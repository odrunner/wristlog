# A/B Experiments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship features to X% of users behind `experiment('key')`, measure one registry metric per test against control, show every test in an admin tab, and auto-roll-out to 100% via a nightly pg_cron decision when the success gates hold.

**Architecture:** Four Supabase tables (`experiments`, `experiment_assignments`, `experiment_metrics`, `experiment_decisions`) plus `user_activity_days`; SECURITY DEFINER RPCs do sticky hash assignment, per-arm stats (z-test / Welch), verdicts and auto-decisions; the client calls `get_experiments()` once after login and exposes `experiment(key)`; an admin "Experiments" tab renders `admin_experiments_list()`.

**Tech Stack:** Postgres/plpgsql on Supabase (applied with `npx supabase db query --linked --file <sql>`), pg_cron, vanilla JS in `index.html`, pure logic in `wrotate_test.js` + vitest, Playwright mocked E2E.

**Spec:** `docs/superpowers/specs/2026-08-28-ab-experiments-design.md`

## Global Constraints

- Vanilla JS, no frameworks; no `confirm()`/`alert()` — use `showConfirm()` / `toast()`.
- Every new export in `wrotate_test.js` needs vitest tests covering its branches (CI gate: branches ≥ 94%). Run `npm run test:coverage` before push.
- Bump `sw.js` `CACHE` (`wristlog-vNNNN` → +1) on any `index.html` change.
- Exclude `internal_accounts` from all stats via `user_id <> ALL(array(select user_id from internal_accounts))`.
- Admin RPCs gate on `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)`.
- New RPCs end with `NOTIFY pgrst, 'reload schema';`.
- Do NOT `git push` until the final task; commit after each task. Nothing here touches the landing page.
- Use test accounts `test@wrotate.com` / `test2@wrotate.com` only for DB seeding; delete seeds afterwards.
- SQL is applied with: `npx supabase db query --linked --file sql/<file>.sql` (run from the repo root).

---

### Task 1: Schema — tables, registry seed, RLS

**Files:**
- Create: `sql/2026-08-28-experiments.sql` (this task writes the top section; later tasks append)
- Test: `tests/experiments-sql.test.js`

**Interfaces:**
- Produces tables `experiments`, `experiment_assignments`, `experiment_metrics`, `experiment_decisions`, `user_activity_days` exactly as below.

- [ ] **Step 1: Write the failing test** (string-guard test in the style of `tests/admin-metrics.test.js` — asserts the SQL file declares every table/column later code depends on)

