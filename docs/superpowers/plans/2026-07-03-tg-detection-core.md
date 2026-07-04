# tg-style Detection Core (rate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable tg-style detection core (rate from FFT-autocorrelation period, not beat-time regression) to the mic engine, admin-gated in JS, so we can A/B it on-device against the original and ship it as the base if it wins.

**Architecture:** A new rate path inside `TimegrapherEngine` selected by a `useTgAlgo` flag passed from JS at start. It reuses the engine's existing rolling **envelope** buffer (`energyRings[activeHpIndex]`, ~15s @ 24kHz) and existing `fftAutocorrelation(_:count:)`. It measures the beat *period* over multi-resolution windows (2/4/8/16 s, longest-that-converges wins), refines across autocorrelation lag-cycles, and emits `rate = (nominal_period/measured_period − 1)·86400` through the **same `Update` contract**, so the existing UI is unchanged. Original algorithm stays the default; the toggle is admin-only.

**Tech Stack:** Swift / AVFoundation / Accelerate (vDSP); vanilla JS; Python (numpy/scipy) for offline validation.

**Reference:** `docs/research/2026-07-03-tg-algorithm-learnings.md` (tg's exact pipeline, formulas, constants).

## Global Constraints

- **Rate only in this plan.** Amplitude + graphics are a separate later plan.
- **Original algorithm remains the default.** New algo is opt-in via toggle; no behavior change for anyone unless the toggle is on.
- **Admin-only, behind a feature flag** (`tg_algo`), same pattern as `tg_piezo` — never shipped-on until we decide.
- **Swift changes require a TestFlight rebuild** (no xcodebuild on the Mac Mini). Validate Swift via on-device A/B, not unit tests.
- **JS changes:** bump `sw.js` cache version every change; `npm test` (1119 unit) + `npm run test:e2e` (104) must pass before commit.
- **One change at a time**; commit per task.
- Period math: `nominal_period_samples = 7200.0/bph * ringSampleRate` (tic-to-tic, full period). `rate_s_per_day = (nominal/measured − 1) * 86400`.

---

### Task 1: Finalize & validate the offline prototype (lock the algorithm)

Prove the algorithm and pin its parameters on real captures before touching Swift. This de-risks the Swift port — we port a known-good recipe.

**Files:**
- Modify: `scripts/tg_offline_prototype.py`

**Interfaces:**
- Produces (the recipe the Swift port must match): envelope = bandpass(200–5000Hz) → rectify → lowpass(80Hz); period via FFT-autocorrelation with peak search at `nominal±2%`, refined by averaging peak/n across lag-cycles in the middle 2/3 of the window; multi-resolution windows `[2,4,8, full]` s; pick the **longest** window whose period is finite and `|rate|<200`.

- [ ] **Step 1: Add multi-cycle refine + longest-window selection to `tg_rate`/`main`** (already largely present — confirm the window loop picks the longest valid window and prints per-window rates + spread).

- [ ] **Step 2: Run on the one known-good capture and confirm it matches the phase-lock ground truth**

Run: `python3 scripts/tg_offline_prototype.py 12`
Expected: tg full-window rate within ~±3 s/day of the phase-lock's +2.3 on id 12 (our validated strong capture). If it disagrees wildly, fix the envelope/period search before proceeding.

- [ ] **Step 3: Run on the weak captures and confirm tg full-window is steadier than phase-lock**

Run: `python3 scripts/tg_offline_prototype.py 111 125 127`
Expected: tg full-window values cluster tighter (e.g. within a few s/day) than the phase-lock column, as already observed (+2.4/+2.5/+8.6 vs +7.2/+13.3/+11.5). Record the numbers in the commit message.

- [ ] **Step 4: Commit**

```bash
git add scripts/tg_offline_prototype.py
git commit -m "prototype: finalize tg autocorrelation-period recipe + validate vs phase-lock"
```

---

### Task 2: Swift — `computeTgRate()` (period → rate over the envelope ring)

Add the core computation as a **pure, self-contained method** on `TimegrapherEngine` that reads the existing envelope ring and returns a rate. It does not touch the emit path yet (Task 3 wires it in), so this task is reviewable on its own.

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherEngine.swift` (add method near `fftAutocorrelation`, ~line 1359)

**Interfaces:**
- Consumes: `energyRings: [[Float]]`, `energyRingWritePos: Int`, `energyRingCount: Int`, `energyRingCapacity: Int`, `activeHpIndex: Int`, `ringSampleRate` (the ring rate used for `energyRings`), `targetBph`, and `fftAutocorrelation(_ signal: [Float], count: Int) -> [Float]`.
- Produces: `func computeTgRate() -> Double?` — the tg rate in s/day over the best available window, or `nil` if not enough buffer / no clean period.

- [ ] **Step 1: Add a helper to linearize the last N envelope samples from the circular ring**

```swift
// Copy the most-recent `n` samples of the active envelope ring into a linear array
// (oldest→newest), handling wrap. Returns fewer than n only if the ring isn't full yet.
private func recentEnvelope(_ n: Int) -> [Float] {
    let count = min(n, energyRingCount)
    guard count > 0 else { return [] }
    let ring = energyRings[activeHpIndex]
    var out = [Float](repeating: 0, count: count)
    var idx = (energyRingWritePos - count + energyRingCapacity) % energyRingCapacity
    for i in 0..<count { out[i] = ring[idx]; idx = (idx + 1) % energyRingCapacity }
    return out
}
```

- [ ] **Step 2: Add the period-from-autocorrelation refinement**

```swift
// Measure the full (tic-to-tic) period in ring samples from a window of envelope,
// refined across autocorrelation lag-cycles (tg algo.c:427-450). Returns nil if no peak.
private func tgPeriod(_ env: [Float], nominal: Double) -> Double? {
    let n = env.count
    guard n > Int(nominal * 2.5) else { return nil }
    // mean-subtract + 100ms raised-cosine edge taper
    var e = env
    var mean: Float = 0; vDSP_meanv(e, 1, &mean, vDSP_Length(n))
    var negMean = -mean; vDSP_vsadd(e, 1, &negMean, &e, 1, vDSP_Length(n))
    let tap = min(n/2, Int(ringSampleRate * 0.1))
    for i in 0..<tap {
        let w = Float(0.5 * (1 - cos(Double(i) / Double(tap) * .pi)))
        e[i] *= w; e[n - 1 - i] *= w
    }
    let ac = fftAutocorrelation(e, count: n)
    let tol = ringSampleRate * 0.02
    var sum = 0.0, cnt = 0.0, cyc = 1.0
    while nominal * cyc < Double(n) * 0.66 {
        let lo = Int(nominal * cyc - tol), hi = Int(nominal * cyc + tol)
        if hi >= ac.count || lo < 1 { break }
        var best = lo; var bv = ac[lo]
        for k in lo...hi where ac[k] > bv { bv = ac[k]; best = k }
        let a0 = Double(ac[best-1]), b0 = Double(ac[best]), c0 = Double(ac[best+1])
        let d = a0 - 2*b0 + c0
        let frac = abs(d) > 1e-9 ? 0.5*(a0 - c0)/d : 0
        sum += (Double(best) + frac) / cyc; cnt += 1; cyc += 1
    }
    return cnt > 0 ? sum / cnt : nil
}
```

- [ ] **Step 3: Add `computeTgRate()` — multi-resolution, longest-valid wins**

```swift
/// tg-style rate: measure period by autocorrelation over 2/4/8/16s windows of the
/// envelope ring; use the longest window that yields a clean, in-range rate.
private func computeTgRate() -> Double? {
    let nominal = 7200.0 / Double(targetBph) * ringSampleRate   // full period, ring samples
    var best: Double? = nil
    for secs in [2.0, 4.0, 8.0, 16.0] {
        let env = recentEnvelope(Int(secs * ringSampleRate))
        if env.count < Int(secs * ringSampleRate * 0.9) { continue }  // not enough buffer yet
        guard let period = tgPeriod(env, nominal: nominal), period > 1 else { continue }
        let rate = (nominal / period - 1) * 86400
        if abs(rate) <= 200 { best = rate }   // longer windows overwrite → longest valid wins
    }
    return best
}
```

- [ ] **Step 4: Brace/consistency check**

Run: `python3 -c "s=open('ios/Wrotate/Wrotate/TimegrapherEngine.swift').read(); print('braces', s.count('{')==s.count('}'))"`
Expected: `braces True`. Also confirm `ringSampleRate` is the exact stored property name used for `energyRings` (read the `start`/`processAudioBuffer` code); if it differs (e.g. `actualRingRate`), use that name.

- [ ] **Step 5: Commit**

```bash
git add ios/Wrotate/Wrotate/TimegrapherEngine.swift
git commit -m "mic engine: add computeTgRate() (autocorrelation period core, not yet wired)"
```

---

### Task 3: Swift — wire the `useTgAlgo` toggle into start + emit path

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherEngine.swift` (flag decl; `start`; the rate-emit block near line 1006; `setTuning`)

**Interfaces:**
- Consumes: `computeTgRate()` (Task 2).
- Produces: `useTgAlgo` honored — when true, `rateForUpdate` comes from `computeTgRate()` instead of the regression slope; `func start(bph:sensitivity:useTgAlgo:)` gains the flag with a default of `false`.

- [ ] **Step 1: Add the flag**

```swift
private var useTgAlgo = false
```

- [ ] **Step 2: Accept it in `start` (keep the default so existing callers are unchanged)**

Change `func start(bph: Int, sensitivity: Int)` to `func start(bph: Int, sensitivity: Int, useTgAlgo: Bool = false)` and inside, near the top: `self.useTgAlgo = useTgAlgo`. Add to the `[TGSTART]` debug line: `useTg=\(useTgAlgo)`.

- [ ] **Step 3: Use the tg rate in the emit block** (near line 1006, the `let regRate = slope * 86.4` block)

```swift
let regRate = slope * 86.4 // → s/day
let candidate = useTgAlgo ? computeTgRate() : (abs(regRate) <= 200.0 ? regRate : nil)
if let r = candidate {
    smoothedRate = r
    rateForUpdate = (r * 10).rounded() / 10
    rateHistory.append((time: wallElapsed, rate: r))
    // ... keep the existing rateHistory trimming / stability code below unchanged ...
}
```
(Preserve the existing stability/`rateHistory` logic that follows; only the *source* of `r` changes. Read the current block first and splice minimally.)

- [ ] **Step 4: Log it so we can compare in the DB**

In the `[TGRATE ...]` debug line, append `tgRate=\(computeTgRate().map { String(format: "%+.1f", $0) } ?? "nil")` so every run logs BOTH the regression rate and the tg rate side by side — even when the toggle is off. This gives us free offline A/B from the logs.

- [ ] **Step 5: Brace check + commit**

Run: `python3 -c "s=open('ios/Wrotate/Wrotate/TimegrapherEngine.swift').read(); print('braces', s.count('{')==s.count('}'))"`
```bash
git add ios/Wrotate/Wrotate/TimegrapherEngine.swift
git commit -m "mic engine: honor useTgAlgo toggle; log tgRate alongside regression rate"
```

---

### Task 4: Bridge — pass the algo flag from the start message

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherBridge.swift` (the `case "start"` mic branch, ~line 35, and `startMeasurement`)

**Interfaces:**
- Consumes: `body["algo"] as? String` ("tg" | "original").
- Produces: `startMeasurement(bph:sensitivity:useTgAlgo:)` → `engine.start(bph:sensitivity:useTgAlgo:)`.

- [ ] **Step 1:** In `case "start"`, read `let algo = body["algo"] as? String ?? "original"` and pass `useTgAlgo: algo == "tg"` down through `startMeasurement` into `engine.start(...)`. Add `algo=\(algo)` to the `[TG BRIDGE START]` log.

- [ ] **Step 2: Brace check + commit**

```bash
git add ios/Wrotate/Wrotate/TimegrapherBridge.swift
git commit -m "bridge: pass algo flag (tg|original) to the mic engine start"
```

---

### Task 5: JS — feature flag + admin toggle + send at start

**Files:**
- Modify: `index.html` (FEATURE_FLAGS + `_tgAlgo()` helper + toggle UI in the piezo/admin panel + start sites + `sw.js`)

**Interfaces:**
- Consumes: nothing (leaf).
- Produces: start messages include `algo: _tgAlgo()`; `_tgAlgo()` returns `'tg'` when flag `tg_algo` is on AND the admin toggle is set, else `'original'`.

- [ ] **Step 1: Add the feature flag** to the `FEATURE_FLAGS` object: `tg_algo: false` (admin dev-flag, same mechanism as `tg_piezo`).

- [ ] **Step 2: Add helper + toggle**

```javascript
function _tgAlgo() {
  if (!featureFlag('tg_algo')) return 'original';
  return localStorage.getItem('tg_algo_sel') === 'tg' ? 'tg' : 'original';
}
function onTgAlgo(v) { localStorage.setItem('tg_algo_sel', v); }
```
Add an admin-only `<select id="tg-algo-sel" onchange="onTgAlgo(this.value)">` with options `original` / `tg (autocorrelation)` to the admin panel (shown only when `featureFlag('tg_algo')`), prefilled in the panel init.

- [ ] **Step 3: Send it at the mic start site(s)** — in `toggleMsrListen` (the `postMessage({action:'start', ...})` for the native path, ~line 23255) add `algo: _tgAlgo()` to the payload. (Piezo start is separate and unaffected.)

- [ ] **Step 4: Bump SW** (`sw.js` → next `wristlog-vNN`).

- [ ] **Step 5: Run tests**

Run: `npm test && npm run test:e2e`
Expected: `1119 passed` and `104 passed`.

- [ ] **Step 6: Commit + push (JS deploys; Swift still needs the rebuild)**

```bash
git add index.html sw.js
git commit -m "measure: admin toggle to select tg detection core (behind tg_algo flag)"
git push origin main
```

---

### Task 6: On-device A/B validation (TestFlight)

**Files:** none (validation task).

- [ ] **Step 1:** Rebuild on the MacBook Pro (Xcode) with the latest commit; install via TestFlight.
- [ ] **Step 2:** Enable the `tg_algo` flag (admin dev-flags), select **tg** in the toggle. Measure the Hamilton (21600) on the USB device AND the iPhone built-in mic. Then switch to **original** and repeat, same watch/position.
- [ ] **Step 3:** Report back. I pull the logs and compare, per run: time-to-first-stable, drift-after-stable, final rate vs tg-on-laptop (+4). Success = tg core converges faster (<~15s), doesn't drift after stable, and lands within a few s/day of tg/laptop. Because Task 3 logs `tgRate` even when the toggle is off, we also get a free offline A/B on every original run.
- [ ] **Step 4:** If it wins → next plan: amplitude + graphics, then promote tg to default (remove flag) per the ship criteria.

---

## Self-Review notes

- **Spec coverage:** toggle-to-select (Task 3/5), feature-flag admin (Task 5), TestFlight A/B (Task 6), ship-if-it-works (Task 6 Step 4) — all covered. Rate-only scope respected (amplitude deferred).
- **Type consistency:** `computeTgRate() -> Double?`, `recentEnvelope(Int) -> [Float]`, `tgPeriod([Float], nominal: Double) -> Double?`, `start(bph:sensitivity:useTgAlgo:)`, `algo` string "tg"|"original", `_tgAlgo()` → same strings. Consistent across tasks.
- **Risk flagged in Task 2 Step 4:** confirm the exact stored-property name for the ring's sample rate before finalizing (`ringSampleRate` vs whatever `start` actually uses) — the plan assumes `ringSampleRate`.
