# Piezo Timegrapher Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate, piezo-only timegrapher engine (direct time-domain beat detection) selectable via an admin-gated Mic/Piezo picker, producing the same rate/beat-error/scatter outputs as the mic path, without touching the mic path for normal users.

**Architecture:** A new `PiezoEngine.swift` owns its own audio capture (USB/external input, `.default` mode, peak channel pick, gain, `[PZ]` diagnostics) and DSP (band-pass → envelope → adaptive-threshold beat detection → Theil-Sen rate regression + tick/tock beat error). `TimegrapherBridge` routes `start`/`stop`/`tuning` to either the existing `TimegrapherEngine` (mic) or `PiezoEngine` (piezo) based on a `source` field. Both emit the identical Update payload, so the existing JS scatter/rate UI is reused. The dormant external-input code added in commits `20aaee6`/`ca64bc7`/`2592f95` is stripped back out of `TimegrapherEngine`, returning it to built-in-mic-only.

**Tech Stack:** Swift / AVFoundation / Accelerate (iOS native), vanilla JS (index.html), vitest (unit), Playwright (mocked e2e), Supabase `timegrapher_tick_logs` for on-device debug logs.

**Testing reality:**
- JS logic → vitest "logic mirror" tests (re-implement the pure logic in the test, assert) following `tests/review-prompt.test.js`.
- JS DOM/behavior → Playwright mocked e2e in `e2e/app.mock.spec.js`.
- Swift → no XCTest target in this repo. Verify by (a) it compiles in Xcode on the MacBook Pro, (b) on-device behavior via `[PZ]` debug lines written to `timegrapher_tick_logs`, cross-checked against the Weishi reference. iOS builds cannot run on the Mac Mini (no `xcodebuild`).
- `npm test` (unit) and `npm run test:e2e` (mocked e2e) must pass before each JS commit. Bump `sw.js` cache version on any HTML/JS change.

**Reference source (validated this session, in git history):** the external-capture code to copy lives in commit `2592f95` `ios/Wrotate/Wrotate/TimegrapherEngine.swift` (`.default` session mode, `setPreferredInput` matching `.usbAudio`/`.lineIn`/`.headsetMic`/non-built-in, `routeChangeNotification` observer, peak-based channel pick, `setInputGain`, `[TGDIAG]` per-channel raw logging). View with `git show 2592f95:ios/Wrotate/Wrotate/TimegrapherEngine.swift`.

---

## Phase 0 — Strip external-input code from the mic engine

Returns `TimegrapherEngine` to built-in-mic-only. The pre-session version is at commit `114f1c0`.

### Task 0: Revert TimegrapherEngine to built-in-mic-only

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherEngine.swift`
- Modify: `ios/Wrotate/Wrotate/TimegrapherBridge.swift`

- [ ] **Step 1: Restore the pre-session mic engine**

```bash
cd "/Users/ozgurdogan/Documents/Claude project/watch tracker"
git show 114f1c0:ios/Wrotate/Wrotate/TimegrapherEngine.swift > ios/Wrotate/Wrotate/TimegrapherEngine.swift
```

This removes `externalInputMode`, `autoPickChannel`, `hpLow`, the route-change observer, the `.default`-mode branch, `setInputGain`, the `[TGDIAG]` per-channel block, and the lowered HP cutoffs — all the code added this session — restoring `.measurement` mode, channel 0, and `[4000,6000,8000]` cutoffs.

- [ ] **Step 2: Revert the bridge `start`/`startMeasurement` signatures to mic-only**

In `ios/Wrotate/Wrotate/TimegrapherBridge.swift`, the `case "start"` block currently reads `inputMode`/`autoPickChannel` and passes them through. Replace the whole `case "start":` block with:

```swift
        case "start":
            let bph = body["bph"] as? Int ?? 28800
            let sensitivity = body["sensitivity"] as? Int ?? 50
            print("[TG BRIDGE START] bph=\(bph) (0=auto) sensitivity=\(sensitivity)")
            startMeasurement(bph: bph, sensitivity: sensitivity)
