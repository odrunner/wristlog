-- Demo-measure telemetry for Admin → Traffic ("Demo Measure" card).
--
-- Demo visitors can RUN the timegrapher since 2026-10-11 (usage review P1):
-- the engine is on-device, Keep/Share/History stay gated. Every run logs a
-- feature_events row (event='demo_measure', user_id = the shared demo account,
-- meta: phase + per-device `did`), and this RPC aggregates them so the surface
-- is never silent — the card is where abuse would show up. The brake is
-- DEMO_MEASURE_CAP in index.html (0 = off): flip it if max_device_7d runs hot.
--
-- Phases: started | completed | capped | cta_signup | cta_dismissed | converted
-- ('converted' is logged under the NEW account's user_id after signup, same did).
--
-- Computed live like admin_watch_page_traffic — the demo_measure slice of
-- feature_events is small; no admin_stats_cache entry.

CREATE OR REPLACE FUNCTION public.admin_demo_measure_stats(p_days integer DEFAULT 14)
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

  WITH dm AS (
    SELECT created_at,
           meta->>'phase' AS phase,
           meta->>'did'   AS did
    FROM feature_events
    WHERE event = 'demo_measure'
  )
  SELECT json_build_object(
    'started_total',   (SELECT count(*) FROM dm WHERE phase = 'started'),
    'started_1d',      (SELECT count(*) FROM dm WHERE phase = 'started' AND created_at >= NOW() - INTERVAL '1 day'),
    'started_7d',      (SELECT count(*) FROM dm WHERE phase = 'started' AND created_at >= NOW() - INTERVAL '7 days'),
    'completed_total', (SELECT count(*) FROM dm WHERE phase = 'completed'),
    'completed_7d',    (SELECT count(*) FROM dm WHERE phase = 'completed' AND created_at >= NOW() - INTERVAL '7 days'),
    'capped_total',    (SELECT count(*) FROM dm WHERE phase = 'capped'),
    'cta_total',       (SELECT count(*) FROM dm WHERE phase = 'cta_signup'),
    'converted_total', (SELECT count(*) FROM dm WHERE phase = 'converted'),
    'devices_total',   (SELECT count(DISTINCT did) FROM dm WHERE did IS NOT NULL),
    'devices_7d',      (SELECT count(DISTINCT did) FROM dm WHERE did IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days'),
    -- The abuse dial: most runs started by one device in the last 7 days.
    'max_device_7d',   COALESCE((
      SELECT max(n) FROM (
        SELECT count(*) AS n FROM dm
        WHERE phase = 'started' AND did IS NOT NULL
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY did
      ) t), 0),
    'daily', (
      SELECT coalesce(json_agg(row_to_json(d) ORDER BY d.day), '[]'::json)
      FROM (
        SELECT created_at::date AS day, count(*) AS count
        FROM dm
        WHERE phase = 'started' AND created_at >= NOW() - (p_days || ' days')::interval
        GROUP BY 1
      ) d
    )
  ) INTO result;

  RETURN result;
END;
$function$;

NOTIFY pgrst, 'reload schema';
