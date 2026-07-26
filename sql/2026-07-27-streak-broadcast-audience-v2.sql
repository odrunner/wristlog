-- Keep the onboarding drip's records clean.
--
-- v1 recorded the 266 broadcast recipients in email_campaign_sends against the
-- onboarding campaign, purely to stop the drip re-sending. That conflated two
-- different things: "Onboarding 2 — Start your streak" then reported 343 sends
-- when only 77 people actually received it as an onboarding email. The
-- broadcast belongs in broadcast_queue and nowhere else.
--
-- Dedup instead comes from broadcast_queue itself, so each record means what it
-- says:
--   email_campaign_sends → the drip only
--   broadcast_queue      → the one-off broadcast only
delete from public.email_campaign_sends s
 where s.campaign_id = '14a9156c-f132-435c-9beb-32800b8c97cb'
   and exists (
     select 1 from public.broadcast_queue q
     where q.uid = s.user_id and q.label = 'Start your streak — fun fact'
   );

-- NOTE: the drip can still never double-send, because its window pass only ever
-- selects created_at in [now-4d, now-3d) and every member of this audience is
-- already older than that (and only gets older). The one way to break that is
-- raising backfill_daily on this campaign — it drains everyone older than the
-- window, which is exactly this cohort. Keep it at 0, or add the same
-- broadcast_queue exclusion to backfillPass first.
create or replace function public.streak_broadcast_audience()
returns table (
  user_id      uuid,
  display_name text,
  brand        text,
  name         text,
  ref          text,
  model_key    text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.display_name,
    w.brand,
    w.name,
    w.ref,
    case when w.brand is null then null
         else lower(trim(w.brand)) || '|' || lower(trim(w.name)) end
  from profiles p
  left join lateral (
    select w.brand, w.name, w.ref
    from watches w
    where w.user_id = p.id
      and trim(coalesce(w.brand, '')) <> ''
      and trim(coalesce(w.name, ''))  <> ''
    order by w.created_at desc
    limit 1
  ) w on true
  where p.is_suspended = false
    and p.created_at < now() - interval '4 days'
    and coalesce((p.email_prefs->>'updates')::boolean, true) is true
    and not exists (select 1 from logs l where l.user_id = p.id)
    and not exists (select 1 from internal_accounts ia where ia.user_id = p.id)
    -- Already received it as an onboarding email.
    and not exists (
      select 1 from email_campaign_sends s
      where s.user_id = p.id
        and s.campaign_id = '14a9156c-f132-435c-9beb-32800b8c97cb'
    )
    -- Already queued or sent by this broadcast (any status) — makes re-running
    -- the enqueue action idempotent now that it no longer writes campaign sends.
    and not exists (
      select 1 from broadcast_queue q
      where q.uid = p.id and q.label = 'Start your streak — fun fact'
    )
  order by p.created_at desc;
$$;

revoke execute on function public.streak_broadcast_audience() from public, anon, authenticated;
grant execute on function public.streak_broadcast_audience() to service_role;

notify pgrst, 'reload schema';
