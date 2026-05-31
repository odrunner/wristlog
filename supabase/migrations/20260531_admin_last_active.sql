-- Admin "last active" accuracy fix
--
-- Problem: the admin user table's green "Msr" indicator counts timegrapher
-- session_summary tick logs from the last 24h, but the detail modal's
-- "Last login" only looked at GREATEST(logs, watches, auth.last_sign_in_at).
-- auth.last_sign_in_at never moves on token refresh (only on a fresh credential
-- sign-in), and timegrapher activity wasn't counted at all -- so a user who runs
-- timegrapher sessions (without saving) on a persistent session looked dormant.
--
-- Fix: include timegrapher activity (saved results + session_summary tick logs,
-- which capture even unsaved sessions) in the "last active" computation, both for
-- the per-user detail RPC and a new table-wide RPC that powers the "Seen" column.

-- 1. Per-user detail: rename last_sign_in -> last_active (keep last_sign_in as a
--    backward-compat alias for already-deployed frontends), fold in timegrapher.
CREATE OR REPLACE FUNCTION public.admin_user_detail(target_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result json;
  v_last_active timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT greatest(
    (SELECT max(created_at) FROM logs WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM watches WHERE user_id = target_user_id),
    (SELECT last_sign_in_at FROM auth.users WHERE id = target_user_id),
    (SELECT max(created_at) FROM timegrapher_results WHERE user_id = target_user_id),
    (SELECT max(created_at) FROM timegrapher_tick_logs
       WHERE messages LIKE '{"type":"session_summary"%'
         AND (messages::jsonb->>'user_id')::uuid = target_user_id)
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
    'measurements_total', (SELECT count(*) FROM timegrapher_results WHERE user_id = target_user_id),
    'measurements_success', (SELECT count(*) FROM timegrapher_results WHERE user_id = target_user_id AND rate IS NOT NULL),
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
        'brand', brand, 'name', name
      ) ORDER BY created_at DESC), '[]'::json)
      FROM watches WHERE user_id = target_user_id
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- 2. Table-wide last-active per user, powering the admin table "Seen" column.
--    Admin-guarded since it exposes auth.last_sign_in_at. GREATEST ignores NULLs.
CREATE OR REPLACE FUNCTION public.admin_last_active()
 RETURNS TABLE(user_id uuid, last_active timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT p.id,
    GREATEST(l.mc, w.mc, au.last_sign_in_at, tr.mc, tg.mc)
  FROM profiles p
  LEFT JOIN (SELECT logs.user_id AS uid, max(logs.created_at) AS mc FROM logs GROUP BY logs.user_id) l ON l.uid = p.id
  LEFT JOIN (SELECT watches.user_id AS uid, max(watches.created_at) AS mc FROM watches GROUP BY watches.user_id) w ON w.uid = p.id
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN (SELECT timegrapher_results.user_id AS uid, max(timegrapher_results.created_at) AS mc FROM timegrapher_results GROUP BY timegrapher_results.user_id) tr ON tr.uid = p.id
  LEFT JOIN (
    SELECT (messages::jsonb->>'user_id')::uuid AS uid, max(created_at) AS mc
    FROM timegrapher_tick_logs
    WHERE messages LIKE '{"type":"session_summary"%'
    GROUP BY 1
  ) tg ON tg.uid = p.id;
END;
$function$;
