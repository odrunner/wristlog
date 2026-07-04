# tg v2 Confidence UX (amplitude + folded scope + tightened dots) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tg detection core read as "fast, tight, and shows amplitude" — add computed amplitude (°), a folded-beat mini-scope, and re-reference the scatter dots to the tg period — so the fast convergence is backed by visible confidence (the v2 story).

**Architecture:** In the mic engine's tg path, build a tg-style averaged beat waveform (fold the envelope ring at the measured period), compute amplitude from the escapement pulse-pair timing + lift angle, and send `amplitude` + the folded `beatWaveform` in the existing `Update`. In JS (behind the same `tg_algo` flag), show an amplitude number+gauge, render the folded waveform as a mini-scope, and detrend the scatter dots so their slope matches the tg rate line (tight cloud). Amplitude/scope only apply when the tg core is active; original path unchanged.

**Tech Stack:** Swift / Accelerate (vDSP); vanilla JS (canvas); Python (numpy/scipy) for offline validation.

**Reference:** `docs/research/2026-07-03-tg-algorithm-learnings.md` §5 (amplitude formula + pulse detection), and the Build-1 core in `TimegrapherEngine.swift` (`computeTgRate`, `recentEnvelope`, `tgPeriod`).

## Global Constraints

- **Behind the existing `tg_algo` flag + toggle.** Amplitude/scope/dots changes apply ONLY when the tg core is active; the original algorithm and its display are untouched.
- **Swift changes require a TestFlight rebuild.** Validate Swift via on-device A/B + the offline prototype, not unit tests.
- **JS:** bump `sw.js` cache version every change; `npm test` + `npm run test:e2e` must pass before commit/push.
- **One change at a time**; commit per task. Swift tasks (2) land in one rebuild; JS tasks deploy immediately.
- **Amplitude formula (tg):** `amp° = liftAngleDeg / (2·sin(π · Δt / period))`, where `period` = full tic-to-tic period (ring samples), `Δt` = samples between the escapement's secondary pulse and the beat marker. Average tic & toc. Default `liftAngleDeg = 52`. Plausibility gate: report only if `135 ≤ amp ≤ 360` for both tic & toc AND `|ampTic − ampToc| ≤ 60`, else amplitude unavailable (nil).

---

### Task 1: Offline — extend the prototype with fold + amplitude (lock the recipe)

Prove the fold and amplitude math on real captures before porting to Swift.

**Files:**
- Modify: `scripts/tg_offline_prototype.py`

**Interfaces:**
- Produces the recipe: fold = sum of envelope at `k·period` over all k, per-bin **trimmed mean** (drop top 20%); tic marker = fold argmax; toc marker = autocorr peak of the fold near `period/2`; secondary pulse = first threshold crossing scanning back over `[7·period/8, period)`; `amp° = liftAngle/(2·sin(π·Δt/period))`.

- [ ] **Step 1: Add `tg_fold(env, period)`** — returns a period-length averaged pulse (trimmed mean per phase bin), aligned to the fold's fundamental Fourier phase.

```python
def tg_fold(env, period):
    P = int(round(period)); n = len(env)//P
    if n < 4: return None
    M = np.array([env[i*P:(i+1)*P] for i in range(n)])   # n beats × P
    keep = max(1, int(n*0.8))                             # trimmed mean: drop loudest 20%
    fold = np.sort(M, axis=0)[:keep].mean(axis=0)
    return fold - np.median(fold)
```

- [ ] **Step 2: Add `tg_amplitude(fold, period, la=52)`** — tic/toc pulse-pair → amplitude.

```python
def tg_amplitude(fold, period, la=52.0):
    P = len(fold); glob = fold.max()
    thr = max(0.01*glob, 1.4*np.median(np.abs(fold)))
    def pulse_before(marker):
        # scan back over the eighth-period window before the marker for the secondary pulse
        for d in range(int(P/8), 2, -1):
            i = (marker - d) % P
            if fold[i] > thr: return d      # Δt in samples
        return None
    tic = int(np.argmax(fold))
    # toc marker ≈ half a period away
    seg = fold[(tic+int(P*0.4)) % P : (tic+int(P*0.6)) % P] if tic+int(P*0.6) < P else fold[int(P*0.4):int(P*0.6)]
    toc = (tic + int(P*0.4) + int(np.argmax(seg))) % P
    amps=[]
    for mk in (tic, toc):
        dt = pulse_before(mk)
        if dt is None: return None
        s = math.sin(math.pi*dt/period)
        if s <= 0: return None
        amps.append(la/(2*s))
    if not (135 <= amps[0] <= 360 and 135 <= amps[1] <= 360 and abs(amps[0]-amps[1]) <= 60): return None
    return sum(amps)/2
```

