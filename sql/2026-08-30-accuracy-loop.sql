-- sql/2026-08-30-accuracy-loop.sql
-- Self-healing accuracy loop: knob trials are A/B experiments owned by the Sunday
-- job (scripts/weekly-measurement-review.py + scripts/accuracy_loop.py), not by
-- the nightly SQL evaluator. Spec: docs/superpowers/specs/2026-08-30-self-healing-accuracy-loop-design.md
-- Apply: npx supabase db query --linked --file sql/2026-08-30-accuracy-loop.sql

-- ── 1. Owner column ───────────────────────────────────────────────────────
-- 'sql'           → evaluated + auto-decided nightly by experiments_auto_decide()
-- 'weekly_review' → judged by the Sunday job from timegrapher_tick_logs; the SQL
--                   evaluator must never touch these (it would judge a knob change on
--                   accuracy_reading_saved and auto-win/kill it on the wrong metric).
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'sql';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiments_owner_check') THEN
    ALTER TABLE experiments ADD CONSTRAINT experiments_owner_check CHECK (owner IN ('sql', 'weekly_review'));
  END IF;
END $$;

-- ── 2. Metric row so the FK is satisfied and the admin tab reads sensibly ──
INSERT INTO experiment_metrics (key, label, kind, source, sort) VALUES
  ('tg_bad_lock', 'Wrong number of converged tg sessions (weekly review)', 'rate', 'logs:weekly_review', 60)
ON CONFLICT (key) DO NOTHING;

-- ── 3. evaluate_experiment(): a weekly_review row returns the stored eval ──
-- The Python job writes last_eval (arm table + p-values). A Refresh from the admin
-- tab, or Roll out / Kill via admin_experiment_set_status, must not try to compute
-- 'logs:weekly_review' through experiment_user_metric (it would raise).
CREATE OR REPLACE FUNCTION evaluate_experiment(p_key text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
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
  IF e.owner <> 'sql' THEN
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
$$;

-- ── 4. Nightly auto-decide only touches SQL-owned rows ───────────────────
CREATE OR REPLACE FUNCTION experiments_auto_decide()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  r record; ev json; v text; out json[] := '{}';
BEGIN
  FOR r IN SELECT key FROM experiments WHERE status = 'running' AND owner = 'sql' ORDER BY key LOOP
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
$$;
REVOKE EXECUTE ON FUNCTION experiments_auto_decide() FROM PUBLIC, anon, authenticated;

-- ── 5. Admin list carries owner so the tab can label knob trials ─────────
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
           e.started_at, e.decided_at, e.decision, e.created_at, e.owner,
           e.last_eval::json AS eval,
           (SELECT coalesce(json_agg(json_build_object('verdict', d.verdict, 'actor', d.actor, 'at', d.created_at, 'snapshot', d.snapshot)
                    ORDER BY d.created_at DESC), '[]'::json)
              FROM (SELECT * FROM experiment_decisions WHERE experiment_key = e.key ORDER BY created_at DESC LIMIT 10) d) AS decisions
    FROM experiments e
  ) x;
  RETURN result;
END;
$$;

-- ── 6. Seed the do-not-retry history from the change ledger ──────────────
-- Refuted before the loop existed (docs/measurement-changelog.md, 2026-08-23). A
-- killed tgknob_* row is what the candidate picker skips, so these keys are never
-- re-tried. tg_guardmode=1 is the code default since 2026-08-23 and is tested by
-- the loop's first trial (tgknob_guardmode_0), started by the job — not seeded here.
INSERT INTO experiments (key, name, hypothesis, status, rollout_pct, metric_key, min_users_per_arm, min_days,
                         started_at, decided_at, decision, owner)
VALUES
  ('tgknob_confirmband_6', 'tg_confirmband = 6 (T1 lock confirmation)',
   'Bad locks do not repeat on a disjoint 8-s segment, so confirm-before-converge separates them. Refuted 2026-08-23 from shadow verdicts: T1-rejected 30% of bad locks vs 34% of good — bad locks are stable within a session.',
   'killed', 0, 'tg_bad_lock', 15, 7, '2026-08-15', '2026-08-23', 'manual', 'weekly_review'),
  ('tgknob_gatemaxrej_0p5', 'tg_gatemaxrej = 0.5 (T3 σ-gate block)',
   'Blocking convergence while the σ-gate rejects > 50% of windows catches bad locks. Refuted 2026-08-23: fires on 1% of bad locks and 0% of good — catches nothing.',
   'killed', 0, 'tg_bad_lock', 15, 7, '2026-08-15', '2026-08-23', 'manual', 'weekly_review')
ON CONFLICT (key) DO NOTHING;
INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
SELECT k, 'refuted', json_build_object('note', 'seeded from docs/measurement-changelog.md 2026-08-23')::jsonb, 'weekly-review'
FROM (VALUES ('tgknob_confirmband_6'), ('tgknob_gatemaxrej_0p5')) v(k)
WHERE NOT EXISTS (SELECT 1 FROM experiment_decisions d WHERE d.experiment_key = v.k);

NOTIFY pgrst, 'reload schema';
