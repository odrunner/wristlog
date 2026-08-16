-- sql/2026-08-16-measure-reminders.sql
-- Re-measure / drift push: built from measurement_sessions (saved OR unsaved), so it reaches
-- the 95 users who measure but never save. Push only. Deploy with:
--   npx supabase db query --linked --file sql/2026-08-16-measure-reminders.sql
-- Guarded by tests/measure-reminders-sql.test.js. Sender: supabase/functions/send-measure-reminders.

CREATE TABLE IF NOT EXISTS measure_reminder_sends (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  watch_id text,
  sent_on  date NOT NULL,            -- the user's LOCAL date
  PRIMARY KEY (user_id, sent_on)
);

-- Who gets a re-measure nudge in THIS hourly run: local hour 12, push-capable, one watch
-- per user whose LAST converged session is 21–60 days old with nothing on that watch since,
-- and no measure reminder in the last 30 days. prior_* is the previous converged reading on
-- the same watch at least 14 days earlier (drift copy); NULL → "re-measure to see if it's
-- holding" copy.
CREATE OR REPLACE FUNCTION measure_reminder_targets()
RETURNS TABLE (user_id uuid, watch_id text, brand text, name text, rate numeric, measured_at timestamptz,
               prior_rate numeric, prior_at timestamptz, local_today date)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'reminders')::boolean, true) = true
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
      AND EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = p.id AND d.platform = 'ios')
  ),
  now_users AS (
    SELECT v.id, (now() AT TIME ZONE v.timezone)::date AS local_today
    FROM valid v
    WHERE EXTRACT(hour FROM now() AT TIME ZONE v.timezone) = 12
      AND NOT EXISTS (SELECT 1 FROM measure_reminder_sends m
                      WHERE m.user_id = v.id
                        AND m.sent_on > (now() AT TIME ZONE v.timezone)::date - 30)
  ),
  last_conv AS (
    SELECT DISTINCT ON (s.user_id) s.user_id, s.watch_id, s.rate, s.created_at
    FROM measurement_sessions s
    WHERE s.user_id IN (SELECT id FROM now_users)
      AND s.converged AND s.rate IS NOT NULL AND s.watch_id IS NOT NULL
      AND s.created_at BETWEEN now() - interval '60 days' AND now() - interval '21 days'
      AND NOT EXISTS (SELECT 1 FROM measurement_sessions s2
                      WHERE s2.user_id = s.user_id AND s2.watch_id = s.watch_id
                        AND s2.created_at > now() - interval '21 days')
    ORDER BY s.user_id, s.created_at DESC
  ),
  prior AS (
    SELECT lc.user_id, p.rate AS prior_rate, p.created_at AS prior_at
    FROM last_conv lc
    JOIN LATERAL (
      SELECT s.rate, s.created_at FROM measurement_sessions s
      WHERE s.user_id = lc.user_id AND s.watch_id = lc.watch_id
        AND s.converged AND s.rate IS NOT NULL
        AND s.created_at < lc.created_at - interval '14 days'
      ORDER BY s.created_at DESC LIMIT 1
    ) p ON true
  )
  SELECT lc.user_id, lc.watch_id, w.brand, w.name, lc.rate, lc.created_at,
         pr.prior_rate, pr.prior_at, nu.local_today
  FROM last_conv lc
  JOIN now_users nu ON nu.id = lc.user_id
  JOIN watches w ON w.id = lc.watch_id AND w.user_id = lc.user_id
  LEFT JOIN prior pr ON pr.user_id = lc.user_id;
$$;
NOTIFY pgrst, 'reload schema';
