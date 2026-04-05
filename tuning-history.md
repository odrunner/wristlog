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
| `regSkipPairs` | `msr-tune-reg-skip` | 10 | Number of initial pairs to skip before Theil-Sen regression starts |
| `regMinN` | `msr-tune-reg-min-n` | 10 | Minimum pair count before regression reports a rate |
| `wallMinSec` | `msr-tune-wall-min` | 20 | Minimum wall-clock seconds before regression reports a rate |
| `stabWindow` | `msr-tune-stab-window` | 15 | Window (seconds) over which native rate stability is evaluated |
| `stabThresh` | `msr-tune-stab-thresh` | 3 | Rate stability threshold (s/day) — rate is "stable" if range within window ≤ this |
| `stabLoseThresh` | `msr-tune-stab-lose` | 5 | Threshold (s/day) to lose stable status once gained |
| `maxPairThresh` | `msr-tune-max-pair-thresh` | 0.58 | Maximum pair deviation threshold (ms) — adaptive gate ceiling |
| `minPairThresh` | `msr-tune-min-pair-thresh` | 0.2 | Minimum pair deviation threshold (ms) — adaptive gate floor |
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
