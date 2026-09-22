-- Live sample-size progress per arm for running knob trials, for Admin → Experiments.
--
-- A knob trial (owner='weekly_review') is judged only on Sundays by
-- scripts/accuracy_loop.py, so between Sundays its card had nothing to show and
-- looked broken. This counts, per assigned arm, the tg-engine measurements made
-- since the user was assigned (and since the trial started): users with ≥1
-- session, sessions, converged sessions — the numbers the judge's too_early gate
-- needs (≥15 users and ≥60 converged per arm).
--
-- Provisional on purpose: the arm here is the ASSIGNMENT and the source is
-- measurement_sessions (3 MB), while the judge reads each session's [TGTUNE] echo
-- from timegrapher_tick_logs (100+ MB — never scanned from a page load) and counts
-- balanced-preset sessions only for preset knobs. The two can differ slightly.
-- No outcome metric is returned: a mid-week wrong-rate read invites calling it early.
-- Admin-only. Returns { "<key>": { "control": {...}, "treatment": {...} }, ... }.

CREATE OR REPLACE FUNCTION public.admin_knob_trial_progress()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH sess AS (
    SELECT a.experiment_key, a.variant, m.user_id, m.converged
    FROM experiments e
    JOIN experiment_assignments a ON a.experiment_key = e.key
    JOIN measurement_sessions m ON m.user_id = a.user_id
     AND m.algo = 'tg'
     AND m.created_at >= GREATEST(e.started_at, a.assigned_at)
    WHERE e.owner = 'weekly_review' AND e.status = 'running'
      AND NOT EXISTS (SELECT 1 FROM internal_accounts i WHERE i.user_id = a.user_id)
  ), arms AS (
    SELECT experiment_key, variant,
           json_build_object(
             'users',     count(DISTINCT user_id),
             'sessions',  count(*),
             'converged', count(*) FILTER (WHERE converged)
           ) AS stats
    FROM sess GROUP BY experiment_key, variant
  ), per_exp AS (
    SELECT experiment_key, json_object_agg(variant, stats) AS arms FROM arms GROUP BY experiment_key
  )
  SELECT COALESCE(json_object_agg(experiment_key, arms), '{}'::json) INTO result FROM per_exp;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_knob_trial_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_knob_trial_progress() TO authenticated;

NOTIFY pgrst, 'reload schema';
