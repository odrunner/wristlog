-- Watch-page (w/) traffic for Admin → Traffic.
--
-- The public model pages launched without a first-party visit log: p/ and
-- profile/ insert into page_visits, w/ only sent PostHog's model_page_viewed
-- (which the admin dashboard can't read — a PostHog query key in index.html
-- would be public). From 2026-10-03 w/index.html writes the same page_visits
-- row as the other public pages, with the model slug in `path`
-- ('/w/?m=<slug>'), and this RPC aggregates views, models and sources for the
-- Traffic tab. Launch-day traffic before this shipped exists only in PostHog.
--
-- Computed live like admin_boot_timing_daily — no admin_stats_cache entry:
-- the '/w/%' slice of page_visits is small (new surface, low volume).
--
-- No internal-account exclusion is possible: these rows are anonymous
-- (user_id is null), so the admin's own test visits count — same caveat as
-- the p/ and profile/ rows feeding admin_traffic_stats.

CREATE OR REPLACE FUNCTION public.admin_watch_page_traffic(p_days integer DEFAULT 14)
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

  WITH wv AS (
    SELECT
      created_at,
      NULLIF(substring(path from '\?m=([a-z0-9-]+)'), '') AS model,
      -- Same precedence as the Traffic tab's other source lists:
      -- explicit utm_source, else the external referrer's host, else direct.
      CASE
        WHEN COALESCE(utm_source, '') NOT IN ('', 'direct') THEN utm_source
        WHEN COALESCE(referrer, '') <> '' THEN COALESCE(substring(referrer from '://([^/]+)'), referrer)
        ELSE 'direct'
      END AS source
    FROM page_visits
    WHERE path LIKE '/w/%'
  )
  SELECT json_build_object(
    'total',   (SELECT count(*) FROM wv),
    'last_1d', (SELECT count(*) FROM wv WHERE created_at >= NOW() - INTERVAL '1 day'),
    'last_7d', (SELECT count(*) FROM wv WHERE created_at >= NOW() - INTERVAL '7 days'),
    'by_model', (
      SELECT coalesce(json_agg(row_to_json(m) ORDER BY m.total DESC), '[]'::json)
      FROM (
        SELECT COALESCE(model, '(no model)') AS model, count(*) AS total,
          count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') AS day,
          count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week
        FROM wv GROUP BY 1 ORDER BY count(*) DESC LIMIT 30
      ) m
    ),
    'by_source', (
      SELECT coalesce(json_agg(row_to_json(s) ORDER BY s.total DESC), '[]'::json)
      FROM (
        SELECT source, count(*) AS total,
          count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') AS day,
          count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week
        FROM wv GROUP BY 1 ORDER BY count(*) DESC LIMIT 30
      ) s
    ),
    'daily', (
      SELECT coalesce(json_agg(row_to_json(dd) ORDER BY dd.day DESC), '[]'::json)
      FROM (
        SELECT created_at::date AS day, count(*) AS count
        FROM wv
        WHERE created_at >= date_trunc('day', NOW())
          - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 14), 90)) - 1)
        GROUP BY 1 ORDER BY day DESC
      ) dd
    )
  ) INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_watch_page_traffic(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_watch_page_traffic(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
