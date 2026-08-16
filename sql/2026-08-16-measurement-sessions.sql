-- sql/2026-08-16-measurement-sessions.sql
-- Every measurement (saved or not) writes ONE {"type":"session_summary",...} row into
-- timegrapher_tick_logs. 75% of converged sessions are never saved to timegrapher_results
-- (60d to 2026-08-15: 1,652 converged vs 419 saved), so this captures the summary into a
-- queryable table at write time. Regex parsing, not ::jsonb — the summary carries tick_data
-- arrays; we only want a handful of scalars, and a parse failure must never block the
-- client's tick-log insert.
--
-- Deploy: npx supabase db query --linked --file sql/2026-08-16-measurement-sessions.sql
-- Guarded by tests/measurement-sessions-sql.test.js.

CREATE TABLE IF NOT EXISTS measurement_sessions (
  id              bigserial PRIMARY KEY,
  session_id      text UNIQUE,
  user_id         uuid NOT NULL,
  watch_id        text,        -- watches.id is TEXT (client-generated ids)
  rate            numeric,
  bph             integer,
  converged       boolean NOT NULL DEFAULT false,
  stop_reason     text,
  algo            text,
  amplitude       integer,
  duration_sec    integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  saved_result_id uuid,        -- set when the user saved this session (at save time, or via Keep)
  dismissed_at    timestamptz  -- set when the user dismissed it from "Unsaved readings"
);
CREATE INDEX IF NOT EXISTS measurement_sessions_user_watch_idx
  ON measurement_sessions (user_id, watch_id, created_at DESC);

ALTER TABLE measurement_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ms_select_own ON measurement_sessions;
CREATE POLICY ms_select_own ON measurement_sessions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS ms_update_own ON measurement_sessions;
CREATE POLICY ms_update_own ON measurement_sessions FOR UPDATE USING (auth.uid() = user_id);
-- No INSERT policy on purpose: rows come only from the trigger below.

CREATE OR REPLACE FUNCTION capture_measurement_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO measurement_sessions
    (session_id, user_id, watch_id, rate, bph, converged, stop_reason, algo, amplitude, duration_sec, created_at)
  VALUES (
    NEW.session_id,
    substring(NEW.messages from '"user_id":"([0-9a-f-]{36})"')::uuid,
    substring(NEW.messages from '"watch_id":"([^"]{1,64})"'),
    substring(NEW.messages from '"native_rate":(-?[0-9.]+)')::numeric,
    substring(NEW.messages from '"bph":([0-9]+)')::integer,
    COALESCE(substring(NEW.messages from '"converged":(true|false)') = 'true', false),
    substring(NEW.messages from '"stop_reason":"([a-z_]+)"'),
    substring(NEW.messages from '"algo":"([a-z_]+)"'),
    substring(NEW.messages from '"amplitude":([0-9]+)')::integer,
    substring(NEW.messages from '"duration_sec":([0-9]+)')::integer,
    NEW.created_at
  )
  ON CONFLICT (session_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a parse problem (or a NULL user_id) block the tick-log insert.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_capture_measurement_session ON timegrapher_tick_logs;
CREATE TRIGGER trg_capture_measurement_session
  AFTER INSERT ON timegrapher_tick_logs
  FOR EACH ROW WHEN (NEW.messages LIKE '{"type":"session_summary"%')
  EXECUTE FUNCTION capture_measurement_session();

-- Unsaved, converged sessions on one watch for the calling user (RLS applies — SECURITY
-- INVOKER). A session within 5 minutes of a saved reading on the same watch is treated as
-- saved: rows captured before the client started linking saves carry no saved_result_id.
CREATE OR REPLACE FUNCTION unsaved_measurement_sessions(p_watch text)
RETURNS SETOF measurement_sessions LANGUAGE sql STABLE AS $$
  SELECT s.* FROM measurement_sessions s
  WHERE s.user_id = auth.uid() AND s.watch_id = p_watch
    AND s.converged AND s.rate IS NOT NULL
    AND s.saved_result_id IS NULL AND s.dismissed_at IS NULL
    AND s.created_at > now() - interval '30 days'
    AND NOT EXISTS (SELECT 1 FROM timegrapher_results r
                    WHERE r.user_id = s.user_id AND r.watch_id = s.watch_id
                      AND r.created_at BETWEEN s.created_at - interval '5 minutes'
                                           AND s.created_at + interval '5 minutes')
  ORDER BY s.created_at DESC LIMIT 10;
$$;

NOTIFY pgrst, 'reload schema';

-- Backfill: last 90 days, one week per statement, idempotent. This runs INSIDE Postgres —
-- it is not the PostgREST bulk read that caused the 2026-08-13 outage.
DO $$
DECLARE wk timestamptz;
BEGIN
  FOR wk IN SELECT generate_series(date_trunc('week', now() - interval '90 days'),
                                   date_trunc('week', now()), interval '1 week') LOOP
    INSERT INTO measurement_sessions
      (session_id, user_id, watch_id, rate, bph, converged, stop_reason, algo, amplitude, duration_sec, created_at)
    SELECT t.session_id,
      substring(t.messages from '"user_id":"([0-9a-f-]{36})"')::uuid,
      substring(t.messages from '"watch_id":"([^"]{1,64})"'),
      substring(t.messages from '"native_rate":(-?[0-9.]+)')::numeric,
      substring(t.messages from '"bph":([0-9]+)')::integer,
      COALESCE(substring(t.messages from '"converged":(true|false)') = 'true', false),
      substring(t.messages from '"stop_reason":"([a-z_]+)"'),
      substring(t.messages from '"algo":"([a-z_]+)"'),
      substring(t.messages from '"amplitude":([0-9]+)')::integer,
      substring(t.messages from '"duration_sec":([0-9]+)')::integer,
      t.created_at
    FROM timegrapher_tick_logs t
    WHERE t.created_at >= wk AND t.created_at < wk + interval '1 week'
      AND t.messages LIKE '{"type":"session_summary"%'
      AND substring(t.messages from '"user_id":"([0-9a-f-]{36})"') IS NOT NULL
    ON CONFLICT (session_id) DO NOTHING;
  END LOOP;
END $$;
