# Self-healing accuracy loop — design (2026-08-30)

## Goal
The Sunday measurement job stops *recommending* and starts *doing*: every week it
judges the change it made last week (promote / revert / extend), then picks and starts
the next single change from the whole tg-era dataset. The Sunday email is a report of
what it did and why — never a to-do for the user.

## What exists today
- `scripts/weekly-measurement-review.py` (Sunday 08:00, LaunchAgent `com.wrotate.weekly-review`)
  reads every external native tg session since 2.4 from `timegrapher_tick_logs`, scores
  every JS-tunable knob as a counterfactual gate on the whole era (§3 gate table), and
  prints ONE ⭐ recommendation. It cannot change anything.
- Knobs are JS-side: `sendMsrTuning()` (index.html ~33650) reads `localStorage` with
  code defaults and posts them to the native engine at session start. The engine echoes
  every effective value in the `[TGTUNE]` log line, so **the arm a session ran under is
  visible in the log itself**.
- The A/B system (`sql/2026-08-28-experiments.sql`): sticky per-user assignment by
  `hashtext(uid|key) % 100 < rollout_pct`, `get_experiments()` at login, nightly SQL
  evaluator `experiments_auto_decide()` (06:00 UTC), admin Experiments tab.
- Ledger: `docs/measurement-changelog.md` (markdown; launchd can't read `~/Documents`).

## Why before/after judgement is not good enough
`tg_guardmode=1` went live fleet-wide 2026-08-23 to be judged "this week vs prior".
This week: wrong-of-converged 34% vs 25% prior — but users, watches and builds
differ week to week (casual users' sane% swung 38% → 82%). A sequential comparison
can't tell a bad change from a noisy week, so the loop would flip-flop.
**Every trial runs as a same-week 50/50 A/B**; judgement uses all sessions since the
trial started (accumulating, not last-7-days), candidate selection uses the whole era.

## Design

### 1. Trials are experiments (reuse, don't rebuild)
A knob trial is a row in `experiments` with key `tgknob_<knob>_<value>`
(e.g. `tgknob_stabwin_8`, `tgknob_guardmode_0`, decimals as `0p0005`).
- New column `experiments.owner text NOT NULL DEFAULT 'sql'` (`'sql' | 'weekly_review'`).
  `experiments_auto_decide()` skips `owner <> 'sql'` so the nightly SQL judge never
  auto-wins/kills a knob trial on `accuracy_reading_saved`; the Python job owns those.
- Metric registry gets one row `tg_bad_lock` (label "Wrong number of converged tg
  sessions", source `logs:weekly_review`) so the FK is satisfied and the admin tab
  reads sensibly. Knob trials appear in the admin Experiments tab like any other
  (visible, and manually killable from there — the emergency brake).
- Assignment, stickiness, rollout 0/50/100, internal-account exclusion, admin
  force-variant: all inherited.

### 2. Client: trial value sits between personal override and default
`index.html`:
```
_tgTrialKnob(k)  → scan EXPERIMENTS for `tgknob_<k-without-tg_>_<v>` in treatment → v | null
_tgKnob(k, d)    → LS personal value ?? trial ?? d        (non-preset knobs)
_tgConvKnob(k)   → trial ?? LS ?? PROV2_DEFAULTS[k]       (preset knobs: wallmin/stabwin/stabth/maxwin)
                   — trial applies ONLY when tg_precision is unset/'balanced';
                     a user who chose strict/quick keeps their preset
tgGuardMode      → same path via a `tg_guardmode` entry (0 is a legal value)
```
Preset knobs must put the trial above LS because `_migrateProV2Precision` writes all
four into LS for every user, so "LS wins" would exempt everyone. Admin testing uses
the existing Dev-tab force-variant control. `sendMsrTuning()` already runs at every
session start, after `loadExperiments()`, so the arm is in place before measuring.
Mirror in `wrotate_test.js` + unit tests (coverage gate). SW bump.

### 3. The Sunday job (`weekly-measurement-review.py`, same LaunchAgent)
Runs once per review week; needs the service-role key (`~/.config/wrotate/supabase.env`,
already used by cost-report from launchd). Phases, in order:

**A. Judge the running trial** (if any `tgknob_*` row is `running`):
- Population: external users' native tg sessions since `started_at`, precision
  `balanced` (25% of sessions run `strict`; preset-knob trials are ambiguous there),
  arm = the knob's value in that session's `[TGTUNE]` echo (log truth, not the
  assignment table). Sessions on builds that lack the knob are excluded.
- Primary metric: **wrong-of-converged** (converged sessions with |rate| > 15 s/d).
  Guardrails: **converged %** and **no-reading %** of sessions.
  Secondary (reported only): sane %, b2b wild-pair share, users per arm.
- Rules (two-proportion z-test, one-sided where stated):
  - `too_early`: < 60 converged sessions or < 15 users in either arm → extend.
  - `promote`: treatment wrong-of-converged lower, p < 0.05, and no guardrail worse
    by > 5 pp at p < 0.10 → status `won`, rollout 100.
  - `revert`: treatment worse on primary at p < 0.20, or any guardrail worse by > 5 pp
    at p < 0.10 → status `killed`, rollout 0.
  - `inconclusive` after 3 review weeks → `killed` (a change that can't show a win in
    ~800 sessions doesn't earn a permanent place; noted as `inconclusive`, distinct
    from `refuted`).
  - Every verdict → `experiment_decisions` row (actor `weekly-review`, snapshot = arm
    table + p-values) and `last_eval`.

**B. Start the next trial** (only when no trial is running after A):
- Candidate pool = the gate-candidate table, evaluated on the **whole tg era**
  (unchanged: ≥ 15% of bad locks blocked, ≤ 10% good cost, n ≥ 10, best separation).
- Exclusions: any `tgknob_*` key ever `won`/`killed`/`archived` (never retry a reverted
  or refuted change; won ones are already live); knobs that don't exist in the
  fleet's build. Seeded history: `tgknob_confirmband_6` = killed (refuted
  2026-08-23), `tgknob_gatemaxrej_0p5` = killed (catches nothing).
- Start at rollout 50 (`owner='weekly_review'`, hypothesis + metric text filled from
  the table row). One trial at a time, always.
- If nothing clears the bar: start nothing and say so plainly ("pool exhausted; the
  next gain needs native work: …").

**C. Email = what was done.** Sections: (1) verdict on last week's trial with the arm
table and the action taken; (2) the trial started today (or "nothing started — why");
(3) the existing §1–§5 population report (week / prior / era, wrong-number attribution,
gate table, first-lock timing, trend); (4) trial ledger from the DB (key, started,
decided, verdict). No ⭐ "next step for you" section. Failures still email a traceback.

**D. Ledger.** `docs/measurement-changelog.md` stays the human narrative; the job
appends a row via the repo copy when it can read it (manual runs) and the DB
`experiment_decisions` table is the machine-readable source the job actually reads.

### 4. Bake-in
A `won` knob keeps serving treatment to 100% through the experiment (same as any won
experiment). Folding it into `PROV2_DEFAULTS` / the code default and archiving the row
is a normal code change done by hand, listed in the email under "won, awaiting bake-in".

### 5. First trial — decision needed
`tg_guardmode=1` was promoted 2026-08-23 without an A/B and this week's before/after
reads *worse* (34% vs 25%). Options:
- **(a) Trial #1 = `tgknob_guardmode_0` at 50%** — half the users get the 2.4 median
  fallback back for a week; this is the only way to know whether guardmode=1 helped.
  If control (=1) wins, the loop confirms the promotion; if not, it reverts it.
- (b) Leave guardmode=1 as is (unproven) and start with today's ⭐, `tgknob_stabwin_8`.
Recommendation: (a). Its counterfactual separation (5.5×) is the strongest in the table
and the current evidence for it is a noisy sequential read the system itself would
flag as "revert".

## Out of scope
Native (Swift) changes; raw-audio capture; changing what "sane"/"bad lock" mean;
the CI SQL evaluator's own metrics.

## Testing
- Unit: `_tgTrialKnob` parsing (ints, `0p…` decimals, guardmode 0), precedence rules,
  preset gating; Python decision rules on synthetic arm tables (promote / revert /
  too_early / inconclusive), TGTUNE arm parsing, exclusion of tried keys.
- SQL: `experiments_auto_decide()` skips `owner='weekly_review'` (query on a seeded row).
- Path test before ship: `--dry-run` against production logs shows the arm table for a
  seeded running trial; then one real run with `--force` after the client is live.
