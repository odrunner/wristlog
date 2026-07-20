-- Drain lease: rows are claimed to status='sending' before any send, so a
-- crash or concurrent drain cannot double-send. Stale claims are reaped.
ALTER TABLE broadcast_queue ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
