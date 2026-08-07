-- Promo campaigns that open the feedback form.
-- Spec: docs/superpowers/specs/2026-08-06-promo-feedback-campaign-design.md
--
-- A slot with cta_action 'feedback:…' opens the in-app feedback modal. The
-- funnel needs a third number beyond impression/click — how many people who
-- opened the modal actually sent an answer — so promo_events gains a 'submit'
-- event and promo_slot_stats() reports it.

alter table public.promo_events drop constraint if exists promo_events_event_check;
alter table public.promo_events add  constraint promo_events_event_check
  check (event in ('impression','click','dismiss','submit'));

-- Adding a column to the RETURNS TABLE changes the function's return type, and
-- `create or replace` refuses that ("cannot change return type of existing
-- function"). It has to be dropped first.
drop function if exists public.promo_slot_stats();

create function public.promo_slot_stats()
returns table (slot_id uuid, impressions bigint, clicks bigint, dismissals bigint,
               submissions bigint, distinct_users bigint)
language plpgsql
security definer
set search_path = 'pg_catalog','public'
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
           count(distinct e.user_id)
    from public.promo_events e
    where not exists (select 1 from public.internal_accounts i where i.user_id = e.user_id)
    group by e.slot_id;
end;
$function$;

revoke all on function public.promo_slot_stats() from public, anon;
grant execute on function public.promo_slot_stats() to authenticated;

notify pgrst, 'reload schema';
