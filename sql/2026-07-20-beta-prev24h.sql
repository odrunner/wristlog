-- Add prior-24h active beta users so the Pro V2 Beta row can show a day-over-day
-- delta (active beta users last 24h vs the 24h before), matching the DAU/WAU/MAU rows.
CREATE OR REPLACE FUNCTION public.admin_prov2_beta_stats()
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
  WITH beta AS (
    SELECT DISTINCT session_id,
           substring(messages from '"user_id"\s*:\s*"([0-9a-f-]{36})"') AS uid,
           min(created_at) AS t
    FROM timegrapher_tick_logs
    WHERE messages LIKE '%"algo":"tg"%'
    GROUP BY session_id, 2
  ), ext AS (
    SELECT * FROM beta
    WHERE uid IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM internal_accounts ia WHERE ia.user_id::text = beta.uid)
  )
  SELECT json_build_object(
    'beta_users', (SELECT count(DISTINCT uid) FROM ext),
    'beta_sessions', (SELECT count(*) FROM ext),
    'beta_users_24h', (SELECT count(DISTINCT uid) FROM ext WHERE t >= now() - interval '24 hours'),
    'beta_users_prev24h', (SELECT count(DISTINCT uid) FROM ext
                            WHERE t >= now() - interval '48 hours' AND t < now() - interval '24 hours')
  ) INTO result;
  RETURN result;
END; $function$;
