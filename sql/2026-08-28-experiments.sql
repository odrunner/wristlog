-- sql/2026-08-28-experiments.sql
-- A/B experiments: assignment, metric registry, evaluation, auto-rollout.
-- Spec: docs/superpowers/specs/2026-08-28-ab-experiments-design.md
-- Apply: npx supabase db query --linked --file sql/2026-08-28-experiments.sql

-- ── 1. Tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiment_metrics (
  key    text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  label  text NOT NULL,
  kind   text NOT NULL CHECK (kind IN ('rate', 'mean')),
  source text NOT NULL,   -- 'table:<name>' (needs a CASE branch) or 'feature_events:<event>'
  sort   int  NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS experiments (
  key                    text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  name                   text NOT NULL,
  hypothesis             text,
  status                 text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'running', 'won', 'killed', 'archived')),
  rollout_pct            int  NOT NULL DEFAULT 20 CHECK (rollout_pct BETWEEN 0 AND 100),
  metric_key             text NOT NULL REFERENCES experiment_metrics(key),
  min_lift_pct           numeric NOT NULL DEFAULT 10,
  min_users_per_arm      int NOT NULL DEFAULT 50,
  min_days               int NOT NULL DEFAULT 7,
  guardrail_metric_key   text NOT NULL DEFAULT 'active_days' REFERENCES experiment_metrics(key),
  max_guardrail_drop_pct numeric NOT NULL DEFAULT 5,
  started_at             timestamptz,
  decided_at             timestamptz,
  decision               text CHECK (decision IN ('auto', 'manual')),
  last_eval              jsonb,          -- latest evaluate_experiment() output
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  experiment_key text NOT NULL REFERENCES experiments(key) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  variant        text NOT NULL CHECK (variant IN ('control', 'treatment')),
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_key, user_id)
);