- [ ] **Step 3: Wire into `main`** — for each capture, after computing the tg rate on the full window, also print `amp=tg_amplitude(tg_fold(env, period), period)`.

- [ ] **Step 4: Run on the strong capture and confirm a plausible amplitude**

Run: `python3 scripts/tg_offline_prototype.py 12`
Expected: `amp` prints a value in a plausible mechanical range (roughly 200–320°) or `--` if the pulse pair isn't clean. It must NOT throw and must NOT print values outside 135–360. Record the value in the commit message. (No ground truth per-capture; we're validating the math is sane and stable, and the strong capture should yield a number.)

- [ ] **Step 5: Commit**

```bash
git add scripts/tg_offline_prototype.py
git commit -m "prototype: add tg fold + pulse-pair amplitude; validate on strong capture"
```

---

### Task 2: Swift — fold + amplitude in the engine, added to Update (tg path only)

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherEngine.swift` (add `tgFoldedBeat`/`tgAmplitude` near `computeTgRate`; add `amplitude` field to `Update`; set them in the emit path; add `liftAngleDeg` property)

**Interfaces:**
- Consumes: `recentEnvelope(_:)`, `tgPeriod(_:nominal:ringSampleRate:)`, `computeTgRate()` (Build 1); `actualSampleRate`, `ringSubsampleTarget`, `targetBph`, `useTgAlgo`.
- Produces: `Update.amplitude: Double?` (degrees, nil if unavailable); a folded `beatWaveform`; `func setTuning(... liftAngle: Double? ...)` accepts a lift angle (default 52).

- [ ] **Step 1: Add lift-angle property**

```swift
private var liftAngleDeg: Double = 52.0   // escapement lift angle for amplitude (tunable)
```

- [ ] **Step 2: Add the fold + amplitude methods (near computeTgRate)**

```swift
/// tg-style averaged beat: fold the recent envelope at the measured period (trimmed mean per bin).
private func tgFoldedBeat(period: Double) -> [Float]? {
    let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
    let P = Int(period.rounded()); guard P > 8 else { return nil }
    let env = recentEnvelope(Int(ringSampleRate * 8))          // up to 8s of beats
    let nBeats = env.count / P; guard nBeats >= 4 else { return nil }
    var fold = [Float](repeating: 0, count: P)
    var col = [Float](repeating: 0, count: nBeats)
    let keep = max(1, Int(Double(nBeats) * 0.8))
    for p in 0..<P {
        for b in 0..<nBeats { col[b] = env[b*P + p] }
        col.sort()                                             // trimmed mean: drop loudest 20%
        var s: Float = 0; for b in 0..<keep { s += col[b] }
        fold[p] = s / Float(keep)
    }
    var med: Float = 0; vDSP_meanv(fold, 1, &med, vDSP_Length(P))  // cheap center (mean≈median-ish)
    var neg = -med; vDSP_vsadd(fold, 1, &neg, &fold, 1, vDSP_Length(P))
    return fold
}

