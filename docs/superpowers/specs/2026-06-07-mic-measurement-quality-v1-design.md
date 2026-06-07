# Mic Measurement Quality — v1 (JS Experimentation Layer)

**Date:** 2026-06-07
**Status:** Design — awaiting approval
**Scope:** v1 only (JS, ships without an app build). Native instrumentation is a follow-up spec.

## Goal

Make WRotate's microphone measurement **repeatable**: the same watch, measured repeatedly in the
same position, should produce final ratings within **≤ ±5 s/day** of each other. Keep showing the
existing early "preliminary" reading to users; only the *final* reading and the rules for when it
locks are under investigation. This project is exploratory — its first job is to build the
instrumentation and gather the data that tells us what to change.

## Evidence (last 14 days, 91 measurements, 43 watches, 24 users — all mic/`auto`)

- **Repeatability is poor.** Watch `f11bcdf0` produced **−77.7** then **−46.4 s/day** on two runs
  **23 seconds apart** (same watch, same BPH) — a 31 s/day swing that is pure measurement error.
  Across watches measured 3+ times, per-watch rate standard deviation ranged **2.0 → 29.4 s/day**.
- **We don't gate on stability.** Saved `tick_data` averages **34 ticks**, max **131** (~16s). The
  issue is not duration per se — a short capture with low, consistent deviation is a perfectly good
  reading. The issue is that we save whatever the user happens to stop on, with **no check that the
  rate has actually settled**. A clean signal should be allowed to converge quickly; only a noisy or
  unstable one should need more time. The fix is convergence-on-stability, not a minimum duration.
- **No quality signal is stored.** `duration_seconds`, `tick_count`, and amplitude are **NULL on all
  91 rows**. We cannot distinguish a clean 60s reading from a noisy 5s one after the fact.
- **Worst cases correlate with 21600 BPH**, consistent with wrong-BPH / harmonic detection locks.

**Confound to respect:** a watch's rate genuinely changes by position (10–20 s/day dial-up vs
crown-down). The batch tool holds position fixed across runs, isolating *measurement* repeatability
from *real* positional variance.

## Architecture context (as built)

- Measurement DSP (tick detection, native rate/beat-error) runs in **native iOS Swift**
  (`ios/Wrotate/Wrotate/TimegrapherEngine.swift`). The web app is the display + orchestration layer.
- The native engine emits ~5 Hz update callbacks to `window._tgNativeCallback` (`index.html:22056`),
  each carrying `rate`, `beatError`, `tickCount`, `confidence`, and **`newTicks`** (every tick since
  the last update, as `{t: timeSec, d: cumulativeDeviationMs}`).
- JS already accumulates the **full live tick stream** in `_msrScatterData` via `addMsrTickDots`
  (`index.html:22867`), one entry per tick: `{t, d: individualDev, cd: cumulativeDev}`. Capped at
  2000 entries — a 90s run (~720 ticks @ 28800 BPH) never hits the cap, so it is full-resolution.
- **This is the key enabler:** v1 can compute an alternative *final* rate in JS from the same tick
  stream the native preliminary uses, and log that stream at full resolution — with no app build.
- Feature flags: `FEATURE_FLAGS` object (`index.html:4836`), `featureFlag()`/`setFeatureFlag()`
  (`index.html:4843`), auto-rendered as admin toggles by `renderDevFlags()` (`index.html:12244`).
  Admin gating: `ADMIN_USER_ID` (`index.html:4834`). Adding a key to `FEATURE_FLAGS` is all that's
  needed for the admin toggle to appear.
- Existing precedent to mirror: piezo `runPiezoBatch()` (`index.html:21767`), button `#pz-batch-btn`
  (`index.html:3436`), shown by `initPzTunePanel()` (`index.html:21800`).

## What v1 explicitly does NOT do

- No native Swift changes. No raw mic audio capture. No native live-tuning. (→ follow-up spec.)
- No amplitude (out of scope entirely for now).
- No piezo changes — piezo is owned separately and must not be touched.
- No change to anything a non-flag (normal) user sees.

---

## v1 Components

### 1. Feature flag `tg_quality_v2`

Add to `FEATURE_FLAGS` (`index.html:4836`):

