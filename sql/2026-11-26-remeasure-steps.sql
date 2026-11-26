-- Day-3 and day-14 steps of the "did it hold?" follow-up (experiment remeasure_steps).
--
-- Why: 440 of 1,027 members own one watch; the reason they return is measuring (91 of 136
-- returning members came back to measure, usage review 2026-11-26). The day-7 nudge gets
-- 14% of its email recipients to re-measure within three days. These two steps bracket it:
-- day 3 (still in the first week, where win-back is cheapest) and day 14 (the last call
-- before the 21-60 day drift reminder takes over).
--
-- Same audience rule as remeasure_d7: the member's FIRST kept reading, on a watch they
-- still own, with no converged session on that watch after its first day. So a member who
-- re-measured at any point gets no further step. One message per (member, step), sent at
-- local 7pm by send-measure-reminders (phase 3). Reminders opt-out, suspended and internal
-- accounts are excluded. Arms are assigned here, at the first step a member is eligible
-- for (owner = 'server'); control rows are recorded so the ledger shows both arms.
--
-- Kill in Admin -> Experiments stops selection and sends.

CREATE TABLE IF NOT EXISTS remeasure_step_sends (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  step     smallint NOT NULL CHECK (step IN (3, 14)),
  watch_id text,
  channel  text NOT NULL CHECK (channel IN ('push', 'email', 'control')),
  sent_on  date NOT NULL,
  PRIMARY KEY (user_id, step)
);
ALTER TABLE remeasure_step_sends ENABLE ROW LEVEL SECURITY;
-- Reached only by the edge function (service role) and the SECURITY DEFINER RPCs below.
REVOKE ALL ON remeasure_step_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON remeasure_step_sends TO service_role;