```js
// tests/experiments-sql.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, '..', 'sql', '2026-08-28-experiments.sql');
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

describe('experiments SQL schema', () => {
  it('declares the five tables', () => {
    for (const t of ['experiments', 'experiment_assignments', 'experiment_metrics', 'experiment_decisions', 'user_activity_days']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`));
    }
  });
  it('seeds the metric registry with the built-ins', () => {
    for (const k of ['log_created', 'watch_added', 'accuracy_reading_saved', 'active_days', 'd7_retained']) {
      expect(sql).toContain(`('${k}'`);
    }
  });
  it('enables RLS on every table', () => {
    for (const t of ['experiments', 'experiment_assignments', 'experiment_metrics', 'experiment_decisions', 'user_activity_days']) {
      expect(sql).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/experiments-sql.test.js`
Expected: FAIL — `sql` is empty string.

- [ ] **Step 3: Write the schema section**

```sql
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
ALTER TABLE experiment_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_decisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_days     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS experiment_metrics_read ON experiment_metrics;
CREATE POLICY experiment_metrics_read ON experiment_metrics FOR SELECT TO authenticated USING (true);
-- Every other access goes through SECURITY DEFINER RPCs below; no direct policies.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/experiments-sql.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Apply to the linked DB and verify**

Run:
```bash
npx supabase db query --linked --file sql/2026-08-28-experiments.sql
npx supabase db query --linked "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'experiment%' OR table_name='user_activity_days';"
npx supabase db query --linked "SELECT key, kind FROM experiment_metrics ORDER BY sort;"
```
Expected: 5 tables listed; 5 metric rows.

- [ ] **Step 6: Commit**

```bash
git add sql/2026-08-28-experiments.sql tests/experiments-sql.test.js
git commit -m "experiments: schema, metric registry, RLS"
```

---

### Task 2: `get_experiments()` — sticky assignment + activity day

**Files:**
- Modify: `sql/2026-08-28-experiments.sql` (append section 4)
- Test: `tests/experiments-sql.test.js` (add a case), plus live DB check

**Interfaces:**
- Produces RPC `get_experiments() RETURNS json` → `[{"key": "...", "variant": "control"|"treatment"}]` for `running` + `won` experiments. Called by the client in Task 6.

- [ ] **Step 1: Add the failing test**

```js
  it('defines get_experiments with hash-based sticky assignment', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION get_experiments\(\)/);
    expect(sql).toContain("hashtext(auth.uid()::text || '|' || e.key)");
    expect(sql).toContain('INSERT INTO user_activity_days');
  });
```

- [ ] **Step 2: Run it** — `npx vitest run tests/experiments-sql.test.js` → FAIL.

- [ ] **Step 3: Append the RPC**

```sql
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
      AND NOT EXISTS (SELECT 1 FROM experiment_assignments a WHERE a.experiment_key = e.key AND a.user_id = uid);
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
```

Note on stickiness: a user already assigned `control` at 20% stays `control` when the admin raises to 50% (the `NOT EXISTS` guard). New users at 50% get the hash rule. That is intended (spec: "raising rollout_pct only adds users, never flips existing ones") — existing control users are not re-rolled; the treatment share grows through new users only. Document this in `docs/experiments.md` (Task 9).

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Apply and verify against the live DB with a throwaway experiment**

```bash
npx supabase db query --linked --file sql/2026-08-28-experiments.sql
npx supabase db query --linked "INSERT INTO experiments (key, name, status, rollout_pct, metric_key) VALUES ('zz_plan_test', 'plan test', 'running', 50, 'log_created');"
# test@ user id:
npx supabase db query --linked "SELECT id FROM auth.users WHERE email='test@wrotate.com';"
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"<TEST_ID>\"}', true); SELECT get_experiments();"
npx supabase db query --linked "SELECT * FROM experiment_assignments WHERE experiment_key='zz_plan_test'; SELECT * FROM user_activity_days WHERE user_id='<TEST_ID>';"
# Run get_experiments() a second time → same variant, no new row.
```
Expected: one assignment row; second call returns the same variant. Leave `zz_plan_test` in place for Task 3, delete in Task 4.

- [ ] **Step 6: Commit**

```bash
git add sql/2026-08-28-experiments.sql tests/experiments-sql.test.js
git commit -m "experiments: get_experiments() sticky assignment RPC"
```

---

### Task 3: Evaluator — per-user metric, stats, verdict

**Files:**
- Modify: `sql/2026-08-28-experiments.sql` (append section 5)
- Test: `tests/experiments-sql.test.js`, live DB check with hand-computed values

**Interfaces:**
- Produces `evaluate_experiment(p_key text) RETURNS json` with shape:
```json
{ "key": "...", "metric_key": "...", "metric_kind": "rate", "days_running": 12,
  "control":   { "users": 60, "converted": 12, "mean": 0.2, "sd": 0.4 },
  "treatment": { "users": 58, "converted": 20, "mean": 0.345, "sd": 0.48 },
  "lift_pct": 72.4, "p_value": 0.08,
  "guardrail": { "metric_key": "active_days", "control": 3.1, "treatment": 3.0, "drop_pct": 3.2, "p_value": 0.6 },
  "gates": { "min_users_per_arm": 50, "min_days": 7, "min_lift_pct": 10, "max_guardrail_drop_pct": 5 },
  "verdict": "inconclusive" }
```
- Verdicts: `too_early | guardrail_breach | winning | losing | inconclusive`.
- Also produces `normal_cdf(z double precision)` and `experiment_user_metric(p_metric text, p_user uuid, p_since timestamptz) RETURNS numeric`.

- [ ] **Step 1: Add failing tests**

```js
  it('defines the evaluator and the stats helper', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION normal_cdf(z double precision)
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
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Apply and verify stats against hand-computed values**

Hand case (rate): control 60 users / 12 converted, treatment 58 / 20. pooled = 32/118 = 0.2712; se = sqrt(0.2712·0.7288·(1/60+1/58)) = 0.08192; z = (0.3448−0.2)/0.08192 = 1.768; p ≈ 0.0771. Seed it on `zz_plan_test` with fake profiles is not possible (FK to profiles) — instead verify the two pieces separately:

```bash
npx supabase db query --linked --file sql/2026-08-28-experiments.sql
npx supabase db query --linked "SELECT round(normal_cdf(1.768)::numeric, 4);"        # expect 0.9615
npx supabase db query --linked "SELECT round(normal_cdf(-1.0)::numeric, 4);"         # expect 0.1587
# Live run on the throwaway experiment (test accounts are internal → both arms 0 users → too_early):
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"d70b1a85-4f31-4431-b3b7-db76543daaf5\"}', true); SELECT evaluate_experiment('zz_plan_test');"
# Metric helper on the test user (bypasses internal exclusion because it is per-user):
npx supabase db query --linked "SELECT experiment_user_metric('log_created', '<TEST_ID>', now() - interval '365 days'), experiment_user_metric('active_days', '<TEST_ID>', now() - interval '365 days');"
```
Expected: CDF values match; evaluator returns `verdict: too_early` with `users: 0` per arm; metric helper returns `1` and an integer ≥ 0.

- [ ] **Step 6: Commit**

```bash
git add sql/2026-08-28-experiments.sql tests/experiments-sql.test.js
git commit -m "experiments: evaluator with z-test / Welch stats and verdict ladder"
```

---

### Task 4: Auto-decide, admin RPCs, pg_cron

**Files:**
- Modify: `sql/2026-08-28-experiments.sql` (append section 6)
- Modify: `CLAUDE.md` (pg_cron list — add `evaluate-experiments`)
- Test: `tests/experiments-sql.test.js`, live DB

**Interfaces:**
- `experiments_auto_decide() RETURNS json` — `[{key, verdict, action}]`.
- `admin_experiments_list() RETURNS json` — array of experiment rows, each with `eval` (live for running, `last_eval` otherwise) and `decisions` (last 10).
- `admin_experiment_upsert(p json) RETURNS void` — keys: `key,name,hypothesis,metric_key,min_lift_pct,rollout_pct,min_users_per_arm,min_days,guardrail_metric_key,max_guardrail_drop_pct`. Only allowed while status is `draft` (create) or for gate columns on `running`.
- `admin_experiment_set_status(p_key text, p_status text, p_rollout_pct int DEFAULT NULL) RETURNS void` — transitions: draft→running (sets `started_at`), running→running (rollout change), running→won (manual, rollout 100), running→killed, won|killed→archived.

- [ ] **Step 1: Add failing tests**

```js
  it('defines auto-decide, admin RPCs and schedules the cron', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION experiments_auto_decide\(\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION admin_experiments_list\(\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION admin_experiment_upsert\(p json\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION admin_experiment_set_status\(/);
    expect(sql).toContain("cron.schedule('evaluate-experiments', '0 6 * * *'");
  });
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Append**

```sql
-- ── 6. Decisions + admin API + cron ─────────────────────────────────────
CREATE OR REPLACE FUNCTION experiments_auto_decide()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  r record; ev json; v text; out json[] := '{}';
BEGIN
  FOR r IN SELECT key FROM experiments WHERE status = 'running' ORDER BY key LOOP
    BEGIN
      ev := evaluate_experiment(r.key);
      v := ev->>'verdict';
      UPDATE experiments SET last_eval = ev::jsonb WHERE key = r.key;
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
      INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
      VALUES (r.key, 'error', json_build_object('message', SQLERRM)::jsonb, 'cron');
      out := out || json_build_object('key', r.key, 'verdict', 'error', 'action', 'none');
    END;
  END LOOP;
  RETURN to_json(out);
END;
$$;
REVOKE EXECUTE ON FUNCTION experiments_auto_decide() FROM PUBLIC, anon, authenticated;

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
           e.started_at, e.decided_at, e.decision, e.created_at,
           CASE WHEN e.status = 'running' THEN evaluate_experiment(e.key) ELSE e.last_eval::json END AS eval,
           (SELECT coalesce(json_agg(json_build_object('verdict', d.verdict, 'actor', d.actor, 'at', d.created_at, 'snapshot', d.snapshot)
                    ORDER BY d.created_at DESC), '[]'::json)
              FROM (SELECT * FROM experiment_decisions WHERE experiment_key = e.key ORDER BY created_at DESC LIMIT 10) d) AS decisions
    FROM experiments e
  ) x;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_experiments_list() TO authenticated;

CREATE OR REPLACE FUNCTION admin_experiment_upsert(p json)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE cur experiments;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO cur FROM experiments WHERE key = p->>'key';
  IF cur.key IS NULL THEN
    INSERT INTO experiments (key, name, hypothesis, metric_key, min_lift_pct, rollout_pct,
                             min_users_per_arm, min_days, guardrail_metric_key, max_guardrail_drop_pct)
    VALUES (p->>'key', p->>'name', p->>'hypothesis', p->>'metric_key',
            coalesce((p->>'min_lift_pct')::numeric, 10), coalesce((p->>'rollout_pct')::int, 20),
            coalesce((p->>'min_users_per_arm')::int, 50), coalesce((p->>'min_days')::int, 7),
            coalesce(p->>'guardrail_metric_key', 'active_days'), coalesce((p->>'max_guardrail_drop_pct')::numeric, 5));
  ELSIF cur.status IN ('draft', 'running') THEN
    UPDATE experiments SET
      name = coalesce(p->>'name', name), hypothesis = coalesce(p->>'hypothesis', hypothesis),
      metric_key = CASE WHEN cur.status = 'draft' THEN coalesce(p->>'metric_key', metric_key) ELSE metric_key END,
      min_lift_pct = coalesce((p->>'min_lift_pct')::numeric, min_lift_pct),
      min_users_per_arm = coalesce((p->>'min_users_per_arm')::int, min_users_per_arm),
      min_days = coalesce((p->>'min_days')::int, min_days),
      max_guardrail_drop_pct = coalesce((p->>'max_guardrail_drop_pct')::numeric, max_guardrail_drop_pct)
    WHERE key = cur.key;
  ELSE
    RAISE EXCEPTION 'experiment % is %, not editable', cur.key, cur.status;
  END IF;
  INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
  VALUES (p->>'key', 'manual:edit', p::jsonb, auth.uid()::text);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_experiment_upsert(json) TO authenticated;

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
    UPDATE experiments SET status='archived' WHERE key=p_key;
  ELSE
    RAISE EXCEPTION 'cannot move % from % to %', p_key, cur.status, p_status;
  END IF;
  INSERT INTO experiment_decisions (experiment_key, verdict, snapshot, actor)
  VALUES (p_key, 'manual:' || p_status, json_build_object('rollout_pct', p_rollout_pct, 'eval', ev)::jsonb, auth.uid()::text);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_experiment_set_status(text, text, int) TO authenticated;

-- Nightly decision. Runs as postgres (evaluate_experiment lets current_user='postgres' through).
SELECT cron.unschedule('evaluate-experiments') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'evaluate-experiments');
SELECT cron.schedule('evaluate-experiments', '0 6 * * *', $$SELECT public.experiments_auto_decide()$$);
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Apply and exercise every transition on the throwaway experiment**

```bash
npx supabase db query --linked --file sql/2026-08-28-experiments.sql
A='d70b1a85-4f31-4431-b3b7-db76543daaf5'
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"$A\"}', true); SELECT admin_experiment_upsert('{\"key\":\"zz_plan_test2\",\"name\":\"t2\",\"metric_key\":\"watch_added\"}'::json);"
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"$A\"}', true); SELECT admin_experiment_set_status('zz_plan_test2','running',30);"
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"$A\"}', true); SELECT admin_experiment_set_status('zz_plan_test2','running',60);"
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"$A\"}', true); SELECT admin_experiment_set_status('zz_plan_test','killed');"
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"$A\"}', true); SELECT admin_experiment_set_status('zz_plan_test','archived');"
npx supabase db query --linked "SELECT experiments_auto_decide();"      # zz_plan_test2 → too_early, action none
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"$A\"}', true); SELECT json_array_length(admin_experiments_list());"
npx supabase db query --linked "SELECT jobname, schedule FROM cron.job WHERE jobname='evaluate-experiments';"
# Illegal transition must raise:
npx supabase db query --linked "SELECT set_config('request.jwt.claims', '{\"sub\": \"$A\"}', true); SELECT admin_experiment_set_status('zz_plan_test','running');"   # expect ERROR cannot move
# Cleanup:
npx supabase db query --linked "DELETE FROM experiments WHERE key LIKE 'zz_plan_test%';"
```
Expected: each transition succeeds, list returns 2, cron row present, illegal transition errors, cleanup leaves 0 rows.

- [ ] **Step 6: Add the cron entry to CLAUDE.md** — under "Supabase pg_cron jobs", append:

```markdown
- **`evaluate-experiments`** (`0 6 * * *`, added 2026-08-28) → `SELECT public.experiments_auto_decide()` (plain SQL): evaluates every `running` A/B experiment; `winning` → `won` + `rollout_pct=100`, `guardrail_breach` → `killed`; everything else untouched. Every action/error is a row in `experiment_decisions`. Source: `sql/2026-08-28-experiments.sql`; recipe in `docs/experiments.md`.
```

- [ ] **Step 7: Commit**

```bash
git add sql/2026-08-28-experiments.sql tests/experiments-sql.test.js CLAUDE.md
git commit -m "experiments: auto-decide, admin RPCs, nightly pg_cron"
```

---

### Task 5: Pure client logic in `wrotate_test.js`

**Files:**
- Modify: `wrotate_test.js` (append at end)
- Test: `tests/experiments.test.js`

**Interfaces:**
- Produces (exported, and duplicated verbatim into `index.html` in Task 6 — `index.html` cannot import):
  - `resolveExperiment(state, overrides, key) → boolean`
  - `experimentVerdict(ev, gates) → string` (JS mirror of the SQL ladder)
  - `experimentSortRank(status) → number`
  - `fmtExperimentMetric(ev, arm) → string` e.g. `"12/60 (20.0%)"` for rate, `"3.10"` for mean

- [ ] **Step 1: Write failing tests**

```js
// tests/experiments.test.js
import { describe, it, expect } from 'vitest';
import { resolveExperiment, experimentVerdict, experimentSortRank, fmtExperimentMetric } from '../wrotate_test.js';

describe('resolveExperiment', () => {
  const state = { a: 'treatment', b: 'control' };
  it('treatment → true, control → false, unknown → false', () => {
    expect(resolveExperiment(state, {}, 'a')).toBe(true);
    expect(resolveExperiment(state, {}, 'b')).toBe(false);
    expect(resolveExperiment(state, {}, 'zzz')).toBe(false);
  });
  it('override wins in both directions', () => {
    expect(resolveExperiment(state, { a: 'control' }, 'a')).toBe(false);
    expect(resolveExperiment(state, { b: 'treatment' }, 'b')).toBe(true);
  });
  it('tolerates null state/overrides', () => {
    expect(resolveExperiment(null, null, 'a')).toBe(false);
  });
});

describe('experimentVerdict', () => {
  const gates = { min_users_per_arm: 50, min_days: 7, min_lift_pct: 10, max_guardrail_drop_pct: 5 };
  const base = { days_running: 10, control: { users: 60 }, treatment: { users: 58 }, lift_pct: 30, p_value: 0.01, guardrail: { drop_pct: 1, p_value: 0.5 } };
  it('too_early on users or days', () => {
    expect(experimentVerdict({ ...base, treatment: { users: 10 } }, gates)).toBe('too_early');
    expect(experimentVerdict({ ...base, days_running: 3 }, gates)).toBe('too_early');
  });
  it('guardrail_breach beats winning', () => {
    expect(experimentVerdict({ ...base, guardrail: { drop_pct: 9, p_value: 0.01 } }, gates)).toBe('guardrail_breach');
    expect(experimentVerdict({ ...base, guardrail: { drop_pct: 9, p_value: 0.4 } }, gates)).toBe('winning');
  });
  it('winning / losing / inconclusive', () => {
    expect(experimentVerdict(base, gates)).toBe('winning');
    expect(experimentVerdict({ ...base, lift_pct: -20 }, gates)).toBe('losing');
    expect(experimentVerdict({ ...base, lift_pct: 5 }, gates)).toBe('inconclusive');
    expect(experimentVerdict({ ...base, p_value: 0.3 }, gates)).toBe('inconclusive');
    expect(experimentVerdict({ ...base, lift_pct: null, p_value: null }, gates)).toBe('inconclusive');
  });
  it('null eval → too_early', () => {
    expect(experimentVerdict(null, gates)).toBe('too_early');
  });
});

describe('experimentSortRank', () => {
  it('orders running < won < killed < archived < draft', () => {
    const r = ['draft', 'archived', 'killed', 'won', 'running'].map(experimentSortRank);
    expect(r).toEqual([4, 3, 2, 1, 0]);
    expect(experimentSortRank('weird')).toBe(4);
  });
});

describe('fmtExperimentMetric', () => {
  it('rate shows converted/users and %', () => {
    expect(fmtExperimentMetric({ metric_kind: 'rate', control: { users: 60, converted: 12, mean: 0.2 } }, 'control')).toBe('12/60 (20.0%)');
  });
  it('mean shows two decimals', () => {
    expect(fmtExperimentMetric({ metric_kind: 'mean', treatment: { users: 5, mean: 3.1 } }, 'treatment')).toBe('3.10 (n=5)');
  });
  it('missing arm → dash', () => {
    expect(fmtExperimentMetric(null, 'control')).toBe('—');
    expect(fmtExperimentMetric({ metric_kind: 'rate' }, 'control')).toBe('—');
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/experiments.test.js` → FAIL (not exported).

- [ ] **Step 3: Implement** (append to `wrotate_test.js`)

```js
// ══════════════════════════════════════════
//  A/B EXPERIMENTS (mirrored verbatim in index.html)
// ══════════════════════════════════════════
// state: {key: 'control'|'treatment'} from get_experiments(); overrides: admin
// Dev-tab forced variants. Anything unknown is false so a deleted row never throws.
export function resolveExperiment(state, overrides, key) {
  const forced = overrides && overrides[key];
  if (forced === 'treatment') return true;
  if (forced === 'control') return false;
  return !!state && state[key] === 'treatment';
}

// JS mirror of the SQL verdict ladder in evaluate_experiment(), so the admin tab can
// re-derive a verdict from a snapshot. Order matters: too_early → guardrail → win → lose.
export function experimentVerdict(ev, gates) {
  if (!ev) return 'too_early';
  const users = Math.min(ev.control?.users ?? 0, ev.treatment?.users ?? 0);
  if (users < gates.min_users_per_arm || (ev.days_running ?? 0) < gates.min_days) return 'too_early';
  const g = ev.guardrail || {};
  if ((g.drop_pct ?? 0) > gates.max_guardrail_drop_pct && g.p_value != null && g.p_value < 0.05) return 'guardrail_breach';
  const sig = ev.p_value != null && ev.p_value < 0.05;
  if (ev.lift_pct != null && ev.lift_pct >= gates.min_lift_pct && sig) return 'winning';
  if (ev.lift_pct != null && ev.lift_pct < 0 && sig) return 'losing';
  return 'inconclusive';
}

export function experimentSortRank(status) {
  return { running: 0, won: 1, killed: 2, archived: 3 }[status] ?? 4;
}

export function fmtExperimentMetric(ev, arm) {
  const a = ev && ev[arm];
  if (!a) return '—';
  if (ev.metric_kind === 'rate') return `${a.converted}/${a.users} (${(Number(a.mean) * 100).toFixed(1)}%)`;
  return `${Number(a.mean).toFixed(2)} (n=${a.users})`;
}
```

- [ ] **Step 4: Run** → PASS. Then `npm run test:coverage` → thresholds still met.

- [ ] **Step 5: Commit**

```bash
git add wrotate_test.js tests/experiments.test.js
git commit -m "experiments: pure client logic (resolve, verdict mirror, formatting)"
```

---

### Task 6: Client wiring — `experiment()`, load on login, Dev-tab override

**Files:**
- Modify: `index.html` — next to `featureFlag()` (~line 6364); login sequence after `applyWatchDbFlag();` (~line 34089); `signOut()` (~line 7702); `renderDevFlags()` (~line 18070); Dev tab HTML (~line 4040)
- Modify: `sw.js` (bump CACHE)
- Test: `tests/experiments-wiring.test.js` (string guards) + manual on local server

**Interfaces:**
- Consumes RPC `get_experiments()` (Task 2), `resolveExperiment` (Task 5, copied verbatim).
- Produces globals `EXPERIMENTS`, `experiment(key)`, `loadExperiments()`, `clearExperiments()`, `setExperimentOverride(key, variant)`, `renderDevExperiments()`.

- [ ] **Step 1: Write failing string-guard test**

```js
// tests/experiments-wiring.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('experiments client wiring', () => {
  it('defines experiment() on top of resolveExperiment', () => {
    expect(html).toMatch(/function experiment\(key\)\s*\{[^}]*resolveExperiment\(EXPERIMENTS, _expOverrides\(\), key\)/);
  });
  it('loads experiments after login and clears them on sign-out', () => {
    expect(html).toContain('applyWatchDbFlag();\n  loadExperiments();');
    expect(html).toMatch(/async function signOut\(\) \{[\s\S]*?clearExperiments\(\);/);
  });
  it('mirrors resolveExperiment verbatim', () => {
    const src = readFileSync(join(__dirname, '..', 'wrotate_test.js'), 'utf8');
    const fn = src.match(/export (function resolveExperiment[\s\S]*?\n\})/)[1];
    expect(html).toContain(fn);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement in `index.html`**

(a) After `setFeatureFlag` (line ~6372), add:

```js
// ── A/B experiments ─────────────────────────────────────────────────────
// Server-assigned sticky variants (get_experiments RPC). Mirrored in wrotate_test.js.
let EXPERIMENTS = (() => { try { return JSON.parse(safeLS.get('exp_state') || '{}'); } catch (e) { return {}; } })();
function resolveExperiment(state, overrides, key) {
  const forced = overrides && overrides[key];
  if (forced === 'treatment') return true;
  if (forced === 'control') return false;
  return !!state && state[key] === 'treatment';
}
function _expOverrides() {
  if (!currentUser || currentUser.id !== ADMIN_USER_ID) return null;
  const o = {};
  for (const k of Object.keys(EXPERIMENTS)) { const v = safeLS.get('exp_force_' + k); if (v) o[k] = v; }
  return o;
}
function experiment(key) { return resolveExperiment(EXPERIMENTS, _expOverrides(), key); }
async function loadExperiments() {
  if (!currentUser || _isDemoMode) return;
  try {
    const { data, error } = await db.rpc('get_experiments');
    if (error) { console.warn('[WRotate] get_experiments failed:', error.message); return; }
    const next = {};
    for (const row of data || []) next[row.key] = row.variant;
    EXPERIMENTS = next;
    safeLS.set('exp_state', JSON.stringify(next));
    document.dispatchEvent(new CustomEvent('experiments:loaded'));
  } catch (e) { console.warn('[WRotate] loadExperiments:', e.message); }
}
function clearExperiments() { EXPERIMENTS = {}; safeLS.remove('exp_state'); }
function setExperimentOverride(key, variant) {
  if (variant) safeLS.set('exp_force_' + key, variant); else safeLS.remove('exp_force_' + key);
  renderDevExperiments();
}
```

(b) Login sequence: directly after the existing `applyWatchDbFlag();` at ~line 34089 add `loadExperiments();` (own line, exact text `applyWatchDbFlag();\n  loadExperiments();`).

(c) `signOut()`: after `clearUserState();` add `clearExperiments();`.

(d) Dev tab HTML — inside `#admin-tab-dev` after `<div id="admin-dev-flags"></div>`:

```html
      <div style="margin:1.25rem 0 .75rem;"><div class="eyebrow">Experiments — force my variant</div></div>
      <div id="admin-dev-experiments"></div>
```

(e) Add after `renderDevFlags()`:

```js
function renderDevExperiments() {
  const el = document.getElementById('admin-dev-experiments');
  if (!el) return;
  const keys = Object.keys(EXPERIMENTS);
  if (!keys.length) { el.innerHTML = '<div style="font-size:.78rem;color:var(--muted);padding:.5rem 0;">No running experiments.</div>'; return; }
  el.innerHTML = keys.map(k => {
    const forced = safeLS.get('exp_force_' + k) || '';
    const opt = (v, label) => `<option value="${v}" ${forced === v ? 'selected' : ''}>${label}</option>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--border);">
      <div><div style="font-size:.85rem;font-family:monospace;">${escHtml(k)}</div>
           <div style="font-size:.72rem;color:var(--muted);">assigned: ${escHtml(EXPERIMENTS[k])}</div></div>
      <select onchange="setExperimentOverride('${escAttr(k)}', this.value)">${opt('', 'as assigned')}${opt('control', 'force control')}${opt('treatment', 'force treatment')}</select>
    </div>`;
  }).join('');
}
```
and call `renderDevExperiments();` right after the existing `renderDevFlags();` at ~line 17650 (the admin-page loader), plus at the end of `loadExperiments()` after the `experiments:loaded` dispatch so the Dev tab refreshes once the RPC lands.

(f) `sw.js`: bump `wristlog-v1129` → `wristlog-v1130` (read the current value first; use current+1).

- [ ] **Step 4: Run** `npx vitest run tests/experiments-wiring.test.js` → PASS; `npm test` → all green.

- [ ] **Step 5: Manual check** on http://localhost:3000 (Mac Mini) or http://ozgurs-mac-mini-2.local:3000: log in as test@wrotate.com, open devtools console: `EXPERIMENTS` is `{}` (no running experiments), `experiment('nope')` → `false`, no console errors, Network shows one `get_experiments` POST returning `[]`.

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js tests/experiments-wiring.test.js
git commit -m "experiments: experiment() client helper, load on login, Dev-tab override"
```

---

### Task 7: Admin "Experiments" tab

**Files:**
- Modify: `index.html` — `#admin-tabs` chip row (~line 3655), new panel before `#admin-tab-dev` (~line 4040), `switchAdminTab` (~line 18087), new functions after `loadAdminModels`
- Modify: `sw.js` (bump)
- Test: `tests/experiments-wiring.test.js` (extend)

**Interfaces:**
- Consumes `admin_experiments_list()`, `admin_experiment_upsert(p)`, `admin_experiment_set_status(p_key,p_status,p_rollout_pct)` (Task 4); `experimentSortRank`, `fmtExperimentMetric`, `experimentVerdict` (Task 5, copied verbatim into index.html).
- Produces `loadAdminExperiments()`, `adminExpAction(key, status)`, `adminExpCreate()`, `adminExpToggleLog(key)`.

- [ ] **Step 1: Extend the string-guard test**

```js
  it('has an Experiments admin tab wired to its loader', () => {
    expect(html).toContain('data-tab="experiments"');
    expect(html).toContain('id="admin-tab-experiments"');
    expect(html).toContain("if (tab === 'experiments') loadAdminExperiments();");
    expect(html).toMatch(/async function loadAdminExperiments\(\)[\s\S]*?db\.rpc\('admin_experiments_list'\)/);
  });
  it('mirrors the display helpers verbatim', () => {
    const src = readFileSync(join(__dirname, '..', 'wrotate_test.js'), 'utf8');
    for (const name of ['experimentVerdict', 'experimentSortRank', 'fmtExperimentMetric']) {
      const fn = src.match(new RegExp(`export (function ${name}[\\s\\S]*?\\n\\})`))[1];
      expect(html).toContain(fn);
    }
  });
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

(a) Chip, inserted after the `dev` chip:
```html
      <button type="button" class="chip" data-tab="experiments" role="tab" aria-selected="false" aria-controls="admin-tab-experiments" onclick="switchAdminTab('experiments')">Experiments</button>
```

(b) Panel, inserted before `<div id="admin-tab-dev"`:
```html
    <div id="admin-tab-experiments" class="admin-tab" role="tabpanel" style="display:none;">
      <div class="eyebrow" style="margin-bottom:.6rem;">A/B experiments</div>
      <details style="margin-bottom:.8rem;">
        <summary style="cursor:pointer;font-size:.8rem;">New experiment</summary>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin-top:.5rem;font-size:.8rem;">
          <input id="adm-exp-key" placeholder="key (a-z0-9_)">
          <input id="adm-exp-name" placeholder="name">
          <input id="adm-exp-hyp" placeholder="hypothesis" style="grid-column:1/3;">
          <select id="adm-exp-metric"></select>
          <input id="adm-exp-lift" type="number" value="10" placeholder="min lift %">
          <input id="adm-exp-pct" type="number" value="20" min="0" max="100" placeholder="rollout %">
          <button class="chip" onclick="adminExpCreate()">Create draft</button>
        </div>
      </details>
      <div id="admin-experiments-list" style="font-size:.8rem;">Loading…</div>
    </div>
```

(c) `switchAdminTab`: add `if (tab === 'experiments') loadAdminExperiments();`

(d) Functions (after `loadAdminModels` block). Copy `experimentVerdict`, `experimentSortRank`, `fmtExperimentMetric` from `wrotate_test.js` verbatim (without `export`), then:

```js
let _adminExps = [];
const EXP_STATUS_COLOR = { running: 'var(--gold)', won: '#2e9e5b', killed: '#c0392b', archived: 'var(--muted)', draft: 'var(--muted)' };
async function loadAdminExperiments() {
  const el = document.getElementById('admin-experiments-list');
  if (!el) return;
  el.textContent = 'Loading…';
  const [{ data, error }, metrics] = await Promise.all([
    db.rpc('admin_experiments_list'),
    db.from('experiment_metrics').select('key,label,kind').order('sort'),
  ]);
  if (error) { el.textContent = 'Failed: ' + error.message; return; }
  const sel = document.getElementById('adm-exp-metric');
  if (sel && metrics.data) sel.innerHTML = metrics.data.map(m => `<option value="${escAttr(m.key)}">${escHtml(m.label)}</option>`).join('');
  _adminExps = (data || []).slice().sort((a, b) => experimentSortRank(a.status) - experimentSortRank(b.status));
  if (!_adminExps.length) { el.innerHTML = '<div style="color:var(--muted);">No experiments yet.</div>'; return; }
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <tr style="color:var(--muted);text-align:left;"><th>Experiment</th><th>Status</th><th>%</th><th>Days</th><th>Control</th><th>Treatment</th><th>Lift</th><th>p</th><th>Guard Δ</th><th>Verdict</th><th></th></tr>` +
    _adminExps.map(x => {
      const ev = x.eval;
      const gates = { min_users_per_arm: x.min_users_per_arm, min_days: x.min_days, min_lift_pct: x.min_lift_pct, max_guardrail_drop_pct: x.max_guardrail_drop_pct };
      const verdict = ev ? (ev.verdict || experimentVerdict(ev, gates)) : '—';
      const actions = [];
      if (x.status === 'draft') actions.push(`<button class="chip" onclick="adminExpAction('${escAttr(x.key)}','running')">Start</button>`);
      if (x.status === 'running') {
        actions.push(`<button class="chip" onclick="adminExpAction('${escAttr(x.key)}','running')">Change %</button>`);
        actions.push(`<button class="chip" onclick="adminExpAction('${escAttr(x.key)}','won')">Roll out</button>`);
        actions.push(`<button class="chip" onclick="adminExpAction('${escAttr(x.key)}','killed')">Kill</button>`);
      }
      if (x.status === 'won' || x.status === 'killed') actions.push(`<button class="chip" onclick="adminExpAction('${escAttr(x.key)}','archived')">Archive</button>`);
      actions.push(`<button class="chip" onclick="adminExpToggleLog('${escAttr(x.key)}')">Log</button>`);
      return `<tr style="border-top:0.5px solid var(--border);">
        <td><div>${escHtml(x.name)}</div><div style="color:var(--muted);font-family:monospace;font-size:.7rem;">${escHtml(x.key)} · ${escHtml(x.metric_key)}</div></td>
        <td style="color:${EXP_STATUS_COLOR[x.status] || 'inherit'};">${escHtml(x.status)}${x.decision ? ` <span style="color:var(--muted);">(${x.decision})</span>` : ''}</td>
        <td>${x.rollout_pct}</td>
        <td>${ev ? ev.days_running : '—'}</td>
        <td>${fmtExperimentMetric(ev, 'control')}</td>
        <td>${fmtExperimentMetric(ev, 'treatment')}</td>
        <td>${ev && ev.lift_pct != null ? (ev.lift_pct > 0 ? '+' : '') + ev.lift_pct + '%' : '—'}</td>
        <td>${ev && ev.p_value != null ? ev.p_value : '—'}</td>
        <td>${ev && ev.guardrail ? (ev.guardrail.drop_pct > 0 ? '−' : '+') + Math.abs(ev.guardrail.drop_pct) + '%' : '—'}</td>
        <td>${escHtml(verdict)}</td>
        <td style="white-space:nowrap;">${actions.join(' ')}</td>
      </tr>
      <tr id="adm-exp-log-${escAttr(x.key)}" style="display:none;"><td colspan="11" style="padding:.4rem 0;color:var(--muted);">
        ${(x.decisions || []).map(d => `<div>${escHtml(new Date(d.at).toLocaleString())} · ${escHtml(d.verdict)} · ${escHtml(d.actor === 'cron' ? 'cron' : 'admin')}</div>`).join('') || 'No decisions yet.'}
      </td></tr>`;
    }).join('') + '</table>';
}
function adminExpToggleLog(key) {
  const r = document.getElementById('adm-exp-log-' + key);
  if (r) r.style.display = r.style.display === 'none' ? '' : 'none';
}
async function adminExpAction(key, status) {
  let pct = null;
  if (status === 'running') {
    const cur = _adminExps.find(x => x.key === key);
    pct = Number(document.getElementById('adm-exp-pct-' + key)?.value ?? cur?.rollout_pct ?? 20);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { toast('Rollout % must be 0–100', 'error'); return; }
  }
  const labels = { running: `Run "${key}" at ${pct}% treatment?`, won: `Roll "${key}" out to everyone?`, killed: `Kill "${key}"? Treatment users revert to control now.`, archived: `Archive "${key}"? Only do this after the experiment() branch is gone from code.` };
  const ok = await showConfirm(labels[status], { title: 'Experiment', confirmLabel: status === 'killed' ? 'Kill' : 'Confirm', danger: status === 'killed' });
  if (!ok) return;
  const { error } = await db.rpc('admin_experiment_set_status', { p_key: key, p_status: status, p_rollout_pct: pct });
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast(`${key}: ${status}`);
  loadAdminExperiments();
}
async function adminExpCreate() {
  const key = document.getElementById('adm-exp-key').value.trim();
  if (!/^[a-z0-9_]+$/.test(key)) { toast('Key must be a-z, 0-9, _', 'error'); return; }
  const p = {
    key, name: document.getElementById('adm-exp-name').value.trim() || key,
    hypothesis: document.getElementById('adm-exp-hyp').value.trim(),
    metric_key: document.getElementById('adm-exp-metric').value,
    min_lift_pct: Number(document.getElementById('adm-exp-lift').value) || 10,
    rollout_pct: Number(document.getElementById('adm-exp-pct').value) || 20,
  };
  const { error } = await db.rpc('admin_experiment_upsert', { p });
  if (error) { toast('Failed: ' + error.message, 'error'); return; }
  toast('Draft created');
  document.getElementById('adm-exp-key').value = '';
  loadAdminExperiments();
}
```

The rollout % for Start/Change % comes from an inline number input rendered in the row. Add to the `%` cell for `draft`/`running` rows: `<input id="adm-exp-pct-${escAttr(x.key)}" type="number" min="0" max="100" value="${x.rollout_pct}" style="width:3.5rem;">` instead of the bare `${x.rollout_pct}`; `won/killed/archived` rows keep the bare number.

(e) `sw.js`: bump again (+1).

- [ ] **Step 4: Run** `npm test` → PASS.

- [ ] **Step 5: Manual check** on the local server as your admin account (`@od`): Admin → Experiments renders "No experiments yet."; create a draft `zz_ui_test` → row appears with Start; Start at 10% → status running, verdict `too_early`; Kill → killed; Archive → archived; Log expander shows the three manual rows. Then delete: `npx supabase db query --linked "DELETE FROM experiments WHERE key='zz_ui_test';"`.

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js tests/experiments-wiring.test.js
git commit -m "experiments: admin Experiments tab with start/rollout/kill/archive"
```

---

### Task 8: Mocked E2E for the admin tab

**Files:**
- Create: `e2e/admin-experiments.mock.spec.js`

**Interfaces:** consumes `loadAdminExperiments`, `adminExpAction`, `_confirmOk` from index.html.

- [ ] **Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';
import { mockSupabase, injectSession, waitForAppBoot } from './helpers.js';

const ADMIN_ID = 'd70b1a85-4f31-4431-b3b7-db76543daaf5';
const ROW = {
  key: 'feed_compact', name: 'Compact feed cards', status: 'running', rollout_pct: 20, metric_key: 'log_created',
  min_lift_pct: 10, min_users_per_arm: 50, min_days: 7, max_guardrail_drop_pct: 5, decision: null,
  eval: { metric_kind: 'rate', days_running: 12, control: { users: 60, converted: 12, mean: 0.2 }, treatment: { users: 58, converted: 20, mean: 0.3448 },
          lift_pct: 72.4, p_value: 0.0771, guardrail: { drop_pct: 1.2, p_value: 0.6 }, verdict: 'inconclusive' },
  decisions: [],
};

test('experiments tab renders a running row and Kill posts the status change', async ({ page }) => {
  await mockSupabase(page);
  const calls = [];
  await page.route('**/rest/v1/rpc/admin_experiments_list*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ROW]) }));
  await page.route('**/rest/v1/experiment_metrics*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'log_created', label: 'Logged a wear / post', kind: 'rate' }]) }));
  await page.route('**/rest/v1/rpc/admin_experiment_set_status*', r => { calls.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }); });
  await injectSession(page, { id: ADMIN_ID, email: 'admin@wrotate.com', aud: 'authenticated' });
  await page.goto('/');
  await waitForAppBoot(page);
  await page.evaluate(async (id) => { currentUser = { id }; await loadAdminExperiments(); }, ADMIN_ID);
  const list = page.locator('#admin-experiments-list');
  await expect(list).toContainText('Compact feed cards');
  await expect(list).toContainText('12/60 (20.0%)');
  await expect(list).toContainText('20/58 (34.5%)');
  await expect(list).toContainText('+72.4%');
  await expect(list).toContainText('inconclusive');

  await page.evaluate(() => { adminExpAction('feed_compact', 'killed'); });
  await page.waitForSelector('#confirm-modal:not(.hidden)');
  await page.evaluate(() => _confirmOk());
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toEqual({ p_key: 'feed_compact', p_status: 'killed', p_rollout_pct: null });
});
```

- [ ] **Step 2: Run** `npx playwright test --project=mocked e2e/admin-experiments.mock.spec.js` → PASS (fix selectors if the confirm modal id differs — verify with `grep -n 'id="confirm-modal"' index.html`).

- [ ] **Step 3: Commit**

```bash
git add e2e/admin-experiments.mock.spec.js
git commit -m "experiments: mocked E2E for the admin tab"
```

---

### Task 9: Docs, full verification, ship

**Files:**
- Create: `docs/experiments.md`
- Modify: `CLAUDE.md` (Development Workflow: one line pointing at the recipe)

- [ ] **Step 1: Write `docs/experiments.md`**

```markdown
# A/B experiments — how to run one

1. Build the change behind a flag:
   `if (experiment('my_key')) { /* treatment */ } else { /* control */ }`
   `experiment()` is false for unknown keys, so shipping the code first is safe.
2. Admin → Experiments → New experiment: key `my_key`, name, hypothesis, target metric,
   min lift % (default 10), rollout % (default 20). This creates a **draft**.
3. Push the code. Then press **Start** (set the %). New logins are assigned from now on;
   each user's variant is sticky (hash of user id + key).
4. Raising the % later only adds *new* users to treatment — already-assigned control
   users stay control. Lowering it does not un-assign anyone.
5. The nightly job (06:00 UTC) evaluates every running experiment:
   - `too_early` — fewer than min users/arm or min days
   - `winning` → auto **won**, rollout 100 %, everyone gets treatment
   - `guardrail_breach` → auto **killed** (guardrail down > max % with p < 0.05)
   - `losing` / `inconclusive` — nothing happens; decide manually (Roll out / Kill)
6. After **won**: delete the `experiment()` branch, keep the treatment path, ship, then
   press **Archive**. After **killed**: delete the treatment path, ship, Archive.

Metrics: `experiment_metrics` table. Add a `feature_events:<event>` row for any event you
already write to `feature_events` (no SQL change). Table-backed metrics need one `CASE`
branch in `experiment_user_metric()` (`sql/2026-08-28-experiments.sql`).

Dev tab → "Experiments — force my variant" lets the admin see either arm without touching
assignment. Internal accounts are never assigned and never counted.
```

- [ ] **Step 2: CLAUDE.md** — under "Development Workflow" add: `- **Feature ideas ship as A/B experiments** behind \`experiment('key')\` — recipe in \`docs/experiments.md\`; personal-only toggles still use \`featureFlag()\``.

- [ ] **Step 3: Full verification**

```bash
npm run test:coverage && npm run test:functions && npm run test:e2e
git status   # confirm only intended files; check `git diff HEAD -- index.html` for unfamiliar hunks
```
Expected: all green, coverage thresholds met.

- [ ] **Step 4: Commit and push**

```bash
git add docs/experiments.md CLAUDE.md
git commit -m "experiments: developer recipe + CLAUDE.md pointers"
git push origin main
```

- [ ] **Step 5: Post-deploy check** — on https://wrotate.com as admin: Experiments tab loads (empty), Dev tab shows "No running experiments.", console clean. `npx supabase db query --linked "SELECT count(*) FROM user_activity_days;"` grows as users log in over the next day.
