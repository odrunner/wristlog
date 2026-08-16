-- sql/2026-08-16-backfill-auto-keep.sql
-- One-off seed for the auto-keep model: every converged, plausible measurement session
-- (measurement_sessions, since 2026-06-11) becomes a timegrapher_results row, linked back via
-- saved_result_id — so existing measurers open Accuracy History with their real history.
-- Same gate as shouldAutoKeepReading in index.html, minus the tick count (not captured in the
-- session row; duration ≥ 8 s stands in): |rate| ≤ 60, converged, watch still owned by the
-- user, no saved reading within 5 min on that watch, and no earlier kept session on the same
-- watch within 10 min at ±0.5 s/d. Idempotent: linked (saved_result_id) or dismissed sessions
-- are skipped. ALL accounts, internal included — this is the user's own history, not a metric.
--
-- Dry run: replace the final two statements with SELECT count(*) FROM cand.
WITH base AS (
  SELECT s.id AS session_pk, s.user_id, s.watch_id, s.rate, s.bph, s.amplitude, s.duration_sec, s.created_at,
         gen_random_uuid() AS new_id
  FROM measurement_sessions s
  JOIN watches w ON w.id = s.watch_id AND w.user_id = s.user_id
  WHERE s.converged AND s.rate IS NOT NULL AND abs(s.rate) <= 60
    AND COALESCE(s.duration_sec, 0) >= 8
    AND s.saved_result_id IS NULL AND s.dismissed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM timegrapher_results r
                    WHERE r.user_id = s.user_id AND r.watch_id = s.watch_id
                      AND r.created_at BETWEEN s.created_at - interval '5 minutes' AND s.created_at + interval '5 minutes')
),
ranked AS (
  SELECT b.*, lag(b.created_at) OVER (PARTITION BY b.user_id, b.watch_id ORDER BY b.created_at) AS prev_at,
               lag(b.rate)       OVER (PARTITION BY b.user_id, b.watch_id ORDER BY b.created_at) AS prev_rate
  FROM base b
),
cand AS (
  SELECT * FROM ranked
  WHERE prev_at IS NULL OR created_at - prev_at > interval '10 minutes' OR abs(rate - prev_rate) > 0.5
),
ins AS (
  INSERT INTO timegrapher_results (id, user_id, watch_id, rate, beat_error, bph, source, notes, amplitude, duration_seconds, created_at)
  SELECT new_id, user_id, watch_id, rate, NULL, COALESCE(NULLIF(bph, 0), 28800), 'auto', NULL, amplitude, duration_sec, created_at
  FROM cand
  RETURNING id
)
UPDATE measurement_sessions m SET saved_result_id = c.new_id
FROM cand c WHERE m.id = c.session_pk;
