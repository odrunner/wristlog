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

-- Extend admin_fact_counts() with impressions_total / impressions_24h so the
-- admin panel can compute an expand rate (clicks / impressions). Everything
-- else is unchanged, including the admin gate and internal_accounts exclusion.
create or replace function public.admin_fact_counts()
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  d24h timestamptz := now() - interval '24 hours';
  internal_ids uuid[] := array(select user_id from internal_accounts);
  result json;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized';
  end if;

  select json_build_object(
    'clicks_total',      (select count(*) from fact_clicks where user_id <> all(internal_ids)),
    'clicks_24h',        (select count(*) from fact_clicks where created_at >= d24h and user_id <> all(internal_ids)),
    'viewers_total',     (select count(distinct user_id) from fact_clicks where user_id <> all(internal_ids)),
    'viewers_24h',       (select count(distinct user_id) from fact_clicks where created_at >= d24h and user_id <> all(internal_ids)),
    'impressions_total', (select count(*) from fact_impressions where user_id <> all(internal_ids)),
    'impressions_24h',   (select count(*) from fact_impressions where created_at >= d24h and user_id <> all(internal_ids)),
    'generated_total',   (select count(*) from watch_facts),
    'generated_24h',     (select count(*) from watch_facts where created_at >= d24h),
    'watches_total',     (select count(distinct model_key) from watch_facts),
    'watches_24h',       (select count(distinct wf.model_key) from watch_facts wf
                           where not exists (
                             select 1 from watch_facts wf2
                             where wf2.model_key = wf.model_key and wf2.created_at < d24h))
  ) into result;

  return result;
end;
$function$;

notify pgrst, 'reload schema';
