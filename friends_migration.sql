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


-- 2. Add 'friend_invite' to the notifications type CHECK constraint
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
    'friend_invite', 'friend_request', 'friend_accepted'
  )
);
