-- sql/2026-11-06-admin-dm-stats.sql
-- Admin dashboard metrics for private messaging (DMs live for everyone since
-- 2026-11-06, sql/2026-11-06-dms-enable.sql).
--
-- One admin-gated SECURITY DEFINER RPC (dm tables are participant-RLS'd, so a
-- client-side count would only see the admin's own threads). A conversation —
-- and its messages and participants — counts only when NEITHER side is an
-- internal account, so UAT traffic between the test accounts never shows up.
--
-- Deploy with:
--   npx supabase db query --linked --file sql/2026-11-06-admin-dm-stats.sql
-- Guarded by tests/admin-dm-stats-sql.test.js.

CREATE OR REPLACE FUNCTION public.admin_dm_stats()
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
  WITH ext_convs AS (
    SELECT c.id, c.user_lo, c.user_hi, c.status, c.created_at
      FROM dm_conversations c
     WHERE NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id IN (c.user_lo, c.user_hi))
  ),
  ext_msgs AS (
    SELECT m.sender_id, m.created_at
      FROM dm_messages m
      JOIN ext_convs c ON c.id = m.conversation_id
  ),
  participants AS (
    -- first_at = when the user's first conversation started, so users_24h is
    -- "users whose FIRST brush with messaging was in the last 24h" (new adopters).
    SELECT u.user_id, min(u.created_at) AS first_at
      FROM (SELECT user_lo AS user_id, created_at FROM ext_convs
            UNION ALL
            SELECT user_hi, created_at FROM ext_convs) u
     GROUP BY u.user_id
  )
  SELECT json_build_object(
    'messages_total',   (SELECT count(*) FROM ext_msgs),
    'messages_24h',     (SELECT count(*) FROM ext_msgs WHERE created_at >= now() - interval '24 hours'),
    'messages_prev24h', (SELECT count(*) FROM ext_msgs WHERE created_at >= now() - interval '48 hours'
                                                         AND created_at <  now() - interval '24 hours'),
    'senders_total',    (SELECT count(DISTINCT sender_id) FROM ext_msgs),
    'senders_24h',      (SELECT count(DISTINCT sender_id) FROM ext_msgs
                          WHERE created_at >= now() - interval '24 hours'),
    'users_total',      (SELECT count(*) FROM participants),
    'users_24h',        (SELECT count(*) FROM participants WHERE first_at >= now() - interval '24 hours'),
    'convs_total',      (SELECT count(*) FROM ext_convs),
    'convs_accepted',   (SELECT count(*) FROM ext_convs WHERE status = 'accepted'),
    'convs_pending',    (SELECT count(*) FROM ext_convs WHERE status = 'pending')
  ) INTO result;
  RETURN result;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.admin_dm_stats() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_dm_stats() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
