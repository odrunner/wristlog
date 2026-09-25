-- Audit 2026-09-23 SEC-23-7 — close friends without consent.
-- INSERT only checked uid = initiator_id (any status), and UPDATE let either
-- party set anything. So a user could insert a request already 'accepted', or
-- accept their own request, and immediately see the target's close-friends
-- posts, watches and wishlist (verified: 0 → 2 friends-only posts as testuser2).
-- The client only ever inserts with the default 'pending' and only the target
-- accepts (acceptFriendRequest / acceptFriendRequestFromPopover update status
-- only), so the DB now enforces exactly that.

DROP POLICY IF EXISTS "Users can create friend requests" ON public.friend_requests;
DROP POLICY IF EXISTS fr_insert ON public.friend_requests;
CREATE POLICY fr_insert ON public.friend_requests FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = initiator_id AND status = 'pending');

DROP POLICY IF EXISTS "Users can update own friend requests" ON public.friend_requests;
DROP POLICY IF EXISTS fr_update ON public.friend_requests;
CREATE POLICY fr_update ON public.friend_requests FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = target_id)
  WITH CHECK ((SELECT auth.uid()) = target_id AND status = 'accepted');

-- Only status may change; otherwise the target could rewrite initiator_id and
-- "accept" a friendship the other person never asked for.
REVOKE UPDATE ON public.friend_requests FROM anon, authenticated;
GRANT UPDATE (status) ON public.friend_requests TO authenticated;
