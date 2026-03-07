-- Email Notifications: add email_prefs JSONB column to profiles
-- Categories: social (likes/follows), comments, mentions, clubs, friends
-- Default: important ones ON, clubs OFF

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS email_prefs jsonb
DEFAULT '{"social":true,"comments":true,"mentions":true,"clubs":false,"friends":true}'::jsonb;

-- Backfill existing users with defaults
UPDATE profiles
SET email_prefs = '{"social":true,"comments":true,"mentions":true,"clubs":false,"friends":true}'::jsonb
WHERE email_prefs IS NULL;
