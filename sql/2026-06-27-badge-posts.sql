-- Badge achievement posts: which badges a feed row carries, and the per-user opt-out.
ALTER TABLE logs ADD COLUMN IF NOT EXISTS badge_refs jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS share_achievements boolean NOT NULL DEFAULT true;
