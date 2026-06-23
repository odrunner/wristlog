-- ══════════════════════════════════════════════════════════════════════════
--  FRIENDS FEATURE — SUPABASE MIGRATIONS
--  Run these in the Supabase SQL editor before testing locally.
--  This is a LOCAL-ONLY feature (branch: feature/friends-privacy).
--  Stable rollback point: commit 2c2d03d on main.
-- ══════════════════════════════════════════════════════════════════════════

-- 1. friend_requests table
--    Stores a per-pair friend request with two unique codes (one per side).
--    Friendship is active when BOTH sides are verified AND mutual follows exist.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friend_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  initiator_code     TEXT        NOT NULL,   -- code initiator shares with target (out of band)
  target_code        TEXT        NOT NULL,   -- code target shares with initiator (out of band)
  initiator_verified BOOLEAN     NOT NULL DEFAULT FALSE,
  target_verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(initiator_id, target_id),
  CHECK (initiator_id <> target_id)
);

ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own friend requests"
  ON friend_requests FOR SELECT
  USING (auth.uid() = initiator_id OR auth.uid() = target_id);

CREATE POLICY "Users can create friend requests as initiator"
  ON friend_requests FOR INSERT
  WITH CHECK (auth.uid() = initiator_id);

CREATE POLICY "Users can update friend requests they are party to"
  ON friend_requests FOR UPDATE
  USING (auth.uid() = initiator_id OR auth.uid() = target_id);

CREATE POLICY "Users can delete friend requests they are party to"
  ON friend_requests FOR DELETE
  USING (auth.uid() = initiator_id OR auth.uid() = target_id);


-- 2. Add 'friends' to watches.watch_privacy CHECK constraint
--    The original constraint only allowed public/followers/friends_only/private.
--    Cycling now includes 'friends' as a distinct value separate from 'friends_only'.
-- --------------------------------------------------------------------------
ALTER TABLE watches DROP CONSTRAINT IF EXISTS watches_watch_privacy_check;

ALTER TABLE watches ADD CONSTRAINT watches_watch_privacy_check CHECK (
  watch_privacy IS NULL OR
  watch_privacy IN ('public', 'followers', 'friends_only', 'friends', 'private')
);


-- 3. Add 'friends' to wishlist.wish_privacy CHECK constraint
-- --------------------------------------------------------------------------
ALTER TABLE wishlist DROP CONSTRAINT IF EXISTS wishlist_wish_privacy_check;

ALTER TABLE wishlist ADD CONSTRAINT wishlist_wish_privacy_check CHECK (
  wish_privacy IS NULL OR
  wish_privacy IN ('public', 'followers', 'friends_only', 'friends', 'private')
);


-- 4. Allow authenticated users to read non-private wishlist items
--    The wishlist table's existing RLS only allows owners to read their own rows.
--    Without this policy, viewing another user's wishlist always returns empty —
--    even when wishlist_visibility is set to 'friends' or 'followers'.
--    We grant read access for all non-private items; client-side code then
--    enforces the friends/followers distinction for the UI.
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Non-private wishlist items readable by authenticated users" ON wishlist;

CREATE POLICY "Non-private wishlist items readable by authenticated users"
  ON wishlist FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR wish_privacy IS DISTINCT FROM 'private'
  );


-- 5. Add friend notification types to the notifications type CHECK constraint
--    (adjust the IN list to match whatever types currently exist in your DB)
-- --------------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'follow', 'follow_request', 'follow_accepted',
    'like', 'comment', 'comment_also', 'mention',
    'club_join_request', 'club_join_accepted', 'club_invite', 'club_promoted',
    'friend_code_entered', 'friends_now',
    -- legacy values that may exist in existing rows:
    'friend_invite', 'friend_request', 'friend_accepted',
    'system',  -- for brand additions and other auto-generated notifications
    'badge_earned'  -- earned achievement badges (self-generated, actor_id null)
  )
);
