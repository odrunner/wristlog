-- Slot "epoch" for the impression-reset guardrail.
-- Purely additive: no existing column altered/dropped, no row data touched.
-- Same nullable-override shape as first_position (2026-08-03) and
-- max_impressions.
--
-- Finding closed: the client-side impression guardrail (branch
-- promo-impression-guardrail, 2026-08-04) mirrors impression counts into
-- localStorage so a failed promo_events insert still bounds a spent card.
-- That local mirror had no TTL, no version key and no reset path — truncating
-- promo_events to re-air a slot left every returning device's local count in
-- place, so the card stayed retired forever on any device that had already
-- recorded one. updated_at gives the admin a real lever: bump it and every
-- device's stored count (which travels with the slot row on the next load)
-- is invalidated, because it was recorded under the OLD epoch.

alter table public.promo_slots add column if not exists updated_at timestamptz;

-- The admin "Reset impressions" action needs to delete OTHER users'
-- promo_events rows. promo_events_insert_own/select_own (2026-08-02) only
-- ever covered a user's own rows — there was no delete policy of any kind.
-- This is a NEW policy (the name did not exist before), so `drop policy if
-- exists` here is a no-op guard for idempotent re-runs, not a change to any
-- existing policy. Kept as an ordinary RLS-gated policy (matching
-- promo_slots_admin_all's shape) rather than a SECURITY DEFINER RPC, so the
-- reset stays two ordinary client calls — the events delete and the
-- promo_slots.updated_at bump — exactly like every other admin write here.
drop policy if exists promo_events_admin_delete on public.promo_events;
create policy promo_events_admin_delete on public.promo_events
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

notify pgrst, 'reload schema';