```

And restore `startMeasurement` and the `engine.start` call to mic-only signatures:

```swift
    private func startMeasurement(bph: Int, sensitivity: Int) {
```

```swift
                self.engine.start(bph: bph, sensitivity: sensitivity)
```

- [ ] **Step 3: Verify mic engine reverted**

```bash
git diff 114f1c0 -- ios/Wrotate/Wrotate/TimegrapherEngine.swift
grep -n "externalInputMode\|autoPickChannel\|hpLow\|TGDIAG\|setInputGain" ios/Wrotate/Wrotate/TimegrapherEngine.swift
```
Expected: first command empty (identical to 114f1c0); second command no matches.

- [ ] **Step 4: Build on the MacBook Pro (Xcode), scheme `Wrotate`, ⌘B**

Expected: build succeeds. (No `xcodebuild` on the Mac Mini — this step is run on the build machine.)

- [ ] **Step 5: Commit**

```bash
git add ios/Wrotate/Wrotate/TimegrapherEngine.swift ios/Wrotate/Wrotate/TimegrapherBridge.swift
git commit -m "Timegrapher: revert mic engine to built-in-only; piezo capture moves to PiezoEngine"
```

---

## Phase 1 — PiezoEngine skeleton + capture

### Task 1: Create PiezoEngine with capture, channel pick, and `[PZ]` diagnostics

**Files:**
- Create: `ios/Wrotate/Wrotate/PiezoEngine.swift`

PiezoEngine owns its session/capture, copied and adapted from the validated `2592f95` code. It exposes the same `Update`/`TickDot` contract the bridge serializes. For this task it only captures audio, picks the peak channel, computes a noise level, and logs `[PZ]` per-channel raw levels — no DSP yet.

- [ ] **Step 1: Create the file with capture + diagnostics**

```swift
import AVFoundation
import Accelerate

/// Piezo (contact-pickup) timegrapher engine. Separate from TimegrapherEngine:
/// trusts the clean, strong, low-frequency impulses a contact piezo produces, via
/// direct time-domain beat detection. Emits the same Update contract as the mic engine.
class PiezoEngine {

    struct TickDot { let timeSec: Double; let deviationMs: Double }

    struct Update {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let confidence: Double
        let noiseLevel: Double
        let detectedIntervalMs: Double
        let detectedBph: Int?
        let cumulativeOffset: Double
        let elapsedSec: Double
        let method: String
        let rateStable: Bool
        let newTicks: [TickDot]
        let debugMessages: [String]
    }

    struct Result { let rate: Double?; let beatError: Double?; let tickCount: Int }

    var onUpdate: ((Update) -> Void)?

    private var audioEngine: AVAudioEngine?
    private var isRunning = false
    private var routeChangeObserver: NSObjectProtocol?
    private var actualSampleRate: Double = 48000

    // BPH
    private var targetBph: Int = 28800
    private var autoBph: Bool = false
    static let bphCandidates = [18000, 21600, 25200, 28800, 36000]

    // Diagnostics
    private var diagBufCount = 0
    private var diagChMaxPeak: [Float] = []
    private var diagChSumRms: [Float] = []
    private var debugMessages: [String] = []
    private var currentNoiseLevel: Double = 0

    private func debugLog(_ m: String) { print(m); debugMessages.append(m) }

    func start(bph: Int, autoPickChannel: Bool = true) {
        guard !isRunning else { return }
        if bph == 0 { autoBph = true; targetBph = 28800 } else { autoBph = false; targetBph = bph }
        diagBufCount = 0; diagChMaxPeak = []; diagChSumRms = []
        debugLog("[PZSTART] bph=\(bph) autoBph=\(autoBph)")

        do {
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            // .default (not .measurement): measurement crushes USB input to near-silence.
            try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothA2DP])
            try session.setPreferredSampleRate(48000)

            if let inputs = session.availableInputs {
                let preferred = inputs.first { $0.portType == .usbAudio }
                    ?? inputs.first { $0.portType == .lineIn }
                    ?? inputs.first { $0.portType == .headsetMic }
                    ?? inputs.first { $0.portType != .builtInMic }
                if let p = preferred {
                    try? session.setPreferredInput(p)
                    debugLog("[PZINPUT] preferred → \(p.portName) [\(p.portType.rawValue)]")
                }
            }
            try session.setActive(true)
            debugLog("[PZINPUT] inputGain=\(String(format: "%.2f", session.inputGain)) settable=\(session.isInputGainSettable)")
            if session.isInputGainSettable { try? session.setInputGain(1.0) }

            if let existing = routeChangeObserver { NotificationCenter.default.removeObserver(existing) }
            routeChangeObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
            ) { [weak self] note in self?.handleRouteChange(note) }

            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }
            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            actualSampleRate = format.sampleRate
            let route = session.currentRoute.inputs.map { "\($0.portName)[\($0.portType.rawValue)]" }.joined(separator: ",")
            debugLog("[PZINPUT] route=\(route) rate=\(String(format: "%.0f", actualSampleRate)) ch=\(format.channelCount)")

            configureDSP(sampleRate: actualSampleRate)   // defined in Task 2

            inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
                self?.processAudioBuffer(buffer)
            }
            try engine.start()
            isRunning = true
        } catch {
            print("[Piezo] Audio setup error: \(error.localizedDescription)")
        }
    }

    func stop() -> Result {
        isRunning = false
        if let obs = routeChangeObserver { NotificationCenter.default.removeObserver(obs); routeChangeObserver = nil }
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return Result(rate: currentRate, beatError: currentBeatError, tickCount: tickCount)
    }

    deinit { if let obs = routeChangeObserver { NotificationCenter.default.removeObserver(obs) } }

    private func handleRouteChange(_ notification: Notification) {
        guard isRunning else { return }
        guard let info = notification.userInfo,
              let raw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        switch reason {
        case .newDeviceAvailable, .oldDeviceUnavailable:
            let bphToRestart = autoBph ? 0 : targetBph
            debugLog("[PZINPUT] route changed (\(raw)) — restarting, bph=\(bphToRestart)")
            _ = stop(); start(bph: bphToRestart)
        default: break
        }
    }

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channels = buffer.floatChannelData else { return }
        let frameCount = Int(buffer.frameLength)
        let channelCount = max(1, Int(buffer.format.channelCount))

        var chRms = [Float](repeating: 0, count: channelCount)
        var chPeak = [Float](repeating: 0, count: channelCount)
        for c in 0..<channelCount {
            vDSP_rmsqv(channels[c], 1, &chRms[c], vDSP_Length(frameCount))
            vDSP_maxmgv(channels[c], 1, &chPeak[c], vDSP_Length(frameCount))
        }
        var chosen = 0
        var best = chPeak[0]
        for c in 1..<channelCount where chPeak[c] > best { best = chPeak[c]; chosen = c }
        let channelData = channels[chosen]
        currentNoiseLevel = min(1.0, Double(chRms[chosen]) * 10)

        // [PZ] diagnostics ~1/s
        if diagChMaxPeak.count != channelCount {
            diagChMaxPeak = [Float](repeating: 0, count: channelCount)
            diagChSumRms = [Float](repeating: 0, count: channelCount); diagBufCount = 0
        }
        for c in 0..<channelCount { if chPeak[c] > diagChMaxPeak[c] { diagChMaxPeak[c] = chPeak[c] }; diagChSumRms[c] += chRms[c] }
        diagBufCount += 1
        if diagBufCount >= 12 {
            let pk = diagChMaxPeak.map { String(format: "%.5f", $0) }.joined(separator: ",")
            let rm = (0..<channelCount).map { String(format: "%.5f", diagChSumRms[$0] / Float(diagBufCount)) }.joined(separator: ",")
            debugLog("[PZDIAG] chosen=ch\(chosen) rawPeak=[\(pk)] rawRms=[\(rm)]")
            diagChMaxPeak = [Float](repeating: 0, count: channelCount)
            diagChSumRms = [Float](repeating: 0, count: channelCount); diagBufCount = 0
        }

        processDSP(channelData, frameCount: frameCount)   // defined in Task 2/3
        emitUpdate()                                      // defined in Task 3
    }

    // Placeholders satisfied in later tasks (declared here so the file compiles):
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var tickCount: Int = 0
    private func configureDSP(sampleRate: Double) {}
    private func processDSP(_ data: UnsafeMutablePointer<Float>, frameCount: Int) {}
    private func emitUpdate() {}
}
```

- [ ] **Step 2: Add the file to the Xcode target**

In Xcode on the MacBook Pro, drag `PiezoEngine.swift` into the `Wrotate` group, target membership = `Wrotate`. (Or it is auto-detected if the project uses file-system synced groups — verify it appears under Build Phases → Compile Sources.)

- [ ] **Step 3: Build (⌘B)** — Expected: compiles. The empty `configureDSP`/`processDSP`/`emitUpdate` are intentional stubs.

- [ ] **Step 4: Commit**

```bash
git add ios/Wrotate/Wrotate/PiezoEngine.swift ios/Wrotate/Wrotate.xcodeproj/project.pbxproj
git commit -m "PiezoEngine: capture skeleton (external input, peak channel pick, [PZ] diagnostics)"
```

---

## Phase 2 — DSP: band-pass + envelope + beat detection

### Task 2: Band-pass + envelope + adaptive-threshold beat detection

**Files:**
- Modify: `ios/Wrotate/Wrotate/PiezoEngine.swift`

Replace the Task-1 stubs (`configureDSP`, `processDSP`, and the placeholder DSP state) with a real pipeline: 2nd-order Butterworth band-pass biquad → full-wave-rectified envelope (one-pole smoothing) at a subsampled ring rate → adaptive threshold with refractory → sub-sample parabolic peak time. Beat times (in seconds) accumulate into `pendingBeats` for Task 3.

- [ ] **Step 1: Add DSP state + tunables (insert near the other private vars)**

```swift
    // --- DSP tunables (piezo-specific) ---
    private var bpLowHz: Float = 150
    private var bpHighHz: Float = 5000
    private var envSmoothing: Float = 0.002     // one-pole time constant (s)
    private var threshMult: Float = 0.4         // detect at threshold * this
    private var threshDecay: Float = 0.999
    private var refractoryFrac: Double = 0.6    // min spacing = expectedInterval * this
    private var ringTargetRate: Double = 12000

    // --- DSP state ---
    private var bp = BandpassState()
    private var ringSubsample = 4
    private var ringRate: Double = 12000
    private var env: Float = 0
    private var envCoeff: Float = 0
    private var adaptiveThreshold: Float = 0
    private var calibNoiseFloor: Float = 0
    private var sampleCounter: Int64 = 0
    private var ringCounter: Int = 0
    private var lastBeatRing: Int = -1
    private var ringSinceBeat: Int = 0
    private var env1: Float = 0   // previous envelope (for parabolic peak)
    private var env2: Float = 0   // env two samples ago
    private var pendingCross = false
    private var pendingPeak: Float = 0
    private var calibrating = true
    private var calibSamples = 0
    private var calibDuration = 24000
    private var calibEnergies: [Float] = []
    private var expectedInterval: Double = 0   // ring samples between beats
    private var pendingBeats: [Double] = []    // beat times (s) since start, for Task 3
    private var lastPeakTimeSec: Double = 0
