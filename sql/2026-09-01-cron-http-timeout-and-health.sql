-- Audit 2026-09-01 REL-N1: pg_cron → edge-function calls were invisible failures.
--
-- All four net.http_post cron jobs used pg_net's 5s default timeout: every
-- observed call ended status_code=null ("Timeout of 5000 ms reached") in
-- net._http_response while cron.job_run_details said "succeeded" (which only
-- means the request was queued). Sends still happened because the edge runtime
-- keeps running after the client disconnect — but a genuinely failing function
-- (RPC error, APNs cert expiry) would look identical to a healthy one.
--
-- Fix 1: timeout_milliseconds := 30000 on all four jobs, so a real response
--        (or a real error) is recorded.
-- Fix 2: public.cron_http_failures() — a service-role-only RPC the 9:15am cost
--        report calls to surface pg_net failures (status null/>=400) and failed
--        cron runs. net._http_response retention is short (~6h), which still
--        covers the hourly jobs at report time.
--
-- NOTE: the repo copy redacts the secret as <CAMPAIGN_TRIGGER_SECRET> — the
-- applied commands carry the real value. When the secret is rotated (audit
-- SEC-2) all four cron commands must be updated again.

SELECT cron.alter_job(1, command := $cmd$ SELECT net.http_post(url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/run-campaign', headers := jsonb_build_object('Content-Type','application/json','x-campaign-secret','<CAMPAIGN_TRIGGER_SECRET>'), body := '{}'::jsonb, timeout_milliseconds := 30000) AS request_id; $cmd$);

SELECT cron.alter_job(3, command := $cmd$ SELECT net.http_post(url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-wear-reminders', headers := jsonb_build_object('Content-Type','application/json','x-campaign-secret','<CAMPAIGN_TRIGGER_SECRET>'), body := '{}'::jsonb, timeout_milliseconds := 30000) AS request_id; $cmd$);

SELECT cron.alter_job(5, command := $cmd$ SELECT net.http_post(url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-broadcast', headers := jsonb_build_object('Content-Type','application/json','x-campaign-secret','<CAMPAIGN_TRIGGER_SECRET>'), body := '{"drain": true}'::jsonb, timeout_milliseconds := 30000) AS request_id; $cmd$);

SELECT cron.alter_job(6, command := $cmd$ SELECT net.http_post(url := 'https://xnzweevzrojmouzhpwzv.supabase.co/functions/v1/send-measure-reminders', headers := jsonb_build_object('Content-Type','application/json','x-campaign-secret','<CAMPAIGN_TRIGGER_SECRET>'), body := '{}'::jsonb, timeout_milliseconds := 30000) AS request_id; $cmd$);

-- Health RPC for the daily cost report (service_role only)
CREATE OR REPLACE FUNCTION public.cron_http_failures(p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_http jsonb;
  v_runs jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total',  count(*),
    'failed', count(*) FILTER (WHERE status_code IS NULL OR status_code >= 400),
    'last_failure', (
      SELECT jsonb_build_object('created', r2.created, 'status', r2.status_code,
                                'error', left(coalesce(r2.error_msg, r2.content::text), 200))
      FROM net._http_response r2
      WHERE (r2.status_code IS NULL OR r2.status_code >= 400)
        AND r2.created > now() - make_interval(hours => p_hours)
      ORDER BY r2.created DESC LIMIT 1
    )
  ) INTO v_http
  FROM net._http_response r
  WHERE r.created > now() - make_interval(hours => p_hours);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'jobname', j.jobname, 'status', d.status,
           'start_time', d.start_time, 'message', left(d.return_message, 200))
         ORDER BY d.start_time DESC), '[]'::jsonb) INTO v_runs
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.status <> 'succeeded'
    AND d.start_time > now() - make_interval(hours => p_hours);

  RETURN jsonb_build_object('http', v_http, 'failed_runs', v_runs);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cron_http_failures(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_http_failures(integer) TO service_role;

NOTIFY pgrst, 'reload schema';
