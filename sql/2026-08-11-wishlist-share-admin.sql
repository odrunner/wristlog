-- Admin metrics for wishlist sharing. Mirrors admin_fact_counts()
-- (sql/2026-07-22-fact-clicks-admin.sql): admin-only, internal accounts
-- excluded, totals plus a last-24h window.

create or replace function public.admin_wishlist_share_stats()
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
    'links_total',   (select count(*) from wishlist_shares where user_id <> all(internal_ids)),
    'links_24h',     (select count(*) from wishlist_shares where created_at >= d24h and user_id <> all(internal_ids)),
    'sharers_total', (select count(distinct user_id) from wishlist_shares where user_id <> all(internal_ids)),
    'sharers_24h',   (select count(distinct user_id) from wishlist_shares where created_at >= d24h and user_id <> all(internal_ids)),
    'items_total',   (select coalesce(sum(cardinality(item_ids)), 0) from wishlist_shares where user_id <> all(internal_ids)),
    'opens_total',   (select coalesce(sum(views), 0) from wishlist_shares where user_id <> all(internal_ids)),
    'links_opened',  (select count(*) from wishlist_shares where views > 0 and user_id <> all(internal_ids)),
    'links_active',  (select count(*) from wishlist_shares where revoked_at is null and user_id <> all(internal_ids)),
    'links_revoked', (select count(*) from wishlist_shares where revoked_at is not null and user_id <> all(internal_ids))
  ) into result;

  return result;
end;
$function$;

revoke execute on function public.admin_wishlist_share_stats() from public, anon;
grant execute on function public.admin_wishlist_share_stats() to authenticated;

notify pgrst, 'reload schema';
