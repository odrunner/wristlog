-- ═══════════════════════════════════════════════════════════
--  WROTATE SECURITY HARDENING — Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════
--  Run these statements in order. They add:
--  1. Admin role column on profiles
--  2. RLS policies for all tables (privacy + ownership)
--  3. Feedback table admin-only update policy
-- ═══════════════════════════════════════════════════════════

-- ─── 1. ADD ADMIN FLAG TO PROFILES ──────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
UPDATE profiles SET is_admin = true WHERE id = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';

-- ─── 2. PROFILES ────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read public profiles (needed for discover, feed, etc.)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON profiles
  FOR SELECT USING (true);

-- Users can only update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Users can insert their own profile (on first login)
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ─── 3. WATCHES ─────────────────────────────────────────
ALTER TABLE watches ENABLE ROW LEVEL SECURITY;

-- Users can read their own watches always
DROP POLICY IF EXISTS "Users can read own watches" ON watches;
CREATE POLICY "Users can read own watches" ON watches
  FOR SELECT USING (auth.uid() = user_id);

-- Other users can read watches based on privacy settings
-- (public watches, or follower/friend watches if relationship exists)
DROP POLICY IF EXISTS "Others can read shared watches" ON watches;
CREATE POLICY "Others can read shared watches" ON watches
  FOR SELECT USING (
    watch_privacy = 'public'
    OR watch_privacy IS NULL  -- default inherits collection visibility
    OR (watch_privacy = 'followers' AND EXISTS (
      SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = watches.user_id
    ))
    OR (watch_privacy = 'friends' AND EXISTS (
      SELECT 1 FROM friend_requests
      WHERE status = 'accepted'
        AND ((initiator_id = auth.uid() AND target_id = watches.user_id)
          OR (target_id = auth.uid() AND initiator_id = watches.user_id))
    ))
  );

-- Users can insert/update/delete only their own watches
DROP POLICY IF EXISTS "Users can insert own watches" ON watches;
CREATE POLICY "Users can insert own watches" ON watches
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own watches" ON watches;
CREATE POLICY "Users can update own watches" ON watches
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own watches" ON watches;
CREATE POLICY "Users can delete own watches" ON watches
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 4. LOGS (WEAR LOGS) ───────────────────────────────
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

-- Users can always read own logs
DROP POLICY IF EXISTS "Users can read own logs" ON logs;
CREATE POLICY "Users can read own logs" ON logs
  FOR SELECT USING (auth.uid() = user_id);

