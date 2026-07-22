-- Fun-fact engagement tracking + admin metrics.
-- fact_clicks: one row per (user, post) the first time a user expands that post's
-- fun-fact pill (PK dedupes re-toggles). Admin dashboard reads counts via the
-- SECURITY DEFINER admin_fact_counts() RPC.

create table if not exists public.fact_clicks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  log_id     text not null,               -- logs.id is TEXT (app-generated ids)
  created_at timestamptz not null default now(),
  primary key (user_id, log_id)
);
create index if not exists fact_clicks_created_idx on public.fact_clicks (created_at);

alter table public.fact_clicks enable row level security;
drop policy if exists fact_clicks_insert_own on public.fact_clicks;
create policy fact_clicks_insert_own on public.fact_clicks
  for insert to authenticated with check (user_id = auth.uid());
-- INSERT-only by design. The client does a PLAIN insert and ignores the PK-conflict
-- error (= "already clicked this post"); do NOT use a PostgREST upsert
-- (Prefer: resolution=ignore-duplicates), which needs an UPDATE policy we won't grant.
-- No SELECT/UPDATE/DELETE policy: reads happen only via admin_fact_counts().

-- Admin metrics: totals + last-24h deltas, mirroring admin_dod_counts()'s window
-- (now()-24h) and internal-account exclusion. watch_facts is shared content (no
-- user_id), so generated/watches counts are NOT internal-filtered.
create or replace function public.admin_fact_counts()
returns json
language plpgsql security definer set search_path = 'pg_catalog','public'
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
    'clicks_total',    (select count(*) from fact_clicks where user_id <> all(internal_ids)),
    'clicks_24h',      (select count(*) from fact_clicks where created_at >= d24h and user_id <> all(internal_ids)),
    'viewers_total',   (select count(distinct user_id) from fact_clicks where user_id <> all(internal_ids)),
    'viewers_24h',     (select count(distinct user_id) from fact_clicks where created_at >= d24h and user_id <> all(internal_ids)),
    'generated_total', (select count(*) from watch_facts),
    'generated_24h',   (select count(*) from watch_facts where created_at >= d24h),
    'watches_total',   (select count(distinct model_key) from watch_facts),
    'watches_24h',     (select count(distinct wf.model_key) from watch_facts wf
                         where not exists (
                           select 1 from watch_facts wf2
                           where wf2.model_key = wf.model_key and wf2.created_at < d24h))
  ) into result;

  return result;
end;
$function$;

revoke execute on function public.admin_fact_counts() from public, anon;
grant execute on function public.admin_fact_counts() to authenticated;
