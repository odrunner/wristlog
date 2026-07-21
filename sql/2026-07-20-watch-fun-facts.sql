-- Daily Watch Fun Fact — shared lazy fact pool + per-user cursor.

create table if not exists public.watch_facts (
  id         uuid primary key default gen_random_uuid(),
  model_key  text not null,
  position   int  not null,
  fact       text not null,
  created_at timestamptz not null default now(),
  unique (model_key, position)
);
create index if not exists watch_facts_model_key_idx on public.watch_facts (model_key);

create table if not exists public.watch_fact_progress (
  user_id         uuid not null references auth.users(id) on delete cascade,
  model_key       text not null,
  last_position   int  not null default -1,
  last_wear_date  date,
  current_fact_id uuid references public.watch_facts(id),
  updated_at      timestamptz not null default now(),
  primary key (user_id, model_key)
);

alter table public.logs add column if not exists fact_id uuid references public.watch_facts(id);

-- RLS: facts are shared, non-sensitive → readable by any authenticated user.
alter table public.watch_facts enable row level security;
drop policy if exists watch_facts_select on public.watch_facts;
create policy watch_facts_select on public.watch_facts
  for select to authenticated using (true);
-- No INSERT/UPDATE/DELETE policy: writes happen only via SECURITY DEFINER RPCs.

-- RLS: a user sees/writes only their own cursor (RPCs also enforce auth.uid()).
alter table public.watch_fact_progress enable row level security;
drop policy if exists watch_fact_progress_own on public.watch_fact_progress;
create policy watch_fact_progress_own on public.watch_fact_progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- RPC: pick_watch_fact — per-user cursor + daily-gate + cap-wrap logic.
create or replace function public.pick_watch_fact(
  p_brand text, p_name text, p_wear_date date
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text := lower(trim(p_brand)) || '|' || lower(trim(p_name));
  v_prog  public.watch_fact_progress%rowtype;
  v_pool  int;
  v_next  int;
  v_serve int;
  v_fact  public.watch_facts%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_prog from public.watch_fact_progress
    where user_id = v_uid and model_key = v_key;
  if not found then
    v_prog.last_position := -1;
    v_prog.last_wear_date := null;
    v_prog.current_fact_id := null;
  end if;

  -- Same-day re-wear: return the already-chosen fact, no advance, no generation.
  if v_prog.last_wear_date = p_wear_date and v_prog.current_fact_id is not null then
    select * into v_fact from public.watch_facts where id = v_prog.current_fact_id;
    return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact,
                             'needs_generation', false, 'existing_facts', '[]'::json);
  end if;

  select count(*) into v_pool from public.watch_facts where model_key = v_key;
  v_next := v_prog.last_position + 1;

  -- Need a new fact: user has consumed the whole pool and pool is below the cap.
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

  update public.watch_fact_progress
    set last_position = v_next, last_wear_date = p_wear_date,
        current_fact_id = v_fact.id, updated_at = now()
    where user_id = v_uid and model_key = v_key;
  if not found then
    insert into public.watch_fact_progress(user_id, model_key, last_position, last_wear_date, current_fact_id)
    values (v_uid, v_key, v_next, p_wear_date, v_fact.id);
  end if;

  return json_build_object('fact_id', v_fact.id, 'fact', v_fact.fact,
                           'needs_generation', false, 'existing_facts', '[]'::json);
end $$;

grant execute on function public.pick_watch_fact(text, text, date) to authenticated;