```

```swift
    private struct BandpassState {
        var b0: Float = 1; var b1: Float = 0; var b2: Float = 0
        var a1: Float = 0; var a2: Float = 0
        var x1: Float = 0; var x2: Float = 0; var y1: Float = 0; var y2: Float = 0
    }
    private func makeBandpass(low: Float, high: Float, sampleRate: Double) -> BandpassState {
        // Constant-skirt-gain band-pass biquad (RBJ cookbook), center f0 = sqrt(low*high).
        let f0 = sqrt(low * high)
        let bw = max(0.1, log2(Double(high) / Double(low)))   // bandwidth in octaves
        let w0 = 2 * Float.pi * f0 / Float(sampleRate)
        let sinW0 = sin(w0), cosW0 = cos(w0)
        let alpha = sinW0 * Float(sinh(0.5 * log(2.0) * bw * Double(w0) / Double(sinW0)))
        let a0 = 1 + alpha
        var s = BandpassState()
        s.b0 = alpha / a0; s.b1 = 0; s.b2 = -alpha / a0
        s.a1 = -2 * cosW0 / a0; s.a2 = (1 - alpha) / a0
        return s
    }
    private func applyBandpass(_ s: inout BandpassState, _ x: Float) -> Float {
        let y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2
        s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y
        return y
    }
