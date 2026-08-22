-- Collection sharing: one row per minted link. A straight mirror of
-- wishlist_shares (sql/2026-08-11-wishlist-shares.sql) for the Collection tab,
-- served by the share-watches edge function.
--
-- Possession of the token IS the authorisation. A collection share is often
-- sent by someone whose collection is Followers-only or Private, to a recipient
-- with no WRotate account — a guessable ?u=<username> URL cannot carry that.
--
-- item_ids is FROZEN at mint time; item CONTENTS are read live by the edge
-- function. watches.id is TEXT (app-generated ids), so item_ids is text[].

create table if not exists public.collection_shares (
  token          text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text,
  item_ids       text[] not null,
  views          integer not null default 0,
  last_viewed_at timestamptz,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

create index if not exists collection_shares_user_idx
  on public.collection_shares (user_id, created_at desc);
create index if not exists collection_shares_created_idx
  on public.collection_shares (created_at);

alter table public.collection_shares enable row level security;

-- Owner-scoped only. The public page is served by the edge function on the
-- service-role key, which bypasses RLS, so there is no anon policy here.
drop policy if exists collection_shares_insert_own on public.collection_shares;
create policy collection_shares_insert_own on public.collection_shares
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists collection_shares_select_own on public.collection_shares;
create policy collection_shares_select_own on public.collection_shares
  for select to authenticated using (user_id = auth.uid());

-- UPDATE exists so the owner can revoke.
drop policy if exists collection_shares_update_own on public.collection_shares;
create policy collection_shares_update_own on public.collection_shares
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists collection_shares_delete_own on public.collection_shares;
create policy collection_shares_delete_own on public.collection_shares
  for delete to authenticated using (user_id = auth.uid());

-- Atomic view counter, called by the share-watches edge function on the
-- service-role key. SECURITY DEFINER so the increment does not depend on RLS,
-- and granted only to service_role — nobody else may inflate a counter.
create or replace function public.bump_collection_share_view(p_token text)
returns void
language sql security definer set search_path = 'pg_catalog','public'
as $function$
  update public.collection_shares
     set views = views + 1, last_viewed_at = now()
   where token = p_token and revoked_at is null;
$function$;

revoke execute on function public.bump_collection_share_view(text) from public, anon, authenticated;
grant execute on function public.bump_collection_share_view(text) to service_role;

-- Admin metrics, mirroring admin_wishlist_share_stats(): admin-only, internal
-- accounts excluded, totals plus a last-24h window.
create or replace function public.admin_collection_share_stats()
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
    'links_total',   (select count(*) from collection_shares where user_id <> all(internal_ids)),
    'links_24h',     (select count(*) from collection_shares where created_at >= d24h and user_id <> all(internal_ids)),
    'sharers_total', (select count(distinct user_id) from collection_shares where user_id <> all(internal_ids)),
    'sharers_24h',   (select count(distinct user_id) from collection_shares where created_at >= d24h and user_id <> all(internal_ids)),
    'items_total',   (select coalesce(sum(cardinality(item_ids)), 0) from collection_shares where user_id <> all(internal_ids)),
    'opens_total',   (select coalesce(sum(views), 0) from collection_shares where user_id <> all(internal_ids)),
    'links_opened',  (select count(*) from collection_shares where views > 0 and user_id <> all(internal_ids)),
    'links_active',  (select count(*) from collection_shares where revoked_at is null and user_id <> all(internal_ids)),
    'links_revoked', (select count(*) from collection_shares where revoked_at is not null and user_id <> all(internal_ids))
  ) into result;

  return result;
end;
$function$;

revoke execute on function public.admin_collection_share_stats() from public, anon;
grant execute on function public.admin_collection_share_stats() to authenticated;

notify pgrst, 'reload schema';
