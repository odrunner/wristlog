-- sql/2026-10-26-push-auth-platform.sql
-- push_auth_status gains a platform dimension for the Android port (spec §3): one row per
-- (user, platform). Every existing row and every existing caller is iOS, so the column and the
-- RPC parameter both default to 'ios' — the deployed iOS build keeps working unchanged.
-- Supersedes the single-row shape in sql/2026-08-16-push-auth-status.sql.
ALTER TABLE push_auth_status ADD COLUMN platform text NOT NULL DEFAULT 'ios';
ALTER TABLE push_auth_status DROP CONSTRAINT push_auth_status_pkey;
ALTER TABLE push_auth_status ADD PRIMARY KEY (user_id, platform);

-- Drop the 2-arg signature first: CREATE with an extra defaulted param would OVERLOAD, and two
-- candidates make PostgREST return 300 (ambiguous) for every existing iOS call.
DROP FUNCTION IF EXISTS record_push_auth_status(text, text);

CREATE OR REPLACE FUNCTION record_push_auth_status(
  p_status text,
  p_app_version text DEFAULT NULL,
  p_platform text DEFAULT 'ios'
)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO push_auth_status (user_id, status, app_version, platform)
  SELECT auth.uid(), p_status, p_app_version, p_platform
  WHERE auth.uid() IS NOT NULL
    AND p_status IN ('notDetermined', 'provisional', 'authorized', 'denied')
    AND p_platform IN ('ios', 'android')
  ON CONFLICT (user_id, platform) DO UPDATE
    SET status = EXCLUDED.status, app_version = EXCLUDED.app_version, updated_at = now();
$$;
NOTIFY pgrst, 'reload schema';
