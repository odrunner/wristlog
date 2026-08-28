# A/B Experiments — Design

Date: 2026-08-28 · Status: approved in brainstorming, awaiting spec review

## Goal

Ship features to X% of users behind a flag, measure one target metric per test against a
control arm, show every test with its metrics in the admin portal, and roll a test out to
everyone automatically once its success rule holds. Everything lives in Supabase; no vendor
experiment product.

## Decisions taken (from brainstorming)

- One target metric per test, picked from an extensible registry (`experiment_metrics`).
- Assignment + metrics + decisions in Supabase, not PostHog.
- Auto-rollout gates = sample size + minimum duration + minimum lift + significance
  (p < 0.05) + guardrail not breached. Manual override always available.
- Winning sets `rollout_pct = 100`; the `experiment()` check stays in code until the
  developer removes it and presses **Archive**. Killing reverts treatment users to control
  immediately. Tests are UI/behaviour toggles only — never schema changes.

## Data model — `sql/2026-08-28-experiments.sql`

### `experiments`
| column | type | notes |
|---|---|---|
| key | text PK | e.g. `feed_compact_cards`; `^[a-z0-9_]+$` |
| name | text | |
| hypothesis | text | |
| status | text | `draft` · `running` · `won` · `killed` · `archived` |
| rollout_pct | int 0–100 | share of users in treatment |
| metric_key | text FK → experiment_metrics | target metric |
| min_lift_pct | numeric, default 10 | relative lift required |
| min_users_per_arm | int, default 50 | |
| min_days | int, default 7 | |
| guardrail_metric_key | text FK, default `active_days` | |
| max_guardrail_drop_pct | numeric, default 5 | |
| started_at, decided_at | timestamptz | |
| decision | text | `auto` · `manual` · null |
| created_at | timestamptz default now() | |

### `experiment_assignments`
`(experiment_key, user_id)` PK, `variant` (`control`/`treatment`), `assigned_at`.
A user's variant never changes once written.

### `experiment_metrics` (registry)
| column | notes |
|---|---|
| key | text PK |
| label | shown in admin dropdown |
| kind | `rate` (share of users with ≥1 event since assignment) or `mean` (events per user) |
| source | `table:<name>` for built-ins, or `feature_events:<event>` for zero-SQL metrics |
| sort | display order |

Seed rows: `post_created` (rate, entries), `watch_added` (rate, watches),
`accuracy_reading_saved` (rate, timegrapher_results), `wear_logged` (rate, wear log table),
`active_days` (mean, distinct days in `page_visits`/`user_presence` — default guardrail),
`d7_retained` (rate, seen ≥ 7 days after assignment).
Adding a metric = INSERT one row (+ one `CASE` branch in `experiment_user_metric()` if it is
not a `feature_events:` source).

### `experiment_decisions`
`id bigserial`, `experiment_key`, `verdict`, `snapshot jsonb` (the evaluator output at that
moment), `actor` (`cron` / admin user id), `created_at`. Written on every auto or manual
status change, and on evaluator errors (`verdict='error'`, message in snapshot).

### RLS
All four tables: RLS on. `experiment_metrics`: SELECT for authenticated.
`experiments`: SELECT for authenticated on `key, status, rollout_pct` only via the RPC below
(no direct table policy needed for non-admins). Everything else admin-only via
SECURITY DEFINER RPCs that check `profiles.is_admin`.

## RPCs

- `get_experiments()` — SECURITY DEFINER, called once after login. For each experiment with
  status `running`: return the caller's variant, inserting an assignment if none exists:
  `treatment` iff `abs(hashtext(user_id::text || key)) % 100 < rollout_pct`. Also returns
  `won` keys (→ everyone treatment). Callers in `internal_accounts` are never inserted and
  get `control`. Returns `[{key, variant}]`.
- `experiment_user_metric(metric_key, user_id, since timestamptz)` — internal helper,
  returns a numeric per user (0/1 for rate, count for mean).