```js
tg_quality_v2: { label: 'Timegrapher: measurement quality v2 (admin)', default: false },
```

Default off; the admin toggle appears automatically via `renderDevFlags()`. All v1 behavior gates on
`featureFlag('tg_quality_v2')`.

### 2. Robust JS final-rate estimator

New pure function `computeRobustRate(ticks, bph, opts)` in `wrotate_test.js` (alongside
`computeTgResults`, exported for unit tests). Input: the `_msrScatterData` array
(`[{t, d, cd}]`). Pipeline:

1. **Outlier rejection** — compute MAD of per-tick individual deviation `d`; drop ticks beyond
   `madMult × MAD` (default `madMult = 4`).
2. **Robust slope** — Theil-Sen regression of cumulative deviation `cd` (ms) vs time `t` (s):
   median of pairwise slopes `(cd_j − cd_i)/(t_j − t_i)`. Rate (s/day) = `slope × 86.4`.
3. **Sub-window agreement** — compute the same slope over the full window and over the last 50% of
   the window; `subWindowDelta = |rate_full − rate_lastHalf|` (s/day). A small delta means the rate
   has settled.
4. **Residual spread** — `residualSd` = std dev of `cd` residuals around the Theil-Sen fit (ms).
5. **BPH/harmonic sanity** — heuristic flag `bphSuspect = true` when `|rate|` is implausibly large
   (default `> 60 s/day`) together with high `residualSd`. v1 only *flags* it; correction strategy
   is decided from collected data.
6. **Quality score** — a 0–1 score (and a coarse label `solid|fair|weak`) driven primarily by
   **stability** (`subWindowDelta`) and **fit tightness** (`residualSd`), not by duration. `nTicks`
   matters only as a floor for statistical validity (enough points to compute robust stats), not as
   "more is better" — a clean 130-tick reading must be able to score `solid`. Exact weighting is a
   tunable we refine from batch data; v1 ships a documented first formula.

Returns: `{ rate, quality, label, nTicks, durationSec, residualSd, subWindowDelta, bphSuspect }`.

All thresholds (`madMult`, sub-window fraction, convergence gates, quality weights, suspect cutoff)
read from `localStorage` keys (e.g. `q2_mad_mult`) with documented defaults, so they can be tuned
live without code edits — mirroring the piezo `pz_*` live-knob pattern.

### 3. Adaptive convergence (JS-side) — stability-driven, not time-driven

Convergence is declared when the rate has **stabilized**, however long that takes — fast for a clean
signal, longer for a noisy one. The flag-on *final* is treated as "converged" when:

- `subWindowDelta ≤ q2_converge_sday` (default 3 s/day) — the rate is no longer moving, **and**
- `residualSd ≤ q2_max_residual_ms` (default tuned from data) — the fit is tight, **and**
- `nTicks ≥ q2_min_ticks` — a small **statistical-validity floor only** (default low, e.g. 60), not a
  duration target. This exists so we never converge on 5 ticks of noise, not to force long sessions.

There is deliberately **no minimum-duration gate**. A watch that settles in 15s converges in 15s.
Until stability is reached the result is labelled "refining". The existing native preliminary keeps
displaying unchanged throughout — we layer a stability check on the *final*, we do not extend time
for its own sake. All thresholds are live-tunable localStorage knobs, refined from batch data.

### 4. Dev display (flag on only)

In `_tgNativeCallback`, when the flag is on, show **native rate vs JS rate + quality label** side by
side in the measurement card (dev-only styling, like other `_isDevUser()` dev readouts). Lets us
eyeball divergence in real time. No change when the flag is off.

### 5. Batch harness `runMicBatch()`

Admin button mirroring `runPiezoBatch()`:

- Button `#mic-batch-btn`, hidden by default, shown only when `featureFlag('tg_quality_v2')` is on
  (wire visibility into the existing timegrapher init path next to `initTgSourceSelector()`).
- On click: validate native app present and a BPH is selected. Optional free-text **position label**
  (default blank) passed through for offline analysis.
- Runs **15 × 90s** at the watch's selected BPH, same position, with stop/reset gaps between runs
  (reuse the piezo cadence constants, run length = 90000 ms). Button text shows `run i/15`.
  Cancellable by re-click (`_micBatchActive` flag).
