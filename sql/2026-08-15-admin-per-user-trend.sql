-- Admin "Per-User Averages" card 2026-08-15: w/w and m/m change per row.
-- Returns the numerator/denominator of each average as of now, 7 days ago and
-- 30 days ago (external users only, rows created before the cutoff), so the
-- client can compute avg_now − avg_then. Definitions mirror loadAdminStats():
--   watches      = watches
--   wears        = logs with watch_id AND use_case <> 'measurement' (admin_user_stats)
--   price_checks = valuation_events
--   enhances     = identify_attempts mode='enhance'
--   measurements = per user GREATEST(saved timegrapher_results, session_summary logs)
--                  (admin_measurement_counts), summed
--   follows      = follows
--   users        = profiles
-- Deployed via `supabase db query --linked`; this file is the record.

CREATE OR REPLACE FUNCTION public.admin_per_user_snapshot(p_cutoff timestamptz)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $f$
  WITH internal AS (SELECT user_id FROM internal_accounts),
  msr AS (
    SELECT COALESCE(s.user_id, r.user_id) AS user_id,
           GREATEST(COALESCE(r.saved, 0), COALESCE(s.sessions, 0)) AS cnt
    FROM (
      SELECT (t.messages::jsonb->>'user_id')::uuid AS user_id, count(*) AS sessions
      FROM timegrapher_tick_logs t
      WHERE t.messages LIKE '{"type":"session_summary"%' AND t.created_at < p_cutoff
      GROUP BY 1
    ) s
    FULL OUTER JOIN (
      SELECT tr.user_id, count(*) AS saved FROM timegrapher_results tr
      WHERE tr.created_at < p_cutoff GROUP BY 1
    ) r ON s.user_id = r.user_id
  )
  SELECT json_build_object(
    'users',        (SELECT count(*) FROM profiles p WHERE p.created_at < p_cutoff AND p.id NOT IN (SELECT user_id FROM internal)),
    'watches',      (SELECT count(*) FROM watches w WHERE w.created_at < p_cutoff AND w.user_id NOT IN (SELECT user_id FROM internal)),
    'wears',        (SELECT count(*) FROM logs l WHERE l.watch_id IS NOT NULL AND l.use_case IS DISTINCT FROM 'measurement'
                       AND l.created_at < p_cutoff AND l.user_id NOT IN (SELECT user_id FROM internal)),
    'price_checks', (SELECT count(*) FROM valuation_events v WHERE v.created_at < p_cutoff AND v.user_id NOT IN (SELECT user_id FROM internal)),
    'enhances',     (SELECT count(*) FROM identify_attempts i WHERE i.mode = 'enhance' AND i.created_at < p_cutoff AND i.user_id NOT IN (SELECT user_id FROM internal)),
    'measurements', (SELECT COALESCE(sum(cnt), 0) FROM msr WHERE user_id IS NULL OR user_id NOT IN (SELECT user_id FROM internal)),
    'follows',      (SELECT count(*) FROM follows f WHERE f.created_at < p_cutoff AND f.follower_id NOT IN (SELECT user_id FROM internal))
  );
$f$;

CREATE OR REPLACE FUNCTION public.admin_per_user_trend()
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN json_build_object(
    'now',   public.admin_per_user_snapshot(now()),
    'week',  public.admin_per_user_snapshot(now() - interval '7 days'),
    'month', public.admin_per_user_snapshot(now() - interval '30 days')
  );
END;
$f$;

REVOKE EXECUTE ON FUNCTION public.admin_per_user_snapshot(timestamptz) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_per_user_trend() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.admin_per_user_trend() TO authenticated;

NOTIFY pgrst, 'reload schema';
