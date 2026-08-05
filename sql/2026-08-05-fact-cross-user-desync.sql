-- Cross-user fun-fact desync — 2026-08-05
--
-- Problem: watch_fact_progress.last_position starts at -1 for every user, and
-- the serve position was `last_position + 1`. So the FIRST wear of any model
-- served position 0 to EVERYONE, and two people owning the same reference then
-- walked the pool in lockstep, reading identical trivia (9 such facts in the
-- wild as of 2026-08-05, e.g. rolex|gmt-master ii positions 1, 2 and 3).
--
-- Re-ordering cannot fix it: 357 of 413 models have a pool of exactly ONE fact,
-- so the second owner needs a fact that does not exist yet. The pick RPC now
-- serves the lowest pool fact NOBODY has been served, and asks the caller to
-- generate when there is none and the pool is under the 10/model cap.
--
-- The commit RPCs are the necessary companion change: they appended at the
-- CALLER'S cursor (`v_next`), so a second user generating their first fact
-- wrote position 0, hit `on conflict do nothing`, and got handed the very fact
-- we were trying to avoid. They now append at the true end of the pool, and
-- retry on a concurrent append so two simultaneous generations cannot collapse
-- onto one row.

-- Supports the "has this fact ever been served?" probes below. logs is small
-- (2699 rows) but the probes run on every wear log, so index the lookup.
create index if not exists logs_fact_id_idx on public.logs (fact_id) where fact_id is not null;

-- ── pick_watch_fact ────────────────────────────────────────────────────────
create or replace function public.pick_watch_fact(
  p_brand text, p_name text, p_wear_date date, p_log_id text default null
) returns json
language plpgsql security definer set search_path = public as $function$
declare
  v_uid   uuid := auth.uid();
  v_key   text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last  int;
  v_pool  int;
  v_next  int;
  v_serve int;
  v_fact  public.watch_facts%rowtype;
  v_dayid uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- This wear_date already has a fact: return it, no advance, no generation.
  select fact_id into v_dayid from public.watch_fact_days
    where user_id = v_uid and model_key = v_key and wear_date = p_wear_date;
  if v_dayid is not null then
    select * into v_fact from public.watch_facts where id = v_dayid;
    if p_log_id is not null then
      update public.logs set fact_id = v_fact.id
        where id = p_log_id and user_id = v_uid and fact_id is null;
    end if;
    return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact,
                             'needs_generation', false, 'existing_facts', '[]'::json);
  end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if v_last is null then v_last := -1; end if;

  select count(*) into v_pool from public.watch_facts where model_key = v_key;
  v_next := v_last + 1;

  -- Lowest pool fact that has never been served to ANYONE. watch_fact_days is
  -- checked alongside logs because peek_watch_fact claims a fact for the login
  -- modal before any post exists to carry it.
  select min(f.position) into v_serve
    from public.watch_facts f
   where f.model_key = v_key
     and not exists (select 1 from public.logs l where l.fact_id = f.id)
     and not exists (select 1 from public.watch_fact_days d where d.fact_id = f.id);

  -- Nothing fresh in the pool. Below the cap, generate rather than repeat —
  -- this is what stops a second owner of the same watch reading the first
  -- owner's fact. existing_facts steers the generator off what is already there.
  if v_serve is null and v_pool < 10 then
    return json_build_object(
      'fact_id', null, 'fact', null, 'needs_generation', true,
      'existing_facts', coalesce(
        (select json_agg(f.fact order by f.position) from public.watch_facts f where f.model_key = v_key),
        '[]'::json));
  end if;

  -- At the cap: every fact is spoken for, so a repeat is unavoidable. Prefer one
  -- THIS user has not read before; fall back to the old cursor wrap.
  if v_serve is null then
    select min(f.position) into v_serve
      from public.watch_facts f
     where f.model_key = v_key
       and not exists (select 1 from public.logs l
                        where l.fact_id = f.id and l.user_id = v_uid)
       and not exists (select 1 from public.watch_fact_days d
                        where d.fact_id = f.id and d.user_id = v_uid);
  end if;
  if v_serve is null then
    v_serve := case when v_pool > 0 then v_next % v_pool else 0 end;
  end if;

  select * into v_fact from public.watch_facts where model_key = v_key and position = v_serve;
  if v_fact.id is null then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true,
                             'existing_facts', '[]'::json);
  end if;

  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, p_wear_date, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position = excluded.last_position,
        last_wear_date = excluded.last_wear_date,
        current_fact_id = excluded.current_fact_id,
        updated_at = now();

  insert into public.watch_fact_days(user_id, model_key, wear_date, fact_id)
    values (v_uid, v_key, p_wear_date, v_fact.id)
  on conflict (user_id, model_key, wear_date) do nothing;

  if p_log_id is not null then
    update public.logs set fact_id = v_fact.id
      where id = p_log_id and user_id = v_uid and fact_id is null;
  end if;

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact,
                           'needs_generation', false, 'existing_facts', '[]'::json);