```

- [ ] **Step 2: Implement `configureDSP` (replace the stub)**

```swift
    private func configureDSP(sampleRate: Double) {
        bp = makeBandpass(low: bpLowHz, high: bpHighHz, sampleRate: sampleRate)
        ringSubsample = max(1, Int(sampleRate / ringTargetRate))
        ringRate = sampleRate / Double(ringSubsample)
        envCoeff = exp(-1.0 / (envSmoothing * Float(ringRate)))
        expectedInterval = ringRate / (Double(targetBph) / 3600.0)
        calibDuration = Int(ringRate * 2.0)   // 2s calibration
        env = 0; adaptiveThreshold = 0; calibrating = true; calibSamples = 0
        calibEnergies.removeAll(keepingCapacity: true)
        sampleCounter = 0; ringCounter = 0; lastBeatRing = -1; ringSinceBeat = 0
        pendingCross = false; pendingPeak = 0; env1 = 0; env2 = 0
        pendingBeats.removeAll(keepingCapacity: true)
        debugLog("[PZDSP] bp=[\(bpLowHz),\(bpHighHz)] ringRate=\(String(format: "%.0f", ringRate)) expInt=\(String(format: "%.1f", expectedInterval))")
    }
```

- [ ] **Step 3: Implement `processDSP` (replace the stub) — band-pass → envelope → beat detect**

```swift
    private func processDSP(_ data: UnsafeMutablePointer<Float>, frameCount: Int) {
        var subCounter = 0
        var subPeak: Float = 0
        for i in 0..<frameCount {
            let filtered = abs(applyBandpass(&bp, data[i]))
            if filtered > subPeak { subPeak = filtered }
            sampleCounter += 1
            subCounter += 1
            if subCounter < ringSubsample { continue }
            subCounter = 0

            // One-pole envelope on the per-subsample peak
            env = envCoeff * env + (1 - envCoeff) * subPeak
            let e = env
            subPeak = 0
            ringCounter += 1

            // Calibration: learn noise floor for 2s, accept no beats
            if calibrating {
                calibEnergies.append(e); calibSamples += 1
                if calibSamples >= calibDuration {
                    calibrating = false
                    let sorted = calibEnergies.sorted()
                    calibNoiseFloor = sorted[sorted.count / 2]                  // median
                    let p98 = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.98))]
                    adaptiveThreshold = max(p98, calibNoiseFloor * 4)
                    calibEnergies.removeAll(keepingCapacity: false)
                    debugLog("[PZCALIB] thr=\(String(format: "%.6f", adaptiveThreshold)) floor=\(String(format: "%.6f", calibNoiseFloor))")
                }
                env2 = env1; env1 = e
                continue
            }

            ringSinceBeat += 1
            // Track/decay adaptive threshold toward the noise floor
            if e > adaptiveThreshold { adaptiveThreshold = e }
            else { adaptiveThreshold = max(calibNoiseFloor * 4, adaptiveThreshold * threshDecay) }
            let detect = adaptiveThreshold * threshMult
            let minSpacing = Int(expectedInterval * refractoryFrac)

            // Peak detection: fire on the decline after a threshold crossing
            var fire = false
            if e > detect && ringSinceBeat >= minSpacing {
                if !pendingCross || e > pendingPeak { pendingCross = true; pendingPeak = e }
                else { pendingCross = false; fire = true }
            } else if pendingCross && e < pendingPeak {
                pendingCross = false; fire = true
            }

            if fire {
                // Parabolic sub-sample peak using env2(-1), env1(0=peak), e(+1)
                var frac = 0.0
                let d = Double(env2) - 2 * Double(env1) + Double(e)
                if abs(d) > 1e-12 { frac = max(-0.5, min(0.5, 0.5 * (Double(env2) - Double(e)) / d)) }
                let peakRing = Double(ringCounter) - 1 + frac
                let beatTimeSec = peakRing / ringRate
                pendingBeats.append(beatTimeSec)
                lastPeakTimeSec = beatTimeSec
                ringSinceBeat = 0
            }
            env2 = env1; env1 = e
        }
    }
```

- [ ] **Step 4: Build (⌘B)** — Expected: compiles.

- [ ] **Step 5: On-device smoke check (MacBook build → iPad), then read logs**

Run the piezo path once (after Phase 4/5 wire the selector; for now temporarily call `PiezoEngine().start(bph: 28800)` from `startMeasurement` if testing early, or defer this verification to after Phase 5). Confirm `timegrapher_tick_logs` shows `[PZCALIB]` and that beats are firing (Task 3 adds explicit per-beat logs). Query:

```bash
npx supabase db query --linked "SELECT string_agg(messages, E'\n' ORDER BY created_at) FROM timegrapher_tick_logs WHERE created_at > now() - interval '5 minutes';"
```
Expected: `[PZSTART]`, `[PZINPUT]`, `[PZCALIB]` lines present.

- [ ] **Step 6: Commit**

```bash
git add ios/Wrotate/Wrotate/PiezoEngine.swift
git commit -m "PiezoEngine: band-pass + envelope + adaptive-threshold beat detection"
```

---

## Phase 3 — Model: BPH, rate regression, beat error, Update emission

### Task 3: Beat pairing → rate (Theil-Sen) + beat error + stability + Update

**Files:**
- Modify: `ios/Wrotate/Wrotate/PiezoEngine.swift`

Consume `pendingBeats` each buffer: reject interval outliers, pair beats to cancel beat error, regress cumulative pair deviation → rate, derive beat error from tick/tock alternation, track stability, and emit the Update. Replace the Task-1 `emitUpdate` stub and the placeholder `currentRate`/`currentBeatError`/`tickCount`.

- [ ] **Step 1: Add model state (insert near DSP state)**

```swift
    // --- Model state ---
    private var prevBeatTime: Double = -1
    private var regPoints: [(x: Double, y: Double)] = []   // (sec, cumulative pair deviation ms)
    private var cumPairDevMs: Double = 0
    private var pairPhase = 0
    private var pairAccum: Double = 0
    private var pendingFirstBeatTime: Double = 0
    private var recentBeatDevs: [Double] = []
    private var knownBeatError: Double = 0
    private var smoothedRate: Double? = nil
    private var rateHistory: [(t: Double, r: Double)] = []
    private var wasStable = false
    private var startSample: Int64 = 0
    private var pendingDots: [TickDot] = []
    private let regMinN = 10
    private let outlierMargin = 0.2
    private let stabilityWindow = 15.0
    private let stabilityGain = 3.0, stabilityLose = 5.0
    private let wallMin = 20.0
    private var lastEmitMs: Double = 0
