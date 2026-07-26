-- Audience for the one-off "Start your streak" broadcast: everyone the drip
-- campaign will never reach, so nobody can receive it twice.
--
-- Exclusions, in the order they matter:
--   • already in email_campaign_sends for this campaign  → "got it"
--   • created_at newer than the drip window (4 days)     → "will get it"
--     The 10:00 UTC window pass selects created_at in [now-4d, now-3d); anyone
--     newer still has their day-3 slot ahead of them. Anyone older has already
--     passed it.
--   • has any wear log        → mirrors the campaign's skip_if_done = has_log
--   • internal / suspended / email_prefs.updates = false
--
-- Returns the featured watch too (newest with both brand and name, mirroring
-- pickFeaturedWatch in run-campaign/lib.ts) so the caller can resolve a fact.
-- brand/name are NULL for members with no usable watch — they get the curated
-- fallback fact rather than being dropped.
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
    and not exists (
      select 1 from email_campaign_sends s
      where s.user_id = p.id
        and s.campaign_id = '14a9156c-f132-435c-9beb-32800b8c97cb'
    )
  order by p.created_at desc;
$$;

-- Service role only: this returns a mailing list. No client ever calls it.
revoke execute on function public.streak_broadcast_audience() from public, anon, authenticated;
grant execute on function public.streak_broadcast_audience() to service_role;

notify pgrst, 'reload schema';
