-- sql/2026-09-11-wear-reminder-provisional-email.sql
-- Channel selection stops treating a PROVISIONAL push token as "reached".
--
-- Why (usage review 2026-09-10, F2): since the 2.6 provisional-push build, 47 users
-- receive the 5pm reminder as a quiet Notification-Center drop and log after it 2.8% of
-- the time (authorized users: 62.9%). Because they hold a device token, the old rule
-- routed them to push instead of the weekly email (13%), so they were downgraded.
--
-- New rule per candidate:
--   push_ok  = iOS token AND (no push_auth_status row — legacy builds only issued a
--              token after a real grant — OR status = 'authorized')      → 'push' daily
--   otherwise, email not sent in the last 7 days                         → 'email'
--   otherwise, provisional token (quiet drop still beats nothing)        → 'push'
--   denied / notDetermined tokens never get the quiet fallback (iOS shows nothing; the
--   sends would only dilute the conversion metric).
-- Everything above the channel CASE is copied VERBATIM from
-- sql/2026-08-16-wear-reminder-last-watch.sql — keep them in step.
DROP FUNCTION IF EXISTS wear_reminder_targets();
CREATE OR REPLACE FUNCTION wear_reminder_targets()
RETURNS TABLE (user_id uuid, email text, channel text, local_today date,
               last_watch_id text, last_brand text, last_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone
    FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'reminders')::boolean, true) = true
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
           EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
             AND NOT EXISTS (SELECT 1 FROM push_auth_status s
                             WHERE s.user_id = c.uid AND s.status <> 'authorized') AS push_ok,
           EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
             AND EXISTS (SELECT 1 FROM push_auth_status s
                         WHERE s.user_id = c.uid AND s.status = 'provisional') AS push_quiet,
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
         lw.watch_id, lw.brand, lw.name
  FROM chan ch
  JOIN auth.users u ON u.id = ch.uid
  LEFT JOIN lastw lw ON lw.user_id = ch.uid
  WHERE ch.push_ok OR ch.email_due OR ch.push_quiet;
$$;
NOTIFY pgrst, 'reload schema';
