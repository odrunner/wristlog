# Native Mic Detection — Findings (Track B, investigation only)

**Date:** 2026-06-07
**Status:** Findings doc — NO code changes. Input for a future native decision.
**Source:** Read of `ios/Wrotate/Wrotate/TimegrapherEngine.swift`; cross-referenced with the
Hamilton (21,600) and JLC (28,800) batch data in `measurement_batch_runs`.

## Why this exists

Two data observations need a native explanation before anyone touches Swift:
1. **~40% tick acceptance** — a 90s run at 21,600 BPH should see ~540 beats; the recorded streams
   held ~190–243 ticks. Most beats are being rejected somewhere in the pipeline.
2. **Slow early transient** — the from-start rate estimate drifts for ~20–80s before settling
   (Hamilton ~50s, JLC ~80s; JLC's first 10–20s readings were off by 10–20 s/day).

The v2 JS work (adaptive stop + error bar) *manages* the transient on the display side. This doc is
about the *native* causes — the deeper accuracy lever.

## Correction to an earlier assumption

The early transient is **not AGC**. The engine sets `AVAudioSession` `.measurement` mode
(`TimegrapherEngine.swift:420-425`), which disables iOS automatic gain control. Rule AGC out; the
transient comes from threshold/gate settling and regression warm-up (below).

## Finding 1 — Tick acceptance is a cascade of conservative gates

A detected peak must survive, in order: energy threshold → min-spacing → outlier-interval →
per-tick deviation → pair-phase → adaptive-pair-threshold → regression-skip. Each is individually
reasonable; stacked, they explain heavy loss. The two tightest:

- **Adaptive pair threshold (prime suspect)** — `currentPairThreshold()`
  (`TimegrapherEngine.swift:175-183`) is clamped to **[1.0, 2.0] ms** (`minAdaptiveThreshold=1.0`,
  `maxAdaptiveThreshold=2.0`, `adaptiveMultiplier=3.0`). A pair whose deviation exceeds the threshold
  is rejected (`:770-838`). For a watch with real beat error or jitter, a **2.0 ms ceiling is tight**
  — many legitimate pairs can exceed it, and the ceiling prevents the adaptive gate from ever
  widening. This is the most likely single cause of the ~40% rate.
- **Outlier-interval gate** — `outlierMargin=0.15`, `outlierMarginLowBph=0.20` for ≤21,600
  (`:136-137`, applied `:624-669`). At ±20% this is lenient *if the BPH is right* — but if the BPH is
  mis-locked or a harmonic (Finding 3), nearly every interval falls outside the band and is rejected,
  simultaneously crushing acceptance and the rate. This couples acceptance to the 21,600 problem.

Lesser contributors: `maxTickDev=10ms` per-tick gate (`:135`, `:673-684`), `minSpacingMult=0.9`
(`:149`), and `regressionSkipPairs=5` (`:138`) which discards the first 5 pairs from the rate.

**Recommended validation before any change:** the engine already logs reject reasons — we saw
`[TGTICK PAIR_REJECT @ 25.09s] pairDev=-2.417ms thresh=1.50ms` in `timegrapher_tick_logs`. Tally
reject reasons from the Hamilton/JLC batch sessions to see *which* gate dominates, rather than
guessing. (No native edit should precede that tally — consistent with the project's "no fix without
data" rule.)

## Finding 2 — The early transient is threshold + regression warm-up

Several native warm-up effects bias the first ~20–30s, matching the drift we measured:

- **Calibration 0–2s** (`:1082-1083`): no ticks accepted; a stray transient inflates the p98
  threshold (`calibPercentile=0.98`, `calibMultiplier=1.2`, `:142-143`).
- **Threshold decay 2–~5s** (`:536-543`): after calibration the detect threshold tracks peaks and
  decays at `0.9999`/sample, taking ~1–2s to reach steady state — so which ticks pass shifts during
  this window.
- **Cold-start pair gate** (`:131`): the first ~10 pairs use a fixed `coldStartThreshold=2.0 ms`
  before switching to MAD-adaptive — a regime change a few seconds in.
- **Regression composition**: the native rate (Theil-Sen) and the JS from-start LS both include
  those early, settling pairs, so the estimate is pulled until later clean data outweighs them. This
  is *the* reason the from-start rate keeps moving for tens of seconds.

Implication: the transient is real and native-side. The v2 JS adaptive-stop correctly waits it out.
A native improvement would be to **de-weight or exclude the warm-up region from the rate** (a larger,
time-based skip than the current 5-pair skip), and/or tighten initial calibration so the threshold
starts closer to steady state. Neither is done here — flagged for decision.

## Finding 3 — 21,600 BPH harmonic / BPH-lock risk

Auto-BPH locks on a Goertzel ratio (`bphCandidates=[18000,21600,25200,28800,36000]`, `:71`; lock at
`peakRatioThreshold=3.0` with a 1.5× decisiveness check, `:1020-1025`). The sideband baseline uses
multipliers `[0.73,0.81,1.19,1.37,1.61]` (`:1046,1151`). Risk: a strong harmonic of a neighboring
BPH can elevate 21,600's baseline and depress its ratio, or the autocorrelation fallback
(`:1250-1279`) can take the **median of harmonic period estimates** and lock a harmonic. A wrong lock
then trips the outlier gate (Finding 1) → low acceptance + wrong rate, which matches 21,600 being the
historically worst-spread BPH. Mitigations exist but are capped: `maxBphCorrections=2` (`:117`), and
correction needs 8 consistent outliers (`:631-665`, `:776-838`).

Note: in the *batch* runs BPH was set manually (not auto), so harmonic mis-lock does not explain the
Hamilton/JLC acceptance numbers — those point at Finding 1. Finding 3 matters for real-world auto-BPH
use and the historical 21,600 swings.

## Recommended next steps (for decision — no code yet)

1. **Quantify reject reasons** from the batch sessions' `[TGTICK …]` logs (which gate dominates).
   This is a pure data task and should gate any native change. *(I can run this now if you want.)*
2. If the adaptive-pair-threshold ceiling is the dominant rejecter: raise `maxAdaptiveThreshold`
   (and/or make it BPH/beat-error aware) and re-batch — a small, testable Swift change.
3. Consider a **time-based warm-up skip** for the native rate (exclude first ~15–20s) — but note the
   offline test already showed warm-up skip doesn't help the *JS* full-window estimate; it may differ
   natively because it also changes *which ticks calibrate the threshold*. Validate before adopting.
4. Auto-BPH hardening for 21,600 (longer/more decisive lock, or confirm BPH from measured interval
   after a few seconds) — only if the log tally shows real-world mis-locks.

## Update — reject-reason tally (real data, the "data before code" step)

Tallied logged accept/reject events from the two batch sessions (`timegrapher_tick_logs`, via
`regexp_count`):

| Batch | accepted | pair_reject | phase_reject | phase_skip | paired-acceptance |
|---|---|---|---|---|---|
| Hamilton (21,600, clean) | 3254 | 433 | 39 | 14 | **87%** (92% pair / 8% phase) |
| JLC (28,800, ~4ms BE) | 2986 | 1252 | 914 | 292 | **58%** (58% pair / 42% phase) |

**Key correction to Finding 1:** the logged pairing gates are NOT the dominant cause of the ~40%
overall acceptance. Hamilton accepts **87%** of ticks that *reach* pairing, yet only ~217 ticks/run
were logged vs ~540 physical beats — so **most missing beats are lost upstream, silently, at the
energy-detection threshold** (those rejections emit no log line). The adaptive-pair-threshold ceiling
is a real but secondary rejecter, not the prime mover. JLC is hit on both fronts: 58% paired-
acceptance with **42% of rejects being phase rejects (914)** — direct fallout from its ~4ms beat error
mis-pairing tick/tock — plus the same silent detection loss. Sampled threshold was 0.5–0.67ms against
4–5ms pair deviations (brutally tight for a high-beat-error watch).

**What this results in (prioritized native actions, all TestFlight-gated, data-first):**
1. **Quantify the silent detection loss** — the biggest lever and currently unmeasured. Either analyze
   the `TGDEBUG energy/thresh/tickThresh` lines, or add native logging for the silent gates
   (energy-threshold, min-spacing, outlier-interval, maxTickDev). Do this BEFORE changing detection.
2. **Loosen energy detection** (`tickDetectMult` / threshold floor) once (1) shows it's the cause —
   more accepted ticks → lower variance AND faster convergence (more data/sec = plateau sooner).
3. **Beat-error-aware pairing/threshold** for JLC-class watches: raise the adaptive threshold floor
   when beat error is high, and harden phase recovery so a ~4ms BE doesn't reject 42% of pairs.
4. Acceptance work and the JS convergence work compound: more clean ticks/sec lets v2 lock earlier.

## Update 2 — tickDetectMult sweep result (OVERTURNS the "lower the threshold" idea)

Ran a full automated sweep on a clean watch (28,800 BPH, beat error ~0.1ms, 12×90s per value):

| tickDetectMult | accepted | pair_rej | phase_rej | paired-accept | rate SD |
|---|---|---|---|---|---|
| **0.30 (default)** | 3708 | 171 | 41 | **95%** | **0.31** |
| 0.25 | 3176 | 261 | 437 | 82% | 0.53 |
| 0.20 | 3015 | 414 | 1041 | 67% | 1.44 |
| 0.15 | 2524 | 907 | 732 | 61% | 1.44 |

**Lowering the detection threshold admits NOISE, not signal** — spurious peaks between real beats
explode phase rejects (41→1041) and pair rejects, monotonically worsening accepted-tick count AND
repeatability. **The detection threshold is NOT the accuracy lever; 0.30 is already well-chosen**
(95% paired-acceptance, SD 0.31 on a clean watch). The earlier "lower tickDetectMult to recover the
~30% silent loss" recommendation (Update 1 / prioritized action #2) is **WRONG** — those missing
beats are not sitting below the energy threshold; lowering just pulls in garbage. Detection-method
changes (filtering/Goertzel), not the threshold multiplier, would be needed if the silent loss
matters — but on clean watches it doesn't (SD already 0.31).

**PARKED (revisit — do not forget): "Direction A" — sweep tickDetectMult UPWARD (0.30 → 0.40 → 0.50)**
on a clean watch to check whether a higher threshold is even cleaner (fewer noise admits). Cheap
(~45 min). The sweep harness (`runMicSweep`, set `localStorage.q2_sweep_values='0.3,0.4,0.5'`)
already supports it.

**ACTIVE: "Direction B" — native beat-error / phase pairing for noisy watches.** The real signal is
phase rejects scaling with beat error (clean watch be~0.1ms → 41 phase rejects; JLC be~4ms → 900+).
High beat error makes tick/tock pairing mis-phase. This is the next native change, designed from this
data. See the v3 native spec (to be written).

## Update 3 — Kurono "high-BE" case is actually a TWIN-PEAK DETECTION bug (root cause found, fix validated offline)

The "high beat error" watches were a red herring. Captured a Kurono Tokyo Inseki (28,800, dial-down)
batch: app reported beat error **3.2ms** (max 3.8) and rate **+4.6 (SD 2.68)**. But **Weishi ground
truth = +9/+10 s/day, beat error 0.2ms** (the watch is IN beat). So the app FABRICATED the beat error
and got the rate wrong.

Recorded ~16s of the Kurono on Voice Memos (`~/Downloads/kurono1.m4a`) and analyzed the waveform
(ffmpeg→WAV, scipy). Findings:
- The Kurono tick is a **double click**: every tick has two acoustic peaks ~3.5ms apart, **near-equal
  amplitude** (median 2nd/main = 0.79; 82% have 2nd>0.6×main, 45% >0.8×).
- The native detector picks the **loudest** peak each beat; because the twins are near-equal, beat-to-
  beat amplitude jitter flips which wins → the tick jumps ~±3.5–5ms → **fabricated beat error +
  corrupted/noisy rate**. Not high beat error, not a phase-recovery-tuning problem — a
  **peak-selection** problem.

**Fix validated OFFLINE on the recording** (prototype): amplitude-pick (current) → interval std
**20.75ms**, beat error **2.86ms** (reproduces the bug); **phase-locked** pick (choose the candidate
nearest the *predicted* tick time, ignore the louder twin) → interval std **0.74ms**, beat error
**0.01ms** (matches Weishi's 0.2). Decisive. (The prototype's absolute rate was off — that's the
voice-memo clock, not the watch; beat error / interval-cleanup are clock-immune, and on-device the
app's own clock already gives accurate rate on clean watches, so phase-locking fixes the live rate
too since the error was the flipping.)

**→ B2 redefined: native phase-locked peak selection** in `TimegrapherEngine` (after lock, pick the
candidate peak closest to the predicted phase, not the loudest). This supersedes the
"expose phase-recovery params" idea for this failure class. Validate by re-recording/re-batching the
Kurono (expect BE→~0.2, rate→~+9.5, SD collapse).

## Scope note

This is investigation only. Any Swift change is a separate cycle, built by the user and tested via
TestFlight (per the agreed division of labor). Microphone detection stays native-only; no offline
detector sweep / raw-capture tooling is planned.
