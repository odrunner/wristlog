# Timegrapher Tuning History

Track all tunable variables and changes over time. Each section is a snapshot — current values at that date/build.

---

## 2026-04-05 — Baseline (build `6591335`, SW v354)

First recorded snapshot of all tuning variables.

### Engine Parameters — web deploy only (HTML hidden inputs, no App Store submission needed)

These live in `index.html` as hidden inputs. On iOS, JS reads them and sends to Swift via the `tuning` message on each measurement start. On web, JS uses them directly. Changing these only requires a `git push`.

| Variable | Input ID | Value | Description |
|---|---|---|---|
| `multLo` | `msr-tune-mult-lo` | 8 | Low multiplier for adaptive threshold |
| `multHi` | `msr-tune-mult-hi` | 1.5 | High multiplier for adaptive threshold |
| `minThreshold` | `msr-tune-min-thresh` | 0.001 | Minimum energy threshold for tick detection |
| `percentile` | `msr-tune-percentile` | 50 | Percentile for noise floor estimation |
| `hpCutoff` | `msr-tune-hp-cutoff` | 4000 | High-pass filter cutoff (Hz) — removes low-freq noise before tick detection |
| `regSkipPairs` | `msr-tune-reg-skip` | 5 | Number of initial pairs to skip before Theil-Sen regression starts |
| `regMinN` | `msr-tune-reg-min-n` | 10 | Minimum pair count before regression reports a rate |
| `wallMinSec` | `msr-tune-wall-min` | 20 | Minimum wall-clock seconds before regression reports a rate |
| `stabWindow` | `msr-tune-stab-window` | 15 | Window (seconds) over which native rate stability is evaluated |
| `stabThresh` | `msr-tune-stab-thresh` | 3 | Rate stability threshold (s/day) — rate is "stable" if range within window ≤ this |
| `stabLoseThresh` | `msr-tune-stab-lose` | 5 | Threshold (s/day) to lose stable status once gained |
| `maxPairThresh` | `msr-tune-max-pair-thresh` | 0.58 | Maximum pair deviation threshold (ms) — adaptive gate ceiling |
| `minPairThresh` | `msr-tune-min-pair-thresh` | 0.5 | Minimum pair deviation threshold (ms) — adaptive gate floor |
| `coldStartThresh` | `msr-tune-cold-start` | 0.58 | Fixed pair threshold during calibration phase (ms) |
| `pairMadMult` | `msr-tune-pair-mad-mult` | 3 | Multiplier on MAD to compute adaptive pair threshold |
| `maxTickDevMs` | `msr-tune-max-tick-dev` | 8 | Maximum allowed tick deviation from expected interval (ms) |
| `calibDuration` | `msr-tune-calib-duration` | 24000 | Calibration phase duration (ms) — uses coldStartThresh during this period |

### JS Convergence Parameters — web deploy only (hardcoded in index.html)

Also only requires `git push`. These control when JS decides the measurement has converged and auto-stops.

| Variable | Location | Value | Description |
|---|---|---|---|
| `minElapsed` (strong) | Line ~17645 | 12s | Min measurement time before convergence when acceptRate > 0.3 |
| `minElapsed` (weak) | Line ~17645 | 20s | Min measurement time before convergence when acceptRate ≤ 0.3 |
| `minDots` | Line ~17648 | max(20, BPH/1200) | Min scatter dots required (24 for 28800 BPH) |
| `bucketRateHistory min` | Line ~17650 | 8 | Min bucket rate samples before checking convergence |
| `convSpread` | Line ~17652 | 86400/BPH | Max spread of trimmed bucket rates for convergence (3.0 for 28800 BPH) |
| `acceptRate strong threshold` | Line ~17645 | 0.3 | Accept rate above which strong-signal path is used |
| `nativeStable` min samples | Line ~17656 | 8 | Min native rate samples to check stability |
| `nativeStable` max spread | Line ~17658 | 5 s/day | Max spread of last 8 native rates for convergence |

