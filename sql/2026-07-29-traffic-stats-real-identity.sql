-- Drop the Traffic "Overview (All Time)" metrics from admin_traffic_stats.
--
-- The overview reported "unique visitors" / "repeat visitors" from
-- COALESCE(user_id::text, user_agent, 'unknown'). Because user_id was NULL on
-- every non-admin visit (see 2026-07-28-attribute-page-visit.sql), that
-- degraded into "distinct User-Agent string": one iOS 18.7 Safari UA covered
-- 3,830 of 5,196 visits, so the card claimed 169 all-time unique visitors
-- against 458 profiles, and 43 in 30d against 87 signups in the same window.
--
-- Attribution is fixed going forward, but there is still no reliable per-person
-- identity for LOGGED-OUT traffic, so an honest "unique visitors" for the top of
-- the funnel isn't computable from this table at all. And for people who do have
-- an identity, the Usage tab already counts them properly — admin_active_dau
-- derives DAU/WAU/MAU from 12 activity sources (31/79/175 at time of writing,
-- against the overview's 7/16/43). The remaining overview tiles were visit
-- totals that by_source and daily already show.
--
-- So the overview is removed rather than patched. What stays is what this table
-- can actually answer: where traffic comes from, when it arrives, on what
-- device, and how it converts.
--
-- NOTE: the attribution fix still earns its keep here — signups_by_source joins
-- page_visits.user_id to find each signup's first-touch source, and with user_id
-- never populated that join found nothing, collapsing all 452 signups into a
-- single "Direct" bucket. It starts resolving real sources as new users attribute.

CREATE OR REPLACE FUNCTION public.admin_traffic_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH internal AS (
    SELECT user_id FROM internal_accounts
  ),
  filtered AS (
    SELECT
      created_at,
      utm_source,
      referrer,
      user_agent,
      user_id,
      CASE
        WHEN utm_source IN ('reddit', 'reddit_lp') OR utm_source LIKE 'reddit\_lp\_%' OR referrer ILIKE '%reddit.com%' THEN 'Reddit'
        WHEN referrer ILIKE '%google.com%' AND COALESCE(utm_source, '') != 'appstore_click' THEN 'Google'
        WHEN referrer ILIKE '%bing.com%' THEN 'Bing'
        WHEN referrer ILIKE '%duckduckgo%' THEN 'DuckDuckGo'
        WHEN referrer ILIKE '%t.co%' THEN 'Twitter / X'
        WHEN utm_source = 'appstore_click' THEN 'App Store link'
        WHEN utm_source = 'direct' OR (COALESCE(utm_source, '') = '' AND COALESCE(referrer, '') = '') THEN 'Direct'
        WHEN referrer IS NOT NULL AND referrer != '' THEN COALESCE(substring(referrer from '://([^/]+)'), referrer)
        ELSE COALESCE(NULLIF(utm_source, ''), 'Other')
      END AS source_name,
      CASE
        WHEN user_agent ~* 'Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|Opera Mini|IEMobile' THEN 'mobile'
        WHEN user_agent ~* 'iPad|Android|Tablet' THEN 'tablet'
        WHEN user_agent IS NULL OR user_agent = '' THEN 'unknown'
        ELSE 'desktop'
      END AS device_type
    FROM page_visits
    WHERE (user_id IS NULL OR user_id NOT IN (SELECT user_id FROM internal))
      AND (user_agent IS NULL OR user_agent !~* 'HeadlessChrome|Playwright|Puppeteer|Electron')
      AND (utm_medium IS NULL OR utm_medium != 'funnel')
      AND NOT (
        COALESCE(utm_source, '') = ''
        AND referrer IS NOT NULL
        AND (referrer ILIKE '%accounts.google.com%' OR referrer ILIKE '%appleid.apple.com%')
      )
      AND NOT (utm_source ~ '^(signin_google|signin_apple|onboarding_step_\d+)$')
  )
  SELECT json_build_object(
    'by_source', (
      SELECT coalesce(json_agg(row_to_json(s) ORDER BY s.total DESC), '[]'::json)
      FROM (
        SELECT source_name AS source, count(*) AS total,
          count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') AS day,
          count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week
        FROM filtered GROUP BY source_name
      ) s
    ),
    'by_device_7d', (
      SELECT coalesce(json_agg(row_to_json(d) ORDER BY d.count DESC), '[]'::json)
      FROM (
        SELECT device_type AS device, count(*) AS count
        FROM filtered WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY device_type
      ) d
    ),
    'daily', (
      SELECT coalesce(json_agg(row_to_json(dd) ORDER BY dd.day DESC), '[]'::json)
      FROM (
        SELECT created_at::date AS day, count(*) AS count
        FROM filtered WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY created_at::date ORDER BY day DESC LIMIT 14
      ) dd
    ),
    'funnel', (
      SELECT json_build_object(
        'signin_google_all', count(*) FILTER (WHERE utm_source = 'signin_google'),
        'signin_apple_all', count(*) FILTER (WHERE utm_source = 'signin_apple'),
        'signin_google_7d', count(*) FILTER (WHERE utm_source = 'signin_google' AND created_at >= NOW() - INTERVAL '7 days'),
        'signin_apple_7d', count(*) FILTER (WHERE utm_source = 'signin_apple' AND created_at >= NOW() - INTERVAL '7 days'),
        'signin_google_1d', count(*) FILTER (WHERE utm_source = 'signin_google' AND created_at >= NOW() - INTERVAL '1 day'),
        'signin_apple_1d', count(*) FILTER (WHERE utm_source = 'signin_apple' AND created_at >= NOW() - INTERVAL '1 day')
      )
      FROM page_visits
      WHERE utm_medium = 'funnel'
        AND utm_source IN ('signin_google', 'signin_apple')
        AND (user_id IS NULL OR user_id NOT IN (SELECT user_id FROM internal))
    ),
    'signups', json_build_object(
      'total', (SELECT count(*) FROM profiles WHERE id NOT IN (SELECT user_id FROM internal)),
      'last_1d', (SELECT count(*) FROM profiles WHERE id NOT IN (SELECT user_id FROM internal) AND created_at >= NOW() - INTERVAL '1 day'),
      'last_7d', (SELECT count(*) FROM profiles WHERE id NOT IN (SELECT user_id FROM internal) AND created_at >= NOW() - INTERVAL '7 days')
    ),
    'signups_by_source', (
      SELECT coalesce(json_agg(row_to_json(ss) ORDER BY ss.count DESC), '[]'::json)
      FROM (
        SELECT
          CASE
            WHEN pv.utm_source IN ('reddit', 'reddit_lp') OR pv.utm_source LIKE 'reddit\_lp\_%' OR pv.referrer ILIKE '%reddit.com%' THEN 'Reddit'
            WHEN pv.referrer ILIKE '%google.com%' THEN 'Google'
            WHEN pv.referrer ILIKE '%t.co%' THEN 'Twitter / X'
            WHEN pv.utm_source = 'direct' OR (COALESCE(pv.utm_source, '') = '' AND COALESCE(pv.referrer, '') = '') THEN 'Direct'
            WHEN pv.referrer IS NOT NULL AND pv.referrer != '' THEN COALESCE(substring(pv.referrer from '://([^/]+)'), pv.referrer)
            WHEN pv.utm_source IS NOT NULL THEN pv.utm_source
            ELSE 'Unknown'
          END AS source,
          count(*) AS count,
          count(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '1 day') AS day,
          count(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '7 days') AS week
        FROM profiles p
        LEFT JOIN LATERAL (
          SELECT utm_source, referrer
          FROM page_visits
          WHERE page_visits.user_id = p.id
          ORDER BY created_at ASC
          LIMIT 1
        ) pv ON true
        WHERE p.id NOT IN (SELECT user_id FROM internal)
        GROUP BY source
      ) ss
    )
  ) INTO result;

  RETURN result;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.admin_traffic_stats() FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.admin_traffic_stats() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
