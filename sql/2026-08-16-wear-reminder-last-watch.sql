-- sql/2026-08-16-wear-reminder-last-watch.sql
-- Adds the last-worn watch to each wear-reminder target so the push/email can name it
-- ("Wearing the Omega Seamaster again today?"). Return type changes, so DROP first.
-- The valid/cand CTEs are copied VERBATIM from sql/2026-06-24-wear-reminders.sql —
-- keep them in step if that file changes.
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
  )
  SELECT c.uid,
         u.email,
         CASE WHEN EXISTS (SELECT 1 FROM device_tokens d
                           WHERE d.user_id = c.uid AND d.platform = 'ios')
              THEN 'push' ELSE 'email' END AS channel,
         c.local_today,
         lw.watch_id, lw.brand, lw.name
  FROM cand c
  JOIN auth.users u ON u.id = c.uid
  LEFT JOIN lastw lw ON lw.user_id = c.uid
  WHERE EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
     OR NOT EXISTS (SELECT 1 FROM wear_reminder_sends w
                    WHERE w.user_id = c.uid AND w.channel = 'email'
                      AND w.sent_on >= c.local_today - 7);
$$;
NOTIFY pgrst, 'reload schema';
