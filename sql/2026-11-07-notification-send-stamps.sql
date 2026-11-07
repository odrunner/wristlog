-- 2026-11-07 — Replay guard for send-push / send-email (audit 2026-11-06 F3)
--
-- Both senders fire from AFTER INSERT webhooks on notifications and had no
-- record of "this notification id was already pushed/emailed". pg_net does
-- not retry today, so the dup risk was latent — it becomes real the day
-- anything replays the webhook (manual re-fire, a future retry policy, a
-- second trigger).
--
-- The guard: each sender claims its stamp atomically before sending —
--   UPDATE notifications SET pushed_at = now()
--   WHERE id = $1 AND pushed_at IS NULL RETURNING id
-- (emailed_at for send-email). Zero rows back = already claimed = skip.
-- Claim code: supabase/functions/_shared/send-claim.ts (fails OPEN on a
-- query error — pre-guard behavior — so a DB blip never drops a send).
--
-- The triggers are AFTER INSERT only (send-push-on-notification, send_email),
-- so this UPDATE cannot re-fire them.
--
-- To deliberately re-send one (e.g. after an SES outage), null the stamp
-- first, then re-fire the webhook.
--
-- Grants: notifications has table-level grants (verified 2026-11-07:
-- relacl arwdDxtm for anon/authenticated/service_role), so the new columns
-- need no per-column grant work and client `select('*')` keeps working.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS pushed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

COMMENT ON COLUMN public.notifications.pushed_at  IS 'Claimed by send-push before sending; replay guard (audit 11-06 F3)';
COMMENT ON COLUMN public.notifications.emailed_at IS 'Claimed by send-email before sending; replay guard (audit 11-06 F3)';
