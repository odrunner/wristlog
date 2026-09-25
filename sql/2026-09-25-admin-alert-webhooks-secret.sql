-- Audit 2026-09-23 SEC-23-19 — new-user-alert and report-notify took their
-- email content from the request body and needed no secret: anyone knowing a
-- profile or report id could send the admin forged / repeated alerts. The
-- functions now require x-campaign-secret and re-read the row; these triggers
-- send the secret, read from Vault at call time (never a literal).

CREATE OR REPLACE FUNCTION public.webhook_new_user_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/new-user-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-campaign-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'campaign_trigger_secret')),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(NEW), 'old_record', NULL),
    timeout_milliseconds := 15000);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_new_user_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS new_user_alert ON public.profiles;
CREATE TRIGGER new_user_alert AFTER INSERT ON public.profiles FOR EACH ROW
  EXECUTE FUNCTION public.webhook_new_user_alert();

CREATE OR REPLACE FUNCTION public.notify_report_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/report-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-campaign-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'campaign_trigger_secret')),
    body := jsonb_build_object('record', to_jsonb(NEW)),
    timeout_milliseconds := 15000);
  RETURN NEW;
END;
$$;
