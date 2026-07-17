-- Broadcast email queue: drained nightly (21:30 UTC pg_cron) with leftover Resend quota.
-- Writes are service-role only (send-broadcast edge fn); admin reads via the RPC.
-- Applied 2026-07-17 via supabase db query --linked.

CREATE TABLE IF NOT EXISTS broadcast_queue (
  id bigserial PRIMARY KEY,
  uid uuid NOT NULL,
  email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS broadcast_queue_status_idx ON broadcast_queue (status, id);
ALTER TABLE broadcast_queue ENABLE ROW LEVEL SECURITY;
-- no client policies: service role bypasses RLS; admin visibility via the RPC below

CREATE OR REPLACE FUNCTION public.admin_broadcast_queue_status()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT json_build_object(
    'pending', (SELECT count(*) FROM broadcast_queue WHERE status = 'pending'),
    'sent',    (SELECT count(*) FROM broadcast_queue WHERE status = 'sent'),
    'failed',  (SELECT count(*) FROM broadcast_queue WHERE status = 'failed'),
    'used_today', (SELECT count(*) FROM email_events WHERE event_type = 'sent'
                    AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'),
    'sent_today', (SELECT count(*) FROM broadcast_queue WHERE status = 'sent'
                    AND sent_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc')
  ) INTO result;
  RETURN result;
END; $$;
