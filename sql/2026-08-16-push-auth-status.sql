-- sql/2026-08-16-push-auth-status.sql
-- Latest OS notification-permission status per user, reported by the web layer on every
-- native status callback (onPushAuthStatus). Answers "how many quiet-delivery users pick
-- Deliver Prominently vs Turn Off by day 30" — the metric for the 2.6 provisional build.
CREATE TABLE IF NOT EXISTS push_auth_status (
  user_id       uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  status        text NOT NULL,          -- notDetermined | provisional | authorized | denied
  app_version   text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE push_auth_status ENABLE ROW LEVEL SECURITY;
-- No client policies: written via the RPC below, read only by admin/service-role queries.

CREATE OR REPLACE FUNCTION record_push_auth_status(p_status text, p_app_version text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO push_auth_status (user_id, status, app_version)
  SELECT auth.uid(), p_status, p_app_version
  WHERE auth.uid() IS NOT NULL
    AND p_status IN ('notDetermined', 'provisional', 'authorized', 'denied')
  ON CONFLICT (user_id) DO UPDATE
    SET status = EXCLUDED.status, app_version = EXCLUDED.app_version, updated_at = now();
$$;
NOTIFY pgrst, 'reload schema';
