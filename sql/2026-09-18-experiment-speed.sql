-- Speed per experiment arm, for Admin → Experiments.
--
-- The experiments judge only knows behaviour metrics (experiment_metrics); a
-- change whose point is load time — feed_rpc — has nothing to show there. This
-- reads boot_timings (one row per signed-in page load) per arm instead.
--
-- Counted: loads made AFTER the user was assigned, EXCLUDING each user's first
-- load after assignment — a boot-time arm (feed_rpc) is read from a hint the
-- previous visit wrote, so that first load still ran the old path whatever the
-- arm. Internal accounts are never assigned, so they never appear. Admin-only.
-- Returns { "<experiment key>": { "control": {...}, "treatment": {...} }, ... }
-- for experiments that are running or won; computed live (tiny tables).

CREATE OR REPLACE FUNCTION public.admin_experiment_speed()
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

  WITH loads AS (
    SELECT a.experiment_key, a.variant, b.user_id, b.first_live_ms, b.enriched_ms, b.feed_error,
           row_number() OVER (PARTITION BY a.experiment_key, b.user_id ORDER BY b.created_at) AS nth
    FROM experiment_assignments a
    JOIN experiments e ON e.key = a.experiment_key AND e.status IN ('running', 'won')
    JOIN boot_timings b ON b.user_id = a.user_id AND b.created_at >= a.assigned_at - interval '2 minutes'
  ), arms AS (
    SELECT experiment_key, variant,
           json_build_object(
             'loads',          count(*),
             'users',          count(DISTINCT user_id),
             'first_live_p50', round(percentile_cont(0.5) WITHIN GROUP (ORDER BY first_live_ms)),
             'first_live_p90', round(percentile_cont(0.9) WITHIN GROUP (ORDER BY first_live_ms)),
             'enriched_p50',   round(percentile_cont(0.5) WITHIN GROUP (ORDER BY enriched_ms)),
             'enriched_p90',   round(percentile_cont(0.9) WITHIN GROUP (ORDER BY enriched_ms)),
             'error_pct',      round(100.0 * count(*) FILTER (WHERE feed_error) / count(*))
           ) AS stats
    FROM loads WHERE nth > 1
    GROUP BY experiment_key, variant
  ), per_exp AS (
    SELECT experiment_key, json_object_agg(variant, stats) AS arms FROM arms GROUP BY experiment_key
  )
  SELECT COALESCE(json_object_agg(experiment_key, arms), '{}'::json) INTO result FROM per_exp;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_experiment_speed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_experiment_speed() TO authenticated;

NOTIFY pgrst, 'reload schema';
