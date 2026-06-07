# Mic Measurement Quality — v2 (Adaptive Stop + Quick/Accurate + Error Bar)

**Date:** 2026-06-07
**Status:** Design — approved, pre-spec-review
**Scope:** Track A (JS, ships without an app build). Track B (native detection) is investigation-only this cycle — a separate findings doc, no code.

## Goal

When the `tg_quality_v2` flag is on, a microphone measurement finishes via an **adaptive
stability controller** instead of the native converged / Max-Duration auto-stop: it keeps measuring
until the rate estimate has genuinely stopped moving, then locks and shows an honest **± error bar**.
A **Quick / Accurate** toggle trades speed for a tighter error bar. The displayed/saved rate stays
the **native** number (microphone detection is native-only). Built behind the flag now, designed to
become the default for all mic users once proven.

## Evidence (offline replay of two 15×90s batches, Hamilton 21,600 & JLC 28,800 BPH)

- Early readings are unreliable: stopping at 30s can be **±3.5 s/day off** (Hamilton) to **±14 s/day
  off** (JLC) from the settled value. Settle time is watch-dependent (Hamilton ~50s, JLC ~80s), so a
  fixed duration cannot serve both.
- **Warm-up skip and a robust JS estimator are NOT levers** here: skipping early data slightly
  *worsened* spread, and Theil-Sen ≈ least-squares (the errors are slow transients, not spikes).
- A naive "running-rate flat over a trailing window" plateau test is fooled by **flat spots in a
  still-moving transient** (e.g. JLC run 8 sits at −8.9 around 20–30s, then climbs to +5.1). A fixed
  **min-duration** floor only shifts where this misfires (it forced JLC run 5 to lock at 47s/+13.1).
- The **incremental-stability test** — "has `rate[0,t]` stopped changing as the last `look` seconds
  of data were added?" — gives **zero false-early locks on both watches with no min-duration floor**,
  and self-paces: Hamilton ~51–71s, JLC ~79–85s (eps 0.4–0.6, look 20, hold 5–8). This is the
  settled-test we adopt.

Source data lives in `measurement_batch_runs`; the replay harness is `scripts/msr_offline_sweep.py`.

## Architecture context (as built in v1)

- Native iOS engine streams per-tick samples to `_msrScatterData` (`[{t, d, cd}]`; t seconds, cd
  cumulative deviation ms) and a native rate to `_msrLastRate` (`index.html`).
- The measurement auto-stops in JS at `index.html:22494` — `if (!_micBatchActive && (_msrPhase ===
  'converged' || elapsed >= maxDur)) stopMsrListen(...)`. v2 replaces this finish path **when the
  flag is on**.
- `stopMsrListen` (`index.html:23487`) already computes an `errorBar` from bucket-rate history
  (~`index.html:23706`) and shows the result; v2 feeds the adaptive band into it.
- v1 shipped: `tg_quality_v2` flag, inline `computeRobustRate`, dev readout, `runMicBatch` batch
  harness, `measurement_batch_runs` table. v2 builds on that flag.

## Components

### 1. Settled-test pure function `incrSettle(samples, params)`

New exported pure function in `wrotate_test.js` (unit-tested, mirrored inline in `index.html` with
`_q2*` helpers + `q2_*` localStorage knobs, registered ADAPTED in `tests/mirror-drift.test.js`).

- Input: `samples` = `[{t, cd}]` (the live tick stream), `params = {eps, look, hold, minTicks}`.
- Helper `rate(t0,t1)` = least-squares slope of `cd` vs `t` over `[t0,t1]` × 86.4 (s/day). (LS, not
  Theil-Sen — the evidence shows they are equivalent here and LS is cheaper.)
- Scans `t` from `look + hold` to the last sample time in ~1s steps. At each `t` it checks
  `|rate(0,t) − rate(0,t−look)| ≤ eps`. Counts **consecutive** passes; when the count reaches
  `hold`, returns `{settled:true, t, rate: rate(0,t), band}` where `band` = the max
  `|rate(0,t') − rate(0,t'−look)|` observed over the holding window (the residual uncertainty).
- Returns `{settled:false, t:lastT, rate: rate(0,lastT), band}` if it never holds.
- Returns `{settled:false, rate:null, band:null, nTicks}` when `nTicks < minTicks` (validity floor;
  default low, e.g. 40 — guards against locking on noise, NOT a duration target).
