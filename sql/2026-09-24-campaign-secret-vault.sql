-- Audit 2026-09-23 SEC-23-5 (key rotation, step 1b).
-- CAMPAIGN_TRIGGER_SECRET was a literal inside four cron commands and the
-- auto_add_brand webhook, so every schema dump (sql/schema.sql) published it.
-- It now lives only in Supabase Vault as 'campaign_trigger_secret' and is read
-- at call time. The Vault row itself is created/rotated out-of-band (never in
-- a file): SELECT vault.update_secret(id, '<new>') … plus
-- `supabase secrets set CAMPAIGN_TRIGGER_SECRET=<new>` for the edge functions.

-- auto_add_brand: supabase_functions.http_request only takes literal headers,
-- so it gets a small equivalent that reads Vault. Payload shape matches the
-- Database Webhook format (type/table/schema/record/old_record).
CREATE OR REPLACE FUNCTION public.webhook_auto_add_brand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/auto-add-brand',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-campaign-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'campaign_trigger_secret')),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(NEW), 'old_record', NULL),
    timeout_milliseconds := 60000);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_auto_add_brand() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auto_add_brand ON public.feedback;
CREATE TRIGGER auto_add_brand AFTER INSERT ON public.feedback FOR EACH ROW
  EXECUTE FUNCTION public.webhook_auto_add_brand();

-- Cron: same calls, secret read from Vault (cron runs as postgres).
SELECT cron.alter_job(j.jobid, command := format($c$ SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-campaign-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'campaign_trigger_secret')), body := %L::jsonb, timeout_milliseconds := 30000) AS request_id; $c$, j.url, j.body))
FROM (VALUES
  (1, 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/run-campaign', '{}'),
  (3, 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-wear-reminders', '{}'),
  (5, 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-broadcast', '{"drain": true}'),
  (6, 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-measure-reminders', '{}')
) AS j(jobid, url, body);
