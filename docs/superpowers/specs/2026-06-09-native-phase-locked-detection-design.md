# Native Phase-Locked Peak Detection — Design

**Date:** 2026-06-09
**Status:** Design — approved, pre-spec-review
**Project:** Native (Swift) detector fix for twin-peak watches (the B2 outcome). Built by the user via
TestFlight; Claude writes the Swift + the JS A/B plumbing.

## Goal

Fix the class of watches (e.g. Kurono Tokyo Inseki) whose tick is a **double click** — two acoustic
peaks ~3.5ms apart of near-equal amplitude — on which the current "fire at the energy peak" detector
**flips between the twins beat-to-beat**, fabricating beat error (app showed 3.2ms; Weishi truth
0.2ms) and corrupting the rate (app +4.6; Weishi +9/+10). Fix = **phase-locked peak selection**: once
locked, choose the candidate peak **closest to the predicted tick time**, not the loudest.

## Background (evidence + history)

- **Root cause (waveform-verified):** every Kurono tick has 2 peaks ~3.5ms apart; median 2nd/main
  amplitude 0.79, 45% within 0.8×. Near-equal → amplitude jitter flips the pick → ±3.5–5ms tick jitter.
  See [[2026-06-07-mic-measurement-quality-v2-native-findings]] Update 3.
- **Full circle (git):** the detector originally fired on the **rising edge** (phase-consistent but
  threshold-dependent — fired ~16.7ms early at low thresholds, commit `97229ce`'s problem). `97229ce`
  switched to **peak detection** (threshold-independent) — which is the amplitude pick that flips on
  twins. Neither pure approach is right; phase-locked selection keeps `97229ce`'s threshold-
  independence AND adds phase-consistency.
- **Fix validated offline** on `kurono1.m4a` (prototype): amplitude-pick → interval std 20.75ms, beat
  error 2.86ms; phase-locked → std 0.74ms, beat error 0.01ms (matches Weishi 0.2). Absolute rate from
  the recording is unreliable (voice-memo clock); beat error + interval-cleanup are clock-immune, and
  the live device clock already gives accurate rate on clean watches — so phase-lock fixes the live
  Kurono rate too (its error was the flipping).

## Design

### Native: phase-locked selection in `TimegrapherEngine` (the detector fire path)

Current fire logic (`TimegrapherEngine.swift` ~571-589): after `ringPosSinceLastTick ≥ minSpacing`,
track the pending energy peak and fire when energy declines (the 97229ce peak-detect). New behavior,
active ONLY when `phaseLock` is on AND locked (`lastTickRingPos ≥ 0`, `expectedTickInterval > 0`):

1. **Acceptance window** around the predicted next tick, in `ringPosSinceLastTick`:
   `[expectedTickInterval·(1−W), expectedTickInterval·(1+W)]`, `W = phaseLockWindow` (default 0.4).
   Re-anchored to each detected tick (so it tracks the watch's true rate; per-beat prediction error is
   ~0.01ms, negligible vs the 3.5ms twin gap).
2. **Candidate tracking:** each energy crest (same peak-detect as today — keeps threshold-
   independence) that occurs inside the window is a candidate. Keep the one whose interval is
   **closest to `expectedTickInterval`** (smallest `|interval − expectedTickInterval|`).
3. **Fire** the best candidate when the window closes
   (`ringPosSinceLastTick > expectedTickInterval·(1+W)`), using that candidate's recorded interval —
   ignoring the louder twin a few ms away.
4. **Miss handling:** no candidate in the window → no tick this beat; the window reopens at the next
   predicted beat (self-heals). After `phaseLockMaxMiss` (default 3) consecutive misses, drop lock and
   fall back to the current acquisition detector.

**Safety:**
- **Acquisition unchanged** — before lock, the current peak detector runs (lock still acquires).
- **No-op on clean single-peak watches** — one candidate in the window = the same tick as today, so
  Hamilton/Tudor/JLC are unaffected.
- **Keeps 97229ce** — candidates are energy crests, not rising edges (no threshold-timing bias).
- Adds modest latency (≤ `W·interval` ≈ 50ms) to each tick's *processing*; the recorded tick *time*
  is exact (the candidate's interval). Irrelevant for a timegrapher.

New engine state: `pl_bestInterval`, `pl_bestDist`, `pl_haveCandidate`, `pl_missCount` (reset in the
same places as `pendingTickCross`). New tunable vars: `phaseLockEnabled: Bool = false`,
`phaseLockWindow: Double = 0.4`, `phaseLockMaxMiss: Int = 3`.

### Plumbing: A/B without rebuilds (mirror the `tickDetectMult` path)

So we can A/B on-device after one build:
- **Bridge** (`TimegrapherBridge.swift`, `case "tuning"`): parse `phaseLock` (Bool/number),
  `phaseLockWindow` (Double), `phaseLockMaxMiss` (Int); pass to `engine.setTuning(...)`.
- **Engine `setTuning`:** apply the three (and echo in the `[TGTUNE]` log).
- **JS `sendMsrTuning`:** send the three from hidden inputs `#msr-tune-phase-lock` (default "0"),
  `#msr-tune-phase-lock-window` ("0.4"), `#msr-tune-phase-lock-max-miss` ("3").
- **Remote A/B:** add `phase_lock` (+ optional `phase_lock_window`) columns to `timegrapher_tuning`;
  the existing tuning poll writes them into the hidden inputs when `featureFlag('tg_quality_v2')` is on
  (mirrors how `tick_detect_mult` is driven). Then the operator flips phase-lock on/off via SQL and the
  user just measures. Default OFF → the build behaves exactly like today until enabled.

## Validation

No native unit tests exist in this repo; validation is empirical + the offline prototype:
- Keep the offline prototype as `scripts/twinpeak_prototype.py` (reads a WAV; reports amplitude-pick
  vs phase-locked interval-std + beat error) — the reproducible design check.
- On-device after TestFlight: re-batch the **Kurono** with `phase_lock` OFF (baseline: BE ~3ms, SD
  ~2.7) then ON (expect **BE → ~0.2ms, SD collapse, rate → ~+9.5**), via the table A/B. Confirm
  **Hamilton/Tudor/JLC unchanged** with it on (no regression on single-peak watches). Compare to
  Weishi for each.

## Out of scope

- Amplitude (still not measured); piezo.
- The earlier "expose phase-recovery params (isMisPhased bands/hysteresis)" idea — **superseded** for
  this failure class (the phase-recovery machinery was reacting to detector garbage; fixing detection
  removes the cause). Parked, not deleted.
- Parked Direction A (sweep `tickDetectMult` up on a clean watch) — unrelated, still parked.

## Success criteria

A TestFlight build where, with `phase_lock` enabled, the Kurono reads **beat error ~0.2ms and rate
~+9.5 (matching Weishi) with tight run-to-run SD**, while Hamilton/Tudor/JLC are unchanged — proving
phase-locked selection fixes twin-peak watches without regressing single-peak ones. Then `phase_lock`
becomes the default.