### Swift Engine Parameters — requires App Store submission

These are compiled into the iOS app binary (`TimegrapherEngine.swift`). Changing them requires an Xcode archive + App Store/TestFlight submission.

| Variable | File | Value | Description |
|---|---|---|---|
| Ring buffer sample rate | `TimegrapherEngine.swift` | 12000 Hz | Audio ring buffer sample rate. Determines tick position resolution (0.083ms per sample = 7.2 s/day quantization steps) |
| Ring buffer size | `TimegrapherEngine.swift` | `bufferSeconds × sampleRate` | Total ring buffer length. Controlled by `bufferSeconds` param from JS (default 30s) |

*Note: Most Swift engine behavior is parameterized via the "Engine Parameters" table above, which JS sends on each measurement start. Only the audio pipeline fundamentals (sample rate, buffer architecture) are baked into the binary.*

---

## 2026-04-05 — Tuning Update #1 (build `26be101` → next, SW v355)

Based on nightly analysis of real user sessions (Tudor Ranger, Tudor BBC, new user measurements).

### Changes

| Variable | Old | New | Reason |
|---|---|---|---|
| `minPairThresh` | 0.2 | 0.5 | Floor was below quantization resolution (0.083ms steps). Adaptive gate tightened to 0.33ms on accurate watches, rejecting 82% of valid pairs. BBC session: 130 ticks → only 24 dots. New floor of 0.5ms keeps gate above ~6 ring samples, accepting normal quantization noise while still rejecting true outliers. |
| `regSkipPairs` | 10 | 5 | With minPairThresh raised, early pairs are better filtered. Cold-start threshold (0.58ms) already handles calibration phase. Skipping 10 pairs delayed rate display by ~2.5s unnecessarily. Theil-Sen median-of-slopes is inherently robust to a few noisy early pairs. |
| `minElapsed` (strong) | 12s | 15s | Native Theil-Sen rate was still settling at 12s in BBC session (0.0 → 5.2 → stable). Three more seconds provides ~12 additional pairs at 28800 BPH, significantly improving rate stability before convergence lock. |

---

## 2026-04-05 — Tuning Update #2 (SW v356)

IWC Portugieser dial-down measurement converged at +0.0 s/day when real rate is +13 s/day. Root cause: JS convergence only checked bucket rate stability. Bucket rate was quantized at 0 the entire session, so it looked "stable" immediately. Meanwhile native Theil-Sen rate was still drifting (-9.6 → 0.0 → +8.4). Convergence locked at the moment native rate passed through 0.

### Changes

| Variable | Old | New | Reason |
|---|---|---|---|
| JS convergence: native rate stability check | (none) | Last 8 native rates must span ≤ 5 s/day | Prevents converging while Theil-Sen rate is still drifting. Bucket rate stability alone is insufficient — it's blind to rates below one quantization step (7.2 s/day). IWC session: native rate swung 18 s/day over 35 seconds but bucket rate was "stable" at 0 the entire time. |

---

## 2026-04-05 — Bug Fix (SW v357)

**HUD/reference line mismatch after convergence.** HUD showed converged rate (+0.0) but the dashed yellow reference line showed ~7 s/day.

### Root cause

`stopMsrListen()` (line ~18510) overwrote `_msrLastRate` with the bucket median of all scatter dots after the measurement stopped:
```js
const finalMode = computeMedianRate(finalDotRates);
if (finalMode != null) _msrLastRate = finalMode;  // ← overwrote native rate
```
The HUD was set at convergence time (native rate), but then `stopMsrListen` replaced `_msrLastRate` with the bucket median (~7), and the chart's reference line picked up the new value on redraw.

### Fix

Only fall back to bucket median if native rate was never set (web-only mode with no Swift engine). On iOS, `_msrLastRate` is left unchanged — HUD, reference line, and save input all show the same native Theil-Sen rate.

