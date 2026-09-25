-- Audit 2026-09-23 SEC-23-8 (part A: row visibility).
-- "Others can read shared watches/wishlist" only looked at the per-item
-- privacy field and treated NULL (1,469 watches) as public, never the owner's
-- profile_privacy or collection/wishlist visibility settings — those were
-- enforced only in viewUserProfile(). A logged-out caller could read 580
-- watches of 109 users whose collection is not public.
-- can_view_collection_item() mirrors the client exactly (index.html
-- viewUserProfile + computeFriendships):
--   profile gate  : private/followers/friends_only profile → viewer must follow
--   collection    : invalid/NULL visibility → 'followers'; private → nobody;
--                   followers → follower; friends → close friend
--   watch item    : close friend → not private; follower → public/followers/NULL;
--                   anyone else → public/NULL
--   wishlist      : NULL visibility → 'followers'; public / followers+follow /
--                   friends(+_only)+close friend; item private → nobody,
--                   friends → close friend, followers → follower
--   close friend  = accepted friend_request AND viewer follows the owner.
-- A watch also stays readable when its owner's own post that uses it is
-- readable (logs RLS applies inside the subquery), so public posts keep
-- showing their watch in feed/profile/post pages.

CREATE OR REPLACE FUNCTION public.can_view_collection_item(p_owner uuid, p_item_privacy text, p_kind text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_prof record;
  v_follows boolean;
  v_close boolean;
  v_vis text;
BEGIN
  IF v_me IS NOT NULL AND v_me = p_owner THEN RETURN true; END IF;
  SELECT profile_privacy, collection_visibility, wishlist_visibility INTO v_prof
    FROM profiles WHERE id = p_owner;
  IF NOT FOUND THEN RETURN false; END IF;

  v_follows := v_me IS NOT NULL AND EXISTS (
    SELECT 1 FROM follows WHERE follower_id = v_me AND following_id = p_owner);
  v_close := v_follows AND EXISTS (
    SELECT 1 FROM friend_requests WHERE status = 'accepted'
      AND ((initiator_id = v_me AND target_id = p_owner)
        OR (initiator_id = p_owner AND target_id = v_me)));

  IF v_prof.profile_privacy IN ('private', 'followers', 'friends_only') AND NOT v_follows THEN
    RETURN false;
  END IF;

  IF p_kind = 'watch' THEN
    v_vis := CASE WHEN v_prof.collection_visibility IN ('public', 'followers', 'friends', 'private')
                  THEN v_prof.collection_visibility ELSE 'followers' END;
    IF v_vis = 'private'
       OR (v_vis = 'followers' AND NOT v_follows)
       OR (v_vis = 'friends' AND NOT v_close) THEN
      RETURN false;
    END IF;
    IF v_close THEN RETURN p_item_privacy IS DISTINCT FROM 'private'; END IF;
    IF v_follows THEN RETURN p_item_privacy IS NULL OR p_item_privacy IN ('public', 'followers'); END IF;
    RETURN p_item_privacy IS NULL OR p_item_privacy = 'public';
  ELSIF p_kind = 'wish' THEN
    v_vis := coalesce(v_prof.wishlist_visibility, 'followers');
    IF NOT (v_vis = 'public'
            OR (v_vis = 'followers' AND v_follows)
            OR (v_vis IN ('friends', 'friends_only') AND v_close)) THEN
      RETURN false;
    END IF;
    IF p_item_privacy = 'private' THEN RETURN false; END IF;
    IF p_item_privacy IN ('friends', 'friends_only') THEN RETURN v_close; END IF;
    IF p_item_privacy = 'followers' THEN RETURN v_follows; END IF;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.can_view_collection_item(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_collection_item(uuid, text, text) TO anon, authenticated;

DROP POLICY IF EXISTS "Others can read shared watches" ON public.watches;
CREATE POLICY watches_shared_read ON public.watches FOR SELECT TO anon, authenticated
  USING (
    public.can_view_collection_item(user_id, watch_privacy, 'watch')
    OR EXISTS (SELECT 1 FROM public.logs l WHERE l.watch_id = watches.id AND l.user_id = watches.user_id)
  );

DROP POLICY IF EXISTS "Others can read shared wishlist" ON public.wishlist;
CREATE POLICY wishlist_shared_read ON public.wishlist FOR SELECT TO anon, authenticated
  USING (public.can_view_collection_item(user_id, wish_privacy, 'wish'));