-- Others can read logs based on visibility + club membership
DROP POLICY IF EXISTS "Others can read shared logs" ON logs;
CREATE POLICY "Others can read shared logs" ON logs
  FOR SELECT USING (
    -- Public posts: visible to everyone
    visibility = 'public'
    -- Followers posts: visible to followers
    OR (visibility = 'followers' AND EXISTS (
      SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = logs.user_id
    ))
    -- Friends posts: visible to verified friends only
    OR (visibility = 'friends' AND EXISTS (
      SELECT 1 FROM friend_requests
      WHERE status = 'accepted'
        AND ((initiator_id = auth.uid() AND target_id = logs.user_id)
          OR (target_id = auth.uid() AND initiator_id = logs.user_id))
    ))
    -- Legacy NULL visibility: treat as followers-scoped
    OR (visibility IS NULL AND EXISTS (
      SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = logs.user_id
    ))
    -- Club posts: visible to club members (except private)
    OR (club_id IS NOT NULL AND visibility IS DISTINCT FROM 'private' AND EXISTS (
      SELECT 1 FROM club_members WHERE club_id = logs.club_id AND user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "Users can insert own logs" ON logs;
CREATE POLICY "Users can insert own logs" ON logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own logs" ON logs;
CREATE POLICY "Users can update own logs" ON logs
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own logs" ON logs;
CREATE POLICY "Users can delete own logs" ON logs
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 5. WISHLIST ────────────────────────────────────────
ALTER TABLE wishlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own wishlist" ON wishlist;
CREATE POLICY "Users can read own wishlist" ON wishlist
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Others can read shared wishlist" ON wishlist;
CREATE POLICY "Others can read shared wishlist" ON wishlist
  FOR SELECT USING (
    wish_privacy = 'public'
    OR wish_privacy IS NULL
    OR (wish_privacy = 'followers' AND EXISTS (
      SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = wishlist.user_id
    ))
    OR (wish_privacy = 'friends' AND EXISTS (
      SELECT 1 FROM friend_requests
      WHERE status = 'accepted'
        AND ((initiator_id = auth.uid() AND target_id = wishlist.user_id)
          OR (target_id = auth.uid() AND initiator_id = wishlist.user_id))
    ))
  );

DROP POLICY IF EXISTS "Users can insert own wishlist" ON wishlist;
CREATE POLICY "Users can insert own wishlist" ON wishlist
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own wishlist" ON wishlist;
CREATE POLICY "Users can update own wishlist" ON wishlist
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own wishlist" ON wishlist;
CREATE POLICY "Users can delete own wishlist" ON wishlist
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 6. FOLLOWS ─────────────────────────────────────────
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read follows" ON follows;
CREATE POLICY "Anyone can read follows" ON follows
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can follow others" ON follows;
CREATE POLICY "Users can follow others" ON follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can unfollow" ON follows;
CREATE POLICY "Users can unfollow" ON follows
  FOR DELETE USING (auth.uid() = follower_id);

-- ─── 7. FOLLOW REQUESTS ────────────────────────────────
ALTER TABLE follow_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see own follow requests" ON follow_requests;
CREATE POLICY "Users can see own follow requests" ON follow_requests
  FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = target_id);

DROP POLICY IF EXISTS "Users can create follow requests" ON follow_requests;
CREATE POLICY "Users can create follow requests" ON follow_requests
  FOR INSERT WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Users can delete own follow requests" ON follow_requests;
CREATE POLICY "Users can delete own follow requests" ON follow_requests
  FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = target_id);

-- ─── 8. FRIEND REQUESTS ────────────────────────────────
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can see own friend requests" ON friend_requests;
CREATE POLICY "Users can see own friend requests" ON friend_requests
  FOR SELECT USING (auth.uid() = initiator_id OR auth.uid() = target_id);

DROP POLICY IF EXISTS "Users can create friend requests" ON friend_requests;
CREATE POLICY "Users can create friend requests" ON friend_requests
  FOR INSERT WITH CHECK (auth.uid() = initiator_id);

DROP POLICY IF EXISTS "Users can update own friend requests" ON friend_requests;
CREATE POLICY "Users can update own friend requests" ON friend_requests
  FOR UPDATE USING (auth.uid() = initiator_id OR auth.uid() = target_id);

DROP POLICY IF EXISTS "Users can delete own friend requests" ON friend_requests;
CREATE POLICY "Users can delete own friend requests" ON friend_requests
  FOR DELETE USING (auth.uid() = initiator_id OR auth.uid() = target_id);

-- ─── 9. NOTIFICATIONS ──────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Any authenticated user can create notifications (for others)
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON notifications;
CREATE POLICY "Authenticated users can insert notifications" ON notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications" ON notifications
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 10. LIKES ──────────────────────────────────────────
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read likes" ON likes;
CREATE POLICY "Anyone can read likes" ON likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own likes" ON likes;
CREATE POLICY "Users can insert own likes" ON likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own likes" ON likes;
CREATE POLICY "Users can delete own likes" ON likes
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 11. COMMENTS ───────────────────────────────────────
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read comments" ON comments;
CREATE POLICY "Anyone can read comments" ON comments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own comments" ON comments;
CREATE POLICY "Users can insert own comments" ON comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own comments" ON comments;
CREATE POLICY "Users can update own comments" ON comments
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comments" ON comments;
CREATE POLICY "Users can delete own comments" ON comments
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 12. COMMENT LIKES ─────────────────────────────────
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read comment likes" ON comment_likes;
CREATE POLICY "Anyone can read comment likes" ON comment_likes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own comment likes" ON comment_likes;
CREATE POLICY "Users can insert own comment likes" ON comment_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own comment likes" ON comment_likes;
CREATE POLICY "Users can delete own comment likes" ON comment_likes
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 13. CLUBS ──────────────────────────────────────────
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read clubs" ON clubs;
CREATE POLICY "Anyone can read clubs" ON clubs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can create clubs" ON clubs;
CREATE POLICY "Authenticated users can create clubs" ON clubs
  FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Club owners can update clubs" ON clubs;
CREATE POLICY "Club owners can update clubs" ON clubs
  FOR UPDATE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Club owners can delete clubs" ON clubs;
CREATE POLICY "Club owners can delete clubs" ON clubs
  FOR DELETE USING (auth.uid() = created_by);

-- ─── 14. CLUB MEMBERS ──────────────────────────────────
ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read club members" ON club_members;
CREATE POLICY "Anyone can read club members" ON club_members
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can join clubs" ON club_members;
CREATE POLICY "Users can join clubs" ON club_members
  FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() IN (
    SELECT c.created_by FROM clubs c WHERE c.id = club_members.club_id
  ));