This was a pre-existing bug from before native Theil-Sen was made authoritative — the old code always preferred bucket median as the final rate.

---

## 2026-04-05 — Bug Fix (SW v358)

**False "No ticks yet" warning in auto-BPH mode.** Users in auto mode were told to "move watch closer to mic" at 4s even though ticks physically can't appear until ~7s (5s BPH detection + 2s calibration).

### Root cause

The "no ticks yet" warning (line ~17551) checked `elapsed >= 4 && data.tickCount === 0`. In manual mode this is correct — calibration takes ~2s, so no ticks by 4s is a real signal problem. But in auto mode, the Goertzel BPH detection takes ~5s and calibration adds another ~2s, so `tickCount` is always 0 at 4s regardless of signal quality.

### Fix

Differentiated the warning window by mode:
- **Manual mode**: warn at 4–8s (unchanged)
- **Auto mode**: warn at 10–15s (gives BPH detection + calibration + grace period)

This prevents new users (who won't know their BPH and will use auto mode) from being incorrectly told their signal is weak before the engine has even started looking for ticks.

---

## 2026-04-05 — Tuning Update #3 (SW v359)

Tested 4 watches × 2 positions (dial-down and dial-up), 25 sessions total. Only 3 converged. Most sessions ended in 15–20s with <60 ticks — rates were unreliable.

### Changes

| Variable | Old | New | Reason |
|---|---|---|---|
| `minElapsed` | 15s (strong) / 20s (weak) | 25s (both) | Two-tier wasn't helping — even "strong signal" sessions converged with bad rates at 15s. Unified to 25s for all signals. |

### Test results that motivated this

| Watch | Dial-Down (us vs ref) | Dial-Up (us vs ref) |
|---|---|---|
| IWC Portugieser | +0 to +6 vs +13 | -1 to -2 vs +1/+2 |
| JLC Reverso | +9 to +11 vs +9/+15 | +6 vs +7 |
| Omega Speedmaster | -3 to -4 vs -3/-4 | -6 to -16 (phase-flip) |
| Tudor BBC | +0 to +6 vs ~0 | +3 to +6 vs ~0 |

JLC was accurate. Omega dial-down matched. IWC dial-down was 10+ off (separate issue, not convergence-related). Omega dial-up dominated by phase-flip bias (queued for Swift fix).

---

## 2026-04-08 — Tuning Update #4 (restore minPairThresh, SW v384)

After 24kHz ring buffer was reverted back to 12kHz (24kHz caused issues), `minPairThresh` was left at 0.2ms — a value that only works at 24kHz resolution. At 12kHz, pair deviations are quantized to 0.083ms steps, so a 0.2ms floor gives only 2–3 valid quantization levels. The adaptive gate tightens to 0.2ms on accurate watches and rejects pairs landing at ±0.167ms or above — perfectly valid data that just happens to round to the next quantization step.

Analysis of April 8 user sessions confirmed ~50% pair rejection rates across multiple users and watches, consistent with the same over-filtering that Update #1 originally fixed.

### Changes

| Variable | Old | New | Reason |
|---|---|---|---|
| `minPairThresh` | 0.2 | 0.5 | Restores the Update #1 fix. At 12kHz (0.083ms quantization), 0.5ms gives ~6 quantization levels of headroom. Prevents adaptive gate from crushing valid pairs on accurate watches. Same value and rationale as Update #1 — was inadvertently regressed when 24kHz was reverted. |
| `regSkipPairs` | 10 | 5 | Restores the Update #1 fix. With minPairThresh back at 0.5 and coldStartThresh at 0.58ms, early pairs are well-filtered. 10 skipped pairs created a 6-7s dead zone after calibration (longer in noisy environments where rejected pairs don't count toward skip quota). Theil-Sen median-of-slopes is inherently robust to noisy early data. |
