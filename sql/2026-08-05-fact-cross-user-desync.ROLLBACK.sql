-- ROLLBACK for sql/2026-08-05-fact-cross-user-desync.sql
-- Verbatim pg_get_functiondef() output captured from the LIVE database
-- on 2026-08-05, immediately before applying the cross-user desync change.
-- Apply this file to restore the previous fun-fact picker behaviour.

CREATE OR REPLACE FUNCTION public.commit_watch_fact(p_brand text, p_name text, p_wear_date date, p_fact text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_key  text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last int;
  v_next int;
  v_pool int;
  v_fact public.watch_facts%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_fact is null or length(trim(p_fact)) = 0 then raise exception 'empty fact'; end if;

  select last_position into v_last from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if v_last is null then v_last := -1; end if;
  v_next := v_last + 1;

  -- Hard-cap the shared pool at 10 facts/model: never create a position >= 10, so a
  -- client calling this RPC directly cannot grow the pool without bound. Below the cap
  -- we append (race-safe: keep a concurrent wearer's fact if the slot is taken, and
  -- length-bound the stored text defensively); at/above the cap we serve an existing
  -- fact by wrapping, mirroring pick_watch_fact.
  if v_next < 10 then
    insert into public.watch_facts(model_key, position, fact)
      values (v_key, v_next, left(trim(p_fact), 500))
      on conflict (model_key, position) do nothing;
    select * into v_fact from public.watch_facts where model_key = v_key and position = v_next;
  else
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
end $function$
;

CREATE OR REPLACE FUNCTION public.commit_watch_fact_srv(p_user uuid, p_brand text, p_name text, p_wear_date date, p_fact text, p_log_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key  text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_last int;
  v_next int;
  v_pool int;
  v_fact public.watch_facts%rowtype;
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

  if v_next < 10 then
    insert into public.watch_facts(model_key, position, fact)
      values (v_key, v_next, left(trim(p_fact), 500))
      on conflict (model_key, position) do nothing;
    select * into v_fact from public.watch_facts where model_key = v_key and position = v_next;
  else
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

  -- Stamp the post so the fact is frozen even if the client never comes back.
  if p_log_id is not null then
    update public.logs set fact_id = v_fact.id where id = p_log_id and user_id = p_user;
  end if;

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact);
end $function$
;

CREATE OR REPLACE FUNCTION public.peek_watch_fact(p_brand text, p_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Nothing new to show without generating. Write nothing; the caller skips.
  if v_pool = 0 or (v_next >= v_pool and v_pool < 10) then
    return json_build_object('fact_id', null, 'fact', null, 'needs_generation', true);
  end if;

  -- At the 10-fact cap, wrap like pick_watch_fact does.
  v_serve := v_next % v_pool;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.pick_watch_fact(p_brand text, p_name text, p_wear_date date, p_log_id text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Unlike the old single-slot gate this survives logging other dates in between.
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

  -- Need a new fact: user has consumed the whole pool and pool is below the cap.
  -- The edge function generates and commits (commit_watch_fact_srv writes the day
  -- row), so nothing is claimed here.
  if v_next >= v_pool and v_pool < 10 then
    return json_build_object(
      'fact_id', null, 'fact', null, 'needs_generation', true,
      'existing_facts', coalesce(
        (select json_agg(f.fact order by f.position) from public.watch_facts f where f.model_key = v_key),
        '[]'::json));
  end if;

  -- Otherwise serve an existing fact. Below cap: position = v_next. At cap: wrap.
  v_serve := case when v_pool > 0 then v_next % v_pool else 0 end;
  select * into v_fact from public.watch_facts where model_key = v_key and position = v_serve;

  insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, p_wear_date, v_fact.id)
  on conflict (user_id, model_key) do update
    set last_position = excluded.last_position,
        last_wear_date = excluded.last_wear_date,
        current_fact_id = excluded.current_fact_id,
        updated_at = now();

  -- Claim this fact for this wear_date.
  insert into public.watch_fact_days(user_id, model_key, wear_date, fact_id)
    values (v_uid, v_key, p_wear_date, v_fact.id)
  on conflict (user_id, model_key, wear_date) do nothing;

  -- F4: stamp the post here too, so the fact survives a client that never
  -- finishes its own write. Never overwrites an existing fact.
  if p_log_id is not null then
    update public.logs set fact_id = v_fact.id
      where id = p_log_id and user_id = v_uid and fact_id is null;
  end if;

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact,
                           'needs_generation', false, 'existing_facts', '[]'::json);
end $function$
;