```

Remove the three placeholder lines from Task 1 (`private var currentRate`, `currentBeatError`, `tickCount`) and re-declare them here as mutable model outputs:

```swift
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var tickCount: Int = 0
```

- [ ] **Step 2: Append beat-consumption logic at the end of `processDSP`'s buffer pass**

Add, immediately before the closing brace of `processDSP`, after the per-sample `for` loop:

```swift
        // Consume detected beats accumulated this buffer
        let beats = pendingBeats; pendingBeats.removeAll(keepingCapacity: true)
        for t in beats { consumeBeat(timeSec: t) }
```

- [ ] **Step 3: Implement `consumeBeat` (new method) — outlier gate + pair regression + beat error**

```swift
    private func consumeBeat(timeSec t: Double) {
        defer { prevBeatTime = t }
        guard prevBeatTime >= 0 else {
            debugLog("[PZBEAT FIRST @ \(String(format: "%.2f", t))s]"); return
        }
        let intervalRing = (t - prevBeatTime) * ringRate
        let ratio = intervalRing / expectedInterval
        if ratio < 1 - outlierMargin || ratio > 1 + outlierMargin {
            debugLog("[PZBEAT SKIP @ \(String(format: "%.2f", t))s] ratio=\(String(format: "%.3f", ratio)) OUTLIER")
            return
        }
        let devMs = (expectedInterval - intervalRing) / ringRate * 1000.0
        recentBeatDevs.append(devMs); if recentBeatDevs.count > 20 { recentBeatDevs.removeFirst() }
        if recentBeatDevs.count >= 10 {
            let a = recentBeatDevs.map { abs($0) }.sorted(); knownBeatError = a[a.count / 2]
        }

        // Pair two beats to cancel alternating beat error
        pairAccum += intervalRing; pairPhase += 1
        if pairPhase == 1 { pendingFirstBeatTime = t; return }
        let pairExpected = expectedInterval * 2.0
        let pairDevMs = (pairExpected - pairAccum) / ringRate * 1000.0
        pairAccum = 0; pairPhase = 0
        cumPairDevMs += pairDevMs
        regPoints.append((x: t, y: cumPairDevMs))
        tickCount += 2
        let mid = (pendingFirstBeatTime + t) / 2.0
        pendingDots.append(TickDot(timeSec: mid, deviationMs: cumPairDevMs))
        currentBeatError = knownBeatError
        if regPoints.count % 20 == 0 {
            debugLog("[PZBEAT #\(tickCount) @ \(String(format: "%.2f", mid))s] pairDev=\(String(format: "%.2f", pairDevMs)) cum=\(String(format: "%.2f", cumPairDevMs)) be=\(String(format: "%.1f", knownBeatError))")
        }
    }

    private func theilSen() -> Double? {
        let n = regPoints.count
        guard n >= regMinN else { return nil }
        let pts: [(x: Double, y: Double)] = n > 120 ? (0..<120).map { regPoints[Int(Double($0) * Double(n - 1) / 119.0)] } : regPoints
        var slopes: [Double] = []
        for i in 0..<pts.count { for j in (i+1)..<pts.count {
            let dx = pts[j].x - pts[i].x; if dx > 0.01 { slopes.append((pts[j].y - pts[i].y) / dx) }
        }}
        guard !slopes.isEmpty else { return nil }
        slopes.sort(); return slopes[slopes.count / 2]
    }
```

- [ ] **Step 4: Implement `emitUpdate` (replace the Task-1 stub)**

```swift
    private func emitUpdate() {
        let now = CACurrentMediaTime() * 1000
        guard now - lastEmitMs > 200 else { return }   // ~5 Hz UI updates
        lastEmitMs = now
        let wallElapsed = Double(sampleCounter) / actualSampleRate

        var rateForUpdate: Double? = nil
        if let slope = theilSen() {
            let r = slope * 86.4   // ms/s → s/day
            if abs(r) <= 200 {
                smoothedRate = r; rateForUpdate = (r * 10).rounded() / 10
                rateHistory.append((t: wallElapsed, r: r))
                rateHistory.removeAll { wallElapsed - $0.t > stabilityWindow + 5 }
            }
        }
        var isStable = wasStable
        if smoothedRate != nil {
            let recent = rateHistory.filter { wallElapsed - $0.t <= stabilityWindow }
            if recent.count >= 5 && wallElapsed >= wallMin {
                let spread = recent.map(\.r).max()! - recent.map(\.r).min()!
                isStable = wasStable ? (spread <= stabilityLose) : (spread <= stabilityGain)
            }
        }
        wasStable = isStable
        currentRate = rateForUpdate
        let conf = regPoints.count >= 5 ? min(0.99, Double(regPoints.count) / 250.0 + 0.3) : 0.0

        let dots = pendingDots; pendingDots.removeAll(keepingCapacity: true)
        let msgs = debugMessages; debugMessages.removeAll(keepingCapacity: true)
        let update = Update(
            rate: rateForUpdate, beatError: currentBeatError, tickCount: tickCount,
            confidence: conf, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: expectedInterval > 0 ? (expectedInterval / ringRate * 1000.0) : 0,
            detectedBph: autoBph ? (smoothedRate != nil ? targetBph : nil) : targetBph,
            cumulativeOffset: cumPairDevMs, elapsedSec: wallElapsed,
            method: regPoints.count >= regMinN ? "Piezo" : "",
            rateStable: isStable, newTicks: dots, debugMessages: msgs)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }
