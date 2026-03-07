-- ═══════════════════════════════════════════════════════════
--  PUSH NOTIFICATIONS — Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- Device tokens table — stores APNs tokens for each user
CREATE TABLE IF NOT EXISTS device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  token text NOT NULL,
  platform text DEFAULT 'ios',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, token)
);

-- RLS: users can only manage their own tokens
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own tokens" ON device_tokens;
CREATE POLICY "Users can manage own tokens" ON device_tokens
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookup by user_id (used by the push Edge Function)
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);
