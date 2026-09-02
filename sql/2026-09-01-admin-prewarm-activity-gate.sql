-- Audit 2026-09-01 PERF-DB-N1: the admin prewarm cron was 63% of ALL DB time.
--
-- admin_stats_refresh() (sql/2026-08-22-admin-stats-prewarm.sql) recomputed all
-- 10 heavy stats every 10 minutes, 24/7 — 16,219s of the 25,786s total DB time
-- since 08-13 (pg_stat_statements), for a dashboard with exactly one viewer.
--
-- New design — refresh only while the dashboard is actually being used:
--   1. Wrappers serve the cache at ANY age (the freshness predicate is removed
--      by catalog rewrite). Inline recompute now happens only if a key has never
--      been cached, so the pre-08-22 "cold open → five concurrent recomputes →
--      8s-timeout 500s" failure CANNOT return, no matter how long the cron
--      slept. ↻ Refresh (p_force) still computes live, unchanged.
--   2. A dashboard read stamps a '_dashboard_read' row (touch is injected into
--      admin_active_dau's cache-read branch — the dashboard always calls it,
--      and the cron's p_force calls skip that branch, so the cron cannot re-arm
--      itself).
--   3. admin_stats_refresh() exits early ('idle') unless a dashboard read
--      happened in the last 60 minutes. An idle tick costs one row read.
--
-- Net effect: numbers on a first open after idle are as old as the idle period
-- (served instantly), a touch re-arms the cron, and within ≤10 minutes the
-- cache is hot again; while the admin is active everything behaves exactly as
-- before. Expected saving: the refresh runs a few active hours/day instead of 24.
--
-- Rollback: re-apply sql/2026-08-22-admin-stats-prewarm.sql (recreates the
-- refresh fn) and re-add the freshness predicate by reversing the replace below.

BEGIN;

-- 1. Remove the freshness predicate from all 10 wrappers (both body shapes
--    share the literal substring).
DO $do$
DECLARE f text; def text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_active_dau', 'admin_email_engagement', 'admin_traffic_stats',
                           'admin_engine_stats', 'admin_dod_counts', 'admin_email_clickthrough',
                           'admin_per_user_trend', 'admin_last_active', 'admin_measurement_counts',
                           'admin_user_stats'] LOOP
    SELECT pg_get_functiondef(('public.' || f || '(boolean)')::regprocedure) INTO def;
    IF position($q$ AND computed_at > now() - interval '15 minutes'$q$ IN def) > 0 THEN
      EXECUTE replace(def, $q$ AND computed_at > now() - interval '15 minutes'$q$, '');
    END IF;
  END LOOP;
END $do$;

-- 2. Inject the dashboard-read touch into admin_active_dau's cache-read branch.
DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.admin_active_dau(boolean)'::regprocedure) INTO def;
  IF position('_dashboard_read' IN def) = 0 THEN
    EXECUTE replace(def,
      'IF FOUND THEN RETURN cached::json; END IF;',
      'IF FOUND THEN ' ||
      'INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES (''_dashboard_read'', ''{}''::jsonb, now()) ' ||
      'ON CONFLICT (key) DO UPDATE SET computed_at = now(); ' ||
      'RETURN cached::json; END IF;');
  END IF;
END $do$;

-- 3. Gate the refresh on recent dashboard activity.
CREATE OR REPLACE FUNCTION public.admin_stats_refresh()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE admin_id uuid; f text; t0 timestamptz; report text := ''; last_read timestamptz;
BEGIN
  SELECT computed_at INTO last_read FROM admin_stats_cache WHERE key = '_dashboard_read';
  IF last_read IS NULL OR last_read < now() - interval '60 minutes' THEN
    RETURN 'idle (last dashboard read: ' || coalesce(last_read::text, 'never') || ')';
  END IF;
  SELECT id INTO admin_id FROM profiles WHERE is_admin = true ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN RETURN 'no admin profile'; END IF;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  FOREACH f IN ARRAY ARRAY['admin_active_dau', 'admin_email_engagement', 'admin_traffic_stats',
                           'admin_engine_stats', 'admin_dod_counts', 'admin_email_clickthrough',
                           'admin_per_user_trend', 'admin_last_active', 'admin_measurement_counts',
                           'admin_user_stats'] LOOP
    t0 := clock_timestamp();
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I(true)', f);
      report := report || f || '=' || round(extract(epoch FROM clock_timestamp() - t0) * 1000) || 'ms ';
    EXCEPTION WHEN OTHERS THEN
      report := report || f || '=ERR(' || SQLERRM || ') ';
    END;
  END LOOP;
  RETURN report;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_stats_refresh() FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