CREATE OR REPLACE FUNCTION remeasure_step_eligible()
RETURNS TABLE (user_id uuid, step smallint, local_today date, watch_id text, rate numeric, measured_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH valid AS MATERIALIZED (
    SELECT p.id, p.timezone FROM profiles p
    WHERE p.timezone IS NOT NULL AND p.timezone <> ''
      AND EXISTS (SELECT 1 FROM valid_timezones z WHERE z.name = p.timezone)
      AND COALESCE(p.is_suspended, false) = false
      -- Compared as text: a ::boolean cast throws on a non-boolean string and one
      -- malformed profile would fail the whole RPC.
      AND COALESCE(p.email_prefs->>'reminders', 'true') <> 'false'
      AND p.id NOT IN (SELECT ia.user_id FROM internal_accounts ia)
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
  ),
  aged AS (
    SELECT nu.id, nu.local_today, fk.watch_id, fk.rate, fk.created_at,
           nu.local_today - (fk.created_at AT TIME ZONE nu.timezone)::date AS age
    FROM now_users nu JOIN first_kept fk ON fk.user_id = nu.id
    WHERE fk.watch_id IS NOT NULL AND fk.rate IS NOT NULL
  )
  SELECT a.id, s.step, a.local_today, a.watch_id, a.rate, a.created_at
  FROM aged a
  JOIN (VALUES (3::smallint, 3, 4), (14::smallint, 14, 15)) AS s(step, lo, hi) ON a.age BETWEEN s.lo AND s.hi
  WHERE EXISTS (SELECT 1 FROM watches w WHERE w.id = a.watch_id AND w.user_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM remeasure_step_sends x WHERE x.user_id = a.id AND x.step = s.step)
    AND NOT EXISTS (SELECT 1 FROM measurement_sessions ms
                    WHERE ms.user_id = a.id AND ms.watch_id = a.watch_id AND ms.converged
                      AND ms.created_at > a.created_at + interval '1 day');
$$;
REVOKE EXECUTE ON FUNCTION remeasure_step_eligible() FROM PUBLIC, anon, authenticated;

-- Targets for THIS hourly run. p_dry := true returns every eligible row with its would-be
-- arm and writes nothing.
CREATE OR REPLACE FUNCTION remeasure_step_targets(p_dry boolean DEFAULT false)
RETURNS TABLE (user_id uuid, step smallint, email text, channel text, variant text, watch_id text, brand text, name text,
               rate numeric, measured_at timestamptz, local_today date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
#variable_conflict use_column
DECLARE
  e experiments;
  is_won boolean;
BEGIN
  SELECT * INTO e FROM experiments WHERE key = 'remeasure_steps';
  -- Kill is the brake. An archived-won row keeps sending (archive = tidy, not undo).
  IF e.key IS NULL OR NOT (e.status IN ('running', 'won') OR (e.status = 'archived' AND e.archived_from = 'won')) THEN RETURN; END IF;
  is_won := e.status = 'won' OR e.archived_from = 'won';

  IF NOT p_dry THEN
    INSERT INTO experiment_assignments (experiment_key, user_id, variant)
    SELECT DISTINCT 'remeasure_steps', d.user_id,
           CASE WHEN is_won
                  OR (abs(hashtext(d.user_id::text || '|remeasure_steps')::bigint) % 100) < e.rollout_pct
                THEN 'treatment' ELSE 'control' END
    FROM remeasure_step_eligible() d
    ON CONFLICT (experiment_key, user_id) DO NOTHING;

    INSERT INTO remeasure_step_sends (user_id, step, watch_id, channel, sent_on)
    SELECT d.user_id, d.step, d.watch_id, 'control', d.local_today
    FROM remeasure_step_eligible() d
    JOIN experiment_assignments a ON a.experiment_key = 'remeasure_steps' AND a.user_id = d.user_id AND a.variant = 'control'
    ON CONFLICT (user_id, step) DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT d.user_id, d.step, u.email::text,
         -- Same channel rule as remeasure_d7_targets: push only behind a real grant.
         CASE WHEN ( EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = d.user_id AND dt.platform = 'ios')
                     AND NOT EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = d.user_id AND s.platform = 'ios' AND s.status <> 'authorized') )
                  OR ( EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = d.user_id AND dt.platform = 'android')
                       AND EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = d.user_id AND s.platform = 'android' AND s.status = 'authorized') )
              THEN 'push' ELSE 'email' END,
         coalesce(a.variant,
                  CASE WHEN is_won
                         OR (abs(hashtext(d.user_id::text || '|remeasure_steps')::bigint) % 100) < e.rollout_pct
                       THEN 'treatment' ELSE 'control' END),
         d.watch_id, w.brand, w.name, d.rate, d.measured_at, d.local_today
  FROM remeasure_step_eligible() d
  JOIN auth.users u ON u.id = d.user_id
  JOIN watches w ON w.id = d.watch_id AND w.user_id = d.user_id
  LEFT JOIN experiment_assignments a ON a.experiment_key = 'remeasure_steps' AND a.user_id = d.user_id
  WHERE p_dry OR a.variant = 'treatment';
END;
$$;
REVOKE EXECUTE ON FUNCTION remeasure_step_targets(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION remeasure_step_targets(boolean) TO service_role;

INSERT INTO experiments (key, name, hypothesis, status, rollout_pct, metric_key, min_lift_pct,
                         min_users_per_arm, min_days, guardrail_metric_key, max_guardrail_drop_pct, started_at, owner)
VALUES ('remeasure_steps', 'Day-3 and day-14 re-measure nudges',
        'Around the day-7 nudge, one message on day 3 and one on day 14 after a member''s first kept reading (same watch, quoting its rate, only while they have not measured it again; push when authorized, email otherwise) raise the share who keep a second reading. Arms are assigned server-side at the first step, so only eligible members count. Guardrail: seen again 7+ days later.',
        'running', 50, 'accuracy_reading_saved', 25, 50, 14, 'd7_retained', 5, now(), 'server')
ON CONFLICT (key) DO NOTHING;
INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
SELECT 'remeasure_steps', 'manual:running', '{"note": "started by sql/2026-11-26-remeasure-steps.sql"}'::jsonb, 'sql-file'
WHERE NOT EXISTS (SELECT 1 FROM experiment_decisions WHERE experiment_key = 'remeasure_steps');
NOTIFY pgrst, 'reload schema';
