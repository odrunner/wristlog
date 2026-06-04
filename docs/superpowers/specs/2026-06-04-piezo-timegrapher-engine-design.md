# Piezo Timegrapher Engine — Design

Date: 2026-06-04
Status: Approved design (pre-implementation)

## Problem

WRotate's timegrapher was built for the device's built-in microphone, which hears
the watch's **airborne** tick — a high-frequency, sharp click buried in room noise.
The existing `TimegrapherEngine` is tuned for that: three parallel 4/6/8 kHz high-pass
filters, a Goertzel energy ring, and pair-based regression to dig faint ticks out of
noise.

A **contact piezo pickup** (e.g. caralei piezo → M-Audio M-Track Solo → device over
USB) produces a fundamentally different signal: clean, strong, impulsive, and
**lower-frequency** than the airborne tick. Forcing it through the mic algorithm
fails — the 4–8 kHz high-pass filters discard most of the piezo's tick energy, so it
needs excessive gain and still barely detects.

This session proved (with on-device `[TGDIAG]` logs vs. a Weishi No. 1900 reference):
the iOS capture path works, the signal lands cleanly on a channel at healthy level
once gain/coupling are right, but the mic DSP is the wrong tool for it.

## Goal

A **separate, piezo-only algorithm** that the user selects via an input-source picker
(Mic / Piezo), iterated independently of the mic path, producing **parity outputs**:
rate (s/day), beat error (ms), real-time per-beat scatter, and BPH — converging to a
stable rate within ~20–30 s that matches the Weishi reference (~±3 s/day).

## Decisions (from brainstorming)

1. **Fully separate engine** — new `PiezoEngine.swift`; the mic engine is not coupled to it.
2. **Parity outputs**, reusing the existing scatter/rate/beat-error UI.
3. **BPH** mirrors the mic dropdown: "Auto-detect" → infer BPH; otherwise use the selected value.
4. **Gated behind an admin feature flag** (`tg_piezo`) during development; current users see the unchanged mic-only measurement.
5. **DSP = Approach A** — direct time-domain beat detection.
6. **Capture code**: copy the validated capture/session code into `PiezoEngine`; **strip the now-dormant external-input code from `TimegrapherEngine`**, returning the mic engine to its original built-in-mic-only form.

## Architecture

```
JS measure UI ──start{source:'mic'|'piezo', bph, …}──► TimegrapherBridge
                                                          │  route by `source`
                                              ┌───────────┴───────────┐
                                              ▼                       ▼
                                        PiezoEngine            TimegrapherEngine
                                        (new)                  (existing, reverted to
                                              │                 built-in mic only)
                                              └────── Update ────┴──► sendToJS
                                                       │
                                                       ▼
                              existing _tgNativeCallback → scatter / rate / beat-error / BPH UI
```

- **`PiezoEngine` owns**: its `AVAudioSession` config, audio capture, DSP, calibration, and its own tunable parameters.
- **`TimegrapherBridge`** gains a second engine instance and routes `start`/`stop`/tuning to the one named by the `source` field. Default / absent `source` → mic engine (unchanged).
- Both engines emit the **same Update payload contract** (the keys the bridge already serializes: `rate`, `beatError`, `tickCount`, `confidence`, `noiseLevel`, `detectedBph`, `newTicks` [scatter dots], `elapsedSec`, `rateStable`, `method`, `debugMessages`). The JS UI is unchanged.

## PiezoEngine DSP (Approach A — direct beat detection)

Per-buffer pipeline on the captured channel:

1. **Channel pick** — peak-based selection of the loudest channel (a tick is impulsive; RMS picks the steady-hiss channel). Per-channel raw RMS/peak logged as `[PZ]` for diagnostics.
2. **Band-pass** — single biquad band-pass (default ~150 Hz–~5 kHz, both edges tunable). Removes <150 Hz handling rumble/mains and >5 kHz hiss; keeps the piezo tick band.
3. **Envelope** — full-wave rectify + short smoothing (tunable time constant).
4. **Beat detection** — adaptive threshold (tracks recent peak, decays toward a calibrated noise floor) + refractory window (min spacing = fraction of expected interval). Sub-sample parabolic interpolation of each peak for precise beat time.
5. **BPH model**
   - Selected BPH → expected interval = ringRate / (bph/3600).
   - Auto-detect → lock BPH first via interval histogram / envelope autocorrelation over the candidate set [18000, 21600, 25200, 28800, 36000], then proceed.
6. **Outputs**
   - **Beat error**: tick/tock alternation (|even−odd| beat offset).
   - **Rate**: Theil-Sen regression of cumulative interval deviation vs. expected → s/day, with outlier rejection for handling bumps.
   - **Stability**: rate stays within a window for N seconds → `rateStable`.
   - **Scatter**: every accepted beat → a `newTicks` dot in real time.

All thresholds/edges/windows are **PiezoEngine-specific tunables**, independent of the mic engine.

## Web (behind `tg_piezo` admin flag)

- Register `tg_piezo` in `FEATURE_FLAGS` (admin-only toggle via the existing dev-flags panel).
- When on, show an **input-source selector (Mic / Piezo)** near the BPH dropdown, persisted in `localStorage`. Off → mic-only, current behavior unchanged.
- "Piezo" selected → `start` message includes `source:'piezo'` plus piezo input params; "Mic" (or flag off) → unchanged `start`.
- Separate **piezo tuning** message + admin knobs (band low/high, envelope smoothing, threshold mult, refractory fraction, regression min-N, stability window, outlier margin, auto-BPH candidates) so the algorithm can be iterated live without rebuilds where possible.
- Reuse the existing scatter plot and rate/beat-error/BPH display unchanged.

## Capture code & mic-engine cleanup

- `PiezoEngine` gets a clean copy of the validated capture code: `.default` session mode, explicit `setPreferredInput` to `.usbAudio`/`.lineIn`/`.headsetMic`/any non-built-in input, `routeChangeNotification` observer with safe restart, peak-based channel pick, `setInputGain(1.0)` when settable, and `[PZ]` per-channel raw diagnostics.
- **Strip** the external-input additions from `TimegrapherEngine` (the `externalInputMode`/`autoPickChannel`/`hpLow`/route-observer/`.default`-branch/input-gain/diagnostic code added this session), returning it to its original built-in-mic-only form (`.measurement` mode, channel 0, 4/6/8 kHz HP). The bridge stops sending `inputMode`/`autoPickChannel`/`hpLow` to it.

## Testing & rollout

- **JS**: unit + mocked-e2e cover the selector and `start` plumbing; verify the default-off path is byte-unchanged for non-admin users. Bump SW cache version.
- **Swift**: no Swift unit harness in-repo; validate on-device via `[PZ]` debug logs written to `timegrapher_tick_logs`, cross-checked against the Weishi reference (same diagnostic pipeline used this session). iOS builds happen on the MacBook Pro (no `xcodebuild` on the Mac Mini).
- **Rollout**: iterate behind `tg_piezo`; flip on for everyone once the piezo path matches the reference. The mic path and all current users are unaffected throughout.

## Out of scope (for now)

- Amplitude / lift-angle estimation (full Witschi-style readout).
- Matched-filter (template) timing — possible later refinement if Approach A's precision is insufficient.
- Auto-switching between mic and piezo (selection is explicit).
