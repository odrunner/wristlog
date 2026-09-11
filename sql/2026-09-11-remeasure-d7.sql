-- sql/2026-09-11-remeasure-d7.sql
-- Proposal 3 of the 2026-09-10 usage review: a one-time "did it hold?" nudge seven days
-- after a user's FIRST kept reading, on that same watch, quoting its rate — run as the
-- experiment `remeasure_d7` (50/50). Why: 85 of 113 recent sign-ups measure on day 0 and
-- 55% never return after day 2; the existing re-measure push waits 21 days (0 of 36
-- re-measured the reminded watch). Sender: supabase/functions/send-measure-reminders
-- (phase 2 of the hourly run, local hour 19). Deploy with:
--   npx supabase db query --linked --file sql/2026-09-11-remeasure-d7.sql
-- Guarded by tests/remeasure-d7-sql.test.js.
--
-- Arms are assigned HERE, at the day-7 moment, not at login: `owner = 'server'` is a new
-- owner value that get_experiments() skips, so the arm stats only contain users who were
-- actually eligible (an experiment assigned at login would fill both arms with everyone).
-- Channel: 'push' only when the iOS token is backed by push_auth_status authorized (or no
-- status row — legacy grant); provisional / denied / no token → 'email' (quiet pushes
-- converted 2.8% in the 2026-09-10 review, so they are not a treatment).

-- ── 1. Sends ledger (one row per user, ever; control rows recorded too) ──────────
CREATE TABLE IF NOT EXISTS remeasure_d7_sends (
  user_id  uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  watch_id text,
  channel  text NOT NULL CHECK (channel IN ('push', 'email', 'control')),
  sent_on  date NOT NULL             -- the user's LOCAL date
);
ALTER TABLE remeasure_d7_sends ENABLE ROW LEVEL SECURITY;
-- No client policies: written by the edge function (service role) and the RPC below.

