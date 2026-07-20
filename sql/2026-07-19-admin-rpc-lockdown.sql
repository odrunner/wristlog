-- Six SECURITY DEFINER admin_* RPCs were executable by `anon` with no admin guard.
-- Verified exploitable with the public anon key (2026-07-19 security audit, finding #1):
-- admin_totals / admin_email_stats / campaign_send_counts leaked business metrics, and
-- admin_measurement_counts / admin_valuation_counts leaked a per-user-UUID -> activity
-- volume map, joinable against public profile UUIDs.
--
-- Each function now:
--   1. raises unless the caller is an admin (admin_dod_counts previously only checked
--      auth.uid() IS NOT NULL, which let any signed-in user read it),
--   2. pins search_path (all six had proconfig = null),
--   3. is revoked from public/anon and granted to authenticated only.
--
-- `#variable_conflict use_column` keeps the original queries verbatim despite output
-- parameter names (user_id, count, event_type, campaign_id) colliding with column names.

-- ── admin_totals ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_totals()
 RETURNS TABLE(follows_count bigint, likes_count bigint, valuation_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM follows),
    (SELECT count(*) FROM likes),
    (SELECT count(*) FROM valuation_events);
END;
$function$;

-- ── admin_email_stats ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_email_stats()
 RETURNS TABLE(event_type text, cnt bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT e.event_type, count(*) AS cnt FROM email_events e GROUP BY e.event_type;
END;
$function$;

-- ── admin_valuation_counts ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_valuation_counts()
 RETURNS TABLE(user_id uuid, count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT v.user_id, count(*) AS count FROM valuation_events v GROUP BY v.user_id;
END;
$function$;

-- ── campaign_send_counts ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.campaign_send_counts()
 RETURNS TABLE(campaign_id uuid, count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT s.campaign_id, count(*) AS count FROM email_campaign_sends s GROUP BY s.campaign_id;
END;
$function$;

-- ── admin_measurement_counts ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_measurement_counts()
 RETURNS TABLE(user_id uuid, count bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(s.user_id, r.user_id) AS user_id,
    GREATEST(COALESCE(r.saved, 0), COALESCE(s.sessions, 0)) AS count
  FROM (
    SELECT (t.messages::jsonb->>'user_id')::uuid AS user_id, count(*) AS sessions
    FROM timegrapher_tick_logs t
    WHERE t.messages LIKE '{"type":"session_summary"%'
    GROUP BY 1
  ) s
  FULL OUTER JOIN (
    SELECT tr.user_id, count(*) AS saved
    FROM timegrapher_results tr
    GROUP BY 1
  ) r ON s.user_id = r.user_id;
END;
$function$;

-- ── admin_dod_counts ────────────────────────────────────────────────────────
-- Was: IF auth.uid() IS NULL THEN RETURN '{}' — blocked anon but not a signed-in
-- non-admin. Now requires is_admin like its siblings.
CREATE OR REPLACE FUNCTION public.admin_dod_counts()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  d24h timestamptz := now() - interval '24 hours';
  internal_ids uuid[] := ARRAY(SELECT user_id FROM internal_accounts);
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT json_build_object(
    'users',    (SELECT count(*) FROM profiles WHERE created_at >= d24h AND id != ALL(internal_ids)),
    'watches',  (SELECT count(*) FROM watches  WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'wears',    (SELECT count(*) FROM logs     WHERE watch_id IS NOT NULL AND created_at >= d24h AND user_id != ALL(internal_ids)),
    'wish',     (SELECT count(*) FROM wishlist WHERE created_at >= d24h AND user_id != ALL(internal_ids)),
    'comments', (SELECT count(*) FROM comments WHERE created_at >= d24h AND user_id != ALL(internal_ids))
  ) INTO result;

  RETURN result;
END;
$function$;

-- ── Revoke the anon grant (CREATE OR REPLACE preserves existing grants) ─────
REVOKE EXECUTE ON FUNCTION public.admin_totals()              FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_email_stats()         FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_valuation_counts()    FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.campaign_send_counts()      FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_measurement_counts()  FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.admin_dod_counts()          FROM public, anon;

GRANT EXECUTE ON FUNCTION public.admin_totals()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_email_stats()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_valuation_counts()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_send_counts()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_measurement_counts()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dod_counts()           TO authenticated;

-- touch_presence is unpinned too, but is correctly self-scoped (auth.uid() only)
-- and must stay callable by authenticated users — it needs the pin, not a guard.
ALTER FUNCTION public.touch_presence() SET search_path TO 'pg_catalog', 'public';
