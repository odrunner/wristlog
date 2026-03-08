-- Rate limiting table for expensive edge functions (e.g. identify-watch)
-- One row per user per function; no table bloat.
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, function_name)
);

-- RLS enabled with no policies = only service role can access
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