- After each run, capture: native rate/beat-error (from the last converged callback), the JS
  `computeRobustRate` result, the **full tick stream** (`_msrScatterData` snapshot), `n_ticks`,
  `duration_sec`, and quality fields. Write one row per run to `measurement_batch_runs`.
- No in-app results UI — analysis is done by querying the table. Toast on completion.

### 6. Storage: `measurement_batch_runs` table

Created via `supabase db query --linked` (migration-push doesn't work on this project). Columns:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | default gen_random_uuid() |
| `batch_id` | uuid | one per `runMicBatch()` invocation |
| `run_idx` | int | 0–14 |
| `user_id` | uuid | admin |
| `watch_id` | text | matches `timegrapher_results.watch_id` type |
| `position` | text | optional label entered at batch start |
| `bph` | int | |
| `native_rate` | numeric | native engine final rate (s/day) |
| `native_beat_error` | numeric | |
| `js_rate` | numeric | `computeRobustRate` rate |
| `js_quality` | numeric | 0–1 |
| `js_label` | text | solid/fair/weak |
| `n_ticks` | int | |
| `duration_sec` | numeric | |
| `residual_sd` | numeric | ms |
| `sub_window_delta` | numeric | s/day |
| `bph_suspect` | boolean | |
| `tick_stream` | jsonb | full `_msrScatterData` snapshot |
| `created_at` | timestamptz | default now() |

RLS: admin-only insert/select (SECURITY DEFINER RPC or a policy keyed to `ADMIN_USER_ID`),
consistent with how other admin/test tables are gated. Internal-only data; never written for normal
users (only on flag-on batch runs).

### 7. Offline analysis (lightweight, v1)

No new harness in v1. Because the full tick stream is logged, we iterate the *estimation/convergence*
parameters offline with ad-hoc SQL/Python against `measurement_batch_runs.tick_stream`, ranking
candidate parameter sets by **cross-run rate SD** (the ≤±5 s/day goal metric). The full replay
harness (and *detection*-level iteration, which needs raw audio) is the follow-up spec.

---

## Testing

- **Unit tests** (`wrotate_test.js`) for `computeRobustRate`:
  - clean synthetic stream → correct rate, `label=solid`, low `residualSd`;
  - **clean but short stream (above the validity floor)** → converges `solid` (duration must not
    penalize a stable reading);
  - noisy stream with injected outliers → outliers rejected, rate within tolerance;
  - unstable stream (rate still drifting, high `subWindowDelta`) → does not converge (refining);
  - below the validity floor (too few ticks) → does not converge;
  - wrong-BPH-style stream (large slope + high residual) → `bphSuspect=true`.
- **E2E mocked** — verify the batch button is hidden without the flag and visible with it; verify the
  dev display renders both rates when flag on. (No real measurement in mocked E2E.)
- Run `npm test && npm run test:e2e` before any push (per CLAUDE.md).
- Bump SW cache version (`sw.js` → `wristlog-vNN`) for the HTML/JS change.
- Table creation verified with a round-trip insert/select under simulated admin JWT.

## Success criteria for v1 (instrumentation, not the algorithm)

v1 is "done" when we can: toggle `tg_quality_v2`, run a 15×90s batch on a real watch, and query
`measurement_batch_runs` to see native rate, JS rate, quality, and the full tick stream for all 15
runs — with per-run rate SD computable in SQL. Hitting ≤±5 s/day is the *investigation's* goal,
pursued by iterating on top of this rig (and the follow-up native spec).

## Follow-up spec (not v1)

1. Native raw mic audio capture → `mic_raw_captures` (admin/test only), mirroring piezo's
   `exportRawCapture()`.
2. Native live-tuning channel (`tuningMic` → `setTuning()`) for detection knobs.
3. `scripts/msr_offline_sweep.py` — full pipeline replay (detection + estimation) over raw captures,
   ranked by cross-run SD; requires porting the Swift detector to Python (as the piezo sweep did).
4. Decision point: where the final rate is computed (native vs JS) and the shipped convergence
   policy — driven by v1 + raw-capture data.
