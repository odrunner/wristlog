-- "Seen" / last-active accuracy fix #2
--
-- Goal: the admin "Seen" column should mean "last opened the app" — ANY visit,
-- not just write-activity.
--
-- Problem: admin_last_active() / admin_user_detail() computed "last active" as
-- GREATEST(logs, watches, auth.last_sign_in_at, timegrapher_results, tg
-- session_summary) — action-based only, and auth.last_sign_in_at only moves on a
-- fresh credential sign-in (not token refresh). So a user on a persistent
-- session who opened the app and browsed/liked looked dormant. Verified: dgc
-- (Dan) opened the app 2026-06-28 01:14 (user_presence + a like) but "Seen"
-- showed 2026-06-25 (his last wear log).
--
-- Fix: fold user_presence.last_seen_at — the throttled "opened the app" heartbeat
-- (touch_presence RPC, pinged in bootApp, ~hourly) — into the GREATEST, plus all
-- other timestamped logged-in activity (likes, comments, follows, comment_likes,
-- price checks, enhances) so long-lived sessions stay fresh between hourly pings.
-- GREATEST ignores NULL args. Deployed via `npx supabase db query --linked`.

-- 1. Table-wide "Seen" column source.
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
    GREATEST(pr.last_seen_at, l.mc, w.mc, au.last_sign_in_at, tr.mc, tg.mc,
             lk.mc, cm.mc, fl.mc, cl.mc, ve.mc, ia.mc)
  FROM profiles p
  LEFT JOIN user_presence pr ON pr.user_id = p.id
  LEFT JOIN (SELECT logs.user_id AS uid, max(logs.created_at) AS mc FROM logs GROUP BY logs.user_id) l ON l.uid = p.id
  LEFT JOIN (SELECT watches.user_id AS uid, max(watches.created_at) AS mc FROM watches GROUP BY watches.user_id) w ON w.uid = p.id
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN (SELECT timegrapher_results.user_id AS uid, max(timegrapher_results.created_at) AS mc FROM timegrapher_results GROUP BY timegrapher_results.user_id) tr ON tr.uid = p.id
  LEFT JOIN (
    SELECT (messages::jsonb->>'user_id')::uuid AS uid, max(created_at) AS mc
    FROM timegrapher_tick_logs
    WHERE messages LIKE '{"type":"session_summary"%'
    GROUP BY 1
  ) tg ON tg.uid = p.id
  LEFT JOIN (SELECT likes.user_id AS uid, max(likes.created_at) AS mc FROM likes GROUP BY likes.user_id) lk ON lk.uid = p.id
  LEFT JOIN (SELECT comments.user_id AS uid, max(comments.created_at) AS mc FROM comments GROUP BY comments.user_id) cm ON cm.uid = p.id
  LEFT JOIN (SELECT follows.follower_id AS uid, max(follows.created_at) AS mc FROM follows GROUP BY follows.follower_id) fl ON fl.uid = p.id
  LEFT JOIN (SELECT comment_likes.user_id AS uid, max(comment_likes.created_at) AS mc FROM comment_likes GROUP BY comment_likes.user_id) cl ON cl.uid = p.id
  LEFT JOIN (SELECT valuation_events.user_id AS uid, max(valuation_events.created_at) AS mc FROM valuation_events GROUP BY valuation_events.user_id) ve ON ve.uid = p.id
  LEFT JOIN (SELECT identify_attempts.user_id AS uid, max(identify_attempts.created_at) AS mc FROM identify_attempts GROUP BY identify_attempts.user_id) ia ON ia.uid = p.id;
END;
$function$;

-- 2. Per-user detail modal "Last active".
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
