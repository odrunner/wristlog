-- Repeat-user calculation: unify "R?" (admin table) and "Repeat user" (detail
-- modal) on ONE definition, counting activity across all features (not just
-- wear logs).
--
-- Before: R? = distinct wear-log days in last 7d; Repeat user = distinct
-- wear-log days all-time. Two different windows, both logs-only — a user who
-- measured watches or added watches on multiple days didn't count.
--
-- After: both use admin_active_days(user, 30) > 1 — active on 2+ distinct days
-- in the last 30 days across logs, watches, timegrapher_results,
-- valuation_events, and identify_attempts (any real app action).
--
-- Single shared helper so the table and the modal can never disagree.

CREATE OR REPLACE FUNCTION public.admin_active_days(target_user_id uuid, window_days int DEFAULT 30)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  SELECT count(DISTINCT day)::bigint FROM (
    SELECT created_at::date AS day FROM logs
      WHERE user_id = target_user_id AND created_at >= NOW() - (window_days || ' days')::interval
    UNION ALL
    SELECT created_at::date FROM watches
      WHERE user_id = target_user_id AND created_at >= NOW() - (window_days || ' days')::interval
    UNION ALL
    SELECT created_at::date FROM timegrapher_results
      WHERE user_id = target_user_id AND created_at >= NOW() - (window_days || ' days')::interval
    UNION ALL
    SELECT created_at::date FROM valuation_events
      WHERE user_id = target_user_id AND created_at >= NOW() - (window_days || ' days')::interval
    UNION ALL
    SELECT created_at::date FROM identify_attempts
      WHERE user_id = target_user_id AND created_at >= NOW() - (window_days || ' days')::interval
  ) d;
$function$;

-- Not an API-exposed helper; only the admin RPCs (also SECURITY DEFINER) call it.
REVOKE EXECUTE ON FUNCTION public.admin_active_days(uuid, int) FROM public, anon, authenticated;

-- admin_user_stats: recent_active_days now = cross-feature 30-day active days.
CREATE OR REPLACE FUNCTION public.admin_user_stats()
RETURNS TABLE(user_id uuid, watches bigint, wears bigint, price_checks bigint, enhances bigint, recent_active_days bigint)
LANGUAGE sql
SECURITY DEFINER
AS $function$
  SELECT p.id AS user_id,
    COALESCE(w.cnt, 0) AS watches,
    COALESCE(l.cnt, 0) AS wears,
    COALESCE(v.cnt, 0) AS price_checks,
    COALESCE(e.cnt, 0) AS enhances,
    public.admin_active_days(p.id, 30) AS recent_active_days
  FROM profiles p
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM watches GROUP BY user_id) w ON w.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM logs WHERE watch_id IS NOT NULL GROUP BY user_id) l ON l.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM valuation_events GROUP BY user_id) v ON v.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM identify_attempts WHERE mode = 'enhance' GROUP BY user_id) e ON e.user_id = p.id;
$function$;
