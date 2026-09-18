-- boot_timings.feed_rpc: true when the feed's first page came from feed_page()
-- (experiment feed_rpc) instead of the classic multi-request load. Lets the two
-- arms be compared directly: first_live_ms / enriched_ms by feed_rpc.
ALTER TABLE public.boot_timings ADD COLUMN IF NOT EXISTS feed_rpc boolean;

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
    sw_controlled, cached_feed, feed_error, optimistic_boot, early_feed, social_cache, feed_rpc)
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
    COALESCE((p->>'early_feed')      = 'true', false),
    COALESCE((p->>'social_cache')    = 'true', false),
    COALESCE((p->>'feed_rpc')        = 'true', false)
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

NOTIFY pgrst, 'reload schema';