```

- [ ] **Step 5: Build (⌘B)** — Expected: compiles. (Auto-BPH detection is added in Task 3b; for now `autoBph` falls back to the 28800 default model — acceptable interim.)

- [ ] **Step 6: Commit**

```bash
git add ios/Wrotate/Wrotate/PiezoEngine.swift
git commit -m "PiezoEngine: beat pairing, Theil-Sen rate, beat error, stability, Update emission"
```

### Task 3b: Auto-BPH lock (interval histogram)

**Files:**
- Modify: `ios/Wrotate/Wrotate/PiezoEngine.swift`

When `autoBph` is true, lock BPH from the distribution of raw inter-beat intervals before regressing, instead of assuming 28800.

- [ ] **Step 1: Add auto-BPH state + lock logic**

```swift
    private var autoBphLocked = false
    private var rawIntervals: [Double] = []   // ring-sample intervals, pre-lock

    private func tryLockBph(intervalRing: Double) {
        rawIntervals.append(intervalRing)
        guard rawIntervals.count >= 40 else { return }
        // For each candidate, expected ring interval; score = fraction of intervals within 8%.
        var bestBph = targetBph, bestScore = -1.0
        for cand in PiezoEngine.bphCandidates {
            let exp = ringRate / (Double(cand) / 3600.0)
            let hits = rawIntervals.filter { abs($0 / exp - 1.0) < 0.08 }.count
            let score = Double(hits) / Double(rawIntervals.count)
            if score > bestScore { bestScore = score; bestBph = cand }
        }
        if bestScore > 0.5 {
            targetBph = bestBph; expectedInterval = ringRate / (Double(bestBph) / 3600.0)
            autoBphLocked = true
            debugLog("[PZAUTOBPH] locked \(bestBph) score=\(String(format: "%.2f", bestScore))")
        }
    }
```

- [ ] **Step 2: Gate `consumeBeat` on the lock**

At the top of `consumeBeat`, after computing `intervalRing` and before the outlier gate, insert:

```swift
        if autoBph && !autoBphLocked {
            tryLockBph(intervalRing: intervalRing)
            if !autoBphLocked { return }   // don't regress until BPH is known
        }
```

- [ ] **Step 3: Build (⌘B)** — Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add ios/Wrotate/Wrotate/PiezoEngine.swift
git commit -m "PiezoEngine: auto-BPH lock via interval histogram"
```

---

## Phase 4 — Bridge routing + piezo tuning

### Task 4: Route start/stop to PiezoEngine by `source`; forward Update; piezo tuning

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherBridge.swift`

- [ ] **Step 1: Add a PiezoEngine instance + a payload helper**

Below `private let engine = TimegrapherEngine()` add:

```swift
    private let piezo = PiezoEngine()
    private var usingPiezo = false
```

- [ ] **Step 2: Route `case "start"` by `source`**

Replace the `case "start":` block (mic-only after Task 0) with:

```swift
        case "start":
            let bph = body["bph"] as? Int ?? 28800
            let sensitivity = body["sensitivity"] as? Int ?? 50
            let source = body["source"] as? String ?? "mic"
            usingPiezo = (source == "piezo")
            print("[TG BRIDGE START] source=\(source) bph=\(bph) sensitivity=\(sensitivity)")
            if usingPiezo { startPiezo(bph: bph) } else { startMeasurement(bph: bph, sensitivity: sensitivity) }
```

- [ ] **Step 3: Route `case "stop"`**

```swift
        case "stop":
            print("[TG BRIDGE STOP]")
            if usingPiezo { stopPiezo() } else { stopMeasurement() }
```

- [ ] **Step 4: Add a `case "tuningPiezo"` to `handleMessage` (before `default:`)**

```swift
        case "tuningPiezo":
            piezo.setTuning(
                bpLow: body["bpLow"] as? Double, bpHigh: body["bpHigh"] as? Double,
                envSmoothing: body["envSmoothing"] as? Double, threshMult: body["threshMult"] as? Double,
                threshDecay: body["threshDecay"] as? Double, refractoryFrac: body["refractoryFrac"] as? Double,
                outlierMargin: body["outlierMargin"] as? Double)
```

- [ ] **Step 5: Add `startPiezo`/`stopPiezo` + Update→payload (new methods)**

```swift
    private func startPiezo(bph: Int) {
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if !granted {
                    self.sendToJS(["event": "error", "message": "Microphone permission denied. Go to Settings → WRotate → Microphone to allow."]); return
                }
                self.piezo.onUpdate = { [weak self] u in
                    var p: [String: Any] = [
                        "event": "update", "rate": u.rate as Any, "beatError": u.beatError as Any,
                        "tickCount": u.tickCount, "confidence": u.confidence, "noiseLevel": u.noiseLevel,
                        "detectedIntervalMs": u.detectedIntervalMs, "detectedBph": u.detectedBph as Any,
                        "cumulativeOffset": u.cumulativeOffset, "elapsedSec": u.elapsedSec,
                        "method": u.method, "rateStable": u.rateStable]
                    if !u.newTicks.isEmpty { p["newTicks"] = u.newTicks.map { ["t": $0.timeSec, "d": $0.deviationMs] as [String: Any] } }
                    if !u.debugMessages.isEmpty { p["debugMessages"] = u.debugMessages }
                    self?.sendToJS(p)
                }
                self.piezo.start(bph: bph)
                UIApplication.shared.isIdleTimerDisabled = true
                self.sendToJS(["event": "started"])
            }
        }
    }
    private func stopPiezo() {
        UIApplication.shared.isIdleTimerDisabled = false
        let r = piezo.stop()
        sendToJS(["event": "stopped", "rate": r.rate as Any, "beatError": r.beatError as Any, "tickCount": r.tickCount])
    }
