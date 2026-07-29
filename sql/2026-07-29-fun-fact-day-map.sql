-- ── Fun facts: per-day gate (F2) + server-side stamping on the serve path (F4) ──
-- 2026-07-29. See audit-results/2026-07-29-fun-fact-qa.md.
--
-- F2: pick_watch_fact gated on a SINGLE last_wear_date per (user, model). Logging
-- another date in between wiped the previous day's claim, so the same calendar day
-- could serve two different facts and a backfill burned one fact per day logged
-- (corey, 2026-07-22: positions 0 then 2 for the same day). The claim now lives in
-- its own row per wear_date, so re-logging any past day returns that day's fact.
--
-- F4: the serve path left persistence entirely to the client (markDirty + save()),
-- which is how the dirty-sync race silently dropped fact_id. pick_watch_fact now
-- stamps logs.fact_id itself when given a log id, mirroring commit_watch_fact_srv
-- on the generate path. The client still writes too — the log row often does not
-- exist yet when the RPC runs (save() debounces 500ms), so the stamp is a
-- backstop, not a replacement.

create table if not exists public.watch_fact_days (
  user_id    uuid not null references auth.users(id) on delete cascade,
  model_key  text not null,
  wear_date  date not null,
  fact_id    uuid not null references public.watch_facts(id),
  created_at timestamptz not null default now(),
  primary key (user_id, model_key, wear_date)
);

alter table public.watch_fact_days enable row level security;

drop policy if exists watch_fact_days_own on public.watch_fact_days;
create policy watch_fact_days_own on public.watch_fact_days
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Backfill from posts that already carry a fact — the authoritative history, and
-- richer than watch_fact_progress (which only remembers the most recent day).
-- Keyed on the FACT's model_key, not the watch's current brand/name, so a renamed
-- watch still lands on the right pool. Earliest log per day wins.
insert into public.watch_fact_days (user_id, model_key, wear_date, fact_id)
select distinct on (l.user_id, f.model_key, l.date::date)
       l.user_id, f.model_key, l.date::date, l.fact_id
from public.logs l
join public.watch_facts f on f.id = l.fact_id
where l.fact_id is not null
order by l.user_id, f.model_key, l.date::date, l.created_at
on conflict (user_id, model_key, wear_date) do nothing;

-- Also carry over any in-flight claim that never made it onto a post.
insert into public.watch_fact_days (user_id, model_key, wear_date, fact_id)
select wp.user_id, wp.model_key, wp.last_wear_date, wp.current_fact_id
from public.watch_fact_progress wp
where wp.last_wear_date is not null and wp.current_fact_id is not null
on conflict (user_id, model_key, wear_date) do nothing;

-- ── pick_watch_fact ─────────────────────────────────────────────────────────
-- p_log_id is defaulted so clients running cached JS (which call with three named
-- args) keep working through the rollout.
drop function if exists public.pick_watch_fact(text, text, date);
drop function if exists public.pick_watch_fact(text, text, date, text);
create or replace function public.pick_watch_fact(
  p_brand text, p_name text, p_wear_date date, p_log_id text default null
) returns json
language plpgsql security definer set search_path = public as $$
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
end $$;

-- ── commit_watch_fact_srv: record the day claim too ─────────────────────────
drop function if exists public.commit_watch_fact_srv(uuid, text, text, date, text, text);
create or replace function public.commit_watch_fact_srv(
  p_user uuid, p_brand text, p_name text, p_wear_date date, p_fact text, p_log_id text
) returns json
language plpgsql security definer set search_path = public as $$
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
end $$;

revoke all on function public.commit_watch_fact_srv(uuid, text, text, date, text, text) from public, anon, authenticated;
grant execute on function public.commit_watch_fact_srv(uuid, text, text, date, text, text) to service_role;

notify pgrst, 'reload schema';
