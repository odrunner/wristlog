-- sql/2026-10-26-admin-push-stats-platform.sql
-- Android tokens exist now (Android port Plan 4). The headline iOS counts must keep their
-- exact meaning (spec anti-goal: don't pollute iOS push stats), so the user/delta counts are
-- scoped to iOS and android gets its own keys. Supersedes sql/2026-07-29-admin-push-stats.sql.
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
    WHERE d.platform <> 'android'
      AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = d.user_id)
    GROUP BY d.user_id
  ),
  droid AS (
    SELECT d.user_id, min(d.created_at) AS first_at
    FROM device_tokens d
    WHERE d.platform = 'android'
      AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = d.user_id)
    GROUP BY d.user_id
  )
  SELECT json_build_object(
    'push_users',        (SELECT count(*) FROM ext),
    'push_users_24h',    (SELECT count(*) FROM ext WHERE first_at >= now() - interval '24 hours'),
    'push_users_prev24h',(SELECT count(*) FROM ext WHERE first_at >= now() - interval '48 hours'
                                                    AND first_at <  now() - interval '24 hours'),
    'push_devices',      (SELECT count(*) FROM device_tokens d
                           WHERE d.platform <> 'android'
                             AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = d.user_id)),
    'android_push_users',   (SELECT count(*) FROM droid),
    'android_push_devices', (SELECT count(*) FROM device_tokens d
                              WHERE d.platform = 'android'
                                AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = d.user_id))
  ) INTO result;
  RETURN result;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.admin_push_stats() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_push_stats() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
