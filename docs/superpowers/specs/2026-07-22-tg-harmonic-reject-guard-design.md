# tg harmonic-reject guard — native design (2026-07-22)

**STATUS: Layer 1 IMPLEMENTED (2026-07-25)** — `computeTgRate()` multi-window agreement
guard + JS-tunable `tgAgreeBand` (default 12 s/day; admin knob "Agree band", 999 = off)
wired through `applyTuning` / `TimegrapherBridge` / `sendMsrTuning`. Lands in the 2.3
App Store build. Layer 2 (octave check) still deferred (needs mic raw capture).

Queued native change for the next App Store build. Author against `ios/Wrotate/Wrotate/TimegrapherEngine.swift`.
Related: [[project_tg_detection_core]], [[project_measurement_quality]], `docs/measurement-changelog.md`.

## Problem (evidence from the 07-22 Pro V2 deep dive)

Pro V2 (tg engine) is better than the current engine on coverage, settle speed, and median
repeatability — but it has **one gross-failure mode the current engine doesn't**: a harmonic /
spurious-peak lock that scales with lower beat rate.

Shadow A/B over 715 external 2.1 sessions (since 2026-07-04):

| BPH | median \|tg−reg\| | harmonic signature (tg ≈ 2×/½× reg) |
|-----|------------------|-------------------------------------|
| 28800 | 3.1 s/d | 11% |
| 21600 | 3.7 s/d | 17% |
| 18000 | **10.5 s/d** | **24%** |

- tg blows up (\|rate\|>50 s/d) in **11%** of sessions vs the current engine's **8%**.
- Low-BPH (≤21600) tg harmonic lock: **27 sessions, 14 distinct users, 15 watches** — clears the
  weekly-review actionability gate (≥3 users, ≥2 watches) on its own.
- Cleanest reproduction: watch `155123ca-2e44-4eb2-b187-561ecd7ce8e7` (21600) — tg reads
  −167…−135 where the current engine (and reality) sit around −68…−22, a ~2× lock.

## Root cause

