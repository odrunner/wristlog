-- Presence tracking ("last open") — distinct from the action-based "last active".
--
-- "Last active" (admin_last_active / admin_user_detail.last_active) answers
-- "when did this user last DO something?" (a wear, watch, measurement, sign-in).
-- Presence answers "when did they last OPEN the app?", including passive
-- browsing. We keep them separate so a lurker who only opens the app doesn't
-- look as engaged as someone who actually logs activity.
--
-- Design notes:
--  * The server stamps the timestamp (now()) via a SECURITY DEFINER RPC, so a
--    client can't spoof it to an arbitrary time — only "now" while authenticated.
--  * The client throttles calls to once per hour (localStorage), so this is a
--    best-effort signal, not a precise online indicator.
--  * RLS is enabled with no policies: all access goes through SECURITY DEFINER
--    RPCs (touch_presence to write, admin_user_detail to read).

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id uuid PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- Write path: stamps now() for the calling user. No-op for anonymous callers.
CREATE OR REPLACE FUNCTION public.touch_presence()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.user_presence (user_id, last_seen_at)
  VALUES (auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now();
END;
$function$;

-- admin_user_detail also surfaces last_open (presence) alongside last_active.
-- See 20260531_admin_last_active.sql for the rest of the function rationale;
-- this redefinition adds the 'last_open' field.
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
        'id', p.id, 'username', p.username, 'display_name', p.display_name,
        'avatar_url', p.avatar_url, 'bio', p.bio, 'created_at', p.created_at,
        'profile_privacy', p.profile_privacy, 'collection_visibility', p.collection_visibility,
        'is_suspended', p.is_suspended
      ) FROM profiles p WHERE p.id = target_user_id
    ),
    'last_active', v_last_active,
    'last_sign_in', v_last_active,
    'last_open', (SELECT last_seen_at FROM user_presence WHERE user_id = target_user_id),
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
    'feedback_given', (SELECT count(*) FROM (SELECT id FROM feedback WHERE user_id = target_user_id UNION ALL SELECT id FROM app_feedback WHERE user_id = target_user_id) sub),
    'active_days', (SELECT count(DISTINCT date_trunc('day', created_at)) FROM logs WHERE user_id = target_user_id),
    'first_activity', (SELECT least((SELECT min(created_at) FROM logs WHERE user_id = target_user_id),(SELECT min(created_at) FROM watches WHERE user_id = target_user_id))),
    'last_activity', (SELECT greatest((SELECT max(created_at) FROM logs WHERE user_id = target_user_id),(SELECT max(created_at) FROM watches WHERE user_id = target_user_id))),
    'watch_list', (SELECT coalesce(json_agg(json_build_object('brand', brand, 'name', name, 'created_at', created_at) ORDER BY created_at DESC), '[]'::json) FROM watches WHERE user_id = target_user_id)
  ) INTO result;

  RETURN result;
END;
$function$;
