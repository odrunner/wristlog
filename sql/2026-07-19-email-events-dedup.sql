-- SNS delivers at-least-once; dedup webhook inserts on the SNS MessageId.
-- Nullable: historical Resend-era rows have no MessageId (multiple NULLs allowed).
ALTER TABLE email_events ADD COLUMN IF NOT EXISTS sns_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_events_sns_message_id
  ON email_events (sns_message_id);