/// Amplitude (degrees) from the escapement pulse-pair + lift angle. nil if not plausible.
private func tgAmplitude(fold: [Float], period: Double) -> Double? {
    let P = fold.count; guard P > 8 else { return nil }
    let glob = fold.max() ?? 0
    var absmean: Float = 0; for v in fold { absmean += abs(v) }; absmean /= Float(P)
    let thr = max(0.01 * glob, 1.4 * absmean)
    func pulseBefore(_ marker: Int) -> Int? {
        var d = P/8
        while d > 2 { let i = ((marker - d) % P + P) % P; if fold[i] > thr { return d }; d -= 1 }
        return nil
    }
    var tic = 0; var tv = fold[0]
    for i in 1..<P where fold[i] > tv { tv = fold[i]; tic = i }
    let lo = (tic + Int(Double(P)*0.4)) % P, hi = (tic + Int(Double(P)*0.6)) % P
    var toc = lo; var bv = fold[lo]; var j = lo
    while j != hi { if fold[j] > bv { bv = fold[j]; toc = j }; j = (j + 1) % P }
    var amps: [Double] = []
    for mk in [tic, toc] {
        guard let dt = pulseBefore(mk) else { return nil }
        let s = sin(Double.pi * Double(dt) / period); if s <= 0 { return nil }
        amps.append(liftAngleDeg / (2 * s))
    }
    guard amps.allSatisfy({ 135 <= $0 && $0 <= 360 }), abs(amps[0] - amps[1]) <= 60 else { return nil }
    return (amps[0] + amps[1]) / 2
}
```

- [ ] **Step 3: Add `amplitude` to the `Update` struct** — add `let amplitude: Double?` after `let beatWaveform: [Float]?`. Update the `Update(...)` initializer call (near line 1079) to pass it (Step 5 computes it).

- [ ] **Step 4: Compute amplitude + fold in the emit path (tg only), cache with the rate** — where `tgRateCached` is refreshed (Build 1, ~every 0.5s), also refresh the fold + amplitude:

```swift
if wallElapsed - lastTgComputeSec > 0.5 {
    lastTgComputeSec = wallElapsed
    tgRateCached = computeTgRate()
    if useTgAlgo {
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let nominal = 7200.0 / Double(targetBph) * ringSampleRate
        if let period = tgPeriod(recentEnvelope(Int(ringSampleRate*8)), nominal: nominal, ringSampleRate: ringSampleRate),
           let fold = tgFoldedBeat(period: period) {
            tgFoldCached = fold
            tgAmpCached = tgAmplitude(fold: fold, period: period)
        }
    }
}
```
Declare `private var tgFoldCached: [Float]? = nil` and `private var tgAmpCached: Double? = nil`; reset both in `start` alongside `tgRateCached`.

- [ ] **Step 5: Pass amplitude + fold into the Update** — at the `Update(...)` construction, set `amplitude: useTgAlgo ? tgAmpCached : nil` and `beatWaveform: useTgAlgo ? tgFoldCached : lastBeatWaveform`. Add to the `[TGALGO]` log: `amp=\(tgAmpCached.map { String(format: "%.0f", $0) } ?? "nil")`.

- [ ] **Step 6: Accept `liftAngle` in `setTuning`** — add `liftAngle: Double? = nil` param; `if let v = liftAngle { liftAngleDeg = v }`.

- [ ] **Step 7: Brace check + commit**

Run: `python3 -c "s=open('ios/Wrotate/Wrotate/TimegrapherEngine.swift').read(); print('braces', s.count('{')==s.count('}'))"`
```bash
git add ios/Wrotate/Wrotate/TimegrapherEngine.swift
git commit -m "mic engine: tg amplitude (pulse-pair + lift angle) + folded beat in Update"
```

---

### Task 3: Bridge — forward amplitude + lift angle

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherBridge.swift` (mic `onUpdate` payload ~line 140-168; `tuning` message)

**Interfaces:**
- Produces: mic Update payload includes `"amplitude": update.amplitude as Any`; `tuning` message reads `body["liftAngle"] as? Double` and forwards to `engine.setTuning(... liftAngle: ...)`.

- [ ] **Step 1:** In the mic `onUpdate` payload dictionary, add `"amplitude": update.amplitude as Any`.
- [ ] **Step 2:** In `case "tuning"`, read `let liftAngle = body["liftAngle"] as? Double` and pass `liftAngle: liftAngle` into the existing `engine.setTuning(...)` call.
- [ ] **Step 3: Brace check + commit**

```bash
git add ios/Wrotate/Wrotate/TimegrapherBridge.swift
git commit -m "bridge: forward tg amplitude to JS; pass liftAngle to setTuning"
```

---

### Task 4: JS — amplitude display (number + gauge) for the tg path

**Files:**
- Modify: `index.html` (the live HUD near `msr-live-rate`; the `_tgNativeCallback` update handler; `sw.js`)

**Interfaces:**
- Consumes: `data.amplitude` (number°|null) from the Update; `_tgAlgo()`.
- Produces: a `#msr-live-amp` element that shows `NNN°` when tg is active and amplitude is present; hidden otherwise.

