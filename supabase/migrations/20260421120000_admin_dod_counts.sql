CREATE OR REPLACE FUNCTION admin_dod_counts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d24h timestamptz := now() - interval '24 hours';
  internal_ids uuid[] := ARRAY[
    'd70b1a85-4f31-4431-b3b7-db76543daaf5',
    '9f6fccd3-e3d2-4595-87e7-de34ed859500',
    'e0af1615-b151-4260-b6bd-c23e497efa6d',
    '86ea0f82-044d-4730-82af-b942e3b09380',
    '3aa24417-214c-467d-b3aa-e76d63d73476',
    '73e4e48e-dbca-4b2e-82d2-35d5b39716d2'
  ]::uuid[];
  result json;
BEGIN
  IF auth.uid() IS NULL THEN RETURN '{}'::json; END IF;

  SELECT json_build_object(
    'users',       (SELECT count(*) FROM profiles WHERE created_at >= d24h AND id != ALL(internal_ids)),
    'watches',     (SELECT count(*) FROM watches WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'wears',       (SELECT count(*) FROM logs WHERE watch_id IS NOT NULL AND created_at >= d24h AND user_id != ALL(internal_ids)),
    'wish',        (SELECT count(*) FROM wishlist WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'comments',    (SELECT count(*) FROM comments WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'clubs',       (SELECT count(*) FROM clubs WHERE created_at >= d24h),
    'friends',     (SELECT count(*) FROM friend_requests WHERE status = 'accepted' AND created_at >= d24h AND initiator_id != ALL(internal_ids)),
    'follows',     (SELECT count(*) FROM follows WHERE created_at >= d24h AND follower_id != ALL(internal_ids)),
    'likes',       (SELECT count(*) FROM likes WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'enhances',    (SELECT count(*) FROM identify_attempts WHERE mode = 'enhance' AND created_at >= d24h AND user_id != ALL(internal_ids)),
    'priceChecks', (SELECT coalesce(sum(request_count), 0) FROM rate_limits WHERE function_name LIKE 'watch-value:%' AND window_start >= d24h AND user_id != ALL(internal_ids)),
    'measurements',(SELECT count(*) FROM timegrapher_results WHERE created_at >= d24h AND user_id != ALL(internal_ids))
  ) INTO result;

  RETURN result;
END;
$$;
