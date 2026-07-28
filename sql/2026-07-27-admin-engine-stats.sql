-- Admin Usage → Totals: measurement volume split by detection engine.
-- Pro V2 (tg core) vs Original, each with distinct external users + session count.
--
-- Source of truth is the session_summary tick-log row, one per completed measurement
-- session — the same row admin_measurement_counts counts — so the two engine rows
-- partition the same population.
--
-- Engine rule: "algo":"tg" => Pro V2, everything else => Original. The algo field only
-- started shipping 2026-07-05; the 1,459 older summaries carry no algo at all and are
-- Original by definition (the tg core's first session was 2026-07-06).
--
-- Text regex, not messages::jsonb — every summary blob embeds the full tick_data array,
-- so parsing the whole document per row is far more work than matching the header.
--
-- NOTE: the two user counts OVERLAP. A user who measured on both engines is counted in
-- both. Sessions do not overlap.
--
-- Applied 2026-07-27 via supabase db query --linked.

CREATE OR REPLACE FUNCTION public.admin_engine_stats()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  WITH s AS (
    SELECT substring(messages from '"user_id"\s*:\s*"([0-9a-f-]{36})"') AS uid,
           CASE WHEN substring(messages from '"algo"\s*:\s*"([a-z]+)"') = 'tg'
                THEN 'tg' ELSE 'original' END AS engine,
           created_at
    FROM timegrapher_tick_logs
    WHERE messages LIKE '{"type":"session_summary"%'
  ), ext AS (
    SELECT * FROM s
    WHERE uid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id::text = s.uid)
  )
  SELECT json_build_object(
    'prov2_users',        (SELECT count(DISTINCT uid) FROM ext WHERE engine = 'tg'),
    'prov2_sessions',     (SELECT count(*)            FROM ext WHERE engine = 'tg'),
    'prov2_sessions_24h', (SELECT count(*) FROM ext WHERE engine = 'tg'
                            AND created_at >= now() - interval '24 hours'),
    'prov2_sessions_prev24h', (SELECT count(*) FROM ext WHERE engine = 'tg'
                            AND created_at >= now() - interval '48 hours'
                            AND created_at <  now() - interval '24 hours'),
    'orig_users',         (SELECT count(DISTINCT uid) FROM ext WHERE engine = 'original'),
    'orig_sessions',      (SELECT count(*)            FROM ext WHERE engine = 'original'),
    'orig_sessions_24h',  (SELECT count(*) FROM ext WHERE engine = 'original'
                            AND created_at >= now() - interval '24 hours'),
    'orig_sessions_prev24h', (SELECT count(*) FROM ext WHERE engine = 'original'
                            AND created_at >= now() - interval '48 hours'
                            AND created_at <  now() - interval '24 hours')
  ) INTO result;
  RETURN result;
END; $function$;

GRANT EXECUTE ON FUNCTION public.admin_engine_stats() TO authenticated;
NOTIFY pgrst, 'reload schema';
