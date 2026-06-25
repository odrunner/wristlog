-- Daily wear reminder: timezone capture, send-throttle log, and target selection.

-- 1. Per-user IANA timezone (written by the web client on boot).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS timezone TEXT;

-- 2. One row per user per local day they were reminded (idempotency + email throttle).
CREATE TABLE IF NOT EXISTS wear_reminder_sends (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel  text NOT NULL,            -- 'push' | 'email'
  sent_on  date NOT NULL,            -- the user's LOCAL date
  PRIMARY KEY (user_id, sent_on)
);
CREATE INDEX IF NOT EXISTS wear_reminder_sends_email_idx
  ON wear_reminder_sends (user_id, sent_on) WHERE channel = 'email';

-- 3. Who to remind right now (this hourly run), with their channel.
--    SECURITY DEFINER so the service-role edge fn can read auth.users + bypass RLS.
CREATE OR REPLACE FUNCTION wear_reminder_targets()
RETURNS TABLE (user_id uuid, email text, channel text, local_today date)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH cand AS (
    SELECT p.id AS uid,
           (now() AT TIME ZONE p.timezone)::date AS local_today
    FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'reminders')::boolean, true) = true
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
      AND EXTRACT(hour FROM now() AT TIME ZONE p.timezone) = 17
      AND EXISTS (SELECT 1 FROM logs l
                  WHERE l.user_id = p.id AND l.created_at >= now() - interval '14 days')
      AND NOT EXISTS (SELECT 1 FROM logs l
                  WHERE l.user_id = p.id
                    AND l.date = ((now() AT TIME ZONE p.timezone)::date)::text)
      AND NOT EXISTS (SELECT 1 FROM wear_reminder_sends w
                  WHERE w.user_id = p.id
                    AND w.sent_on = (now() AT TIME ZONE p.timezone)::date)
  )
  SELECT c.uid,
         u.email,
         CASE WHEN EXISTS (SELECT 1 FROM device_tokens d
                           WHERE d.user_id = c.uid AND d.platform = 'ios')
              THEN 'push' ELSE 'email' END AS channel,
         c.local_today
  FROM cand c
  JOIN auth.users u ON u.id = c.uid
  WHERE EXISTS (SELECT 1 FROM device_tokens d WHERE d.user_id = c.uid AND d.platform = 'ios')
     OR NOT EXISTS (SELECT 1 FROM wear_reminder_sends w
                    WHERE w.user_id = c.uid AND w.channel = 'email'
                      AND w.sent_on >= c.local_today - 7);
$$;
