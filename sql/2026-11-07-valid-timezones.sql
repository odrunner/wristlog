-- sql/2026-11-07-valid-timezones.sql
-- DB-2 (audits 2026-08-15 -> 2026-11-06): the three reminder RPCs each validated
-- profiles.timezone with EXISTS over pg_timezone_names, a catalog view that
-- enumerates the whole tz database (~1 s) on EVERY hourly pg_cron run. Both
-- reminder RPCs sat in the DB top-10 by total time (~45 s DB/day). The names it
-- validates against change only on a Postgres upgrade, so: snapshot them into a
-- tiny static table and have the RPCs check that instead.
--
-- The three function bodies below are copied VERBATIM from the live definitions
-- (= sql/2026-10-26-reminder-channels-android.sql for wear/measure,
--  sql/2026-09-11-remeasure-d7.sql for remeasure_d7_eligible; live bodies
-- diffed against both files before this change) with exactly ONE line changed
-- in each: pg_timezone_names -> valid_timezones. Keep them in step.
--
-- Fail-safe properties preserved:
--   * a profile timezone missing from the table is SKIPPED (no send), never an
--     error reaching AT TIME ZONE;
--   * the monthly refresh also DELETEs names Postgres no longer accepts, so a
--     stale table cannot let an invalid name through to AT TIME ZONE (which
--     would fail the whole hour's run).

-- ------ 1. the lookup table ------
CREATE TABLE IF NOT EXISTS valid_timezones (name text PRIMARY KEY);
ALTER TABLE valid_timezones ENABLE ROW LEVEL SECURITY;
-- No GRANTs, no policies: reached only inside SECURITY DEFINER RPCs.

INSERT INTO valid_timezones (name)
  SELECT name FROM pg_timezone_names
  ON CONFLICT (name) DO NOTHING;

-- ------ 2. monthly refresh (tz names change only on pg upgrades) ------
CREATE OR REPLACE FUNCTION refresh_valid_timezones() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO valid_timezones (name)
    SELECT name FROM pg_timezone_names
    ON CONFLICT (name) DO NOTHING;
  DELETE FROM valid_timezones v
    WHERE NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v.name);
$$;
REVOKE EXECUTE ON FUNCTION refresh_valid_timezones() FROM PUBLIC, anon, authenticated;

-- pg_cron: monthly, 03:45 UTC on the 1st. cron.schedule(name, ...) upserts.
SELECT cron.schedule('refresh-valid-timezones', '45 3 1 * *',
                     'SELECT public.refresh_valid_timezones();');

-- ------ 3. the three RPCs, one line changed each ------

CREATE OR REPLACE FUNCTION wear_reminder_targets()
RETURNS TABLE (user_id uuid, email text, channel text, local_today date,
               last_watch_id text, last_brand text, last_name text, push_quiet boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone
    FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM valid_timezones z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      -- Compared as text: a ::boolean cast throws on any non-boolean string, and one
      -- malformed profile would fail the whole RPC — that hour's sends for everyone.
      AND COALESCE(p.email_prefs->>'reminders', 'true') <> 'false'
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
  ),
  cand AS (
    SELECT v.id AS uid,
           (now() AT TIME ZONE v.timezone)::date AS local_today
    FROM valid v
    WHERE EXTRACT(hour FROM now() AT TIME ZONE v.timezone) = 17
      -- Audience: recently active, OR a new account starting the day after its
      -- first watch was added (the day-1 drip email owns the "add a watch" nudge;
      -- reminders begin once there is something to log). New accounts age out at
      -- 14 days unless they log — then the active branch covers them.
      AND ( EXISTS (SELECT 1 FROM logs l
                    WHERE l.user_id = v.id AND l.created_at >= now() - interval '14 days')
            OR ( EXISTS (SELECT 1 FROM auth.users au
                         WHERE au.id = v.id AND au.created_at >= now() - interval '14 days')
                 AND EXISTS (SELECT 1 FROM watches w
                             WHERE w.user_id = v.id
                               AND (w.created_at AT TIME ZONE v.timezone)::date
                                   < (now() AT TIME ZONE v.timezone)::date) ) )
      -- Skip anyone who has ALREADY engaged for today: a log dated today, OR
      -- any log/post CREATED today in their local timezone. The app lets you
      -- pick a log's date, so posts/wears are often backdated — keying only off
      -- l.date nagged people who'd already posted today (created_at was today
      -- but the assigned date wasn't).
      AND NOT EXISTS (SELECT 1 FROM logs l
                  WHERE l.user_id = v.id
                    AND ( l.date = ((now() AT TIME ZONE v.timezone)::date)::text
                          OR (l.created_at AT TIME ZONE v.timezone)::date = (now() AT TIME ZONE v.timezone)::date ))
      AND NOT EXISTS (SELECT 1 FROM wear_reminder_sends w
                  WHERE w.user_id = v.id
                    AND w.sent_on = (now() AT TIME ZONE v.timezone)::date)
  ),
  lastw AS (
    SELECT DISTINCT ON (l.user_id) l.user_id, w.id AS watch_id, w.brand, w.name
    FROM logs l JOIN watches w ON w.id = l.watch_id
    WHERE l.user_id IN (SELECT uid FROM cand)
    ORDER BY l.user_id, l.date DESC, l.created_at DESC
  ),
  chan AS (
    SELECT c.uid, c.local_today,
           ( EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
             AND NOT EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = c.uid AND s.platform = 'ios' AND s.status <> 'authorized') )
           OR
           ( EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'android')
             AND EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = c.uid AND s.platform = 'android' AND s.status = 'authorized') )
           AS push_ok,
           EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
             AND EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = c.uid AND s.platform = 'ios' AND s.status = 'provisional') AS push_quiet,
           NOT EXISTS (SELECT 1 FROM wear_reminder_sends w
                       WHERE w.user_id = c.uid AND w.channel = 'email'
                         AND w.sent_on >= c.local_today - 7) AS email_due
    FROM cand c
  )
  SELECT ch.uid,
         u.email,
         CASE WHEN ch.push_ok THEN 'push'
              WHEN ch.email_due THEN 'email'
              ELSE 'push' END AS channel,
         ch.local_today,
         lw.watch_id, lw.brand, lw.name,
         -- For the sender: an 'email' row whose address is bounce-suppressed falls back to
         -- the quiet push when this is true. Without it that user got nothing, forever —
         -- no send means no ledger row, so email_due never turned false (audit 2026-09-20 S3).
         ch.push_quiet
  FROM chan ch
  JOIN auth.users u ON u.id = ch.uid
  LEFT JOIN lastw lw ON lw.user_id = ch.uid
  WHERE ch.push_ok OR ch.email_due OR ch.push_quiet;
