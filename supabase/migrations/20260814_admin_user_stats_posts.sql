-- Admin users table 2026-08-14: the table now hides users with no record at all,
-- so "has a record" has to include standalone posts (logs with watch_id IS NULL).
-- admin_user_stats' `wears` deliberately counts only watch_id IS NOT NULL, so
-- without a posts column 5 users whose only activity is a post would be dropped
-- from the table entirely.
--
-- Return type changes, so this is DROP + CREATE, not CREATE OR REPLACE. Body is
-- otherwise identical to 20260612_guard_admin_user_stats.sql (admin guard,
-- pinned search_path, EXECUTE revoked from PUBLIC/anon).
-- Deployed via `supabase db query --linked`; this file is the record.

DROP FUNCTION IF EXISTS public.admin_user_stats();

CREATE FUNCTION public.admin_user_stats()
RETURNS TABLE(user_id uuid, watches bigint, wears bigint, posts bigint, price_checks bigint, enhances bigint, recent_active_days bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $f$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
  SELECT p.id AS user_id, COALESCE(w.cnt, 0) AS watches, COALESCE(l.cnt, 0) AS wears,
    COALESCE(po.cnt, 0) AS posts,
    COALESCE(v.cnt, 0) AS price_checks, COALESCE(e.cnt, 0) AS enhances,
    public.admin_active_days(p.id, 30) AS recent_active_days
  FROM profiles p
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM watches GROUP BY user_id) w ON w.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM logs WHERE watch_id IS NOT NULL AND use_case IS DISTINCT FROM 'measurement' GROUP BY user_id) l ON l.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM logs WHERE watch_id IS NULL GROUP BY user_id) po ON po.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM valuation_events GROUP BY user_id) v ON v.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM identify_attempts WHERE mode = 'enhance' GROUP BY user_id) e ON e.user_id = p.id;
END;
$f$;

REVOKE EXECUTE ON FUNCTION public.admin_user_stats() FROM public, anon;

NOTIFY pgrst, 'reload schema';