```

- [ ] **Step 6: Add `setTuning` to PiezoEngine**

In `ios/Wrotate/Wrotate/PiezoEngine.swift`:

```swift
    func setTuning(bpLow: Double?, bpHigh: Double?, envSmoothing: Double?, threshMult: Double?,
                   threshDecay: Double?, refractoryFrac: Double?, outlierMargin: Double?) {
        if let v = bpLow { bpLowHz = Float(v) }
        if let v = bpHigh { bpHighHz = Float(v) }
        if let v = envSmoothing { self.envSmoothing = Float(v) }
        if let v = threshMult { self.threshMult = Float(v) }
        if let v = threshDecay { self.threshDecay = Float(v) }
        if let v = refractoryFrac { self.refractoryFrac = v }
        if let v = outlierMargin { self.outlierMargin = v }
        debugLog("[PZTUNE] bp=[\(bpLowHz),\(bpHighHz)] env=\(self.envSmoothing) thr=\(threshMult ?? -1) refrac=\(refractoryFrac ?? -1)")
    }
```

Change `private let outlierMargin = 0.2` to `private var outlierMargin = 0.2` (Task 3 declared it `let`).

- [ ] **Step 7: Build (⌘B)** — Expected: compiles.

- [ ] **Step 8: Commit**

```bash
git add ios/Wrotate/Wrotate/TimegrapherBridge.swift ios/Wrotate/Wrotate/PiezoEngine.swift
git commit -m "Bridge: route to PiezoEngine by source; piezo tuning message"
```

---

## Phase 5 — Web: feature flag + Mic/Piezo selector + start plumbing

### Task 5: `tg_piezo` flag + source-selection logic (unit-tested)

**Files:**
- Modify: `index.html`
- Test: `tests/piezo-source.test.js` (create)

- [ ] **Step 1: Write the failing unit test (logic mirror, per existing pattern)**

Create `tests/piezo-source.test.js`:

```js
import { describe, it, expect } from 'vitest';

// Mirrors index.html _tgStartSource(): the start message's `source` is 'piezo'
// only when the tg_piezo flag is on AND the user picked Piezo; otherwise 'mic'.
function _tgStartSource(flagOn, selected) {
  return (flagOn && selected === 'piezo') ? 'piezo' : 'mic';
}

describe('piezo source selection', () => {
  it('mic when flag off even if piezo selected', () => {
    expect(_tgStartSource(false, 'piezo')).toBe('mic');
  });
  it('piezo when flag on and piezo selected', () => {
    expect(_tgStartSource(true, 'piezo')).toBe('piezo');
  });
  it('mic when flag on but mic selected', () => {
    expect(_tgStartSource(true, 'mic')).toBe('mic');
  });
  it('defaults to mic when nothing selected', () => {
    expect(_tgStartSource(true, null)).toBe('mic');
  });
});
```

- [ ] **Step 2: Run it — Expected: PASS**

Run: `npm test -- piezo-source`
Expected: 4 passed. (Pure logic mirror; this guards the rule we implement in index.html.)

- [ ] **Step 3: Register the flag in `index.html`**

In the `FEATURE_FLAGS` object (currently `const FEATURE_FLAGS = { ... };` near line 4801), add:

```js
  tg_piezo: { label: 'Timegrapher: piezo input source (admin)', default: false },
```

- [ ] **Step 4: Add the source helper next to `_tgHasNative()`**

After the `_tgHasNative()` definition add:

```js
// Returns the start-message source. 'piezo' only when the tg_piezo flag is on AND
// the user picked Piezo; else 'mic' (unchanged behavior for everyone else).
function _tgSource() {
  if (!featureFlag('tg_piezo')) return 'mic';
  return (localStorage.getItem('tg_input_source') === 'piezo') ? 'piezo' : 'mic';
}
```

- [ ] **Step 5: Include `source` in the three start call sites**

There are three `messageHandlers.timegrapher.postMessage({ action: 'start', ... })` calls. Add `, source: _tgSource()` to each object:
- `toggleTgListen()` (`sensitivity: sens`) → `{ action: 'start', bph: bph, sensitivity: sens, source: _tgSource() }`
- the two `onMsrBphChange`-area calls (`sensitivity: 50`) → `{ action: 'start', bph: bph, sensitivity: 50, source: _tgSource() }`

- [ ] **Step 6: Bump SW + run full JS suite**

In `sw.js` change `const CACHE = 'wristlog-v728';` to `'wristlog-v729';`

Run: `npm test && npm run test:e2e`
Expected: unit all pass (incl. piezo-source), mocked e2e all pass.

- [ ] **Step 7: Commit**

```bash
git add index.html sw.js tests/piezo-source.test.js
git commit -m "Web: tg_piezo flag + source selection in start message (default mic, gated)"
```

### Task 6: Mic/Piezo selector UI + e2e

**Files:**
- Modify: `index.html`
- Test: `e2e/app.mock.spec.js`

- [ ] **Step 1: Add the selector markup near the BPH dropdown**

Find the measure controls containing `id="tg-bph-select"`. Immediately before it, add a source selector that is hidden unless the flag is on:

```html
<select id="tg-input-source" onchange="onTgSourceChange()" style="display:none;">
  <option value="mic">iPhone mic</option>
  <option value="piezo">Piezo (contact)</option>