- `evaluate_experiment(key)` — admin. Returns json per arm (`users`, `converted` or `mean`,
  `sd`), `lift_pct`, `p_value`, guardrail (`control`, `treatment`, `drop_pct`),
  `days_running`, `verdict`. External accounts only. Stats: two-proportion z-test for
  `rate`, Welch t-test (normal approximation for p) for `mean`.
  Verdict order: `too_early` (users or days below minimum) → `guardrail_breach` (guardrail
  drop > max and p < 0.05 on the guardrail) → `winning` (lift ≥ min, p < 0.05) →
  `losing` (lift < 0, p < 0.05) → `inconclusive`.
- `experiments_auto_decide()` — run by pg_cron. For each `running` experiment, in its own
  exception block: evaluate; `winning` → `status='won', rollout_pct=100, decision='auto',
  decided_at=now()`; `guardrail_breach` → `killed`; anything else untouched. Writes
  `experiment_decisions` for every experiment it touched or that errored.
- `admin_experiments_list()` — admin. Every experiment with its latest evaluation (cached
  in the row for `won/killed/archived`, live for `running`) for the tab.
- `admin_experiment_upsert(json)`, `admin_experiment_set_status(key, status, rollout_pct)`
  — admin writes; both log to `experiment_decisions` with `actor = auth.uid()`.

pg_cron: `evaluate-experiments`, `0 6 * * *`, `SELECT public.experiments_auto_decide();`
(plain SQL like `refresh-admin-stats-cache`). Add to CLAUDE.md's pg_cron list.

## Client (`index.html`)

- `EXPERIMENTS = {}` in memory, loaded by `loadExperiments()` right after login via
  `db.rpc('get_experiments')`, mirrored to `safeLS` `exp_state` so the UI is stable on next
  boot before the RPC returns. Cleared on logout.
- `experiment(key)` → boolean. Order: Dev-tab override `exp_force_<key>` (admin only) →
  `EXPERIMENTS[key] === 'treatment'` → false. Unknown/`draft`/`killed`/`archived` keys are
  false, so removing a row can never throw.
- Anything using an experiment applies it after `loadExperiments()` resolves (same hook
  point as `applyWatchDbFlag`).

## Admin → Experiments tab

- New chip `experiments` in `#admin-tabs`, panel `#admin-tab-experiments`, loader
  `loadAdminExperiments()` following the `loadAdminModels` pattern.
- Table: name · status badge · rollout % · days · users/arm · target metric
  (control / treatment / lift / p) · guardrail Δ · verdict. Order running → won → killed
  → archived → draft.
- Row actions with inline toast confirmations (no `confirm()`): Start (asks rollout %),
  Change %, Roll out now, Kill, Archive (only `won`/`killed`). Decision-log expander.
- "New experiment" inline form: key, name, hypothesis, metric (from registry), min lift,
  rollout %. Other gates use defaults, editable later.
- Dev tab: "Force variant" select per running experiment → writes `exp_force_<key>`.

## Developer recipe (`docs/experiments.md`)

1. Build the change behind `if (experiment('my_key'))`.
2. Create the experiment as draft in the admin tab.
3. Push code; then Start at e.g. 20%.
4. Watch the tab; nightly cron decides. On `won`: delete the `experiment()` branch, keep
   the treatment path, ship, press Archive. On `killed`: delete the treatment path.

## Testing

- **Unit (`wrotate_test.js`)**: `variantForHash(hash, pct)`, `resolveExperiment(state,
  override, key)`, `experimentVerdict(stats, gates)` (JS mirror used by the tab so the
  displayed verdict matches SQL), all branches covered for the 94% CI gate.
- **SQL**: apply file on the linked DB (`db query --linked`), `NOTIFY pgrst`; seed one
  experiment with `test@`/`test2@` assignments, run `evaluate_experiment` under
  `set_config('request.jwt.claims', …)`; check z-test / t-test against hand-computed
  values; run `experiments_auto_decide()` and inspect `experiment_decisions`. Delete the
  seed afterwards.
- **E2E mocked**: admin tab renders a running experiment; Start and Kill flows.
- **Ship**: SW cache bump, `npm run test:coverage`, `npm run test:e2e`, one push.

## Out of scope

Multi-variant (>2 arms), mutual-exclusion groups, sequential testing, iOS-native (Swift)
flags — the app's JS runs on iOS so it is covered.