- Deterministic; no `Date`/DOM. The inline copy is numerically identical; only defaults are read
  from `q2_*` localStorage first.

### 2. Mode presets (Quick / Accurate)

Selected by `localStorage.msr_mode` (`'accurate'` default | `'quick'`), each a `params` preset; every
field overridable by a `q2_*` knob so we keep tuning live as more batches arrive:

| Mode | eps | look | hold | cap |
|---|---|---|---|---|
| **Accurate** (default) | 0.4 | 20 | 8 | 90s |
| **Quick** | 0.7 | 15 | 5 | 90s |

(Validated starting values; exact numbers finalized from further batches. Architecture, not the
constants, is what this spec fixes.)

### 3. Adaptive stop controller (live, flag-on only)

In `_tgNativeCallback`, throttled to ~1 Hz (reuse the existing `_q2` throttle), when
`featureFlag('tg_quality_v2')` and measuring:

- Compute `s = incrSettle(_msrScatterData, paramsForMode())`.
- If `s.settled` (and `elapsed ≥ look+hold`) → `stopMsrListen('plateau')`.
- Else if `elapsed ≥ 90` → `stopMsrListen('duration_cap')`.

This **replaces** the native converged / Max-Duration finish when the flag is on: guard the existing
auto-stop block (`index.html:22494`) to skip when `featureFlag('tg_quality_v2')` is on (the 90s cap
subsumes Max-Duration). When the flag is off, behavior is exactly as today. The early **preliminary**
display is untouched in both cases — the controller governs only the final lock.

### 4. Error bar

At stop, `errorBar = max(s.band, floor)` (floor ~0.5 s/day so we never imply false precision).
Display the native rate with it, e.g. `+0.6 ±1.2 s/day`. Feed this into the existing `errorBar`
variable in `stopMsrListen` so the result text and any downstream gating use the adaptive value when
the flag is on. The rate number shown/saved stays `_msrLastRate` (native), with the LS rate from
`incrSettle` as a fallback only if native is null.

### 5. Quick/Accurate toggle (UI)

A small segmented control on the measure screen, shown only when the flag is on (mirrors how the
batch button appears). Writes `localStorage.msr_mode`; default `'accurate'`. No effect when the flag
is off. Designed so that, when v2 later becomes default-for-all, the toggle + error bar simply show
for everyone (remove the flag gate).

### 6. Relationship to v1 pieces

- `computeRobustRate` stays as a cross-check / dev-readout input; it is **not** the headline number.
- The dev readout gains the settled state (`band`, `settled`, mode) for live observation.
- `runMicBatch` is unchanged: it still records full 90s runs (auto-stop disabled during batch) so we
  can keep evaluating settled-test params offline before/while they drive the live stop.

## Out of scope (this cycle)

- Any native Swift change. Track B is a **findings doc only** (`docs/.../v2-native-findings.md`):
  read `TimegrapherEngine.swift` and report the likely causes of ~40% tick acceptance, the early
  AGC/coupling transient, and BPH-lock behavior — no edits, no raw capture, no offline detector sweep
  (microphone detection stays native-only per decision).
- Removing the `tg_quality_v2` flag / shipping to all users (separate later step).
- Amplitude, piezo.

## Testing

- **Unit (`incrSettle`)**: clean synthetic stream → settles, tight band, correct rate; slow-transient
  stream with a mid flat-spot → does NOT settle on the flat spot (the JLC-run-8 case); never-settling
  stream → `settled:false` (controller then hits the 90s cap); below `minTicks` → `rate:null`.
- **Offline confirmation**: `scripts/msr_offline_sweep.py` reproduces zero false-early locks on the
  recorded batches with the chosen presets.
- **E2E mocked**: Quick/Accurate toggle visible only when flag on; hidden/no-op when off.
- Mirror-drift guard for the inline `incrSettle` copy. `npm test && npm run test:e2e` before push.
  Bump SW cache version.

## Success criteria

With the flag on: a measurement locks when the rate has stopped moving (not at a fixed time), shows
an honest ± error bar, and Quick vs Accurate trade speed for band width — reproducing the offline
result of zero false-early locks (Hamilton ~50–70s, JLC ~80–85s) on live runs. Flag-off users see no
change.
