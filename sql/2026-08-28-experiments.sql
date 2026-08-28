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
