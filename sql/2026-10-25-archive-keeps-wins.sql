-- sql/2026-10-25-archive-keeps-wins.sql
-- Archiving a WON experiment must only tidy the admin list — never un-serve the
-- winner. Until today get_experiments() and remeasure_d7_targets() served only
-- status IN ('running','won'), so archiving a won row silently put everyone back
-- on control. That cost four live wins: tgknob_driftband_6 (archived 2026-10-12,
-- the accuracy loop's only promotion — drift gate off fleet-wide for 13 days),
-- and enhance_nudge / follow_suggest / remeasure_d7 (archived 2026-10-24, each
-- still gated by experiment() or its RPC). feed_rpc was already folded into code.
-- From now on: Kill is the brake; Archive is cosmetic.
-- Apply: npx supabase db query --linked --file sql/2026-10-25-archive-keeps-wins.sql

-- ── 1. Remember what a row was when it was archived ──────────────────────
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS archived_from text
  CHECK (archived_from IN ('won', 'killed'));

-- ── 2. Record it on every future archive ─────────────────────────────────
CREATE OR REPLACE FUNCTION admin_experiment_set_status(p_key text, p_status text, p_rollout_pct int DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE cur experiments; ev json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO cur FROM experiments WHERE key = p_key;
  IF cur.key IS NULL THEN RAISE EXCEPTION 'unknown experiment %', p_key; END IF;

  IF cur.status = 'draft' AND p_status = 'running' THEN
    UPDATE experiments SET status='running', started_at=now(), rollout_pct=coalesce(p_rollout_pct, rollout_pct) WHERE key=p_key;
  ELSIF cur.status = 'running' AND p_status = 'running' AND p_rollout_pct IS NOT NULL THEN
    UPDATE experiments SET rollout_pct=p_rollout_pct WHERE key=p_key;
  ELSIF cur.status = 'running' AND p_status = 'won' THEN
    ev := evaluate_experiment(p_key);
    UPDATE experiments SET status='won', rollout_pct=100, decision='manual', decided_at=now(), last_eval=ev::jsonb WHERE key=p_key;
  ELSIF cur.status = 'running' AND p_status = 'killed' THEN
    ev := evaluate_experiment(p_key);
    UPDATE experiments SET status='killed', decision='manual', decided_at=now(), last_eval=ev::jsonb WHERE key=p_key;
  ELSIF cur.status IN ('won', 'killed') AND p_status = 'archived' THEN
    -- Archive only hides the row from the active list. archived_from keeps a won
    -- experiment serving its winner (get_experiments / remeasure_d7_targets).
    UPDATE experiments SET status='archived', archived_from=cur.status WHERE key=p_key;
  ELSE
    RAISE EXCEPTION 'cannot move % from % to %', p_key, cur.status, p_status;
  END IF;
  INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
  VALUES (p_key, 'manual:' || p_status, json_build_object('rollout_pct', p_rollout_pct, 'eval', ev)::jsonb, auth.uid()::text);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_experiment_set_status(text, text, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_experiment_set_status(text, text, int) FROM PUBLIC, anon;

-- ── 3. Serve an archived-won experiment exactly like a won one ───────────
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
           CASE WHEN e.status = 'won' OR e.archived_from = 'won' THEN 'treatment'
                WHEN is_internal THEN 'control'
                ELSE coalesce(a.variant, 'control') END AS v
    FROM experiments e
    LEFT JOIN experiment_assignments a ON a.experiment_key = e.key AND a.user_id = uid
    -- A won experiment keeps serving after it is archived (archive = tidy, not undo).
    WHERE e.status IN ('running', 'won')
       OR (e.status = 'archived' AND e.archived_from = 'won')
  ) s;
  RETURN result;
END;
$function$;

-- ── 4. remeasure_d7: Kill still brakes; Archive no longer does ───────────
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
         CASE WHEN EXISTS (SELECT 1 FROM device_tokens dt WHERE dt.user_id = d.user_id AND dt.platform = 'ios')
                   AND NOT EXISTS (SELECT 1 FROM push_auth_status s WHERE s.user_id = d.user_id AND s.status <> 'authorized')
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

-- ── 5. Admin list carries archived_from so the tab can say "still serving" ─
CREATE OR REPLACE FUNCTION admin_experiments_list()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE result json;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT coalesce(json_agg(row_to_json(x) ORDER BY
           CASE x.status WHEN 'running' THEN 0 WHEN 'won' THEN 1 WHEN 'killed' THEN 2 WHEN 'archived' THEN 3 ELSE 4 END,
           x.created_at DESC), '[]'::json)
  INTO result
  FROM (
    SELECT e.key, e.name, e.hypothesis, e.status, e.rollout_pct, e.metric_key, e.min_lift_pct,
           e.min_users_per_arm, e.min_days, e.guardrail_metric_key, e.max_guardrail_drop_pct,
           e.started_at, e.decided_at, e.decision, e.created_at, e.owner, e.archived_from,
           e.last_eval::json AS eval,
           (SELECT coalesce(json_agg(json_build_object('verdict', d.verdict, 'actor', d.actor, 'at', d.created_at, 'snapshot', d.snapshot)
                    ORDER BY d.created_at DESC), '[]'::json)
              FROM (SELECT * FROM experiment_decisions WHERE experiment_key = e.key ORDER BY created_at DESC LIMIT 10) d) AS decisions
    FROM experiments e
  ) x;
  RETURN result;
END;
$$;

-- ── 6. Backfill the existing archives from their decision history ────────
-- Won when archived (the four restored wins + feed_rpc, whose branch was already
-- folded into the client so serving it again is a no-op):
UPDATE experiments SET archived_from = 'won'
 WHERE status = 'archived'
   AND key IN ('tgknob_driftband_6', 'feed_rpc', 'enhance_nudge', 'follow_suggest', 'remeasure_d7');
-- Killed when archived:
UPDATE experiments SET archived_from = 'killed'
 WHERE status = 'archived'
   AND key IN ('tgknob_gatemaxrej_0p5', 'tgknob_confirmband_6', 'tgknob_guardmode_0',
               'tgknob_stabwin_8', 'tgknob_driftband_4', 'msr_verdict_line');
-- wishlist_recommend / collection_sim were archived without ever being decided
-- (no won/killed in experiment_decisions) and have no client code: archived_from
-- stays NULL and they stay unserved.

NOTIFY pgrst, 'reload schema';
