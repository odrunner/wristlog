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
