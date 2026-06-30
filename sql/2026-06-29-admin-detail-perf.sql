-- 2026-06-29: kill the ~1.1s tick_logs scan on every admin user-detail open.
--
-- Before: the modal fired admin_user_detail AND a separate client-side
-- double-LIKE over all 16.5k tick_logs rows (`%session_summary%` + `%userId%`,
-- ~960ms, unindexable) to compute measurement counts, then overrode the RPC's
-- timegrapher_results-based counts with the tick-log ones.
--
-- After: a partial index on the extracted user_id of session_summary rows only
-- (~1170 rows, written once per session — NOT the 3s debug rows), and the
-- measurement aggregation folded into admin_user_detail so the client drops its
-- second query entirely. The RPC's existing last_active scan also uses the index.

CREATE INDEX IF NOT EXISTS idx_ttl_summary_user
  ON public.timegrapher_tick_logs (((messages::jsonb->>'user_id')::uuid))
  WHERE messages LIKE '{"type":"session_summary"%';

CREATE OR REPLACE FUNCTION public.admin_user_detail(target_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
DECLARE
  result json;
  v_last_active timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT greatest(
    (SELECT last_seen_at FROM user_presence WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM logs WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM watches WHERE user_id = target_user_id),
    (SELECT last_sign_in_at FROM auth.users WHERE id = target_user_id),
    (SELECT max(created_at) FROM timegrapher_results WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM timegrapher_tick_logs
       WHERE messages LIKE '{"type":"session_summary"%'
         AND (messages::jsonb->>'user_id')::uuid = target_user_id),
    (SELECT max(created_at) FROM likes WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM comments WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM follows WHERE follower_id = target_user_id),
    (SELECT max(created_at) FROM comment_likes WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM valuation_events WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM identify_attempts WHERE user_id = target_user_id)
  ) INTO v_last_active;

  SELECT json_build_object(
    'profile', (
      SELECT json_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url,
        'bio', p.bio,
        'created_at', p.created_at,
        'profile_privacy', p.profile_privacy,
        'collection_visibility', p.collection_visibility,
        'is_suspended', p.is_suspended
      ) FROM profiles p WHERE p.id = target_user_id
    ),
    'last_active', v_last_active,
    'last_sign_in', v_last_active,
    'watches', (SELECT count(*) FROM watches WHERE user_id = target_user_id),
    'wears', (SELECT count(*) FROM logs WHERE user_id = target_user_id AND watch_id IS NOT NULL),
    'posts', (SELECT count(*) FROM logs WHERE user_id = target_user_id AND watch_id IS NULL),
    'wishlist', (SELECT count(*) FROM wishlist WHERE user_id = target_user_id),
    -- Measurement counts from tick_logs session_summary rows (timegrapher_results
    -- is RLS-blocked to the test user; the client used to compute these itself).
    'measurements_total', (
      SELECT count(*) FROM timegrapher_tick_logs
      WHERE messages LIKE '{"type":"session_summary"%'
        AND (messages::jsonb->>'user_id')::uuid = target_user_id
    ),
    'measurements_success', (
      SELECT count(*) FROM timegrapher_tick_logs
      WHERE messages LIKE '{"type":"session_summary"%'
        AND (messages::jsonb->>'user_id')::uuid = target_user_id
        AND ((messages::jsonb->>'converged')::boolean
             OR messages::jsonb->>'stop_reason' = 'converged')
    ),
    'advanced_sessions', (
      SELECT count(*) FROM timegrapher_tick_logs
      WHERE messages LIKE '{"type":"session_summary"%'
        AND (messages::jsonb->>'user_id')::uuid = target_user_id
        AND (messages::jsonb->>'advanced_used')::boolean
    ),
    'advanced_last_preset', (
      SELECT coalesce(messages::jsonb->>'adv_preset', 'custom')
      FROM timegrapher_tick_logs
      WHERE messages LIKE '{"type":"session_summary"%'
        AND (messages::jsonb->>'user_id')::uuid = target_user_id
        AND (messages::jsonb->>'advanced_used')::boolean
      ORDER BY created_at DESC LIMIT 1
    ),
    'enhances', (SELECT count(*) FROM identify_attempts WHERE user_id = target_user_id AND mode = 'enhance'),
    'price_checks', (SELECT count(*) FROM valuation_events WHERE user_id = target_user_id),
    'followers', (SELECT count(*) FROM follows WHERE following_id = target_user_id),
    'following', (SELECT count(*) FROM follows WHERE follower_id = target_user_id),
    'friends', (SELECT count(*) FROM friend_requests WHERE status = 'accepted' AND (initiator_id = target_user_id OR target_id = target_user_id)),
    'comments', (SELECT count(*) FROM comments WHERE user_id = target_user_id),
    'likes_given', (SELECT count(*) FROM likes WHERE user_id = target_user_id),
    'clubs', (SELECT count(*) FROM club_members WHERE user_id = target_user_id),
    'feedback_asked', (SELECT count(*) FROM review_prompt_events WHERE user_id = target_user_id),
    'feedback_given', (
      SELECT count(*) FROM (
        SELECT id FROM feedback WHERE user_id = target_user_id
        UNION ALL
        SELECT id FROM app_feedback WHERE user_id = target_user_id
      ) sub
    ),
    'active_days', (
      SELECT count(DISTINCT date_trunc('day', created_at))
      FROM logs WHERE user_id = target_user_id
    ),
    'first_activity', (
      SELECT least(
        (SELECT min(created_at) FROM logs WHERE user_id = target_user_id),
        (SELECT min(created_at) FROM watches WHERE user_id = target_user_id)
      )
    ),
    'last_activity', (
      SELECT greatest(
        (SELECT max(created_at) FROM logs WHERE user_id = target_user_id),
        (SELECT max(created_at) FROM watches WHERE user_id = target_user_id)
      )
    ),
    'watch_list', (
      SELECT coalesce(json_agg(json_build_object(
        'brand', brand, 'name', name, 'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::json)
      FROM watches WHERE user_id = target_user_id
    )
  ) INTO result;

  RETURN result;
END;
$function$;
