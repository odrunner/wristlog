-- A measurement-share post tags the watch (for attribution) but is NOT a wear.
-- Such posts are stored as logs rows with use_case = 'measurement'. Exclude them
-- from the admin wear counts (admin_user_stats.wears and admin_user_detail.wears)
-- so measurements don't inflate wear metrics. Client wear counts are excluded in
-- rebuildLogsByWatch (index.html).
--
-- Deployed via `supabase db query --linked` (migration push doesn't work on this
-- project); this file is the record. Both functions otherwise unchanged.

CREATE OR REPLACE FUNCTION public.admin_user_stats()
RETURNS TABLE(user_id uuid, watches bigint, wears bigint, price_checks bigint, enhances bigint, recent_active_days bigint)
LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT p.id AS user_id, COALESCE(w.cnt, 0) AS watches, COALESCE(l.cnt, 0) AS wears,
    COALESCE(v.cnt, 0) AS price_checks, COALESCE(e.cnt, 0) AS enhances,
    public.admin_active_days(p.id, 30) AS recent_active_days
  FROM profiles p
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM watches GROUP BY user_id) w ON w.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM logs WHERE watch_id IS NOT NULL AND use_case IS DISTINCT FROM 'measurement' GROUP BY user_id) l ON l.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM valuation_events GROUP BY user_id) v ON v.user_id = p.id
  LEFT JOIN (SELECT user_id, count(*) AS cnt FROM identify_attempts WHERE mode = 'enhance' GROUP BY user_id) e ON e.user_id = p.id;
$f$;

-- admin_user_detail.wears: the only changed line is the wears count gaining
-- "AND use_case IS DISTINCT FROM 'measurement'". (Full body redeployed in place.)
