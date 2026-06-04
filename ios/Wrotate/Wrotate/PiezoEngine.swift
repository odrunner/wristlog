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

            configureDSP(sampleRate: actualSampleRate)

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

        processDSP(channelData, frameCount: frameCount)
        emitUpdate()
    }

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

    // Placeholders satisfied in Task 3 (declared here so the file compiles):
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var tickCount: Int = 0
    private func emitUpdate() {}
}
