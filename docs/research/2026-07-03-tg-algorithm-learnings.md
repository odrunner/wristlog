# What we learned from tg (vacaboja) — and how it applies to WRotate

Source read: `~/tg/src` (tg 0.5.2). This is the reference open-source timegrapher that
read our Hamilton cleanly (+4 s/d, 0.2ms BE, 286° amplitude, converged fast) off the
cheap USB timegrapher device, where our own algorithm gave wild output.

## The one big insight

**tg does NOT compute rate from beat arrival times.** No per-tick peak detection → pair
deviations → slope/regression (which is what BOTH our engines do). Instead:

1. Take a whole window of audio (it keeps 2/4/8/16 s windows). HP 3000Hz → full-wave
   rectify → LP 3000Hz = a smooth beat *envelope*. (`algo.c:299`)
2. **FFT-autocorrelate the entire window** (`fft·conj(fft)` → inverse FFT). The beat
   period is the autocorrelation peak. (`algo.c:325`)
3. Refine the period by averaging across many autocorrelation lag-cycles (peak near
   `n·period`, divide by n) → relative precision ~1/N for free. (`algo.c:427-450`)
4. `rate = (nominal_period / measured_period − 1) · 86400`. (`computer.c:147`)

Rate is a **pure function of one precisely-measured period.** No regression.

## Why tg converges fast AND stable (our two problems, solved)

- **Batch fold → √N SNR in a single snapshot.** It folds every beat in the window onto
  one averaged pulse via a trimmed mean per bin (top 20% discarded). A 16 s window at
  21600 bph ≈ 120 beats → noise averages down √120 *inside one snapshot*. No temporal
  accumulation needed → stable immediately. (`compute_phase`/`compute_waveform` algo.c:543,565)
- **Multi-resolution + "longest-converged-wins."** Computes rate on 2/4/8/16 s windows
  every cycle; displays the longest window whose relative period σ < 1e-4. The 2 s window
  gives an instant answer; it auto-upgrades to 16 s for a rock-steady readout.
  (`compute_update` computer.c:92) This replaces our single trailing-window + wallMin.
- **Each snapshot independent, from fresh audio.** No forgetting factor, no drift. Cures
  our "declared stable at +3.4 then drifted to +0.5" problem — that came from our slope
  over a growing window keeping the startup transient forever.

## Amplitude (we don't have this)

Escapement makes a pulse triplet per beat. tg finds the secondary pulse in the `period/8`
window before each beat marker, measures Δt, and:

`amplitude° = lift_angle / (2·sin(π·Δt/period))`, averaged over tic & toc. (`algo.c:795`)

Gate: iterate detection threshold ×1.4 until `135° < amp < 360°` and `|tic−toc| < 60°`,
else report unavailable. The strong USB-device signal makes this feasible.

## Robustness bits worth copying

- Noise suppressor: zero any 20 ms block whose energy > 2× median-of-block-maxima (kills
  knocks/handling). `algo.c:265`
- peak_detector: median-isolation + reject if >20 half-height crossings. `algo.c:335`
- Trimmed-mean fold: one loud beat can't corrupt the pulse shape. `algo.c:517`
- Harmonic / half-double period guards. `algo.c:383,392`
- Sub-sample phase from the fundamental Fourier bin (`atan2`). `algo.c:562`

## Key constants (starting points)
filter cutoff 3000 Hz · windows 2/4/8/16 s · σ-accept `period/1e4` · period-cycle
tolerance 20 ms · noise-suppressor 20 ms / 2×median / 0.5 s blocks · amplitude smoothing
1 ms · amplitude bounds 135–360°, tic/toc within 60°, threshold ×1.4 · edge taper 100 ms.

## What this means for us

Our whole detection approach (phase-locked peak detection → Theil-Sen slope) is the
noisier one. tg — and essentially every good timegrapher — measures period by
autocorrelation + beat-fold. Moving to that would give, in one change: fast stable
convergence, √N noise immunity (would've saved the weak-signal piezo), and amplitude.

## Proposed next step (offline prototype first — zero app risk)

Implement tg's core in Python (HP→rectify→LP envelope → FFT autocorrelation period →
multi-cycle refine → beat fold → rate; then amplitude) and run it on the raw captures we
already have (`piezo_raw_captures`) plus fresh captures from the USB device. Compare
convergence speed / stability / accuracy vs our current phase-lock on the SAME audio. If
it wins (expected), port to Swift as the new detection core for both engines.
