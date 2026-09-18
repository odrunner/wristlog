-- First-load timings, first-party copy of the PostHog `boot_timing` event, so
-- Admin → Traffic can show a daily "First load" card without a PostHog key
-- (and without losing users whose blocker drops PostHog).
--
-- Written by the client once per page load, AFTER the feed has rendered, via
-- record_boot_timing(); read only through admin_boot_timing_daily(). The table
-- has RLS on and no policies: no direct client access at all.
-- Volume: ~70–100 logged-in page loads/day → ~100 narrow rows/day.

CREATE TABLE IF NOT EXISTS public.boot_timings (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform        text,          -- 'ios' | 'web'
  nav_type        text,          -- navigate | reload | back_forward | prerender
  shell_from      text,          -- network | cache
  shell_kb        integer,
  script_ms       integer,       -- boot script began running (shell arrived + parsed)
  session_ms      integer,       -- getSession() settled
  cached_paint_ms integer,       -- last visit's feed drawn
  first_live_ms   integer,       -- feed Phase-1 render
  enriched_ms     integer,       -- feed Phase-2 render
  sw_controlled   boolean,
  cached_feed     boolean,
  feed_error      boolean,
  optimistic_boot boolean,
  early_feed      boolean
);
CREATE INDEX IF NOT EXISTS boot_timings_created_at_idx ON public.boot_timings (created_at);
CREATE INDEX IF NOT EXISTS boot_timings_user_day_idx   ON public.boot_timings (user_id, created_at);

ALTER TABLE public.boot_timings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boot_timings FROM PUBLIC, anon, authenticated;

-- ── Write: one row per page load, from the signed-in client ─────────────────
-- Values are clamped/whitelisted here so the client can send its payload as-is.
-- ≤ 60 rows per user per UTC day: far above real use, stops a loop or a script
-- from filling the table.
CREATE OR REPLACE FUNCTION public.record_boot_timing(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ms  integer;
BEGIN
  IF v_uid IS NULL OR p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM boot_timings
       WHERE user_id = v_uid AND created_at >= date_trunc('day', now())) >= 60 THEN
    RETURN;
  END IF;

  INSERT INTO boot_timings (
    user_id, platform, nav_type, shell_from, shell_kb,
    script_ms, session_ms, cached_paint_ms, first_live_ms, enriched_ms,
    sw_controlled, cached_feed, feed_error, optimistic_boot, early_feed)
  SELECT
    v_uid,
    CASE WHEN p->>'platform'   IN ('ios','web') THEN p->>'platform' END,
    CASE WHEN p->>'nav_type'   IN ('navigate','reload','back_forward','prerender') THEN p->>'nav_type' END,
    CASE WHEN p->>'shell_from' IN ('network','cache') THEN p->>'shell_from' END,
    ms.shell_kb, ms.script_ms, ms.session_ms, ms.cached_paint_ms, ms.first_live_ms, ms.enriched_ms,
    COALESCE((p->>'sw_controlled')   = 'true', false),
    COALESCE((p->>'cached_feed')     = 'true', false),
    COALESCE((p->>'feed_error')      = 'true', false),
    COALESCE((p->>'optimistic_boot') = 'true', false),
    COALESCE((p->>'early_feed')      = 'true', false)
  FROM (
    SELECT
      -- numeric JSON values only, 0 … 10 min (shell_kb: 0 … 100 MB); anything else → NULL
      CASE WHEN jsonb_typeof(p->'shell_kb')        = 'number' AND (p->>'shell_kb')::numeric        BETWEEN 0 AND 102400 THEN round((p->>'shell_kb')::numeric)::int END        AS shell_kb,
      CASE WHEN jsonb_typeof(p->'script_ms')       = 'number' AND (p->>'script_ms')::numeric       BETWEEN 0 AND 600000 THEN round((p->>'script_ms')::numeric)::int END       AS script_ms,
      CASE WHEN jsonb_typeof(p->'session_ms')      = 'number' AND (p->>'session_ms')::numeric      BETWEEN 0 AND 600000 THEN round((p->>'session_ms')::numeric)::int END      AS session_ms,
      CASE WHEN jsonb_typeof(p->'cached_paint_ms') = 'number' AND (p->>'cached_paint_ms')::numeric BETWEEN 0 AND 600000 THEN round((p->>'cached_paint_ms')::numeric)::int END AS cached_paint_ms,
      CASE WHEN jsonb_typeof(p->'first_live_ms')   = 'number' AND (p->>'first_live_ms')::numeric   BETWEEN 0 AND 600000 THEN round((p->>'first_live_ms')::numeric)::int END   AS first_live_ms,
      CASE WHEN jsonb_typeof(p->'enriched_ms')     = 'number' AND (p->>'enriched_ms')::numeric     BETWEEN 0 AND 600000 THEN round((p->>'enriched_ms')::numeric)::int END     AS enriched_ms
  ) ms;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_boot_timing(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_boot_timing(jsonb) TO authenticated;

-- ── Read: daily medians / p90s for the admin Traffic tab ────────────────────
-- Internal accounts are excluded (canonical list: internal_accounts). Days are
-- UTC. Percentiles ignore NULLs, so a load with no cached paint simply doesn't
-- contribute to cached_paint_p50.
CREATE OR REPLACE FUNCTION public.admin_boot_timing_daily(p_days integer DEFAULT 14)
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

  SELECT COALESCE(json_agg(d ORDER BY d.day DESC), '[]'::json) INTO result
  FROM (
    SELECT
      (b.created_at AT TIME ZONE 'UTC')::date                                   AS day,
      count(*)                                                                  AS loads,
      count(DISTINCT b.user_id)                                                 AS users,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.script_ms))           AS script_p50,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY b.script_ms))           AS script_p90,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.cached_paint_ms))     AS cached_paint_p50,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.first_live_ms))       AS first_live_p50,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY b.first_live_ms))       AS first_live_p90,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY b.enriched_ms))         AS enriched_p50,
      round(percentile_cont(0.9) WITHIN GROUP (ORDER BY b.enriched_ms))         AS enriched_p90,
      round(100.0 * count(*) FILTER (WHERE b.cached_feed)     / count(*))       AS cached_pct,
      round(100.0 * count(*) FILTER (WHERE b.early_feed)      / count(*))       AS early_pct,
      round(100.0 * count(*) FILTER (WHERE b.optimistic_boot) / count(*))       AS optimistic_pct,
      round(100.0 * count(*) FILTER (WHERE b.shell_from = 'cache') / count(*))  AS shell_cache_pct,
      round(100.0 * count(*) FILTER (WHERE b.feed_error)      / count(*))       AS error_pct
    FROM boot_timings b
    WHERE b.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 14), 90)) - 1)) AT TIME ZONE 'UTC'
      AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id = b.user_id)
    GROUP BY 1
  ) d;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_boot_timing_daily(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_boot_timing_daily(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
