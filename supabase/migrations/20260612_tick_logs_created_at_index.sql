-- Performance audit 2026-06-12 N1: timegrapher_tick_logs (the project's biggest
-- table, ~37k rows / 45 MB) had only pkey(id) + idx_tick_logs_session(session_id)
-- and no index on created_at. Every time-windowed read seq-scanned + sorted the
-- whole table: the rollout script's paginated fetch (daily 9am,
-- created_at>=since ORDER BY created_at asc), nightly-analysis (5am), and the
-- admin traffic query (index.html — created_at>=d1ago).
--
-- A plain btree on created_at serves both the range filter and the ascending
-- sort. Table is small enough that a non-CONCURRENT build locks for <1s.
-- Deployed via `supabase db query --linked`; this file is the record.

CREATE INDEX IF NOT EXISTS idx_tick_logs_created_at
  ON public.timegrapher_tick_logs (created_at);
