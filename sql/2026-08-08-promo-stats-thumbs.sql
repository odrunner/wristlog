-- Surface thumbs up/down in the admin's per-slot stats.
-- Spec: docs/superpowers/specs/2026-08-07-month-in-review-promo-design.md
--
-- The votes were already landing in promo_events, but promo_slot_stats() only
-- counted impression/click/dismiss/submit — so the one signal the recap card
-- exists to collect was invisible in the admin list. Adding two columns rather
-- than a second RPC keeps the admin's single round trip.
--
-- Internal accounts stay excluded, same as every other count here.
--
-- DROP first: CREATE OR REPLACE cannot change a function's return type, and
-- adding OUT columns does exactly that. The admin tab is the only caller.
drop function if exists public.promo_slot_stats();

create or replace function public.promo_slot_stats()
returns table (
  slot_id uuid,
  impressions bigint,
  clicks bigint,
  dismissals bigint,
  submissions bigint,
  thumbs_up bigint,
  thumbs_down bigint,
  distinct_users bigint
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'admin only';
  end if;
  return query
    select e.slot_id,
           count(*) filter (where e.event = 'impression'),
           count(*) filter (where e.event = 'click'),
           count(*) filter (where e.event = 'dismiss'),
           count(*) filter (where e.event = 'submit'),
           count(*) filter (where e.event = 'thumbs_up'),
           count(*) filter (where e.event = 'thumbs_down'),
           count(distinct e.user_id)
    from public.promo_events e
    where not exists (select 1 from public.internal_accounts i where i.user_id = e.user_id)
    group by e.slot_id;
end;
$function$;

notify pgrst, 'reload schema';
