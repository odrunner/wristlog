-- Archive retired drips out of the admin Campaigns tab without deleting them.
-- The row has to stay: email_campaign_sends.campaign_id is FK'd to it with
-- NO ACTION, and those rows are the real delivery history (84 sends for the
-- welcome drip). Archiving hides the card; un-set the flag to bring it back.
ALTER TABLE email_campaigns
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- "Welcome — 3 things to try" — superseded by "Onboarding 1 — Add a watch",
-- paused since 2026-06-24.
UPDATE email_campaigns
   SET is_archived = true, updated_at = now()
 WHERE id = 'f10da233-2c90-4e20-ad2a-a663b567c122';
