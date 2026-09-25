-- Audit 2026-09-23 low tail (L8): send-email, send-push and feedback-to-github
-- were reachable by anyone with no credential; replaying a known notification
-- or feedback id re-sent the email / push / GitHub issue. Their triggers now
-- send x-campaign-secret (read from Vault at call time) through one generic
-- trigger function; the functions require it (see _shared/trigger-auth.ts).
-- Args: TG_ARGV[0] = function URL, TG_ARGV[1] = timeout ms.

CREATE OR REPLACE FUNCTION public.webhook_with_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url := TG_ARGV[0],
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-campaign-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'campaign_trigger_secret')),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(NEW), 'old_record', NULL),
    timeout_milliseconds := TG_ARGV[1]::int);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_with_secret() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS feedback ON public.feedback;
CREATE TRIGGER feedback AFTER INSERT ON public.feedback FOR EACH ROW
  EXECUTE FUNCTION public.webhook_with_secret(
    'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/feedback-to-github', '5000');

DROP TRIGGER IF EXISTS "send-push-on-notification" ON public.notifications;
CREATE TRIGGER "send-push-on-notification" AFTER INSERT ON public.notifications FOR EACH ROW
  EXECUTE FUNCTION public.webhook_with_secret(
    'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-push', '15000');

DROP TRIGGER IF EXISTS send_email ON public.notifications;
CREATE TRIGGER send_email AFTER INSERT ON public.notifications FOR EACH ROW
  EXECUTE FUNCTION public.webhook_with_secret(
    'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-email', '15000');
