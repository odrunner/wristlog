-- ═══════════════════════════════════════════════════════════
--  MODERATION & SAFETY — App Store Guideline 1.2 Compliance
-- ═══════════════════════════════════════════════════════════
--  Adds: EULA acceptances, user blocks, content reports,
--  moderation status on logs/comments, suspension flag on profiles.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. EULA ACCEPTANCES ─────────────────────────────────
CREATE TABLE IF NOT EXISTS eula_acceptances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version     TEXT NOT NULL DEFAULT '1.0',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, version)
);
ALTER TABLE eula_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own eula" ON eula_acceptances;
CREATE POLICY "Users can read own eula" ON eula_acceptances
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own eula" ON eula_acceptances;
CREATE POLICY "Users can insert own eula" ON eula_acceptances
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ─── 2. USER BLOCKS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own blocks" ON user_blocks;
CREATE POLICY "Users can read own blocks" ON user_blocks
  FOR SELECT USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can block others" ON user_blocks;
CREATE POLICY "Users can block others" ON user_blocks
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can unblock" ON user_blocks;
CREATE POLICY "Users can unblock" ON user_blocks
  FOR DELETE USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Admin reads all blocks" ON user_blocks;
CREATE POLICY "Admin reads all blocks" ON user_blocks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ─── 3. CONTENT REPORTS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS content_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type     TEXT NOT NULL CHECK (content_type IN ('log', 'comment')),
  content_id       TEXT,
  reason           TEXT NOT NULL CHECK (reason IN ('inappropriate', 'spam', 'harassment', 'other')),
  details          TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed')),
  admin_notes      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actioned_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own reports" ON content_reports;
CREATE POLICY "Users can read own reports" ON content_reports
  FOR SELECT USING (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Users can report content" ON content_reports;
CREATE POLICY "Users can report content" ON content_reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Admin reads all reports" ON content_reports;
CREATE POLICY "Admin reads all reports" ON content_reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

DROP POLICY IF EXISTS "Admin updates reports" ON content_reports;
CREATE POLICY "Admin updates reports" ON content_reports
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ─── 4. ADD COLUMNS TO EXISTING TABLES ──────────────────

-- Profiles: suspension + EULA tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS eula_accepted_at TIMESTAMPTZ;

-- Logs: moderation status (null = normal, 'flagged' = under review, 'removed' = violation confirmed)
ALTER TABLE logs ADD COLUMN IF NOT EXISTS moderation_status TEXT;

-- Comments: moderation status
ALTER TABLE comments ADD COLUMN IF NOT EXISTS moderation_status TEXT;

-- ─── 5. UPDATE RLS FOR MODERATION ────────────────────────

-- Logs: non-owners should not see flagged/removed content
DROP POLICY IF EXISTS "Others can read shared logs" ON logs;
CREATE POLICY "Others can read shared logs" ON logs
  FOR SELECT USING (
    moderation_status IS NULL
    AND (
      visibility = 'public'
      OR (visibility = 'followers' AND EXISTS (
        SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = logs.user_id
      ))
      OR (visibility = 'friends' AND EXISTS (
        SELECT 1 FROM friend_requests
        WHERE status = 'accepted'
          AND ((initiator_id = auth.uid() AND target_id = logs.user_id)
            OR (target_id = auth.uid() AND initiator_id = logs.user_id))
      ))
      OR (visibility IS NULL AND EXISTS (
        SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = logs.user_id
      ))
      OR (club_id IS NOT NULL AND visibility IS DISTINCT FROM 'private' AND EXISTS (
        SELECT 1 FROM club_members WHERE club_id = logs.club_id AND user_id = auth.uid()
      ))
    )
  );

-- Comments: non-owners should not see flagged/removed comments
DROP POLICY IF EXISTS "Anyone can read comments" ON comments;
CREATE POLICY "Anyone can read comments" ON comments
  FOR SELECT USING (
    auth.uid() = user_id
    OR moderation_status IS NULL
  );

-- Admin can read ALL logs (including flagged/removed) for moderation
DROP POLICY IF EXISTS "Admin can read all logs" ON logs;
CREATE POLICY "Admin can read all logs" ON logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin can update logs moderation_status
DROP POLICY IF EXISTS "Admin can update log moderation" ON logs;
CREATE POLICY "Admin can update log moderation" ON logs
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin can read ALL comments for moderation
DROP POLICY IF EXISTS "Admin can read all comments" ON comments;
CREATE POLICY "Admin can read all comments" ON comments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin can update comments moderation_status
DROP POLICY IF EXISTS "Admin can update comment moderation" ON comments;
CREATE POLICY "Admin can update comment moderation" ON comments
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Admin can update profiles (for suspension)
DROP POLICY IF EXISTS "Admin can update profiles" ON profiles;
CREATE POLICY "Admin can update profiles" ON profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Suspended users cannot insert logs
DROP POLICY IF EXISTS "Suspended users cannot insert logs" ON logs;
CREATE POLICY "Suspended users cannot insert logs" ON logs
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_suspended = true)
  );

-- Suspended users cannot insert comments
DROP POLICY IF EXISTS "Suspended users cannot insert comments" ON comments;
CREATE POLICY "Suspended users cannot insert comments" ON comments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_suspended = true)
  );

-- Reporter can update moderation_status to 'flagged' on content they report
-- (allows immediate flagging on report submission)
DROP POLICY IF EXISTS "Reporter can flag logs" ON logs;
CREATE POLICY "Reporter can flag logs" ON logs
  FOR UPDATE USING (
    auth.uid() IS NOT NULL AND auth.uid() != user_id
  )
  WITH CHECK (moderation_status = 'flagged');

DROP POLICY IF EXISTS "Reporter can flag comments" ON comments;
CREATE POLICY "Reporter can flag comments" ON comments
  FOR UPDATE USING (
    auth.uid() IS NOT NULL AND auth.uid() != user_id
  )
  WITH CHECK (moderation_status = 'flagged');

-- ═══════════════════════════════════════════════════════════
--  NOTE: The original "Users can insert own logs" and
--  "Users can insert own comments" policies are superseded
--  by the new suspended-user-aware versions above.
--  Drop the originals to avoid conflicts:
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can insert own logs" ON logs;
DROP POLICY IF EXISTS "Users can insert own comments" ON comments;
DROP POLICY IF EXISTS "comments_read" ON comments;
DROP POLICY IF EXISTS "comments_select" ON comments;
DROP POLICY IF EXISTS "comments_insert" ON comments;

-- Drop old policies that bypass moderation_status checks
-- (PostgreSQL ORs permissive policies, so these old ones override moderation filtering)
DROP POLICY IF EXISTS "logs_public" ON logs;
DROP POLICY IF EXISTS "logs_followers" ON logs;
DROP POLICY IF EXISTS "logs_insert" ON logs;
DROP POLICY IF EXISTS "logs_public_club_browse" ON logs;

-- Recreate club browse with moderation_status check
CREATE POLICY "logs_public_club_browse" ON logs
  FOR SELECT USING (
    moderation_status IS NULL
    AND club_id IS NOT NULL
    AND visibility = 'public'
    AND EXISTS (
      SELECT 1 FROM clubs WHERE clubs.id = logs.club_id AND clubs.privacy = 'public'
    )
  );
