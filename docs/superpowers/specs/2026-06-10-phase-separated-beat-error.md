# Spec — Phase-Separated Beat-Error Estimator (native)

**Date:** 2026-06-10
**Status:** Draft (design only — not implemented)
**Scope:** Mic timegrapher, native `TimegrapherEngine.swift`. Replaces the displayed/saved beat error. Independent of (and complementary to) phase-locked detection. **Does NOT touch piezo.**

---

## 1. Problem

The beat error shown to users and logged to `measurement_batch_runs.native_beat_error` comes from a **folded-envelope estimator** — `detectTickEvents(...)` (`TimegrapherEngine.swift:1400-1477`, called once per `analyze()` at `:1088`). It epoch-folds the raw signal over one beat period, finds the two strongest peaks of the folded profile, and reports `BE = |gap1 − gap2|`.

This estimator is **confirmed broken** — it is structurally divorced from the phase-locked tick stream and picks whatever two energy humps dominate the fold:

| Watch | Weishi BE | folded BE (app) | nature |
|---|---|---|---|
| Kurono (twin-peak) | 0.2 ms | 3.2–3.9 ms | grabs the 2nd click of the double-tick |
| Hamilton (clean, rate +0.87 vs Weishi 0) | ~0.2 ms | **bimodal: 0.17 ↔ 4.5 ms** | flip-flops between truth and a spurious harmonic peak |
| JLC (flaky) | 0.6 ms | 3.3 ms (avg) | same bimodal flip-flop |

The Hamilton per-run trace is the smoking gun — the *rate* is flawless and dead-stable (SD 0.39), yet folded BE alternates `4.33, 4.83, 4.67, 4.67, 4.67, 0.17, 4.17, 0.17, 4.50, 0.17, 4.67 …`. When it lands right it reads 0.17 ms (matches Weishi); otherwise it locks a fixed ~4.5 ms artifact. **The measurement is good; the BE estimator is fragile.**

We already detect every tick with phase-lock. Beat error is recoverable directly from that tick stream — far more robustly than from a blind energy fold.

---

## 2. The estimator

Beat error is the systematic timing asymmetry between the two half-beats (tick→tock vs tock→tick). Detection fires one impulse per half-beat, so consecutive detected intervals alternate phase.

### 2.1 Derivation

Let `H = expectedTickInterval` (ring samples per half-beat). With beat error, the tock sits off-center by `e`:

```
impulse times:   t_2m = 2mH        (tick)
                 t_2m+1 = (2m+1)H + e   (tock, late by e)
intervals:       I_even = H + e   (tick→tock)
                 I_odd  = H − e   (tock→tick)
```

Horological beat error = `|I_even − I_odd| = 2e`.

The engine's per-tick deviation is `dev = expectedTickInterval − actualInterval` (`:719`), so:

```
dev on an even interval ≈ −e
dev on an odd  interval ≈ +e
```

**Estimator:**
```
BE = | mean(dev | phase==even) − mean(dev | phase==odd) |
```
which equals `|(−e) − (+e)| = 2e` = the true beat error. **No correction factor** — the ×2 is already baked into the difference-of-means.

### 2.2 Why this beats the current per-tick `knownBeatError`

`knownBeatError` (`:740-742`) = **median of |dev|** over the last 20 ticks. That conflates the alternating ±e signal with random per-tick jitter, so it reads *high* on clean watches (measured 0.80 ms on Hamilton/JLC old-build batches where true BE ≈ 0.2–0.6). It is **not** a usable BE estimate and must not be reported (we already rejected that swap with data, 2026-06-09).

The phase-separated estimator instead **averages signed deviations within each phase bucket**, so zero-mean jitter cancels. At BE ≈ 0.2 ms with ~0.15 ms jitter, median|dev| ≈ 0.25–0.3 (wrong), while difference-of-means → 0.2 (right) given enough samples.

### 2.3 Parity robustness (the hard part)

The whole estimator depends on assigning each interval to the correct phase bucket. Naïve "buffer index parity" breaks whenever a tick is skipped (outlier gate `:715`, DEV_SKIP `:722`, phase-lock miss `:625-633`) — an odd number of skipped impulses flips parity and silently collapses the two means toward each other (→ underestimate).

**Solution: track cumulative *expected-impulse* count, not accepted-tick count.**

```
let steps = max(1, Int((actualInterval / expectedTickInterval).rounded()))
tickPhaseIndex += steps
let parity = tickPhaseIndex & 1
```

- A clean consecutive tick → `steps == 1` → parity flips correctly.
- A skipped impulse → interval ≈ 2H → `steps == 2` → parity preserved correctly.
- Only `steps == 1` intervals carry clean single-phase information; **`steps >= 2` intervals advance `tickPhaseIndex` but are NOT pushed to a bucket** (they span a full beat = net-symmetric, no phase signal).

This makes the phase assignment immune to skips and misses without any special-casing at each skip site.

---

## 3. Native integration

### 3.1 New state (near `recentTickDevs`, `:108-110`)
```swift
private var tickPhaseIndex: Int = 0              // cumulative expected-impulse counter (parity source)
private var beDevsByParity: [[Double]] = [[], []] // rolling signed-dev buckets, phase 0 / phase 1
private let beBucketWindow: Int = 30             // per-bucket rolling size
private let beMinPerBucket: Int = 8              // min samples per bucket before BE is valid
private var phaseSepBeatError: Double? = nil     // result of the estimator (ms), nil until valid
```

