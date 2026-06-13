-- Security audit 2026-06-12 NEW-1: admin_user_stats() was SECURITY DEFINER with
-- EXECUTE granted to PUBLIC/anon and no admin guard — anyone with the public
-- anon key could dump every user's id + activity counts via PostgREST RPC.
--
-- Fix: add the standard is_admin guard (same pattern as admin_user_detail and
-- admin_traffic_stats, which requires plpgsql), pin search_path (same as
-- admin_demo_views), and revoke EXECUTE from PUBLIC/anon. authenticated keeps
-- EXECUTE because the admin page calls this RPC as the signed-in admin
-- (index.html db.rpc('admin_user_stats')); the guard rejects non-admins.
--
-- Body is otherwise identical to 20260601_exclude_measurement_from_wears.sql.
-- Deployed via `supabase db query --linked`; this file is the record.

CREATE OR REPLACE FUNCTION public.admin_user_stats()
RETURNS TABLE(user_id uuid, watches bigint, wears bigint, price_checks bigint, enhances bigint, recent_active_days bigint)
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
    COALESCE(v.cnt, 0) AS price_checks, COALESCE(e.cnt, 0) AS enhances,
    public.admin_active_days(p.id, 30) AS recent_active_days
  FROM profiles p
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM watches GROUP BY user_id) w ON w.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM logs WHERE watch_id IS NOT NULL AND use_case IS DISTINCT FROM 'measurement' GROUP BY user_id) l ON l.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM valuation_events GROUP BY user_id) v ON v.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM identify_attempts WHERE mode = 'enhance' GROUP BY user_id) e ON e.user_id = p.id;
END;
$f$;

REVOKE EXECUTE ON FUNCTION public.admin_user_stats() FROM public, anon;
