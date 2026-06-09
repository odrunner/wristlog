# Native Phase-Locked Peak Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the native detector from flipping between a twin-peak watch's two near-equal clicks by, once locked, firing the candidate peak **closest to the predicted tick time** — fixing fabricated beat error + corrupted rate (Kurono) without regressing single-peak watches.

**Architecture:** In `TimegrapherEngine`'s streaming fire path, when phase-lock is on and locked, buffer the energy crests that fall in a window around the predicted next tick, fire the one closest to `expectedTickInterval` at window close, and carry the leftover samples forward so consecutive intervals stay candidate-to-candidate. Exposed as an A/B tunable (`phaseLock`) through the bridge + JS, drivable from the `timegrapher_tuning` table like `tickDetectMult`.

**Tech Stack:** Swift (TimegrapherEngine/Bridge — Claude writes, USER compiles in Xcode + TestFlights), Vanilla JS, Supabase, Python (offline prototype). **No native unit tests exist; Swift is validated by Xcode build + on-device A/B; the offline prototype validates the algorithm.**

---

## File Structure
- `scripts/twinpeak_prototype.py` — Create: the offline amplitude-pick vs phase-locked check (reproducible design validation).
- `ios/Wrotate/Wrotate/TimegrapherEngine.swift` — Modify: phase-lock state + carry + candidate/window selection + `setTuning` params.
- `ios/Wrotate/Wrotate/TimegrapherBridge.swift` — Modify: parse `phaseLock`/`phaseLockWindow`/`phaseLockMaxMiss`.
- `index.html` — Modify: hidden tuning inputs + `sendMsrTuning` payload + tuning-poll applies `phase_lock` from the table.
- `sw.js` — Modify: cache bump.
- Supabase — `phase_lock` + `phase_lock_window` columns on `timegrapher_tuning`.

**Pre-commit hook** bumps `APP_VERSION` in index.html on every commit (expected).
**Swift caveat:** these tasks can't `npm test` the Swift. After Swift edits, the verification is "USER builds in Xcode (no compile errors) + on-device A/B." A reviewer should read the Swift for logic correctness since it can't be run here.

---

## Task 1: Offline prototype script (reproducible design check)