- [ ] **Step 1:** Add an amplitude readout element next to the live rate HUD (mirror the beat-error element's markup): `<span id="msr-live-amp" style="display:none;">—</span>` with a small "AMP" label.
- [ ] **Step 2:** In `_tgNativeCallback`, when `isMsr`, update it:

```javascript
const ampEl = document.getElementById('msr-live-amp');
if (ampEl) {
  if (_tgAlgo() === 'tg' && data.amplitude != null) {
    ampEl.parentElement.style.display = '';
    ampEl.textContent = Math.round(data.amplitude) + '°';
    ampEl.style.color = (data.amplitude >= 250) ? '#4ade80' : (data.amplitude >= 200 ? '#eab308' : '#ef4444');
  } else if (ampEl.parentElement) {
    ampEl.parentElement.style.display = 'none';
  }
}
```

- [ ] **Step 3:** On stop/converge, prefill the manual amplitude field (`#tg-amplitude-input`) with the computed value if present, so it's saved with the measurement: in `stopMsrListen`, `if (_tgAlgo()==='tg' && _msrLastAmp != null) document.getElementById('tg-amplitude-input').value = Math.round(_msrLastAmp);` (track `_msrLastAmp = data.amplitude` in the update handler).
- [ ] **Step 4:** Bump SW; `npm test && npm run test:e2e` (expect pass); commit + push.

```bash
git add index.html sw.js
git commit -m "measure: show computed amplitude (tg path) + prefill save field"
git push origin main
```

---

### Task 5: JS — folded-beat mini-scope

**Files:**
- Modify: `index.html` (add a small canvas near the scatter; render `data.beatWaveform`; `sw.js`)

**Interfaces:**
- Consumes: `data.beatWaveform` (Array<number>) from the Update.
- Produces: `#msr-beat-scope` canvas drawn each update when tg is active and a waveform is present.

- [ ] **Step 1:** Add `<canvas id="msr-beat-scope" width="120" height="40" style="display:none;">` near the scatter plot (admin/tg only).
- [ ] **Step 2:** Add `renderBeatScope(wave)` — normalize to [-1,1], draw the folded pulse as a phosphor-green line on the canvas (reuse the scatter's green `#4ade80`). Show two beat markers (tic/toc) as faint vertical lines at argmax and ~half-period.
- [ ] **Step 3:** In the update handler, when `_tgAlgo()==='tg' && data.beatWaveform`, show the canvas and call `renderBeatScope(data.beatWaveform)`; else hide it.
- [ ] **Step 4:** Bump SW; tests; commit + push.

```bash
git add index.html sw.js
git commit -m "measure: folded-beat mini-scope for the tg path"
git push origin main
```

---

### Task 6: JS — re-reference the scatter dots to the tg rate (tight cloud)

The dots come from the beat detector (its own noisier rate), so their slope drifts away from the tg line. Detrend them to the tg rate so the cloud sits tight around the line = visible confidence.

**Files:**
- Modify: `index.html` (`drawMsrScatterCore` / the dot `cd` mapping; `sw.js`)

**Interfaces:**
- Consumes: `_msrLastRate` (= tg rate when tg active), `_msrScatterData[].cd`, `.t`.
- Produces: when `_tgAlgo()==='tg'`, each dot is plotted at `cd − (tgRate/86.4)·t` (removing the tg-rate trend) so the cloud is horizontal and the rate line is drawn flat through it.

- [ ] **Step 1:** In `drawMsrScatterCore`, compute `const detrend = (_tgAlgo && _tgAlgo()==='tg' && _msrLastRate!=null) ? _msrLastRate/86.4 : 0;` and plot each dot's y from `pt.cd - detrend*pt.t` instead of `pt.cd`. Draw the rate line horizontally (slope 0) in that mode, with the numeric rate labeled — so dots cluster tightly around a flat line at the tg rate.
- [ ] **Step 2:** Verify the non-tg path is unchanged (`detrend===0` → identical to today).
- [ ] **Step 3:** Bump SW; tests; commit + push.

```bash
git add index.html sw.js
git commit -m "measure: detrend scatter dots to the tg rate (tight cloud) for the tg path"
git push origin main
```

---

### Task 7: On-device A/B validation (TestFlight)

- [ ] **Step 1:** Rebuild on the MacBook Pro (Xcode) with the latest (Tasks 2–3 need it); install via TestFlight.
- [ ] **Step 2:** tg on, measure the Hamilton (mic + USB device). Confirm: amplitude shows a plausible ° (compare to tg-on-laptop's 286°), the folded scope shows a clean tick/tock pulse, and the dots sit tight around a flat line.
- [ ] **Step 3:** Report back with a screenshot + say done. I pull the `[TGALGO] ... amp=` logs and confirm amplitude stability across the run and vs the tg-laptop reference.
- [ ] **Step 4:** If it reads well → the confidence UX is done; decision point to promote tg to default v2 (drop the flag, brand "v2 fast & accurate") after broader multi-watch validation.

---

## Self-Review notes

- **Spec coverage:** amplitude (Tasks 1–4), folded scope (Task 5), dots-to-tg-period (Task 6) — all three confidence pieces covered; validation Task 7. Flag/toggle gating respected throughout.
- **Type consistency:** `tgFoldedBeat(period:) -> [Float]?`, `tgAmplitude(fold:period:) -> Double?`, `Update.amplitude: Double?`, `data.amplitude` (JS), `liftAngleDeg`/`liftAngle` param, `tgFoldCached`/`tgAmpCached`. Consistent across tasks.
- **Risk:** amplitude pulse detection is the least certain part — Task 1 validates the math offline first; if the strong capture yields no clean pulse pair, revisit the threshold/window before the Swift port. The `beatWaveform` field already exists in the Update + bridge, so Task 5 mostly reuses plumbing.
- **Lift angle:** default 52° (tg's default). A per-watch lift-angle input can be added later; not required for v1 (52° is a reasonable default for most modern watches).
