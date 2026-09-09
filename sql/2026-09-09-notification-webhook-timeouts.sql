-- 2026-09-09: raise the pg_net timeout on the two notifications webhook triggers
--
-- The 2026-09-08 cost report flagged "HTTP calls 51, failed 1". Edge logs for the
-- same 6h window showed all 51 pg_net calls returned 200; the "failure" was a
-- send-email trigger call that ran 5806 ms against the trigger's 5000 ms pg_net
-- timeout (a 16:00 UTC burst: wear-reminder cron + admin_stats_refresh + a run of
-- notification inserts, and a cold boot). No email was due, nothing was lost.
--
-- 2026-09-01-cron-http-timeout-and-health.sql raised the four cron jobs to 30 s
-- but left the database-webhook triggers at pg_net's 5 s default. This brings the
-- two notifications triggers (send_email, send-push-on-notification) to 15 s.
-- feedback / auto_add_brand / new_user_alert are untouched (60 s / 5 s / 5 s).
--
-- Applied via `supabase db query --linked` as a DO block so the Bearer secret in
-- the trigger definition never leaves the database.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN ('send_email', 'send-push-on-notification')
      AND tgfoid = 'supabase_functions.http_request'::regproc
  LOOP
    EXECUTE replace(replace(pg_get_triggerdef(r.oid), '''5000'')', '''15000'')'),
                    'CREATE TRIGGER', 'CREATE OR REPLACE TRIGGER');
  END LOOP;
END $$;

-- Verify (secret redacted):
-- SELECT tgname, regexp_replace(pg_get_triggerdef(oid), '[a-zA-Z0-9._-]{60,}', '<secret>', 'g')
-- FROM pg_trigger WHERE NOT tgisinternal AND tgfoid = 'supabase_functions.http_request'::regproc;