DROP POLICY IF EXISTS "Users can leave clubs or owners can remove" ON club_members;
CREATE POLICY "Users can leave clubs or owners can remove" ON club_members
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() IN (
    SELECT c.created_by FROM clubs c WHERE c.id = club_members.club_id
  ));

-- ─── 15. CLUB JOIN REQUESTS ────────────────────────────
ALTER TABLE club_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Relevant users can read join requests" ON club_join_requests;
CREATE POLICY "Relevant users can read join requests" ON club_join_requests
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() IN (
    SELECT cm.user_id FROM club_members cm WHERE cm.club_id = club_join_requests.club_id AND cm.role = 'owner'
  ));

DROP POLICY IF EXISTS "Users can create join requests" ON club_join_requests;
CREATE POLICY "Users can create join requests" ON club_join_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users or owners can delete join requests" ON club_join_requests;
CREATE POLICY "Users or owners can delete join requests" ON club_join_requests
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() IN (
    SELECT cm.user_id FROM club_members cm WHERE cm.club_id = club_join_requests.club_id AND cm.role = 'owner'
  ));

-- ─── 16. CLUB INVITES ──────────────────────────────────
ALTER TABLE club_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Relevant users can read invites" ON club_invites;
CREATE POLICY "Relevant users can read invites" ON club_invites
  FOR SELECT USING (auth.uid() = invitee_id OR auth.uid() = invited_by);

DROP POLICY IF EXISTS "Members can create invites" ON club_invites;
CREATE POLICY "Members can create invites" ON club_invites
  FOR INSERT WITH CHECK (auth.uid() = invited_by);

DROP POLICY IF EXISTS "Users can delete own invites" ON club_invites;
CREATE POLICY "Users can delete own invites" ON club_invites
  FOR DELETE USING (auth.uid() = invitee_id OR auth.uid() = invited_by);

-- ─── 17. FEEDBACK (ADMIN UPDATE) ───────────────────────
-- Keep existing insert policies, add admin-only update
DROP POLICY IF EXISTS "Admin can update feedback" ON feedback;
CREATE POLICY "Admin can update feedback" ON feedback
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin can read all feedback
DROP POLICY IF EXISTS "Admin can read all feedback" ON feedback;
CREATE POLICY "Admin can read all feedback" ON feedback
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ═══════════════════════════════════════════════════════════
--  DONE! All tables now have RLS policies enforced.
--  Test by logging in as a regular user and confirming:
--  - You can see your own data
--  - You can't see private data from other users
--  - Admin functions (feedback status) still work for admin
-- ═══════════════════════════════════════════════════════════
