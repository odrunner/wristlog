-- ─── FEEDBACK TABLE: Enable RLS + add missing policies ───
-- security-hardening.sql created admin SELECT/UPDATE policies but
-- never issued ALTER TABLE feedback ENABLE ROW LEVEL SECURITY,
-- leaving the table wide open.

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated users can submit feedback
DROP POLICY IF EXISTS "Users can insert feedback" ON feedback;
CREATE POLICY "Users can insert feedback" ON feedback
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Anonymous users can submit feedback (signed-out bug reports)
DROP POLICY IF EXISTS "Anon can insert feedback" ON feedback;
CREATE POLICY "Anon can insert feedback" ON feedback
  FOR INSERT TO anon WITH CHECK (true);

-- Users can delete own feedback (needed for account deletion flow)
DROP POLICY IF EXISTS "Users can delete own feedback" ON feedback;
CREATE POLICY "Users can delete own feedback" ON feedback
  FOR DELETE USING (auth.uid() = user_id);