`computeTgRate()` ([TimegrapherEngine.swift:1485](../../../ios/Wrotate/Wrotate/TimegrapherEngine.swift#L1485))
sweeps 2/4/8/16/32 s windows, and **keeps the longest window whose rate passes `abs(rate) ≤ 200`
— with no cross-window consistency check**:

```swift
if abs(rate) <= 200 { best = rate }   // longer valid window overwrites → longest wins
```

`tgPeriod()` finds the period by grabbing the max autocorrelation bin within a ±20 ms window of
`nominal·cyc`. At low BPH the envelope is noisier and fewer full cycles fit the window, so the
σ-gate (`tgSigmaGate`) has little to work with; a spurious peak that is only ~0.2 % off the true
lag yields a ~180 s/d error that still passes the ±200 gate and becomes the reported rate. Because
"longest wins," a single bad long-window estimate overwrites good short-window ones.

## Fix — two layers

### Layer 1 (primary, shippable): multi-window agreement in `computeTgRate()`

Robust statistics, no new DSP, and a **no-op on clean watches** (all windows already agree, longest
wins as today). A harmonic mislock shows up as one outlier window; require the headline (longest)
rate to agree with the median of all valid windows, else fall back to the median.

```swift
private func computeTgRate() -> Double? {
    let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
    let nominal = 7200.0 / Double(targetBph) * ringSampleRate
    var rates: [(secs: Double, rate: Double)] = []
    for secs in [2.0, 4.0, 8.0, 16.0, 32.0] where secs <= tgMaxWindowSec {
        let want = Int(secs * ringSampleRate)
        let env = recentEnvelope(want)
        if env.count < Int(Double(want) * 0.9) { continue }
        guard let period = tgPeriod(env, nominal: nominal, ringSampleRate: ringSampleRate) else { continue }
        let rate = (nominal / period - 1) * 86400
        if abs(rate) <= 200 { rates.append((secs, rate)) }
    }
    guard !rates.isEmpty else { return nil }
    let sorted = rates.map { $0.rate }.sorted()
    let median = sorted[sorted.count / 2]
    let longest = rates.max { $0.secs < $1.secs }!.rate
    // A harmonic mislock in the headline window is an outlier vs the pack.
    // With >=2 windows, only trust the longest if it agrees with the median.
    if rates.count >= 2 && abs(longest - median) > tgAgreeBand {
        debugLog("[TGALGO harmonic-guard] longest=\(String(format:"%.1f",longest)) median=\(String(format:"%.1f",median)) band=\(tgAgreeBand) → median")
        return median
    }
    return longest
}
```

New tunable knob (default deliberately loose so it only catches gross disagreement, not honest
window-to-window jitter):

```swift
private var tgAgreeBand = 12.0   // s/day: longest-window rate must agree with the window median
```

Wire it JS-tunable exactly like the existing tg knobs so the weekly review can tighten it without
an App Store cycle:
- `applyTuning(...)` — add `tgAgreeBand: Double? = nil` param, `if let v = tgAgreeBand, v > 0 { self.tgAgreeBand = v }`, and echo in the `[TGTUNE]` log ([TimegrapherEngine.swift:344](../../../ios/Wrotate/Wrotate/TimegrapherEngine.swift#L344)).
- `TimegrapherBridge.swift` `case "tuning"` — pass `tgAgreeBand: body["tgAgreeBand"] as? Double` ([TimegrapherBridge.swift:117](../../../ios/Wrotate/Wrotate/TimegrapherBridge.swift#L117)).
- `index.html` `sendMsrTuning()` — add `tgAgreeBand: _tgKnob('tg_agreeband', 12)`; add an admin knob + preset entries ([index.html:26555](../../../index.html#L26555), presets ~25594). No SW/logic change beyond the knob.

### Layer 2 (secondary — needs offline validation FIRST, do not code blind)

An octave / beat-spacing cross-check inside `tgPeriod()`: the beat spacing (≈ period/2) must show a
real autocorrelation peak, else the near-`nominal` lock is untrustworthy. This is a DSP-level change
and **must not ship without offline replay** on real mic envelope, but:

> **Blocker:** there is no mic raw-capture table today (only piezo has `piezo_raw_captures`; mic raw
> capture was parked as a "next phase" in [[project_measurement_quality]]). The shadow `[TGALGO]`
> logs record only the 2 s final tg rate, not per-window rates or the envelope — so **neither layer
> can be offline-validated from existing data**. Layer 2 needs a mic raw-capture build first
> (mirror piezo's `exportRawCapture` → `mic_raw_captures`), then replay via an extended
> `scripts/tg_offline_prototype.py`. Until then, validate Layer 1 on-device via A/B only.

## Validation plan (on-device A/B, mirrors the phase-lock rollout)

Gate Layer 1 behind a `tg_agreeband` value driven from the admin panel (start with the guard
effectively off — `tg_agreeband = 999` — then flip to 12 and compare), same live-tuning mechanism
used for `phase_lock`/`tick_detect_mult`.

Regression watches (must not regress clean/high-BPH, must fix low-BPH):
- **Fix target:** `155123ca` (21600, the clean 2× lock) — expect tg to drop from −150-ish to ≈ −45
  and agree with the current engine.
- **Low-BPH cohort:** any 18000 watch — expect median \|tg−reg\| 10.5 → ≤ 4 s/d, harmonic rate 24% → single digits.
- **No-regression (clean, single-peak):** Hamilton (28800), Tudor (28800), Kurono (28800) — tg rate
  and settle time unchanged (all windows agree → longest still wins, guard is a no-op).
- Exclude the **wrong-BPH** sessions (`f341cb01`, `9928e7ab` carry 18000/21600/36000 on one watch
  id) — those are user beat-rate mis-selection (#5), not an engine fault, and would muddy the read.

Pass = low-BPH harmonic sessions drop out, high-BPH watches bit-identical, overall shadow median
\|tg−reg\| moves under the 3.0 flip-gate on all sessions (it is already 2.2 on clean sessions).

## Changelog entry (add on ship)

`docs/measurement-changelog.md`: hypothesis = "multi-window agreement guard removes tg's low-BPH
harmonic blowups"; target metric = 18000-bph median |tg−reg| and overall tg |rate|>50 rate;
result = fill in next weekly review.
```
