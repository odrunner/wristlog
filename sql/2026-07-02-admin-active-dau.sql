-- Period-over-period active-user counts for the admin Totals card.
-- Counts DISTINCT external users with ANY activity in each window and its
-- immediately-preceding window:
--   24h  : [now-24h, now)   vs [now-48h, now-24h)
--   7d   : [now-7d,  now)   vs [now-14d, now-7d)
--   30d  : [now-30d, now)   vs [now-60d, now-30d)
-- Uses the SAME activity sources as admin_last_active(), so active_24h/7d/30d
-- match the Active (24h/7d/30d) figures derived from the SEEN column. Per-window
-- counts are required because a user active in both periods has only their
-- latest timestamp in lastActiveByUser, which would undercount the prior period.
CREATE OR REPLACE FUNCTION public.admin_active_dau()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
DECLARE
  n timestamptz := now();
  floor60 timestamptz := now() - interval '60 days';   -- widest lookback (prev-30d start)
  internal uuid[] := ARRAY(SELECT user_id FROM internal_accounts);
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH acts AS (
    SELECT user_id AS uid, last_seen_at AS ts FROM user_presence WHERE last_seen_at >= floor60
    UNION ALL SELECT user_id, created_at FROM logs WHERE created_at >= floor60
    UNION ALL SELECT user_id, created_at FROM watches WHERE created_at >= floor60
    UNION ALL SELECT id, last_sign_in_at FROM auth.users WHERE last_sign_in_at >= floor60
    UNION ALL SELECT user_id, created_at FROM timegrapher_results WHERE created_at >= floor60
    UNION ALL SELECT (messages::jsonb->>'user_id')::uuid, created_at
      FROM timegrapher_tick_logs
      WHERE messages LIKE '{"type":"session_summary"%' AND created_at >= floor60
    UNION ALL SELECT user_id, created_at FROM likes WHERE created_at >= floor60
    UNION ALL SELECT user_id, created_at FROM comments WHERE created_at >= floor60
    UNION ALL SELECT follower_id, created_at FROM follows WHERE created_at >= floor60
    UNION ALL SELECT user_id, created_at FROM comment_likes WHERE created_at >= floor60
    UNION ALL SELECT user_id, created_at FROM valuation_events WHERE created_at >= floor60
    UNION ALL SELECT user_id, created_at FROM identify_attempts WHERE created_at >= floor60
  ),
  ext AS (  -- real external users only: has a profile row (matches
            -- admin_last_active's FROM profiles), not internal, non-null uid.
    SELECT uid, ts FROM acts
    WHERE uid IS NOT NULL AND uid <> ALL(internal)
      AND uid IN (SELECT id FROM profiles)
  )
  SELECT json_build_object(
    'active_24h',      (SELECT count(DISTINCT uid) FROM ext WHERE ts >= n - interval '24 hours'),
    'active_prev_24h', (SELECT count(DISTINCT uid) FROM ext WHERE ts >= n - interval '48 hours' AND ts < n - interval '24 hours'),
    'active_7d',       (SELECT count(DISTINCT uid) FROM ext WHERE ts >= n - interval '7 days'),
    'active_prev_7d',  (SELECT count(DISTINCT uid) FROM ext WHERE ts >= n - interval '14 days' AND ts < n - interval '7 days'),
    'active_30d',      (SELECT count(DISTINCT uid) FROM ext WHERE ts >= n - interval '30 days'),
    'active_prev_30d', (SELECT count(DISTINCT uid) FROM ext WHERE ts >= n - interval '60 days' AND ts < n - interval '30 days')
  ) INTO result;

  RETURN result;
END;
$function$;
