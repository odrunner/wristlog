-- Fun-fact impressions: the denominator for expand rate, now that the footnote
-- is visible without a tap. Shaped exactly like fact_clicks so the two counts
-- are comparable — composite PK dedups server-side to one row per user per
-- post, insert-only policy, reads go through admin_fact_counts().
-- log_id is text (not uuid) to match fact_clicks.
create table if not exists public.fact_impressions (
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_id     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, log_id)
);

alter table public.fact_impressions enable row level security;

drop policy if exists fact_impressions_insert_own on public.fact_impressions;
create policy fact_impressions_insert_own on public.fact_impressions
  for insert to authenticated with check (user_id = auth.uid());

create index if not exists fact_impressions_created_at_idx
  on public.fact_impressions (created_at);

notify pgrst, 'reload schema';
