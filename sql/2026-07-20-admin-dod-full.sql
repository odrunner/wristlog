-- Expand admin_dod_counts to cover EVERY totals-card metric (day-over-day, last 24h,
-- external users only). Each key mirrors how the corresponding total is computed in
-- loadAdminStats(): price checks = valuation_events, enhances = identify_attempts(mode=enhance),
-- measurements = timegrapher session_summary logs, clubs = clubs, follows = follows,
-- friends = accepted friend_requests, likes = likes.
CREATE OR REPLACE FUNCTION public.admin_dod_counts()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  d24h timestamptz := now() - interval '24 hours';
  internal_ids uuid[] := ARRAY(SELECT user_id FROM internal_accounts);
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT json_build_object(
    'users',        (SELECT count(*) FROM profiles WHERE created_at >= d24h AND id != ALL(internal_ids)),
    'watches',      (SELECT count(*) FROM watches  WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'wears',        (SELECT count(*) FROM logs     WHERE watch_id IS NOT NULL AND created_at >= d24h AND user_id != ALL(internal_ids)),
    'priceChecks',  (SELECT count(*) FROM valuation_events  WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'enhances',     (SELECT count(*) FROM identify_attempts WHERE mode = 'enhance' AND created_at >= d24h AND user_id != ALL(internal_ids)),
    'measurements', (SELECT count(*) FROM timegrapher_tick_logs
                      WHERE messages LIKE '{"type":"session_summary"%' AND created_at >= d24h
                        AND COALESCE((messages::jsonb->>'user_id')::uuid <> ALL(internal_ids), true)),
    'wish',         (SELECT count(*) FROM wishlist WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'clubs',        (SELECT count(*) FROM clubs    WHERE created_at >= d24h AND created_by != ALL(internal_ids)),
    'follows',      (SELECT count(*) FROM follows  WHERE created_at >= d24h AND follower_id != ALL(internal_ids)),
    'friends',      (SELECT count(*) FROM friend_requests WHERE status = 'accepted' AND created_at >= d24h AND initiator_id != ALL(internal_ids)),
    'likes',        (SELECT count(*) FROM likes    WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'comments',     (SELECT count(*) FROM comments WHERE created_at >= d24h AND user_id != ALL(internal_ids))
  ) INTO result;

  RETURN result;
END;
$function$;
