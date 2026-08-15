-- 2026-08-15 — Admin dashboard stats cache (audit 2026-08-15 DB-1)
--
-- pg_stat_statements (46 h): admin RPCs = 876 s of 1,655 s total DB time (57 %)
-- from 1,527 calls; admin_active_dau alone averaged 2.1 s (max 7.2 s), and the
-- dashboard opens ~53×/day. None of these numbers change minute to minute, so
-- each heavy RPC now serves a 10-minute server-side cache and only recomputes
-- when it is stale or the caller passes p_force := true (the ↻ Refresh button).
--
-- Mechanics: the ORIGINAL body of each RPC is cloned verbatim from the live
-- catalog into <name>_compute() (so the numbers' logic is untouched), and
-- <name>(p_force boolean DEFAULT false) becomes a VOLATILE wrapper (it must be
-- VOLATILE — PostgREST runs STABLE functions in a READ ONLY transaction, which
-- would reject the cache write). The auth check stays in both layers.
--
-- Wrapped: admin_active_dau, admin_email_engagement, admin_traffic_stats, admin_engine_stats, admin_dod_counts, admin_email_clickthrough, admin_per_user_trend, admin_last_active, admin_measurement_counts, admin_user_stats
-- NOT wrapped (must be live): admin_broadcast_queue_status, admin_totals,
-- admin_fact_counts, admin_*_stats (cheap), and anything outside the dashboard.
--
-- Apply with: npx supabase db query --linked --file sql/2026-08-15-admin-stats-cache.sql
-- Then:       NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.admin_stats_cache (
  key         text PRIMARY KEY,
  payload     jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_stats_cache ENABLE ROW LEVEL SECURITY;   -- no policies: only the SECURITY DEFINER wrappers touch it
REVOKE ALL ON public.admin_stats_cache FROM anon, authenticated;

-- 1. Clone the original bodies to <name>_compute() straight from the catalog.
DO $do$
DECLARE f text; def text;
BEGIN
  FOREACH f IN ARRAY ARRAY['admin_active_dau', 'admin_email_engagement', 'admin_traffic_stats', 'admin_engine_stats', 'admin_dod_counts', 'admin_email_clickthrough', 'admin_per_user_trend', 'admin_last_active', 'admin_measurement_counts', 'admin_user_stats'] LOOP
    IF to_regproc('public.' || f || '_compute') IS NOT NULL THEN CONTINUE; END IF;   -- idempotent
    SELECT pg_get_functiondef(('public.' || f)::regproc) INTO def;
    def := replace(def, 'FUNCTION public.' || f || '()', 'FUNCTION public.' || f || '_compute()');
    EXECUTE def;
  END LOOP;
END $do$;

-- 2. Replace each RPC with a cache-checking wrapper of the same name/result.

DROP FUNCTION IF EXISTS public.admin_active_dau();
CREATE OR REPLACE FUNCTION public.admin_active_dau(p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE cached jsonb; result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_active_dau' AND computed_at > now() - interval '10 minutes';
    IF FOUND THEN RETURN cached::json; END IF;
  END IF;
  result := public.admin_active_dau_compute();
  INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_active_dau', coalesce(result, 'null')::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  RETURN result;
END $fn$;

DROP FUNCTION IF EXISTS public.admin_email_engagement();
CREATE OR REPLACE FUNCTION public.admin_email_engagement(p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE cached jsonb; result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_email_engagement' AND computed_at > now() - interval '10 minutes';
    IF FOUND THEN RETURN cached::json; END IF;
  END IF;
  result := public.admin_email_engagement_compute();
  INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_email_engagement', coalesce(result, 'null')::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  RETURN result;
END $fn$;

DROP FUNCTION IF EXISTS public.admin_traffic_stats();
CREATE OR REPLACE FUNCTION public.admin_traffic_stats(p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE cached jsonb; result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_traffic_stats' AND computed_at > now() - interval '10 minutes';
    IF FOUND THEN RETURN cached::json; END IF;
  END IF;
  result := public.admin_traffic_stats_compute();
  INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_traffic_stats', coalesce(result, 'null')::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  RETURN result;
END $fn$;

DROP FUNCTION IF EXISTS public.admin_engine_stats();
CREATE OR REPLACE FUNCTION public.admin_engine_stats(p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE cached jsonb; result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_engine_stats' AND computed_at > now() - interval '10 minutes';
    IF FOUND THEN RETURN cached::json; END IF;
  END IF;
  result := public.admin_engine_stats_compute();
  INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_engine_stats', coalesce(result, 'null')::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  RETURN result;
END $fn$;

DROP FUNCTION IF EXISTS public.admin_dod_counts();
CREATE OR REPLACE FUNCTION public.admin_dod_counts(p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE cached jsonb; result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_dod_counts' AND computed_at > now() - interval '10 minutes';
    IF FOUND THEN RETURN cached::json; END IF;
  END IF;
  result := public.admin_dod_counts_compute();
  INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_dod_counts', coalesce(result, 'null')::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  RETURN result;
END $fn$;

DROP FUNCTION IF EXISTS public.admin_email_clickthrough();
CREATE OR REPLACE FUNCTION public.admin_email_clickthrough(p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE cached jsonb; result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_email_clickthrough' AND computed_at > now() - interval '10 minutes';
    IF FOUND THEN RETURN cached::json; END IF;
  END IF;
  result := public.admin_email_clickthrough_compute();
  INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_email_clickthrough', coalesce(result, 'null')::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  RETURN result;
END $fn$;

DROP FUNCTION IF EXISTS public.admin_per_user_trend();
CREATE OR REPLACE FUNCTION public.admin_per_user_trend(p_force boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
DECLARE cached jsonb; result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_per_user_trend' AND computed_at > now() - interval '10 minutes';
    IF FOUND THEN RETURN cached::json; END IF;
  END IF;
  result := public.admin_per_user_trend_compute();
  INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_per_user_trend', coalesce(result, 'null')::jsonb, now())
  ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  RETURN result;
END $fn$;

DROP FUNCTION IF EXISTS public.admin_last_active();
CREATE OR REPLACE FUNCTION public.admin_last_active(p_force boolean DEFAULT false)
RETURNS TABLE(user_id uuid, last_active timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
#variable_conflict use_column
DECLARE cached jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_last_active' AND computed_at > now() - interval '10 minutes';
  END IF;
  IF cached IS NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO cached FROM public.admin_last_active_compute() c;
    INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_last_active', cached, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  END IF;
  RETURN QUERY SELECT t."user_id", t."last_active" FROM jsonb_to_recordset(cached) AS t("user_id" uuid, "last_active" timestamptz);
END $fn$;

DROP FUNCTION IF EXISTS public.admin_measurement_counts();
CREATE OR REPLACE FUNCTION public.admin_measurement_counts(p_force boolean DEFAULT false)
RETURNS TABLE(user_id uuid, count bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
#variable_conflict use_column
DECLARE cached jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_measurement_counts' AND computed_at > now() - interval '10 minutes';
  END IF;
  IF cached IS NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO cached FROM public.admin_measurement_counts_compute() c;
    INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_measurement_counts', cached, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  END IF;
  RETURN QUERY SELECT t."user_id", t."count" FROM jsonb_to_recordset(cached) AS t("user_id" uuid, "count" bigint);
END $fn$;

DROP FUNCTION IF EXISTS public.admin_user_stats();
CREATE OR REPLACE FUNCTION public.admin_user_stats(p_force boolean DEFAULT false)
RETURNS TABLE(user_id uuid, watches bigint, wears bigint, posts bigint, price_checks bigint, enhances bigint, recent_active_days bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $fn$
#variable_conflict use_column
DECLARE cached jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT coalesce(p_force, false) THEN
    SELECT payload INTO cached FROM admin_stats_cache
     WHERE key = 'admin_user_stats' AND computed_at > now() - interval '10 minutes';
  END IF;
  IF cached IS NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO cached FROM public.admin_user_stats_compute() c;
    INSERT INTO admin_stats_cache (key, payload, computed_at) VALUES ('admin_user_stats', cached, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
  END IF;
  RETURN QUERY SELECT t."user_id", t."watches", t."wears", t."posts", t."price_checks", t."enhances", t."recent_active_days" FROM jsonb_to_recordset(cached) AS t("user_id" uuid, "watches" bigint, "wears" bigint, "posts" bigint, "price_checks" bigint, "enhances" bigint, "recent_active_days" bigint);
END $fn$;

NOTIFY pgrst, 'reload schema';
