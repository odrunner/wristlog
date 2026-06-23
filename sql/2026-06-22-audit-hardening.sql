-- 2026-06-22 audit hardening — DB-side changes (applied via `supabase db query --linked`;
-- recorded here for reproducibility since this project deploys RPCs directly, not via
-- migrations). Covers audit items #10 (search_path), #17 (founder-exclude recent), #27
-- (atomic rate limit).

-- ── #10: pin search_path on SECURITY DEFINER admin RPCs (excludes user-writable pg_temp) ──
ALTER FUNCTION public.admin_active_days(uuid, integer) SET search_path = pg_catalog, public;
ALTER FUNCTION public.admin_last_active()            SET search_path = pg_catalog, public;
ALTER FUNCTION public.admin_traffic_stats()          SET search_path = pg_catalog, public;
ALTER FUNCTION public.admin_user_detail(uuid)        SET search_path = pg_catalog, public;

-- ── #17: founder-exclude the recent opens/clicks list (server-side, matching the
--         client-side by_subject exclusion) + pin search_path on this RPC too ──
CREATE OR REPLACE FUNCTION public.admin_email_engagement()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, public
AS $function$
DECLARE
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT json_build_object(
    'by_subject', (
      SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT
          subject,
          count(*) FILTER (WHERE event_type = 'sent') AS sent,
          count(*) FILTER (WHERE event_type = 'delivered') AS delivered,
          count(*) FILTER (WHERE event_type = 'opened') AS opened,
          count(*) FILTER (WHERE event_type = 'clicked') AS clicked,
          count(*) FILTER (WHERE event_type IN ('bounced','complained')) AS bounced
        FROM email_events
        WHERE subject IS NOT NULL
        GROUP BY subject
      ) s
    ),
    'recent', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT event_type, email_to, created_at
        FROM email_events
        WHERE event_type IN ('opened','clicked')
          AND (subject IS NULL OR (
                subject NOT LIKE 'New WRotate user:%'
                AND subject !~* 'weekly measurements|weekly analysis'
              ))
        ORDER BY created_at DESC
        LIMIT 40
      ) r
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- ── #27: atomic check-and-increment for rate limiting (replaces edge-function
--         read-modify-write that let concurrent same-user requests exceed the cap) ──
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_user uuid, p_fn text, p_window_floor timestamptz, p_now timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO rate_limits (user_id, function_name, window_start, request_count)
  VALUES (p_user, p_fn, p_now, 1)
  ON CONFLICT (user_id, function_name) DO UPDATE
    SET request_count = CASE WHEN rate_limits.window_start >= p_window_floor
                             THEN rate_limits.request_count + 1 ELSE 1 END,
        window_start  = CASE WHEN rate_limits.window_start >= p_window_floor
                             THEN rate_limits.window_start ELSE p_now END
  RETURNING request_count INTO new_count;
  RETURN new_count;
END;
$function$;