**Files:** Create `scripts/twinpeak_prototype.py`.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Twin-peak detection prototype: amplitude-pick (current) vs phase-locked (proposed).
Reads a mono recording of a ticking watch, prints interval std + beat error for each method.
Validates the phase-locked fix offline. Usage: python3 scripts/twinpeak_prototype.py <wav_or_m4a> <bph>"""
import sys, subprocess, tempfile, os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt, find_peaks

def load(path):
    if path.lower().endswith('.wav'):
        wav = path
    else:
        wav = tempfile.mktemp(suffix='.wav')
        subprocess.run(['ffmpeg','-y','-i',path,'-ac','1','-ar','48000',wav],
                       check=True, capture_output=True)
    sr, y = wavfile.read(wav)
    return sr, y.astype(float)

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'docs/superpowers/specs/kurono1-reference.m4a'
    bph = int(sys.argv[2]) if len(sys.argv) > 2 else 28800
    sr, y = load(path); y -= y.mean()
    sos = butter(4,[1500,9000],btype='band',fs=sr,output='sos'); yb = sosfiltfilt(sos,y)
    env = np.abs(yb); w = int(sr*0.0007); env = np.convolve(env,np.ones(w)/w,mode='same'); env /= env.max()
    thr = np.median(env) + 3*np.median(np.abs(env-np.median(env)))
    EXP = 3600.0/bph*1000  # ms per beat
    cand,_ = find_peaks(env, height=thr*0.5, distance=int(sr*0.0015)); ct = cand/sr
    def metrics(times):
        t = np.array(sorted(times)); d = np.diff(t)*1000
        d = d[(d > EXP*0.5) & (d < EXP*1.6)]
        even, odd = d[0::2], d[1::2]; m = min(len(even), len(odd))
        be = abs(np.mean(even[:m]) - np.mean(odd[:m])) if m else float('nan')
        return np.std(d), be, len(t)
    amppk,_ = find_peaks(env, height=thr, distance=int(sr*0.090)); A = metrics(amppk/sr)
    P = EXP/1000; locked=[ct[0]]; nxt = ct[0]+P
    while nxt < ct[-1]+P:
        near = ct[(ct > nxt-0.4*P) & (ct < nxt+0.4*P)]
        if len(near): pick = near[np.argmin(np.abs(near-nxt))]; locked.append(pick); nxt = pick+P
        else: nxt += P
    B = metrics(locked)
    print(f'file={os.path.basename(path)} bph={bph} expected_interval={EXP:.3f}ms')
    print(f'A amplitude-pick (current): interval_std={A[0]:.2f}ms beat_error={A[1]:.2f}ms n={A[2]}')
    print(f'B phase-locked (proposed):  interval_std={B[0]:.2f}ms beat_error={B[1]:.2f}ms n={B[2]}')

if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run it on the reference recording**

Run: `python3 scripts/twinpeak_prototype.py docs/superpowers/specs/kurono1-reference.m4a 28800`
Expected: method A interval_std ~20ms / beat_error ~2.9ms; method B interval_std <1ms / beat_error <0.1ms (the phase-locked fix).

- [ ] **Step 3: Commit**

```bash
git add scripts/twinpeak_prototype.py
git commit -m "feat(deep): twin-peak detection offline prototype (amplitude vs phase-locked)"
```

---

## Task 2: `phase_lock` columns on `timegrapher_tuning`

**Files:** DB only.

- [ ] **Step 1: Add columns**

```bash
npx supabase db query --linked "ALTER TABLE public.timegrapher_tuning ADD COLUMN IF NOT EXISTS phase_lock int; ALTER TABLE public.timegrapher_tuning ADD COLUMN IF NOT EXISTS phase_lock_window double precision;"
```
Expected: success.

- [ ] **Step 2: Verify**

```bash
npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='timegrapher_tuning' AND column_name LIKE 'phase_lock%' ORDER BY column_name;"
```
Expected: `phase_lock`, `phase_lock_window`.

---

## Task 3: Native phase-locked selection in `TimegrapherEngine.swift` (Claude writes; USER compiles)

**Files:** Modify `ios/Wrotate/Wrotate/TimegrapherEngine.swift`.

> No automated test here — correctness is by code review + Xcode build + on-device A/B. Keep the change contained.

- [ ] **Step 1: Add state + tunables.** Find the line `private var pendingTickPeakEnergy: Float = 0` (the peak-detect state added by 97229ce, ~line 154). Immediately AFTER it, add:

```swift
    // Phase-locked selection: once locked, pick the candidate crest closest to the predicted tick.
    private var phaseLockEnabled: Bool = false       // A/B tunable (default off => behaves as today)
    private var phaseLockWindow: Double = 0.4         // acceptance half-window as fraction of interval
    private var phaseLockMaxMiss: Int = 3             // consecutive misses before dropping lock
    private var plHaveCand: Bool = false
    private var plBestInterval: Int = 0
    private var plBestDist: Int = Int.max
    private var plMissCount: Int = 0
    private var plApplyCarry: Bool = false
    private var plPendingCarry: Int = 0
```

- [ ] **Step 2: Apply the carry at the top of the per-sample step.** Find the line `ringPosSinceLastTick += 1` (~line 533). Immediately AFTER it, add:

```swift
                    if plApplyCarry { ringPosSinceLastTick += plPendingCarry; plApplyCarry = false }
```

- [ ] **Step 3: Insert phase-lock candidate/window logic.** Find the block that ends the fire decision — the lines:

```swift
                    } else if pendingTickCross {
                        pendingTickCross = false
                        shouldFireTick = true
                    }

                    if shouldFireTick {
```
Insert the following BETWEEN the closing `}` of the `else if pendingTickCross` block and the `if shouldFireTick {` line:

```swift
                    // Phase-locked selection: when locked, defer firing and pick the crest closest to
                    // the predicted tick time (ignores a louder twin ~3.5ms away). No-op pre-lock and
                    // on single-peak watches (one candidate in window => same tick as before).
                    let plActive = phaseLockEnabled && lastTickRingPos >= 0 && expectedTickInterval > 0
                    if plActive {
                        let expI = Int(expectedTickInterval)
                        let lo = Int(expectedTickInterval * (1.0 - phaseLockWindow))
                        let hi = Int(expectedTickInterval * (1.0 + phaseLockWindow))
                        if shouldFireTick {
                            let intv = ringPosSinceLastTick
                            if intv >= lo && intv <= hi {
                                let d = abs(intv - expI)
                                if !plHaveCand || d < plBestDist { plHaveCand = true; plBestInterval = intv; plBestDist = d }
                            }
                            shouldFireTick = false   // defer; decide at window close
                        }
                        if ringPosSinceLastTick > hi {
                            if plHaveCand {
                                plPendingCarry = ringPosSinceLastTick - plBestInterval
                                plApplyCarry = true
                                ringPosSinceLastTick = plBestInterval   // fire path reads this as the interval
                                shouldFireTick = true
                                plMissCount = 0
                            } else {
                                plMissCount += 1
                                ringPosSinceLastTick -= expI            // re-predict next beat
                                if plMissCount >= phaseLockMaxMiss { lastTickRingPos = -1; plMissCount = 0 }  // drop lock => re-acquire
                            }
                            plHaveCand = false; plBestDist = Int.max
                        }
                    }
```

- [ ] **Step 4: Reset phase-lock state with the other detection state.** Find each place that resets `pendingTickCross = false; pendingTickPeakEnergy = 0` (there are ~2: a mid-session reset and the `resetDetectionState`-style block near the end). At EACH, append on the same line:

```swift
 plHaveCand = false; plBestDist = Int.max; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
```
(Find them: `grep -n "pendingTickCross = false; pendingTickPeakEnergy = 0" ios/Wrotate/Wrotate/TimegrapherEngine.swift` — update all.)

- [ ] **Step 5: Add the tunable params to `setTuning`.** In `func setTuning(...)`, add three optional params to the signature (after `peakDetectGate: Double? = nil`):

```swift
                    , phaseLock: Bool? = nil, phaseLockWindow: Double? = nil, phaseLockMaxMiss: Int? = nil
```
And in the body (after `if let v = peakDetectGate { self.peakDetectGate = Float(v) }`), add:

```swift
        if let v = phaseLock { self.phaseLockEnabled = v }
        if let v = phaseLockWindow { self.phaseLockWindow = v }
        if let v = phaseLockMaxMiss { self.phaseLockMaxMiss = v }
```
And extend the `[TGTUNE]` debugLog string with: ` phaseLock=\(self.phaseLockEnabled)/\(self.phaseLockWindow)`.

- [ ] **Step 6: Commit** (no build here — USER compiles in Xcode)

```bash
git add ios/Wrotate/Wrotate/TimegrapherEngine.swift
git commit -m "feat(tg): native phase-locked peak selection (twin-peak fix, A/B tunable)"
```

---

## Task 4: Bridge + JS plumbing for the `phaseLock` A/B tunable

**Files:** Modify `ios/Wrotate/Wrotate/TimegrapherBridge.swift`, `index.html`.

- [ ] **Step 1: Bridge — parse the new params.** In `TimegrapherBridge.swift`, `case "tuning":`, after `let peakDetectGate = body["peakDetectGate"] as? Double`, add:

```swift
            let phaseLock = body["phaseLock"] as? Bool
            let phaseLockWindow = body["phaseLockWindow"] as? Double
            let phaseLockMaxMiss = body["phaseLockMaxMiss"] as? Int
```
And in the `engine.setTuning(...)` call, append the args (after `peakDetectGate: peakDetectGate`):

```swift
                             , phaseLock: phaseLock, phaseLockWindow: phaseLockWindow, phaseLockMaxMiss: phaseLockMaxMiss
```

- [ ] **Step 2: JS — hidden tuning inputs.** In `index.html`, find the hidden input `<input type="hidden" id="msr-tune-peak-detect-gate"` (in the `msr-tune-*` block ~line 3540). Immediately AFTER it, add:

```html
        <input type="hidden" id="msr-tune-phase-lock" value="0">
        <input type="hidden" id="msr-tune-phase-lock-window" value="0.4">
        <input type="hidden" id="msr-tune-phase-lock-max-miss" value="3">
```

- [ ] **Step 3: JS — send them in `sendMsrTuning`.** In `sendMsrTuning()`, after the `peakDetectGate: Number(document.getElementById('msr-tune-peak-detect-gate').value)` line, add (note the comma on the prior line):

```js
    phaseLock: document.getElementById('msr-tune-phase-lock').value === '1',
    phaseLockWindow: Number(document.getElementById('msr-tune-phase-lock-window').value),
    phaseLockMaxMiss: Number(document.getElementById('msr-tune-phase-lock-max-miss').value)
```

- [ ] **Step 4: JS — drive it from the tuning table (remote A/B).** In `startTuningPoll`, find the flag-gated `tick_detect_mult` block (added earlier: `if (featureFlag('tg_quality_v2')) { ... resolveTdm ... }`). Immediately AFTER that block, add:

```js
      if (featureFlag('tg_quality_v2')) {
        if (data.phase_lock != null) { const e = document.getElementById('msr-tune-phase-lock'); if (e) e.value = data.phase_lock ? '1' : '0'; }
        if (data.phase_lock_window != null) { const e = document.getElementById('msr-tune-phase-lock-window'); if (e) e.value = data.phase_lock_window; }
      }
```
(`sendMsrTuning()` is already called right after in the poll, so the values propagate to native within the 3s poll.)

- [ ] **Step 5: Verify JS wiring + suite**

Run: `grep -n "msr-tune-phase-lock\|phaseLock:\|data.phase_lock" index.html` (expect the inputs, the payload, the poll application) and `npm test && npm run test:e2e` — all green (e2e loads index.html; re-run once on a flaky timeout).

- [ ] **Step 6: Commit**

```bash
git add ios/Wrotate/Wrotate/TimegrapherBridge.swift index.html
git commit -m "feat(tg): phaseLock A/B plumbing (bridge + sendMsrTuning + tuning-table drive)"
```

---

## Task 5: SW bump + verification + on-device A/B UAT

**Files:** Modify `sw.js`.

- [ ] **Step 1: Bump SW cache.** `grep -n "wristlog-v" sw.js`, increment by one.

- [ ] **Step 2: JS suite.** `npm test && npm run test:e2e` — all green.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache version for phase-lock plumbing"
```

- [ ] **Step 4: On-device A/B UAT (USER builds Xcode + TestFlight; do not declare success until measured).**

1. USER builds the iOS app in Xcode (confirm it compiles) and installs via TestFlight.
2. Baseline (phase-lock OFF): `npx supabase db query --linked "UPDATE public.timegrapher_tuning SET phase_lock=0, updated_at=now() WHERE id=1;"` — couple the **Kurono**, run a Mic Batch ×15. Expect BE ~3ms, SD ~2.7 (reproduces the bug).
3. Fix ON: `npx supabase db query --linked "UPDATE public.timegrapher_tuning SET phase_lock=1, updated_at=now() WHERE id=1;"` — re-batch the Kurono. **Expect beat error → ~0.2ms, SD collapse, rate → ~+9.5 (matches Weishi).** Confirm via:
   `npx supabase db query --linked "SELECT round(avg(native_beat_error)::numeric,2) be, round(stddev_samp(native_rate)::numeric,2) sd, round(avg(native_rate)::numeric,2) rate FROM measurement_batch_runs WHERE batch_id=(SELECT batch_id FROM measurement_batch_runs ORDER BY created_at DESC LIMIT 1);"`
4. Regression check: with phase_lock=1, batch **Hamilton/Tudor/JLC** — confirm BE/SD/rate unchanged vs their earlier baselines (single-peak watches must be unaffected).
5. Reset when done: `npx supabase db query --linked "UPDATE public.timegrapher_tuning SET phase_lock=NULL, updated_at=now() WHERE id=1;"`. If validated, a follow-up flips the native default `phaseLockEnabled = true`.

---

## Self-Review

**Spec coverage:**
- Phase-locked selection (window, closest-to-predicted, fire at close, miss handling/drop-lock) → Task 3 Steps 1-4. ✓
- Keeps 97229ce (candidates are energy crests) + acquisition unchanged (plActive requires lock) + no-op on single-peak (one candidate) → Task 3 (plActive gate, candidate from existing crest). ✓
- A/B tunable via bridge + JS + table → Task 3 Step 5 + Task 4. ✓
- Offline prototype as reproducible check → Task 1. ✓
- DB `phase_lock`/`phase_lock_window` → Task 2. ✓
- Validation = Xcode build + on-device A/B (Kurono fix + clean-watch regression) → Task 5 Step 4. ✓
- Default OFF (behaves as today until enabled) → Task 3 Step 1 (`phaseLockEnabled=false`). ✓
- Out of scope (amplitude, piezo, phase-recovery-param exposure, Direction A) → absent. ✓

**Placeholder scan:** none — full Swift/JS/SQL/commands.

**Type consistency:** new engine vars `phaseLockEnabled/phaseLockWindow/phaseLockMaxMiss` + `pl*` match across Steps 1-5; `setTuning` params (`phaseLock`/`phaseLockWindow`/`phaseLockMaxMiss`) match the bridge args (Task 4 Step 1) and the JS payload keys (`phaseLock`/`phaseLockWindow`/`phaseLockMaxMiss`, Task 4 Step 3); table columns `phase_lock`/`phase_lock_window` match the poll reads (Task 4 Step 4). Hidden input ids `msr-tune-phase-lock[-window|-max-miss]` consistent. ✓

**Risk note:** Task 3 is intricate streaming surgery that can't be compiled/run here. The carry mechanism (Steps 2-3) keeps consecutive intervals candidate-to-candidate; a code reviewer should trace it, and the on-device A/B (Task 5) is the real proof. If the live result is off, iterate on the carry/window via TestFlight.
