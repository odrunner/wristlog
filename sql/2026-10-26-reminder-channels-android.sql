-- sql/2026-10-26-reminder-channels-android.sql
-- Per-platform reminder channel rules for the Android port (spec §3). Requires
-- sql/2026-10-26-push-auth-platform.sql (push_auth_status keyed by user_id, platform).
--
-- The rule, per candidate:
--   ios_push_ok     = iOS token AND no ios-platform row with status <> 'authorized'
--                     (the legacy no-row grant, unchanged in effect — old builds only
--                     issued a token after a real grant)
--   android_push_ok = android token AND an EXPLICIT android 'authorized' row — an FCM
--                     token exists regardless of permission, so no-row means NOT granted
--   push            = ios_push_ok OR android_push_ok; push_quiet (provisional) stays iOS-only.
-- Every push_auth_status predicate is platform-scoped: without that, one android 'denied'
-- row would strip a dual-device user's iOS push (see tests/reminder-channels-android-sql.test.js).
-- Everything except the channel predicates is copied VERBATIM from the prior definitions
-- (wear: 2026-09-11-wear-reminder-provisional-email.sql; measure: 2026-08-16-measure-reminders.sql;
-- d7: 2026-10-25-archive-keeps-wins.sql) — keep them in step.

-- ── 1. wear_reminder_targets ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION wear_reminder_targets()
RETURNS TABLE (user_id uuid, email text, channel text, local_today date,
               last_watch_id text, last_brand text, last_name text, push_quiet boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone
    FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)
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
REVOKE EXECUTE ON FUNCTION wear_reminder_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wear_reminder_targets() TO service_role;

-- ── 2. measure_reminder_targets ───────────────────────────────────────────
-- iOS keeps its exact legacy predicate (a token alone qualifies — this RPC never checked
-- push_auth_status for iOS and changing that would change iOS behavior); android joins
-- only with an explicit grant.
CREATE OR REPLACE FUNCTION measure_reminder_targets()
RETURNS TABLE (user_id uuid, watch_id text, brand text, name text, rate numeric, measured_at timestamptz,
               prior_rate numeric, prior_at timestamptz, local_today date)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)
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
REVOKE EXECUTE ON FUNCTION measure_reminder_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION measure_reminder_targets() TO service_role;

-- ── 3. remeasure_d7_targets ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION remeasure_d7_targets(p_dry boolean DEFAULT false)
RETURNS TABLE (user_id uuid, email text, channel text, variant text, watch_id text, brand text, name text,
               rate numeric, measured_at timestamptz, local_today date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
#variable_conflict use_column
DECLARE
  e experiments;
  is_won boolean;
BEGIN
  SELECT * INTO e FROM experiments WHERE key = 'remeasure_d7';
  -- Kill in the admin Experiments tab is the brake: nothing is assigned or sent.
  -- An archived-won row keeps sending (archive = tidy, not undo).
  IF e.key IS NULL OR NOT (e.status IN ('running', 'won') OR (e.status = 'archived' AND e.archived_from = 'won')) THEN RETURN; END IF;
  is_won := e.status = 'won' OR e.archived_from = 'won';

  IF NOT p_dry THEN
    INSERT INTO experiment_assignments (experiment_key, user_id, variant)
    SELECT 'remeasure_d7', d.user_id,
           CASE WHEN is_won
                  OR (abs(hashtext(d.user_id::text || '|remeasure_d7')::bigint) % 100) < e.rollout_pct
                THEN 'treatment' ELSE 'control' END
    FROM remeasure_d7_eligible() d
    ON CONFLICT (experiment_key, user_id) DO NOTHING;

    INSERT INTO remeasure_d7_sends (user_id, watch_id, channel, sent_on)
    SELECT d.user_id, d.watch_id, 'control', d.local_today
    FROM remeasure_d7_eligible() d
    JOIN experiment_assignments a ON a.experiment_key = 'remeasure_d7' AND a.user_id = d.user_id AND a.variant = 'control'
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT d.user_id, u.email::text,
         CASE WHEN ( EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = d.user_id AND dt.platform = 'ios')
                     AND NOT EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = d.user_id AND s.platform = 'ios' AND s.status <> 'authorized') )
                  OR ( EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = d.user_id AND dt.platform = 'android')
                       AND EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = d.user_id AND s.platform = 'android' AND s.status = 'authorized') )
              THEN 'push' ELSE 'email' END,
         coalesce(a.variant,
                  CASE WHEN is_won
                         OR (abs(hashtext(d.user_id::text || '|remeasure_d7')::bigint) % 100) < e.rollout_pct
                       THEN 'treatment' ELSE 'control' END),
         d.watch_id, w.brand, w.name, d.rate, d.measured_at, d.local_today
  FROM remeasure_d7_eligible() d
  JOIN auth.users u ON u.id = d.user_id
  JOIN watches w ON w.id = d.watch_id AND w.user_id = d.user_id
  LEFT JOIN experiment_assignments a ON a.experiment_key = 'remeasure_d7' AND a.user_id = d.user_id
  WHERE p_dry OR a.variant = 'treatment';
END;
$$;
REVOKE EXECUTE ON FUNCTION remeasure_d7_targets(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION remeasure_d7_targets(boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
