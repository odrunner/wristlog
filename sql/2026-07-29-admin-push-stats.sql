-- Admin Usage → Totals: how many users approved in-app (push) notifications.
--
-- Signal is device_tokens: the iOS app only calls registerForRemoteNotifications()
-- after UNUserNotificationCenter reports .authorized (see ios/.../PushManager.swift),
-- so a row exists iff that user granted permission on at least one device. Web-only
-- users never appear. Two caveats in opposite directions: a later revoke in iOS Settings
-- does NOT delete the row (nothing reports the revoke back), while signing out DOES
-- (PushManager.handleSignOut deletes the token). So this is "has a live registered
-- device", the closest available proxy for approvals — not a strict ever-approved count.
--
-- device_tokens has RLS scoped to auth.uid() = user_id, hence SECURITY DEFINER —
-- an admin client-side select would silently return only the admin's own rows.
--
-- Counts are DISTINCT USERS, not token rows (215 rows / 149 users today — one row
-- per device), external users only, gated on profiles.is_admin like the other admin_* RPCs.
-- The 24h/prev24h figures count users whose FIRST token landed in that window, i.e.
-- newly approved, so they read as a day-over-day delta.
--
-- Applied 2026-07-29 via supabase db query --linked.

CREATE OR REPLACE FUNCTION public.admin_push_stats()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  WITH ext AS (
    SELECT d.user_id, min(d.created_at) AS first_at
    FROM device_tokens d
    WHERE NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = d.user_id)
    GROUP BY d.user_id
  )
  SELECT json_build_object(
    'push_users',        (SELECT count(*) FROM ext),
    'push_users_24h',    (SELECT count(*) FROM ext WHERE first_at >= now() - interval '24 hours'),
    'push_users_prev24h',(SELECT count(*) FROM ext WHERE first_at >= now() - interval '48 hours'
                                                    AND first_at <  now() - interval '24 hours'),
    'push_devices',      (SELECT count(*) FROM device_tokens d
                           WHERE NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = d.user_id))
  ) INTO result;
  RETURN result;
END; $function$;

-- Lockdown per sql/2026-07-26-admin-rpc-revoke-anon.sql: PUBLIC carries the default
-- EXECUTE grant that anon inherits, so revoke PUBLIC too, then re-grant the real callers.
REVOKE EXECUTE ON FUNCTION public.admin_push_stats() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_push_stats() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