$$;

CREATE OR REPLACE FUNCTION measure_reminder_targets()
RETURNS TABLE (user_id uuid, watch_id text, brand text, name text, rate numeric, measured_at timestamptz,
               prior_rate numeric, prior_at timestamptz, local_today date)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM valid_timezones z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      -- Compared as text: a ::boolean cast throws on any non-boolean string, and one
      -- malformed profile would fail the whole RPC — that hour's sends for everyone.
      AND COALESCE(p.email_prefs->>'reminders', 'true') <> 'false'
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
      AND ( EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = p.id AND d.platform = 'ios')
            OR ( EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = p.id AND d.platform = 'android')
                 AND EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = p.id AND s.platform = 'android' AND s.status = 'authorized') ) )
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

CREATE OR REPLACE FUNCTION remeasure_d7_eligible()
RETURNS TABLE (user_id uuid, local_today date, watch_id text, rate numeric, measured_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM valid_timezones z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      -- Compared as text: a ::boolean cast throws on any non-boolean string, and one
      -- malformed profile would fail the whole RPC — that hour's sends for everyone.
      AND COALESCE(p.email_prefs->>'reminders', 'true') <> 'false'
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
      AND NOT EXISTS (SELECT 1 FROM remeasure_d7_sends s WHERE s.user_id = p.id)
  ),
  now_users AS (
    SELECT v.id, v.timezone, (now() AT TIME ZONE v.timezone)::date AS local_today
    FROM valid v
    WHERE EXTRACT(hour FROM now() AT TIME ZONE v.timezone) = 19
  ),
  first_kept AS (
    SELECT DISTINCT ON (t.user_id) t.user_id, t.watch_id, t.rate::numeric AS rate, t.created_at
    FROM timegrapher_results t
    WHERE t.user_id IN (SELECT id FROM now_users)
    ORDER BY t.user_id, t.created_at ASC
  )
  SELECT nu.id, nu.local_today, fk.watch_id, fk.rate, fk.created_at
  FROM now_users nu
  JOIN first_kept fk ON fk.user_id = nu.id
  WHERE fk.watch_id IS NOT NULL AND fk.rate IS NOT NULL
    AND nu.local_today - (fk.created_at AT TIME ZONE nu.timezone)::date BETWEEN 7 AND 8
    AND EXISTS (SELECT 1 FROM watches w WHERE w.id = fk.watch_id AND w.user_id = nu.id)
    AND NOT EXISTS (SELECT 1 FROM measurement_sessions ms
                    WHERE ms.user_id = nu.id AND ms.watch_id = fk.watch_id AND ms.converged
                      AND ms.created_at > fk.created_at + interval '1 day');
$$;

REVOKE EXECUTE ON FUNCTION wear_reminder_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wear_reminder_targets() TO service_role;
REVOKE EXECUTE ON FUNCTION measure_reminder_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION measure_reminder_targets() TO service_role;
REVOKE EXECUTE ON FUNCTION remeasure_d7_eligible() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
