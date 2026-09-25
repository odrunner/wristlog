-- Audit 2026-09-23 SEC-23-17 — forged measurements via timegrapher_tick_logs.
-- Anyone (anon included) could insert a session_summary tick log naming ANY
-- user_id and any created_at; capture_measurement_session() (definer) turned
-- it into that user's measurement_sessions row — fake readings in their
-- "unsaved measurements", re-measure reminders triggered or suppressed,
-- model accuracy stats skewed. The table was also world-readable, and every
-- summary carries a user_id.
-- Logged-out measuring still logs (INSERT stays open to anon), but:
--  * created_at is server-set (column INSERT grant excludes it);
--  * a summary becomes a measurement only for the user actually signed in;
--  * reading tick logs is admin + internal accounts (the analysis scripts sign
--    in as testuser), not the demo account ('alexrivera') anyone can enter.

REVOKE INSERT ON public.timegrapher_tick_logs FROM anon, authenticated;
GRANT INSERT (session_id, messages) ON public.timegrapher_tick_logs TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_measurement_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := substring(NEW.messages from '"user_id":"([0-9a-f-]{36})"')::uuid;
  -- Only the signed-in user can create their own measurement.
  IF v_uid IS NULL OR v_uid IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;
  INSERT INTO measurement_sessions
    (session_id, user_id, watch_id, rate, bph, converged, stop_reason, algo, amplitude, duration_sec, created_at)
  VALUES (
    NEW.session_id,
    v_uid,
    substring(NEW.messages from '"watch_id":"([^"]{1,64})"'),
    substring(NEW.messages from '"native_rate":(-?[0-9.]+)')::numeric,
    substring(NEW.messages from '"bph":([0-9]+)')::integer,
    COALESCE(substring(NEW.messages from '"converged":(true|false)') = 'true', false),
    substring(NEW.messages from '"stop_reason":"([a-z_]+)"'),
    substring(NEW.messages from '"algo":"([a-z_]+)"'),
    substring(NEW.messages from '"amplitude":([0-9]+)')::integer,
    substring(NEW.messages from '"duration_sec":([0-9]+)')::integer,
    now()
  )
  ON CONFLICT (session_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a parse problem block the tick-log insert.
  RETURN NEW;
END $$;

DROP POLICY IF EXISTS "Anyone can read tick logs" ON public.timegrapher_tick_logs;
CREATE POLICY tick_logs_read_internal ON public.timegrapher_tick_logs FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR EXISTS (SELECT 1 FROM public.internal_accounts ia
               WHERE ia.user_id = (SELECT auth.uid()) AND ia.label <> 'alexrivera')
  );