CREATE TABLE IF NOT EXISTS experiment_decisions (
  id             bigserial PRIMARY KEY,
  experiment_key text NOT NULL REFERENCES experiments(key) ON DELETE CASCADE,
  verdict        text NOT NULL,   -- winning/guardrail_breach/error/manual:<status>
  snapshot       jsonb,
  actor          text NOT NULL,   -- 'cron' or admin uuid
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiment_decisions_key_idx ON experiment_decisions (experiment_key, created_at DESC);

-- One row per user per calendar day the app was opened (written by get_experiments()).
-- Feeds the active_days guardrail and d7_retained; user_presence keeps only last_seen_at.
CREATE TABLE IF NOT EXISTS user_activity_days (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day     date NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- ── 2. Registry seed ─────────────────────────────────────────────────────
INSERT INTO experiment_metrics (key, label, kind, source, sort) VALUES
  ('log_created',            'Logged a wear / post',      'rate', 'table:logs',                10),
  ('watch_added',            'Added a watch',             'rate', 'table:watches',             20),
  ('accuracy_reading_saved', 'Saved an accuracy reading', 'rate', 'table:timegrapher_results', 30),
  ('active_days',            'Active days per user',      'mean', 'table:user_activity_days',  40),
  ('d7_retained',            'Seen again 7+ days later',  'rate', 'table:user_activity_days',  50)
ON CONFLICT (key) DO NOTHING;

-- ── 3. RLS ───────────────────────────────────────────────────────────────
ALTER TABLE experiment_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS experiment_metrics_read ON experiment_metrics;
CREATE POLICY experiment_metrics_read ON experiment_metrics FOR SELECT TO authenticated USING (true);
-- Every other access goes through SECURITY DEFINER RPCs below; no direct policies.

-- ── 4. get_experiments(): called once after login ───────────────────────
-- Returns the caller's variant for every running experiment (assigning on
-- first sight) plus won experiments as treatment. Internal accounts are never
-- assigned (always control) so they cannot pollute the stats. Also records
-- today's activity day for the active_days / d7_retained metrics.
CREATE OR REPLACE FUNCTION get_experiments()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
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
           CASE WHEN (abs(hashtext(uid::text || '|' || e.key)) % 100) < e.rollout_pct
                THEN 'treatment' ELSE 'control' END
    FROM experiments e
    WHERE e.status = 'running'
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
$$;
GRANT EXECUTE ON FUNCTION get_experiments() TO authenticated;
NOTIFY pgrst, 'reload schema';

-- ── 5. Evaluator: per-user metric, stats, verdict ───────────────────────
CREATE OR REPLACE FUNCTION normal_cdf(z double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  -- tail = P(X > |z|); mirror for negative z. No recursion (a SQL function cannot
  -- reference itself at CREATE time).
  SELECT CASE WHEN z < 0 THEN tail ELSE 1 - tail END
  FROM (
    SELECT (exp(-z*z/2) / sqrt(2*pi())) *
           (0.319381530*t - 0.356563782*t^2 + 1.781477937*t^3 - 1.821255978*t^4 + 1.330274429*t^5) AS tail
    FROM (SELECT 1 / (1 + 0.2316419 * abs(z)) AS t) s1
  ) s2;
$$;

-- Per-user value of one registry metric counted from p_since (the user's assigned_at).
-- rate metrics return 0/1, mean metrics return a count. Extend: add one CASE branch
-- per new 'table:' source; 'feature_events:<event>' sources need no SQL change.
CREATE OR REPLACE FUNCTION experiment_user_metric(p_metric text, p_user uuid, p_since timestamptz)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  m experiment_metrics;
  n numeric;
BEGIN
  SELECT * INTO m FROM experiment_metrics WHERE key = p_metric;
  IF m.key IS NULL THEN RAISE EXCEPTION 'unknown metric %', p_metric; END IF;

  IF m.source LIKE 'feature_events:%' THEN
    SELECT count(*) INTO n FROM feature_events
     WHERE user_id = p_user AND event = substr(m.source, 16) AND created_at >= p_since;
  ELSE
    CASE m.source
      WHEN 'table:logs' THEN
        SELECT count(*) INTO n FROM logs WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:watches' THEN
        SELECT count(*) INTO n FROM watches WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:timegrapher_results' THEN
        SELECT count(*) INTO n FROM timegrapher_results WHERE user_id = p_user AND created_at >= p_since;
      WHEN 'table:user_activity_days' THEN
        IF m.key = 'd7_retained' THEN
          SELECT count(*) INTO n FROM user_activity_days
           WHERE user_id = p_user AND day >= (p_since + interval '7 days')::date;
        ELSE
          SELECT count(*) INTO n FROM user_activity_days
           WHERE user_id = p_user AND day > p_since::date;   -- exclude the assignment day itself
        END IF;
      ELSE RAISE EXCEPTION 'metric % has no evaluator branch for source %', p_metric, m.source;
    END CASE;
  END IF;
  IF m.kind = 'rate' THEN RETURN CASE WHEN n > 0 THEN 1 ELSE 0 END; END IF;
  RETURN n;
END;
$$;

-- Two-arm stats for one metric over one experiment's assignments (external users only).
-- Returns json {control:{users,converted,mean,sd}, treatment:{...}, lift_pct, p_value}.
CREATE OR REPLACE FUNCTION experiment_arm_stats(p_key text, p_metric text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  internal_ids uuid[] := array(SELECT user_id FROM internal_accounts);
  kind text;
  n1 int; n2 int; m1 numeric; m2 numeric; s1 numeric; s2 numeric; c1 int; c2 int;
  pooled numeric; se numeric; z numeric; p numeric; lift numeric;
BEGIN
  SELECT em.kind INTO kind FROM experiment_metrics em WHERE em.key = p_metric;
  WITH vals AS (
    SELECT a.variant, experiment_user_metric(p_metric, a.user_id, a.assigned_at) AS v
    FROM experiment_assignments a
    WHERE a.experiment_key = p_key AND a.user_id <> ALL(internal_ids)
  ),
  agg AS (
    SELECT variant, count(*) n, avg(v) m, coalesce(stddev_samp(v), 0) s, sum(CASE WHEN v > 0 THEN 1 ELSE 0 END) c
    FROM vals GROUP BY variant
  )
  SELECT
    coalesce((SELECT n FROM agg WHERE variant='control'), 0),   coalesce((SELECT n FROM agg WHERE variant='treatment'), 0),
    coalesce((SELECT m FROM agg WHERE variant='control'), 0),   coalesce((SELECT m FROM agg WHERE variant='treatment'), 0),
    coalesce((SELECT s FROM agg WHERE variant='control'), 0),   coalesce((SELECT s FROM agg WHERE variant='treatment'), 0),
    coalesce((SELECT c FROM agg WHERE variant='control'), 0),   coalesce((SELECT c FROM agg WHERE variant='treatment'), 0)
  INTO n1, n2, m1, m2, s1, s2, c1, c2;

  lift := CASE WHEN m1 > 0 THEN round((m2 - m1) / m1 * 100, 1) ELSE NULL END;
  p := NULL;
  IF n1 >= 2 AND n2 >= 2 THEN
    IF kind = 'rate' THEN
      pooled := (c1 + c2)::numeric / (n1 + n2);
      se := sqrt(pooled * (1 - pooled) * (1.0/n1 + 1.0/n2));
    ELSE
      se := sqrt(s1*s1/n1 + s2*s2/n2);   -- Welch, normal approximation
    END IF;
    IF se > 0 THEN
      z := (m2 - m1) / se;
      p := round((2 * (1 - normal_cdf(abs(z)::double precision)))::numeric, 4);
    END IF;
  END IF;
  RETURN json_build_object(
    'control',   json_build_object('users', n1, 'converted', c1, 'mean', round(m1, 4), 'sd', round(s1, 4)),
    'treatment', json_build_object('users', n2, 'converted', c2, 'mean', round(m2, 4), 'sd', round(s2, 4)),
    'lift_pct', lift, 'p_value', p);
END;
$$;

CREATE OR REPLACE FUNCTION evaluate_experiment(p_key text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  e experiments;
  tgt json; gr json;
  days int;
  min_users int; lift numeric; p numeric; g_drop numeric; g_p numeric;
  verdict text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
     AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO e FROM experiments WHERE key = p_key;
  IF e.key IS NULL THEN RAISE EXCEPTION 'unknown experiment %', p_key; END IF;

  tgt := experiment_arm_stats(p_key, e.metric_key);
  gr  := experiment_arm_stats(p_key, e.guardrail_metric_key);
  days := coalesce(extract(day FROM now() - e.started_at)::int, 0);
  min_users := least((tgt->'control'->>'users')::int, (tgt->'treatment'->>'users')::int);
  lift := (tgt->>'lift_pct')::numeric;
  p    := (tgt->>'p_value')::numeric;
  g_drop := CASE WHEN (gr->'control'->>'mean')::numeric > 0
                 THEN round(((gr->'control'->>'mean')::numeric - (gr->'treatment'->>'mean')::numeric)
                            / (gr->'control'->>'mean')::numeric * 100, 1) ELSE 0 END;
  g_p := (gr->>'p_value')::numeric;

  verdict := CASE
    WHEN min_users < e.min_users_per_arm OR days < e.min_days THEN 'too_early'
    WHEN g_drop > e.max_guardrail_drop_pct AND g_p IS NOT NULL AND g_p < 0.05 THEN 'guardrail_breach'
    WHEN lift IS NOT NULL AND lift >= e.min_lift_pct AND p IS NOT NULL AND p < 0.05 THEN 'winning'
    WHEN lift IS NOT NULL AND lift < 0 AND p IS NOT NULL AND p < 0.05 THEN 'losing'
    ELSE 'inconclusive' END;

  RETURN json_build_object(
    'key', e.key, 'metric_key', e.metric_key,
    'metric_kind', (SELECT kind FROM experiment_metrics WHERE key = e.metric_key),
    'days_running', days,
    'control', tgt->'control', 'treatment', tgt->'treatment',
    'lift_pct', lift, 'p_value', p,
    'guardrail', json_build_object('metric_key', e.guardrail_metric_key,
                   'control', (gr->'control'->>'mean')::numeric, 'treatment', (gr->'treatment'->>'mean')::numeric,
                   'drop_pct', g_drop, 'p_value', g_p),
    'gates', json_build_object('min_users_per_arm', e.min_users_per_arm, 'min_days', e.min_days,
                   'min_lift_pct', e.min_lift_pct, 'max_guardrail_drop_pct', e.max_guardrail_drop_pct),
    'verdict', verdict,
    'evaluated_at', now());
END;
$$;
GRANT EXECUTE ON FUNCTION evaluate_experiment(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION experiment_user_metric(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION experiment_arm_stats(text, text) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