-- ── 2. Eligibility (pure): local hour 19, first kept reading 7–8 local days ago on a
--       watch still owned, nothing converged on that watch since day 1, never targeted. ──
CREATE OR REPLACE FUNCTION remeasure_d7_eligible()
RETURNS TABLE (user_id uuid, local_today date, watch_id text, rate numeric, measured_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      AND COALESCE((p.email_prefs->>'reminders')::boolean, true) = true
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
REVOKE EXECUTE ON FUNCTION remeasure_d7_eligible() FROM PUBLIC, anon, authenticated;

-- ── 3. Targets for THIS hourly run: assigns arms, records control rows, returns the
--       treatment rows with their channel. p_dry := true returns every eligible row with
--       its would-be arm and writes nothing (the edge function's dry_run). ──────────────
CREATE OR REPLACE FUNCTION remeasure_d7_targets(p_dry boolean DEFAULT false)
RETURNS TABLE (user_id uuid, email text, channel text, variant text, watch_id text, brand text, name text,
               rate numeric, measured_at timestamptz, local_today date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
#variable_conflict use_column
DECLARE
  e experiments;
BEGIN
  SELECT * INTO e FROM experiments WHERE key = 'remeasure_d7';
  -- Kill / archive in the admin Experiments tab is the brake: nothing is assigned or sent.
  IF e.key IS NULL OR e.status NOT IN ('running', 'won') THEN RETURN; END IF;

  IF NOT p_dry THEN
    INSERT INTO experiment_assignments (experiment_key, user_id, variant)
    SELECT 'remeasure_d7', d.user_id,
           CASE WHEN e.status = 'won'
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
         CASE WHEN EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = d.user_id AND dt.platform = 'ios')
                   AND NOT EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = d.user_id AND s.status <> 'authorized')
              THEN 'push' ELSE 'email' END,
         coalesce(a.variant,
                  CASE WHEN e.status = 'won'
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

-- ── 4. owner = 'server': skipped by login-time assignment, judged by the normal stats ──
CREATE OR REPLACE FUNCTION public.get_experiments()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_internal boolean;
  result json;
BEGIN
  IF uid IS NULL THEN RETURN '[]'::json; END IF;
  INSERT INTO user_activity_days (user_id, day) VALUES (uid, current_date) ON CONFLICT DO NOTHING;
  is_internal := EXISTS (SELECT 1 FROM internal_accounts WHERE user_id = uid);

  IF NOT is_internal THEN
    INSERT INTO experiment_assignments (experiment_key, user_id, variant)
    SELECT e.key, uid,
           CASE WHEN (abs(hashtext(uid::text || '|' || e.key)::bigint) % 100) < e.rollout_pct
                THEN 'treatment' ELSE 'control' END
    FROM experiments e
    WHERE e.status = 'running'
      -- owner='server' experiments assign their own arms at the exposure moment
      -- (e.g. remeasure_d7_targets), never at login — see sql/2026-09-11-remeasure-d7.sql.
      AND coalesce(e.owner, 'sql') <> 'server'
      AND NOT EXISTS (SELECT 1 FROM experiment_assignments a WHERE a.experiment_key = e.key AND a.user_id = uid)
    ON CONFLICT (experiment_key, user_id) DO NOTHING;
  END IF;

  SELECT coalesce(json_agg(json_build_object('key', k, 'variant', v)), '[]'::json) INTO result
  FROM (
    SELECT e.key AS k,
           CASE WHEN e.status = 'won' THEN 'treatment'
                WHEN is_internal THEN 'control'
                ELSE coalesce(a.variant, 'control') END AS v
    FROM experiments e
    LEFT JOIN experiment_assignments a ON a.experiment_key = e.key AND a.user_id = uid
    WHERE e.status IN ('running', 'won')
  ) s;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_experiment(p_key text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  e experiments; tgt json; gr json;
  days int;
  min_users int; lift numeric; p numeric; p_raw numeric; g_drop numeric; g_p numeric; g_p_raw numeric;
  c_mean numeric; t_mean numeric;
  verdict text;
  result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO e FROM experiments WHERE key = p_key;
  IF e.key IS NULL THEN RAISE EXCEPTION 'unknown experiment %', p_key; END IF;
  IF e.owner = 'weekly_review' THEN   -- knob trials are judged by the Sunday loop; 'sql' and 'server' use the stats below
    RETURN coalesce(e.last_eval::json, json_build_object('key', e.key, 'verdict', 'not evaluated',
                    'note', 'judged by the Sunday weekly review from timegrapher_tick_logs'));
  END IF;

  tgt := experiment_arm_stats(p_key, e.metric_key);
  gr  := experiment_arm_stats(p_key, e.guardrail_metric_key);
  days := coalesce(extract(day FROM now() - e.started_at)::int, 0);
  min_users := least((tgt->'control'->>'users')::int, (tgt->'treatment'->>'users')::int);
  lift := (tgt->>'lift_pct')::numeric;
  p    := (tgt->>'p_value')::numeric;
  p_raw := (tgt->>'p_raw')::numeric;
  c_mean := (tgt->'control'->>'mean')::numeric;
  t_mean := (tgt->'treatment'->>'mean')::numeric;
  g_drop := CASE WHEN (gr->'control'->>'mean')::numeric > 0
                 THEN round(((gr->'control'->>'mean')::numeric - (gr->'treatment'->>'mean')::numeric)
                            / (gr->'control'->>'mean')::numeric * 100, 1) ELSE 0 END;
  g_p := (gr->>'p_value')::numeric;
  g_p_raw := (gr->>'p_raw')::numeric;

  verdict := CASE
    WHEN min_users < e.min_users_per_arm OR days < e.min_days THEN 'too_early'
    WHEN g_drop > e.max_guardrail_drop_pct AND g_p_raw IS NOT NULL AND g_p_raw < 0.05 THEN 'guardrail_breach'
    WHEN ((lift IS NOT NULL AND lift >= e.min_lift_pct) OR (c_mean = 0 AND t_mean > 0))
         AND p_raw IS NOT NULL AND p_raw < 0.05 THEN 'winning'
    WHEN lift IS NOT NULL AND lift < 0 AND p_raw IS NOT NULL AND p_raw < 0.05 THEN 'losing'
    ELSE 'inconclusive' END;

  result := json_build_object(
    'key', e.key, 'metric_key', e.metric_key,
    'metric_kind', (SELECT kind FROM experiment_metrics WHERE key = e.metric_key),
    'days_running', days,
    'control', tgt->'control', 'treatment', tgt->'treatment',
    'lift_pct', lift, 'p_value', p, 'p_raw', p_raw,
    'guardrail', json_build_object('metric_key', e.guardrail_metric_key,
                   'control', (gr->'control'->>'mean')::numeric, 'treatment', (gr->'treatment'->>'mean')::numeric,
                   'drop_pct', g_drop, 'p_value', g_p, 'p_raw', g_p_raw),
    'gates', json_build_object('min_users_per_arm', e.min_users_per_arm, 'min_days', e.min_days,
                   'min_lift_pct', e.min_lift_pct, 'max_guardrail_drop_pct', e.max_guardrail_drop_pct),
    'verdict', verdict,
    'evaluated_at', now());

  UPDATE experiments SET last_eval = result::jsonb WHERE key = p_key;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.experiments_auto_decide()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  r record; ev json; v text; out json[] := '{}';
BEGIN
  FOR r IN SELECT key FROM experiments WHERE status = 'running' AND owner IN ('sql', 'server') ORDER BY key LOOP
    BEGIN
      ev := evaluate_experiment(r.key);
      v := ev->>'verdict';
      IF v = 'winning' THEN
        UPDATE experiments SET status='won', rollout_pct=100, decision='auto', decided_at=now() WHERE key = r.key;
        INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor) VALUES (r.key, v, ev::jsonb, 'cron');
        out := out || json_build_object('key', r.key, 'verdict', v, 'action', 'won');
      ELSIF v = 'guardrail_breach' THEN
        UPDATE experiments SET status='killed', decision='auto', decided_at=now() WHERE key = r.key;
        INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor) VALUES (r.key, v, ev::jsonb, 'cron');
        out := out || json_build_object('key', r.key, 'verdict', v, 'action', 'killed');
      ELSE
        out := out || json_build_object('key', r.key, 'verdict', v, 'action', 'none');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
        VALUES (r.key, 'error', json_build_object('message', SQLERRM)::jsonb, 'cron');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'experiments_auto_decide: could not log error for %: %', r.key, SQLERRM;
      END;
      out := out || json_build_object('key', r.key, 'verdict', 'error', 'action', 'none');
    END;
  END LOOP;
  RETURN to_json(out);
END;
$function$;

-- ── 5. The experiment itself (running at 50%). Kill in Admin → Experiments to stop. ──
ALTER TABLE experiments DROP CONSTRAINT IF EXISTS experiments_owner_check;
ALTER TABLE experiments ADD CONSTRAINT experiments_owner_check CHECK (owner IN ('sql', 'weekly_review', 'server'));
INSERT INTO experiments (key, name, hypothesis, status, rollout_pct, metric_key, min_lift_pct,
                         min_users_per_arm, min_days, guardrail_metric_key, max_guardrail_drop_pct, started_at, owner)
VALUES ('remeasure_d7', 'Day-7 "did it hold?" re-measure nudge',
        'Seven days after a user''s first kept reading, one nudge on that watch quoting its rate (push when authorized, email otherwise) raises the share who keep a second reading. Arms are assigned server-side at the day-7 moment, so only eligible users count. Guardrail: seen again 7+ days later.',
        'running', 50, 'accuracy_reading_saved', 25, 50, 14, 'd7_retained', 5, now(), 'server')
ON CONFLICT (key) DO NOTHING;
INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
SELECT 'remeasure_d7', 'manual:running', '{"note": "started by sql/2026-09-11-remeasure-d7.sql"}'::jsonb, 'sql-file'
WHERE NOT EXISTS (SELECT 1 FROM experiment_decisions WHERE experiment_key = 'remeasure_d7');
NOTIFY pgrst, 'reload schema';
