-- Admin portal stats: email unsubscribes (total + day/day) and Pro V2 beta usage.
-- Both SECURITY DEFINER, gated on profiles.is_admin like admin_email_engagement.
-- Unsub day/day counts come from email_events(event_type='unsubscribed') which the
-- email-unsubscribe edge function logs from 2026-07-17 on (in-app toggle-offs are
-- not logged; the profile-based total captures both).
-- Applied 2026-07-17 via supabase db query --linked.

CREATE OR REPLACE FUNCTION public.admin_unsub_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT json_build_object(
    'unsub_total', (SELECT count(*) FROM profiles WHERE (email_prefs->>'updates') = 'false'),
    'unsub_24h', (SELECT count(*) FROM email_events WHERE event_type = 'unsubscribed'
                   AND created_at >= now() - interval '24 hours'),
    'unsub_prev24h', (SELECT count(*) FROM email_events WHERE event_type = 'unsubscribed'
                   AND created_at >= now() - interval '48 hours'
                   AND created_at <  now() - interval '24 hours')
  ) INTO result;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_prov2_beta_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
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
    'beta_users_24h', (SELECT count(DISTINCT uid) FROM ext WHERE t >= now() - interval '24 hours')
  ) INTO result;
  RETURN result;
END; $$;