end $function$;

grant execute on function public.pick_watch_fact(text, text, date, text) to authenticated;

-- ── commit_watch_fact_srv ──────────────────────────────────────────────────
create or replace function public.commit_watch_fact_srv(
  p_user uuid, p_brand text, p_name text, p_wear_date date, p_fact text, p_log_id text
) returns json
language plpgsql security definer set search_path = public as $function$
declare
  v_key   text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last  int;
  v_next  int;
  v_pool  int;
  v_pos   int;
  v_try   int := 0;
  v_fact  public.watch_facts%rowtype;
  v_dayid uuid;
begin
  if p_user is null then raise exception 'user required'; end if;
  if p_fact is null or length(trim(p_fact)) = 0 then raise exception 'empty fact'; end if;

  -- If this wear_date was already claimed (a concurrent generation, or a retry),
  -- reuse it instead of burning another position.
  select fact_id into v_dayid from public.watch_fact_days
    where user_id = p_user and model_key = v_key and wear_date = p_wear_date;
  if v_dayid is not null then
    select * into v_fact from public.watch_facts where id = v_dayid;
    if p_log_id is not null then
      update public.logs set fact_id = v_fact.id
        where id = p_log_id and user_id = p_user and fact_id is null;
    end if;
    return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact);
  end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = p_user and model_key = v_key;
  if v_last is null then v_last := -1; end if;
  v_next := v_last + 1;

  -- Append at the END of the shared pool, not at this user's cursor. The old
  -- code used v_next, so a second owner's first generated fact landed on
  -- position 0, hit the conflict, and was handed the first owner's fact back —
  -- exactly the duplicate we are generating to avoid. Retry on a concurrent
  -- append so two simultaneous generations get two rows, not one.
  loop
    select coalesce(max(position), -1) + 1 into v_pos
      from public.watch_facts where model_key = v_key;
    exit when v_pos >= 10 or v_try >= 3;
    insert into public.watch_facts(model_key, position, fact)
      values (v_key, v_pos, left(trim(p_fact), 500))
      on conflict (model_key, position) do nothing
      returning * into v_fact;
    exit when v_fact.id is not null;
    v_try := v_try + 1;
  end loop;

  -- At/over the cap (or lost every retry): serve an existing fact by wrapping.
  if v_fact.id is null then
    select count(*) into v_pool from public.watch_facts where model_key = v_key;
    if v_pool = 0 then raise exception 'no facts to serve'; end if;
    select * into v_fact from public.watch_facts where model_key = v_key and position = (v_next % v_pool);
  end if;

  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (p_user, v_key, v_next, p_wear_date, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position = v_next, last_wear_date = p_wear_date,
        current_fact_id = v_fact.id, updated_at = now();

  insert into public.watch_fact_days(user_id, model_key, wear_date, fact_id)
    values (p_user, v_key, p_wear_date, v_fact.id)
  on conflict (user_id, model_key, wear_date) do nothing;

  if p_log_id is not null then
    update public.logs set fact_id = v_fact.id where id = p_log_id and user_id = p_user;
  end if;

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact);
end $function$;

