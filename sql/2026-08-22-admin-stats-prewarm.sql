-- 2026-08-22 — Pre-warm the admin dashboard stats cache (follow-up to 2026-08-15 DB-1)
--
-- sql/2026-08-15-admin-stats-cache.sql gave each heavy admin RPC a 10-minute
-- server-side cache, but a COLD open of the dashboard still recomputed them —
-- five at once, under the `authenticated` role's 8 s statement_timeout, on a
-- 406 MB instance that is also serving users. Measured sequentially as
-- postgres on 2026-08-22: admin_active_dau 2.1 s, admin_email_engagement 1.6 s,
-- admin_per_user_trend 1.1 s, admin_traffic_stats 1.0 s … ~8 s for all ten;
-- concurrent + contended, three of them exceed 8 s → 500 "canceling statement
-- due to statement timeout", ~5× a day, and the cache row for those keys never
-- refreshes (the failed transaction rolls back), so the next open misses again.
--
-- Fix: a pg_cron job runs admin_stats_refresh() every 10 minutes as `postgres`
-- (no statement_timeout) and forces every wrapper (p_force := true) one after
-- another, so a dashboard open only ever READS the cache. The wrapper TTL is
-- widened 10 → 15 minutes so a cron tick always lands inside it; the ↻ Refresh
-- buttons still recompute live (explicit user action, unchanged).
--
-- Apply with: npx supabase db query --linked --file sql/2026-08-22-admin-stats-prewarm.sql
-- Verify:     SELECT admin_stats_refresh();  -- returns per-key timings
--             SELECT key, computed_at FROM admin_stats_cache ORDER BY computed_at;
--             SELECT jobname, schedule FROM cron.job WHERE jobname = 'refresh-admin-stats-cache';

-- 1. The refresh function. The wrappers gate on auth.uid() ∈ profiles.is_admin,
--    so impersonate the admin for this transaction only (set_config is_local).
CREATE OR REPLACE FUNCTION public.admin_stats_refresh()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE admin_id uuid; f text; t0 timestamptz; report text := '';
BEGIN
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
      -- count(*) drains both the json-returning and the TABLE-returning wrappers.
      EXECUTE format('SELECT count(*) FROM public.%I(true)', f);
      report := report || f || '=' || round(extract(epoch FROM clock_timestamp() - t0) * 1000) || 'ms ';
    EXCEPTION WHEN OTHERS THEN
      -- One slow/broken key must not leave the other nine stale.
      report := report || f || '=ERR(' || SQLERRM || ') ';
    END;
  END LOOP;
  RETURN report;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_stats_refresh() FROM PUBLIC, anon, authenticated;

-- 2. Widen the wrappers' TTL 10 → 15 minutes (a 10-minute cron must always land
--    inside the window). Same catalog-rewrite technique the original file used.
DO $do$
DECLARE f text; def text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_active_dau', 'admin_email_engagement', 'admin_traffic_stats',
                           'admin_engine_stats', 'admin_dod_counts', 'admin_email_clickthrough',
                           'admin_per_user_trend', 'admin_last_active', 'admin_measurement_counts',
                           'admin_user_stats'] LOOP
    SELECT pg_get_functiondef(('public.' || f || '(boolean)')::regprocedure) INTO def;
    IF position($q$interval '10 minutes'$q$ IN def) > 0 THEN
      EXECUTE replace(def, $q$interval '10 minutes'$q$, $q$interval '15 minutes'$q$);
    END IF;
  END LOOP;
END $do$;

-- 3. Schedule (pg_cron upserts by job name, so re-applying is safe).
SELECT cron.schedule('refresh-admin-stats-cache', '*/10 * * * *', $$SELECT public.admin_stats_refresh()$$);

NOTIFY pgrst, 'reload schema';
