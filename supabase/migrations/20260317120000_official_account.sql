-- Official Account feature: adds is_official flag and official_drafts table

-- Add is_official column to profiles (for badge rendering)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_official BOOLEAN DEFAULT false;

-- Draft posts table for official account content curation
CREATE TABLE IF NOT EXISTS official_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT,                        -- original Instagram/blog URL
  image_url TEXT,                         -- extracted external image URL
  photo_stored_url TEXT,                  -- Supabase Storage URL after upload
  caption TEXT,                           -- post text / notes
  celebrity_name TEXT,                    -- for reference / searchability
  watch_info TEXT,                        -- brand/model if known
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  published_log_id UUID REFERENCES logs(id),
  created_by UUID REFERENCES profiles(id)
);

-- RLS: admin-only access
ALTER TABLE official_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on official_drafts"
  ON official_drafts FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- Index for quick status filtering
CREATE INDEX IF NOT EXISTS idx_official_drafts_status ON official_drafts(status);