### 3.2 Accumulate (in the accepted-tick block, right after `recentTickDevs.append`, `:735`)
```swift
let steps = max(1, Int((actualInterval / expectedTickInterval).rounded()))
tickPhaseIndex += steps
if steps == 1 {
    let p = tickPhaseIndex & 1
    beDevsByParity[p].append(deviationThisTick)
    if beDevsByParity[p].count > beBucketWindow { beDevsByParity[p].removeFirst() }
    if beDevsByParity[0].count >= beMinPerBucket && beDevsByParity[1].count >= beMinPerBucket {
        let m0 = beDevsByParity[0].reduce(0,+) / Double(beDevsByParity[0].count)
        let m1 = beDevsByParity[1].reduce(0,+) / Double(beDevsByParity[1].count)
        phaseSepBeatError = (abs(m0 - m1) * 100).rounded() / 100   // ms, 2-dp
    }
}
```
(`deviationThisTick` is already in ms at `:719`; `actualInterval`/`expectedTickInterval` are ring samples.)

### 3.3 Report (the two output sites)
Prefer the phase-separated value, fall back to folded only before it's valid:
```swift
// :480  Result(...)  and  :1027 Update(...)
beatError: phaseSepBeatError ?? currentBeatError
```
Leave `detectTickEvents`/`currentBeatError` in place as the **pre-lock fallback** (first ~1 s, before either bucket fills). No deletion — minimal change.

### 3.4 Reset
Reset the new state wherever `recentTickDevs` resets (`:415`, `:936`, `:1124`) and at every `tickCalibrating = true` site (same set the phase-lock state already resets at):
```swift
tickPhaseIndex = 0; beDevsByParity = [[], []]; phaseSepBeatError = nil
```

### 3.5 Debug echo
Extend the `[TGTICK]` log (`:914`) with `psBE=\(phaseSepBeatError ?? -1)` so offline analysis can compare folded vs phase-separated per run.

---

## 4. A/B + tunability (mirror the `phase_lock` pattern)

So we can validate on-device without a rebuild, expose a switch the same way phase-lock is driven:

- `setTuning(... beatErrorMode: String? = nil)` — `"phase_sep"` (new, default) vs `"folded"` (legacy).
- `TimegrapherBridge` parses `beatErrorMode` from the tuning body.
- `index.html` `sendMsrTuning` payload + hidden `#msr-tune-be-mode` input; `timegrapher_tuning` gets a `beat_error_mode text` column, polled like `phase_lock`.
- Lets us A/B folded vs phase-separated on the same coupling via SQL, and log both (`psBE` echo already carries the phase-sep value regardless of which is reported).

Default ships `phase_sep` once validated.

---

## 5. Calibration & validation

The formula is dimensionally exact (`= 2e`), but BE near 0.2 ms is close to the mic's measurement floor, so validate the *magnitude* against Weishi before trusting it:

| Watch | Weishi BE | expect phase-sep |
|---|---|---|
| Hamilton | ~0.2 ms | 0.1–0.3 ms, **stable run-to-run** (not bimodal) |
| Kurono | 0.2 ms | ~0.2 ms (vs folded's 3.9) |
| JLC | 0.6 ms | ~0.6 ms |

**Pass criteria:** (1) per-run BE no longer bimodal; (2) batch-mean within ~±0.3 ms of Weishi on all three; (3) run-to-run SD of BE collapses vs folded. Capture via a Mic Batch with `beat_error_mode` logging both values.

---

## 6. Offline prototype (validate before Swift)

`scripts/twinpeak_prototype.py` already computes `be = |mean(even) − mean(odd)|` for method B. Extend it to:
1. Apply the `steps`-based parity tracking (skip-robust) instead of naïve `d[0::2]/d[1::2]`.
2. Print phase-separated BE alongside folded BE on the Kurono/Hamilton reference recordings.
3. Confirm phase-sep ≈ Weishi and folded flip-flops — reproduces §1 offline before we touch the engine.

---

## 7. Test plan

- **Unit (offline):** synthetic alternating ±e interval stream + Gaussian jitter → estimator recovers 2e within tolerance; inject skips → parity stays correct (BE unchanged); verify `steps>=2` intervals are excluded.
- **Mirror/JS:** none — this is native-only (no JS mirror). The displayed value flows through the existing native→JS bridge unchanged.
- **On-device:** the §5 batch across Hamilton/Kurono/JLC with both modes logged.
- **Regression:** rate, SD, n_ticks, reject tallies must be **unchanged** (this touches only the BE output path, never detection or rate).

---

## 8. Risks / notes

- **Parity reset on lock-drop** is essential — a stale `tickPhaseIndex` across a recal would scramble buckets. Tied to the existing reset sites (§3.4).
- **Low BE near the floor:** if even phase-sep can't resolve 0.2 ms cleanly, that's a mic-physics limit, not a code bug — acceptable as long as it's not *alarmingly* wrong (the folded 3.9 ms is the real problem; ±0.2 ms noise at true 0.2 ms is fine).
- **Sign/convention:** we report `|m0 − m1|` (unsigned) — matches Weishi's unsigned BE. We do not attempt to label which half-beat is early (no tick/tock identity from mic).
- **Out of scope:** amplitude, lift angle (no mic derivation). Rate unchanged. Piezo untouched.
