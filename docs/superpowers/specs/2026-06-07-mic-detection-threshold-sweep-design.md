# Mic Detection-Threshold Sweep (`tickDetectMult`) — Design

**Date:** 2026-06-07
**Status:** Design — approved, pre-spec-review
**Goal:** Increase microphone measurement *accuracy* by recovering beats lost at the energy-detection
threshold. This spec delivers the **fastest path to the data** that tells us how far to push the
threshold — a flag-gated way to sweep `tickDetectMult` live and measure detection% + repeatability.
The north star is accuracy by any means; this is step 1, and **native Swift changes are explicitly on
the table** as the sweep data warrants (see "Where this leads").

## Why this, why now

Measured silent detection loss (from native `tickCount` vs physical beats): **Hamilton ~12%, JLC
~27%** of beats never detected — worse early (JLC 61% detected at 10s → 73% by end). Fewer ticks →
higher variance → the run-to-run wander we see on JLC. The detection threshold is conservative:
`tickDetectMult = 0.3` × `calibMultiplier 1.2` × `noiseFloorMult 2.0` (`TimegrapherEngine.swift`).
Loosening `tickDetectMult` should recover beats; the risk is false detections (noise as ticks), which
must be checked against repeatability, not assumed. Hence: sweep + measure, don't guess.

## Key enabler (already built)

`tickDetectMult` is **already live-tunable end to end**: `sendMsrTuning()`
(`index.html:23455`) reads hidden input `#msr-tune-tick-detect-mult` (default 0.3) and posts it as
`action:'tuning'`; the Swift bridge routes it to `TimegrapherEngine.setTuning()`, which assigns the
mutable `var tickDetectMult` live. This path already runs on every measurement. We only need to make
the *value* settable for a sweep — and confirm the installed build honors a *changed* value.

## Components (all gated on `tg_quality_v2`; flag-off behavior unchanged)

1. **DB:** add nullable column `tick_detect_mult double precision` to the existing
   `timegrapher_tuning` table (single row, `id=1`, already polled every 3s by `startTuningPoll`).

2. **Table-driven sweep (operator drives via SQL).** In `startTuningPoll`
   (`index.html:~22077`), when `featureFlag('tg_quality_v2')` is on and `data.tick_detect_mult` is
   non-null, write it into the hidden input `#msr-tune-tick-detect-mult` before the existing
   `sendMsrTuning()` call — UNLESS a local override is set (see #3). Updating the row (with a bumped
   `updated_at`, since the poll dedupes on that timestamp) propagates to a flag-on device within ~3s,
   live. Gating on the flag means production users are never affected even though they poll the table.

3. **On-phone override (user sets).** A small visible number input on the measure screen, shown only
   when the flag is on (mirrors how the batch button/mode toggle appear). On change it writes the
   hidden input, persists to `localStorage.q2_tick_detect_mult`, and re-sends tuning. On measurement
   start, a persisted override is applied to the hidden input. **Local override wins over the table
   value** so the user's phone setting isn't stomped by the operator poll; clearing the input removes
   the override and returns control to the table/default.

4. **Dev readout.** Append `tdm=<value>` (the active `tickDetectMult`) to the existing
   `[mode] native … | js … · band … · n…` line so the applied threshold is always visible during a
   run.

## Rollout — verification FIRST

Before trusting any sweep result, confirm the installed iOS build applies a *changed*
`tickDetectMult` live:
- Set `tick_detect_mult = 0.6` (deliberately high → should *reduce* detection), run a short
  measurement, and check detection% drops (via `TGDEBUG tickCount` / readout `n`).
- If it moves → plumbing confirmed; proceed to the sweep.
- If it does NOT move → the installed build predates the live-tuning support → **escalate to a
  TestFlight build** (separate spec) before sweeping.

## Sweep & measurement (operating procedure, not code)

One `tickDetectMult` value per batch, holding watch/position fixed: e.g. **0.30 → 0.25 → 0.20 →
0.15**. After each batch, measure with existing tooling:
- **detection%** = native `tickCount` / physical beats (from `TGDEBUG`),
- **repeatability** = cross-run SD/range of rate (`measurement_batch_runs`),
- **accuracy** = mean vs Weishi.
Pick the lowest threshold that raises detection% and tightens SD *without* false-detection damage
(SD or beat-error worsening). Run on both a clean (Hamilton) and noisy (JLC) watch.

## Where this leads (accuracy is the goal — not the knob)

The sweep is diagnostic. Depending on what it shows, the next step may be a **native Swift change**,
and that is in scope for the broader effort (just not this spec):
- If a fixed lower `tickDetectMult` clearly helps → bake the new default into `TimegrapherEngine`
  (Swift) and ship.
- If detection needs to *adapt* (e.g. lower threshold during warm-up, or scale with SNR/beat error)
  → a native detection change, designed from the sweep data.
- If the threshold isn't the lever (false detects dominate) → pivot to step B (native instrumentation
  of the peak-energy distribution) to set it from first principles, and/or the beat-error-aware
  pairing work.

This spec deliberately avoids a premature Swift change: we get the data cheaply (JS, no build) first,
then change Swift with evidence.

## Testing

- Unit: the local-override precedence helper (override wins over table; cleared override falls back) —
  a small pure function, unit-tested.
- E2E mocked: the on-phone input is visible only when the flag is on; hidden/no-op when off.
- DB: round-trip the new column (set via SQL, read back).
- `npm test && npm run test:e2e` before push; bump SW cache version.

## Out of scope

- Swift changes in *this* spec (the plumbing already exists; changes come after the sweep data).
- Knobs other than `tickDetectMult` (single-variable sweep first).
- Removing the `tg_quality_v2` flag / production rollout of any new default.