</select>
```

- [ ] **Step 2: Add the show/persist logic**

```js
function onTgSourceChange() {
  const v = document.getElementById('tg-input-source').value;
  localStorage.setItem('tg_input_source', v);
}
function initTgSourceSelector() {
  const el = document.getElementById('tg-input-source');
  if (!el) return;
  if (featureFlag('tg_piezo')) {
    el.style.display = '';
    el.value = localStorage.getItem('tg_input_source') || 'mic';
  } else {
    el.style.display = 'none';
  }
}
```

Call `initTgSourceSelector()` where the measure page initializes (alongside the existing measure setup — search for where `tg-bph-select` is populated/initialized and add the call there).

- [ ] **Step 3: Write the e2e test (gated visibility)**

In `e2e/app.mock.spec.js`, add (mirroring existing mocked tests that set localStorage before load):

```js
test('input source selector hidden by default, shown when tg_piezo flag on', async ({ page }) => {
  await page.goto('/');
  // default: hidden
  await expect(page.locator('#tg-input-source')).toBeHidden();
  // enable flag, reload
  await page.evaluate(() => localStorage.setItem('ff_tg_piezo', 'true'));
  await page.reload();
  await page.evaluate(() => { if (window.initTgSourceSelector) window.initTgSourceSelector(); });
  await expect(page.locator('#tg-input-source')).toBeVisible();
});
```

- [ ] **Step 4: Run e2e — Expected: PASS**

Run: `npm run test:e2e -- -g "input source selector"`
Expected: 1 passed. (If the selector only initializes on the measure view, navigate to it in the test as the surrounding tests do; adjust the locator/navigation to match the existing measure-page test setup in the same file.)

- [ ] **Step 5: Bump SW + full suite**

In `sw.js`: `'wristlog-v729'` → `'wristlog-v730'`.
Run: `npm test && npm run test:e2e` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js e2e/app.mock.spec.js
git commit -m "Web: Mic/Piezo selector (admin-gated, persisted)"
```

### Task 7: Piezo tuning knobs (live iteration, admin)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Send a `tuningPiezo` message from localStorage-backed knobs**

Add a helper and call it after a piezo `start` (mirroring how `sendMsrTuning` is called ~200ms after start):

```js
function sendPiezoTuning() {
  if (!_tgHasNative() || _tgSource() !== 'piezo') return;
  const n = (k, d) => { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  window.webkit.messageHandlers.timegrapher.postMessage({
    action: 'tuningPiezo',
    bpLow: n('pz_bp_low', 150), bpHigh: n('pz_bp_high', 5000),
    envSmoothing: n('pz_env', 0.002), threshMult: n('pz_thresh_mult', 0.4),
    threshDecay: n('pz_thresh_decay', 0.999), refractoryFrac: n('pz_refrac', 0.6),
    outlierMargin: n('pz_outlier', 0.2)
  });
}
```

In each start path, after sending the piezo `start`, schedule it: `setTimeout(() => sendPiezoTuning(), 200);` (guard so it only runs when `_tgSource() === 'piezo'`).

- [ ] **Step 2: Bump SW + suite**

In `sw.js`: bump to `'wristlog-v731'`. Run: `npm test && npm run test:e2e` — Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add index.html sw.js
git commit -m "Web: piezo live tuning knobs via tuningPiezo (localStorage-backed)"
```

---

## Phase 6 — On-device validation against the Weishi reference

### Task 8: End-to-end piezo measurement validation

**Files:** none (validation + iteration)

- [ ] **Step 1: Build to the iPad (MacBook Pro, scheme `Wrotate`, ⌘R)** — Expected: launches.

- [ ] **Step 2: Enable the flag + select Piezo**

In the app (admin account): Admin → dev flags → enable *Timegrapher: piezo input source*. On the measure screen, set the source selector to **Piezo (contact)**, pick the JLC's BPH (or Auto).

- [ ] **Step 3: Run ~25-30s on the JLC, well-coupled.**

- [ ] **Step 4: Pull logs and check beat detection + rate**

```bash
npx supabase db query --linked "SELECT string_agg(messages, E'\n' ORDER BY created_at) FROM timegrapher_tick_logs WHERE created_at > now() - interval '5 minutes';"
```
Expected: `[PZINPUT] route=USB AUDIO CODEC…`, `[PZCALIB]`, `[PZBEAT FIRST]`, periodic `[PZBEAT #…]` with small `pairDev`, and a rate that converges. Compare the on-screen rate to the Weishi (~±3 s/day).

- [ ] **Step 5: Iterate tuning if needed (no rebuild)**

Adjust `localStorage` knobs (`pz_bp_low`, `pz_bp_high`, `pz_thresh_mult`, `pz_refrac`, …), stop/start the measurement to re-send `tuningPiezo`, and re-check. Common levers: lower `pz_bp_low` (e.g. 80–120) if energy collapses post-filter; lower `pz_thresh_mult` if beats are missed; widen `pz_outlier` if jitter rejects too many.

- [ ] **Step 6: Record validated defaults**

Once it matches the reference, set the validated values as the Swift defaults in `PiezoEngine.swift` (the `bpLowHz`/`bpHighHz`/`threshMult`/… initializers) so the shipped defaults are good. Build, commit:

```bash
git add ios/Wrotate/Wrotate/PiezoEngine.swift
git commit -m "PiezoEngine: validated default tuning (matches Weishi reference)"
```

---

## Self-review notes (coverage)

- Spec §"Fully separate engine" → Tasks 1–4 (PiezoEngine + bridge routing); mic engine untouched after Task 0.
- Spec §"Parity outputs / reuse UI" → Task 4 maps PiezoEngine.Update to the exact existing payload keys; no UI changes beyond the selector.
- Spec §"BPH mirrors mic (auto or selected)" → Task 3b auto-lock + Task 5 passes `bph` unchanged from the existing dropdown.
- Spec §"Admin feature flag gating" → Task 5 `tg_piezo`; Task 6 selector hidden unless flag on; default path = mic.
- Spec §"DSP Approach A" → Tasks 2–3.
- Spec §"Copy capture into PiezoEngine, strip from mic engine" → Task 0 (strip) + Task 1 (copy/adapt).
- Spec §"Testing & rollout" → JS vitest/e2e in Tasks 5–6; on-device `[PZ]` validation in Task 8; SW bumped each web change.
```
