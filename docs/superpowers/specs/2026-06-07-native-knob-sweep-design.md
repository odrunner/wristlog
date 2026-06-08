# Generalized Native-Knob Sweep (B1) — Design

**Date:** 2026-06-07
**Status:** Design — approved, pre-spec-review
**Goal:** Generalize the existing `tickDetectMult` sweep harness so it can sweep ANY already-live-tunable
native knob, and use it to sweep `maxPairThresh` (the adaptive-threshold ceiling that drives mass
PAIR_REJECT on high-beat-error watches) on JLC. No Swift build. This is B1 of the
native phase/beat-error effort; B2 (exposing the hardcoded phase-recovery params in Swift) follows,
informed by B1's data.

## Background

The `tickDetectMult` sweep showed lowering detection admits noise — threshold is not the lever
([[2026-06-07-mic-measurement-quality-v2-native-findings]]). The real JLC problem is the pair/phase
machinery: JLC (beat error ~4ms) logged ~1252 PAIR_REJECT + ~900 PHASE_REJECT in a batch vs ~170/40
on a clean watch. Two lever groups exist:

- **Live-tunable now** (bridge parses + `setTuning` applies): `maxPairThresh`→`maxAdaptiveThreshold`
  (the ~1.5–2.0ms ceiling), `pairMadMult`, `maxTickDevMs`, `coldStartThresh`, plus detection knobs.
- **Hardcoded in Swift** (NOT tunable): the `isMisPhased` bands and phase-recovery hysteresis
  (`TimegrapherEngine.swift:728-731`). `sendMsrTuning` sends `phaseRec*`/`beatErrWindow` but the
  bridge ignores them. → B2.

B1 sweeps the live-tunable pair-ceiling to quantify how much of JLC's variance it explains, before
committing to the B2 Swift change.

## Current harness (what exists)

`runMicSweep` (`index.html`) loops a hardcoded `tickDetectMult` value list, setting
`localStorage.q2_tick_detect_mult` + the hidden input `#msr-tune-tick-detect-mult` per value, running
a full batch each (via `_micRunBatchLoop`), logging `tick_detect_mult` per run, restoring in a
`try/finally`. The start hook `_q2ApplyTdm` re-applies the tickDetectMult override after
`tgApplySettingsToInputs` so it survives measurement start. `tgApplySettingsToInputs` only sets
calibMultiplier/noiseFloorMult/outlierMargin/stabThresh/maxRecalibrations — NOT maxPairThresh or
tickDetectMult.

## Components (all flag-gated on `tg_quality_v2`)

1. **DB:** add `sweep_param` (text) + `sweep_value` (numeric) to `measurement_batch_runs`. Each run
   records the swept knob + value, so any knob's sweep is cleanly analyzable. (`tick_detect_mult`
   column stays, recording the active detection threshold for context.)

2. **Knob registry (pure, unit-tested):** `resolveSweepKnob(name)` maps a friendly knob name to its
   hidden `msr-tune-*` input id, or null if unknown. Supported initially:
   `tickDetectMult→msr-tune-tick-detect-mult`, `maxPairThresh→msr-tune-max-pair-thresh`,
   `pairMadMult→msr-tune-pair-mad-mult`, `maxTickDevMs→msr-tune-max-tick-dev`,
   `coldStartThresh→msr-tune-cold-start`, `calibMultiplier→msr-tune-calib-multiplier`,
   `noiseFloorMult→msr-tune-noise-floor-mult`. Plus `parseSweepValues(str)` (pure) → array of
   positive finite numbers from a comma list. Both live in `wrotate_test.js` (tested) + inline mirror
   in `index.html` (mirror-drift).

3. **Generalize `runMicSweep`:** read config from localStorage —
   `q2_sweep_knob` (default `tickDetectMult`, preserving current behavior),
   `q2_sweep_values` (default `0.3,0.25,0.2,0.15`), `q2_sweep_runs` (12), `q2_sweep_secs` (90).
   Resolve the knob to its input id (abort with a toast if unknown). For each value: set an
   "active sweep" marker `localStorage.q2_sweep_active` = `{knob, inputId, value}` (JSON), set the
   hidden input, `sendMsrTuning()`; run a batch via `_micRunBatchLoop`, logging `sweep_param`=knob and
   `sweep_value`=value on each run. On finish/cancel/throw, a `try/finally` clears `q2_sweep_active`
   and restores prior knob state.

4. **Generalize the start hook:** rename/extend `_q2ApplyTdm` → `_q2ApplyOverrides`, called in the
   measurement-start path after `tgApplySettingsToInputs`. It applies (a) the existing tickDetectMult
   override (`q2_tick_detect_mult`) AND (b) the active sweep knob from `q2_sweep_active` (set its input
   to the active value). This guarantees a swept value survives the settings-apply for ANY knob —
   including calibMultiplier/noiseFloorMult which `tgApplySettingsToInputs` does set.

5. **First experiment (operating procedure):** `q2_sweep_knob=maxPairThresh`,
   `q2_sweep_values=1.5,2.5,3.5,4.5`, on JLC, fixed position, Weishi noted. Hit Mic Sweep once.
   Measure per value: PAIR_REJECT / PHASE_REJECT counts (logs), detection%, rate SD, accuracy.

## What we expect to learn

Whether raising the pair-ceiling cuts JLC's PAIR_REJECT and tightens SD (→ maybe a new native
default), and how much PHASE_REJECT remains untouched (→ scope/justify the B2 Swift change). Raising
the ceiling could also *admit* bad pairs and worsen SD — the measurement decides.

## Out of scope

- B2: Swift change to expose phase-recovery bands/hysteresis/on-off + beat-error window for sweeping.
- Changing any native default (that comes after a sweep identifies a winner).
- Non-mic paths; piezo.

## Testing

- Unit: `resolveSweepKnob` (known→id, unknown→null) and `parseSweepValues` (commas, junk rejected,
  empties). Mirror-drift for the inline copies.
- E2E mocked: sweep button still flag-gated; default `q2_sweep_knob` unset → behaves as the
  tickDetectMult sweep (no behavior change for the existing path).
- DB: round-trip the two new columns.
- `npm test && npm run test:e2e` before push; bump SW.

## Success criteria

One press runs a full `maxPairThresh` sweep on JLC, each run tagged with `sweep_param=maxPairThresh`
and its `sweep_value`, and we can query per-value PAIR/PHASE rejects + SD to decide whether the
pair-ceiling is a lever and what B2 must address.
