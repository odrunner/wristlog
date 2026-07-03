-- Day-over-day active-user counts for the admin Totals card.
-- Counts DISTINCT external users with ANY activity in two 24h windows:
--   active_24h      = [now-24h, now)          (today's DAU)
--   active_prev_24h = [now-48h, now-24h)      (yesterday's DAU)
-- Uses the SAME activity sources as admin_last_active(), so active_24h matches
-- the "Active (24h)" figure the SEEN column shows. A per-window count is needed
-- because a user active both days has only their latest timestamp in
-- lastActiveByUser, which would undercount yesterday.
CREATE OR REPLACE FUNCTION public.admin_active_dau()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
DECLARE
  w0 timestamptz := now() - interval '24 hours';   -- today window start
  w1 timestamptz := now() - interval '48 hours';   -- yesterday window start
  internal uuid[] := ARRAY(SELECT user_id FROM internal_accounts);
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH acts AS (
    SELECT user_id AS uid, last_seen_at AS ts FROM user_presence WHERE last_seen_at >= w1
    UNION ALL SELECT user_id, created_at FROM logs WHERE created_at >= w1
    UNION ALL SELECT user_id, created_at FROM watches WHERE created_at >= w1
    UNION ALL SELECT id, last_sign_in_at FROM auth.users WHERE last_sign_in_at >= w1
    UNION ALL SELECT user_id, created_at FROM timegrapher_results WHERE created_at >= w1
    UNION ALL SELECT (messages::jsonb->>'user_id')::uuid, created_at
      FROM timegrapher_tick_logs
      WHERE messages LIKE '{"type":"session_summary"%' AND created_at >= w1
    UNION ALL SELECT user_id, created_at FROM likes WHERE created_at >= w1
    UNION ALL SELECT user_id, created_at FROM comments WHERE created_at >= w1
    UNION ALL SELECT follower_id, created_at FROM follows WHERE created_at >= w1
    UNION ALL SELECT user_id, created_at FROM comment_likes WHERE created_at >= w1
    UNION ALL SELECT user_id, created_at FROM valuation_events WHERE created_at >= w1
    UNION ALL SELECT user_id, created_at FROM identify_attempts WHERE created_at >= w1
  )
  SELECT json_build_object(
    'active_24h', (
      SELECT count(DISTINCT uid) FROM acts
      WHERE ts >= w0 AND uid IS NOT NULL AND uid <> ALL(internal)
    ),
    'active_prev_24h', (
      SELECT count(DISTINCT uid) FROM acts
      WHERE ts >= w1 AND ts < w0 AND uid IS NOT NULL AND uid <> ALL(internal)
    )
  ) INTO result;

  RETURN result;
END;
$function$;
