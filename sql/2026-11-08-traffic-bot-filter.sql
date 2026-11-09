-- Exclude crawler traffic from admin_traffic_stats (Traffic tab: Daily chart,
-- By Source, Device).
--
-- The UA exclusion only covered test tooling (HeadlessChrome/Playwright/
-- Puppeteer/Electron), so search-engine crawls counted as visits: on
-- 2026-11-08 a Googlebot crawl burst put 129 bot rows into a 254-row day —
-- the Daily chart showed a 2x traffic spike that was half crawler. Last-30d
-- bot volume: ~153 Googlebot, 14 meta-webindexer, 9 Ahrefs, 1 bingbot,
-- 1 Google-InspectionTool.
--
-- Fix: add the same crawler pattern admin_watch_page_traffic has used since
-- 2026-10-03 — generic '(bot|spider|crawler)[ /;)]' (matches Googlebot/2.1,
-- bingbot/2.0, AhrefsBot, AhrefsSiteAudit via its "/robot/" URL,
-- meta-webindexer via its ".../crawler)" URL, Bytespider, GPTBot, …) plus
-- Google-InspectionTool and facebookexternalhit, which carry none of those
-- words. Verified against the actual last-30d UA list before shipping; the
-- only theoretical false positive is the CUBOT phone brand ("CUBOT " matches
-- 'bot '), never seen in page_visits.
--
-- Only the shared `filtered` CTE changes, so by_source / by_device_7d /
-- daily all clean up together. The funnel and signups_by_source branches
-- query sign-in events and profiles — crawlers never appear there.
--
-- NOTE: this replaces admin_traffic_stats_COMPUTE — the inner function behind
-- the admin_stats_cache wrapper (sql/2026-08-15-admin-stats-cache.sql), NOT
-- the plain admin_traffic_stats() of 2026-07-29 (replacing that name would
-- clobber the cache wrapper). The DELETE below busts the cached payload so
-- the next dashboard open recomputes instead of serving pre-fix numbers.
--
-- Applied 2026-11-08 via: npx supabase db query --linked --file sql/2026-11-08-traffic-bot-filter.sql --yes

CREATE OR REPLACE FUNCTION public.admin_traffic_stats_compute()
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
      AND (user_agent IS NULL OR user_agent !~* 'HeadlessChrome|Playwright|Puppeteer|Electron|(bot|spider|crawler)[ /;)]|Google-InspectionTool|facebookexternalhit')
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

-- Bust the cached payload so the next dashboard open recomputes with the
-- filter instead of serving pre-fix numbers at any age.
DELETE FROM public.admin_stats_cache WHERE key = 'admin_traffic_stats';

NOTIFY pgrst, 'reload schema';
