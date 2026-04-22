CREATE OR REPLACE FUNCTION admin_dod_counts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d24h timestamptz := now() - interval '24 hours';
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '{}'::json; END IF;

  SELECT json_build_object(
    'users',       (SELECT count(*) FROM profiles WHERE created_at >= d24h),
    'watches',     (SELECT count(*) FROM watches WHERE created_at >= d24h),
    'wears',       (SELECT count(*) FROM logs WHERE watch_id IS NOT NULL AND created_at >= d24h),
    'wish',        (SELECT count(*) FROM wishlist WHERE created_at >= d24h),
    'comments',    (SELECT count(*) FROM comments WHERE created_at >= d24h),
    'clubs',       (SELECT count(*) FROM clubs WHERE created_at >= d24h),
    'friends',     (SELECT count(*) FROM friend_requests WHERE status = 'accepted' AND created_at >= d24h),
    'follows',     (SELECT count(*) FROM follows WHERE created_at >= d24h),
    'likes',       (SELECT count(*) FROM likes WHERE created_at >= d24h),
    'enhances',    (SELECT count(*) FROM identify_attempts WHERE mode = 'enhance' AND created_at >= d24h),
    'priceChecks', (SELECT coalesce(sum(request_count), 0) FROM rate_limits WHERE function_name LIKE 'watch-value:%' AND window_start >= d24h),
    'measurements',(SELECT count(*) FROM timegrapher_sessions WHERE created_at >= d24h)
  ) INTO result;

  RETURN result;
END;
$$;