-- ── commit_watch_fact (client-callable legacy twin) ────────────────────────
create or replace function public.commit_watch_fact(
  p_brand text, p_name text, p_wear_date date, p_fact text
) returns json
language plpgsql security definer set search_path = public as $function$
declare
  v_uid  uuid := auth.uid();
  v_key  text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last int;
  v_next int;
  v_pool int;
  v_pos  int;
  v_try  int := 0;
  v_fact public.watch_facts%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_fact is null or length(trim(p_fact)) = 0 then raise exception 'empty fact'; end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if v_last is null then v_last := -1; end if;
  v_next := v_last + 1;

  -- Same end-of-pool append as commit_watch_fact_srv; the 10/model cap still
  -- holds, so a client calling this directly cannot grow the pool without bound.
  loop
    select coalesce(max(position), -1) + 1 into v_pos
      from public.watch_facts where model_key = v_key;
    exit when v_pos >= 10 or v_try >= 3;
    insert into public.watch_facts(model_key, position, fact)
      values (v_key, v_pos, left(trim(p_fact), 500))
      on conflict (model_key, position) do nothing
      returning * into v_fact;
    exit when v_fact.id is not null;
    v_try := v_try + 1;
  end loop;

  if v_fact.id is null then
    select count(*) into v_pool from public.watch_facts where model_key = v_key;
    if v_pool = 0 then raise exception 'no facts to serve'; end if;
    select * into v_fact from public.watch_facts where model_key = v_key and position = (v_next % v_pool);
  end if;

  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, p_wear_date, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position = v_next, last_wear_date = p_wear_date,
        current_fact_id = v_fact.id, updated_at = now();

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact);
end $function$;

-- ── peek_watch_fact ────────────────────────────────────────────────────────
-- The login modal. It cannot generate, so it degrades instead of demanding a
-- fresh fact: prefer one nobody has read, then one THIS user has not read, then
-- skip. It must not hand out someone else's fact as if it were new.
create or replace function public.peek_watch_fact(p_brand text, p_name text)
returns json
language plpgsql security definer set search_path = public as $function$
declare
  v_uid   uuid := auth.uid();
  v_key   text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last  int;
  v_pool  int;
  v_next  int;
  v_serve int;
  v_fact  public.watch_facts%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_brand), '') = '' or coalesce(trim(p_name), '') = '' then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if v_last is null then v_last := -1; end if;

  select count(*) into v_pool from public.watch_facts where model_key = v_key;
  v_next := v_last + 1;

  if v_pool = 0 then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  select min(f.position) into v_serve
    from public.watch_facts f
   where f.model_key = v_key
     and not exists (select 1 from public.logs l where l.fact_id = f.id)
     and not exists (select 1 from public.watch_fact_days d where d.fact_id = f.id);

  if v_serve is null then
    select min(f.position) into v_serve
      from public.watch_facts f
     where f.model_key = v_key
       and not exists (select 1 from public.logs l
                        where l.fact_id = f.id and l.user_id = v_uid)
       and not exists (select 1 from public.watch_fact_days d
                        where d.fact_id = f.id and d.user_id = v_uid);
  end if;

  -- Nothing this user has not already read. Write nothing; the caller skips.
  if v_serve is null then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  select * into v_fact from public.watch_facts
    where model_key = v_key and position = v_serve;
  if v_fact.id is null then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  -- last_wear_date stays NULL on purpose: the next wear log must advance again.
  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, null, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position   = v_next,
        last_wear_date  = null,
        current_fact_id = v_fact.id,
        updated_at      = now();

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact, 'needs_generation', false);
end $function$;
