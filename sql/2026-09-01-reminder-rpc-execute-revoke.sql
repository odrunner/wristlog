-- Audit 2026-09-01 SEC-5: reminder-target RPCs were executable by anon.
--
-- wear_reminder_targets(), measure_reminder_targets() and value_digest_targets()
-- are SECURITY DEFINER selection functions built for the pg_cron → edge-function
-- pipeline (service role). They carried the default PUBLIC EXECUTE, so an
-- anonymous PostgREST call could dump user emails, display names, last-worn
-- watches and total collection values (verified live: 117 rows with emails and
-- values up to $2.36M from value_digest_targets()).
--
-- Only service_role keeps EXECUTE — same pattern as
-- sql/2026-08-22-collection-shares.sql.
--
-- Rollback: GRANT EXECUTE ON FUNCTION public.<name>() TO anon, authenticated;

BEGIN;
REVOKE EXECUTE ON FUNCTION public.wear_reminder_targets()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.measure_reminder_targets() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.value_digest_targets()     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wear_reminder_targets()    TO service_role;
GRANT  EXECUTE ON FUNCTION public.measure_reminder_targets() TO service_role;
GRANT  EXECUTE ON FUNCTION public.value_digest_targets()     TO service_role;
COMMIT;

NOTIFY pgrst, 'reload schema';
