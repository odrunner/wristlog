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

    func setTuning(bpLow: Double?, bpHigh: Double?, envSmoothing: Double?, threshMult: Double?,
                   threshDecay: Double?, refractoryFrac: Double?, outlierMargin: Double?,
                   searchWin: Double? = nil, smoothMs: Double? = nil,
                   regSkip: Int? = nil, stabThresh: Double? = nil, stabWindow: Double? = nil, wallMin: Double? = nil,
                   rateWindow: Double? = nil) {
        if let v = bpLow { bpLowHz = Float(v) }
        if let v = bpHigh { bpHighHz = Float(v) }
        if let v = envSmoothing { self.envSmoothing = Float(v) }
        if let v = threshMult { self.threshMult = Float(v) }
        if let v = threshDecay { self.threshDecay = Float(v) }
        if let v = refractoryFrac { self.refractoryFrac = v }
        if let v = outlierMargin { self.outlierMargin = v }
        if let v = searchWin { searchWinFrac = v }
        if let v = regSkip { regSkipPairs = v }
        if let v = stabThresh { stabilityGain = v; stabilityLose = v * 1.7 }
        if let v = stabWindow { stabilityWindow = v }
        if let v = wallMin { self.wallMin = v }
        if let v = rateWindow { rateWindowSec = v }
        // Smoothing (ms) takes effect live (envCoeff recomputed against the live ring rate).
        if let v = smoothMs, ringRate > 0 { self.envSmoothing = Float(v / 1000.0); envCoeff = exp(-1.0 / (self.envSmoothing * Float(ringRate))) }
        debugLog("[PZTUNE] bp=[\(bpLowHz),\(bpHighHz)] smoothMs=\(smoothMs ?? Double(self.envSmoothing*1000)) searchWin=\(searchWinFrac) regSkip=\(regSkipPairs) stabThresh=\(stabilityGain) stabWin=\(stabilityWindow) wallMin=\(self.wallMin)")
    }

    private var sessionModeStr = "default"
    func start(bph: Int, autoPickChannel: Bool = true, sessionMode: String = "default") {
        guard !isRunning else { return }
        sessionModeStr = sessionMode
        if bph == 0 { autoBph = true; targetBph = 28800 } else { autoBph = false; targetBph = bph }
        diagBufCount = 0; diagChMaxPeak = []; diagChSumRms = []
        debugLog("[PZSTART] bph=\(bph) autoBph=\(autoBph) mode=\(sessionMode)")

        do {
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            // .default vs .measurement (.measurement = no AGC/processing, but historically crushed
            // USB level). Toggleable so we can A/B which gives a steadier signal.
            let mode: AVAudioSession.Mode = (sessionMode == "measurement") ? .measurement : .default
            try session.setCategory(.playAndRecord, mode: mode, options: [.allowBluetoothA2DP])
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
            let mode = sessionModeStr
            _ = stop(); start(bph: bphToRestart, sessionMode: mode)
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

        // Accumulate decimated raw samples for offline analysis
        if rawCapture.count < rawCaptureCap {
            for i in 0..<frameCount {
                rawDecimCounter += 1
                if rawDecimCounter >= rawDecim {
                    rawDecimCounter = 0
                    if rawCapture.count < rawCaptureCap { rawCapture.append(channelData[i]) }
                }
            }
        }

        processDSP(channelData, frameCount: frameCount)
        emitUpdate()
    }

    /// Base64-encoded little-endian Int16 PCM of the decimated raw capture, for offline sweeps.
    func exportRawCapture() -> (b64: String, rate: Double, n: Int)? {
        guard !rawCapture.isEmpty else { return nil }
        var pcm = [Int16](repeating: 0, count: rawCapture.count)
        for i in 0..<rawCapture.count {
            let v = max(-1.0, min(1.0, rawCapture[i]))
            pcm[i] = Int16(v * 32767.0)
        }
        let data = pcm.withUnsafeBytes { Data($0) }
        return (data.base64EncodedString(), rawCaptureRate, rawCapture.count)
    }

    // --- DSP tunables (piezo-specific) ---
    private var bpLowHz: Float = 150
    private var bpHighHz: Float = 5000
    private var envSmoothing: Float = 0.008     // one-pole time constant (s) — fuses intra-beat ringing
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
    // Phase-locked detection (validated offline): predict each beat at last+expectedInterval,
    // search a ±searchWinFrac window, take the peak. Robust to the multi-sub-peak beat clusters
    // a contact piezo produces (free-running threshold detection locks onto spurious sub-rhythms).
    private var envBuf = [Float](repeating: 0, count: 4096)
    private let envBufN = 4096
    private var searchWinFrac: Double = 0.13
    private var phaseBootstrapped = false
    private var phaseStart: Double = -1
    private var nextPredicted: Double = 0
    private var lastBeatRingF: Double = -1
    private var autoCollectUntil = 0
    // Signal meter = autocorrelation at the beat rate (shows real tick/tock periodicity, not raw
    // loudness). A 1kHz-decimated envelope over ~4s.
    private var meterBuf = [Float](repeating: 0, count: 4096)
    private let meterBufN = 4096
    private var meterIdx = 0
    private var meterSub = 0
    private var tickSignalLevel: Double = 0
    private var pzDbgCounter = 0
    private var pzDbgMaxE: Float = 0
    private var pzDbgBeats = 0
    // Raw capture for offline parameter sweeps (decimated to ~24kHz, capped ~12s).
    private var rawCapture: [Float] = []
    private var rawCaptureRate: Double = 24000
    private var rawCaptureCap = 0
    private var rawDecim = 2
    private var rawDecimCounter = 0

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
        pzDbgCounter = 0; pzDbgMaxE = 0; pzDbgBeats = 0
        phaseBootstrapped = false; phaseStart = -1; nextPredicted = 0; lastBeatRingF = -1; autoCollectUntil = 0
        for i in 0..<envBufN { envBuf[i] = 0 }
        meterIdx = 0; meterSub = 0; tickSignalLevel = 0
        for i in 0..<meterBufN { meterBuf[i] = 0 }
        rawDecim = max(1, Int((sampleRate / 24000).rounded()))
        rawCaptureRate = sampleRate / Double(rawDecim)
        rawCaptureCap = Int(rawCaptureRate * 12)   // ~12s
        rawCapture.removeAll(keepingCapacity: true); rawDecimCounter = 0
        // Reset ALL model/regression state so measurements don't accumulate across runs
        // (the engine instance persists in the bridge).
        prevBeatTime = -1; regPoints.removeAll(keepingCapacity: true); cumPairDevMs = 0
        totalPairsAccepted = 0; lastRateLogMs = 0
        pairPhase = 0; pairAccum = 0; pendingFirstBeatTime = 0
        recentBeatDevs.removeAll(keepingCapacity: true); knownBeatError = 0
        smoothedRate = nil; rateHistory.removeAll(keepingCapacity: true); wasStable = false
        pendingDots.removeAll(keepingCapacity: true); lastEmitMs = 0
        currentRate = nil; currentBeatError = nil; tickCount = 0
        autoBphLocked = false; rawIntervals.removeAll(keepingCapacity: true)
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

            // Light envelope smoothing (~8ms) fuses the intra-beat ringing into one bump/beat.
            env = envCoeff * env + (1 - envCoeff) * subPeak
            let e = env
            subPeak = 0
            ringCounter += 1
            let r = ringCounter
            envBuf[((r % envBufN) + envBufN) % envBufN] = e

            // Calibration: learn the noise floor for 2s (presence/floor reference only).
            if calibrating {
                calibEnergies.append(e); calibSamples += 1
                if calibSamples >= calibDuration {
                    calibrating = false
                    let sorted = calibEnergies.sorted()
                    calibNoiseFloor = sorted[sorted.count / 2]
                    calibEnergies.removeAll(keepingCapacity: false)
                    autoCollectUntil = r + Int(ringRate * 2.5)
                    debugLog("[PZCALIB] floor=\(String(format: "%.6f", calibNoiseFloor))")
                }
                continue
            }

            // Decimate envelope to ~1kHz for the periodicity meter
            meterSub += 1
            if meterSub >= 12 { meterSub = 0; meterBuf[meterIdx % meterBufN] = e; meterIdx += 1 }

            if e > pzDbgMaxE { pzDbgMaxE = e }
            pzDbgCounter += 1
            if pzDbgCounter >= Int(ringRate) {
                tickSignalLevel = beatSignalStrength()
                debugLog("[PZDBG] maxE=\(String(format: "%.6f", pzDbgMaxE)) floor=\(String(format: "%.6f", calibNoiseFloor)) beats=\(pzDbgBeats) sig=\(String(format: "%.2f", tickSignalLevel)) bph=\(targetBph)")
                pzDbgMaxE = 0; pzDbgBeats = 0; pzDbgCounter = 0
            }

            // Auto-BPH: collect ~2.5s of envelope, then autocorrelation-lock the period.
            if autoBph && !autoBphLocked {
                if r < autoCollectUntil { continue }
                lockBphAutocorr(endRing: r)
                if !autoBphLocked { autoCollectUntil = r + Int(ringRate * 1.0); continue }
            }

            // Phase-locked beat detection: predict next at last+expectedInterval, take the
            // peak in a ±searchWinFrac window (robust to the piezo's multi-sub-peak clusters).
            let win = expectedInterval * searchWinFrac
            if !phaseBootstrapped {
                if phaseStart < 0 { phaseStart = Double(r) }
                if Double(r) >= phaseStart + expectedInterval * 1.5 {
                    let p = argmaxRing(from: Int(phaseStart), to: r)
                    lastBeatRingF = Double(p)
                    nextPredicted = Double(p) + expectedInterval
                    phaseBootstrapped = true
                }
                continue
            }
            if Double(r) >= nextPredicted + win {
                let lo = Int((nextPredicted - win).rounded())
                let hi = Int((nextPredicted + win).rounded())
                let p = argmaxRing(from: lo, to: hi)
                let em1 = Double(envAt(p - 1)), e0 = Double(envAt(p)), ep1 = Double(envAt(p + 1))
                let dd = em1 - 2 * e0 + ep1
                var frac = 0.0
                if abs(dd) > 1e-12 { frac = max(-0.5, min(0.5, 0.5 * (em1 - ep1) / dd)) }
                let beatRing = Double(p) + frac
                pendingBeats.append(beatRing / ringRate)
                pzDbgBeats += 1
                lastBeatRingF = beatRing
                nextPredicted = beatRing + expectedInterval
            }
        }

        // Consume detected beats accumulated this buffer
        let beats = pendingBeats; pendingBeats.removeAll(keepingCapacity: true)
        for t in beats { consumeBeat(timeSec: t) }
    }

    private func envAt(_ idx: Int) -> Float {
        let m = ((idx % envBufN) + envBufN) % envBufN
        return envBuf[m]
    }
    private func argmaxRing(from lo: Int, to hi: Int) -> Int {
        var best = -Float.greatestFiniteMagnitude; var bi = lo
        var i = lo
        while i <= hi { let v = envAt(i); if v > best { best = v; bi = i }; i += 1 }
        return bi
    }
    /// Normalized autocorrelation of the decimated envelope at the beat-rate lag → 0..1 meter.
    /// High only when there's a real periodic tick/tock, not for arbitrary loud noise.
    private func beatSignalStrength() -> Double {
        let lag = Int((1000.0 / (Double(targetBph) / 3600.0)).rounded())  // beat period in ms (≈ms @1kHz)
        let avail = min(meterIdx, meterBufN)
        guard lag > 10, avail > lag + 200 else { return 0 }
        let win = avail - lag
        let end = meterIdx
        func mAt(_ i: Int) -> Float { return meterBuf[((i % meterBufN) + meterBufN) % meterBufN] }
        var mean = 0.0
        for k in 0..<avail { mean += Double(mAt(end - avail + k)) }
        mean /= Double(avail)
        var num = 0.0, den = 0.0
        for k in 0..<win {
            let a = Double(mAt(end - avail + k)) - mean
            let b = Double(mAt(end - avail + k + lag)) - mean
            num += a * b; den += a * a
        }
        let ac = den > 0 ? num / den : 0
        let periodicity = max(0, min(1, ac / 0.2))
        // Strength: how far the beat peaks rise above the noise floor (responds to gain/coupling).
        let snr = calibNoiseFloor > 0 ? max(0, min(1, (Double(pzDbgMaxE / calibNoiseFloor) - 1.0) / 4.0)) : 0
        return periodicity * snr   // strong only when periodic AND well above noise
    }
    /// Auto-BPH: pick the standard BPH whose period best autocorrelates the recent envelope.
    private func lockBphAutocorr(endRing: Int) {
        let span = min(Int(ringRate * 2.5), envBufN - 4)
        guard span > 10 else { return }
        var w = [Float](repeating: 0, count: span)
        for k in 0..<span { w[k] = envAt(endRing - span + 1 + k) }
        let mean = w.reduce(0, +) / Float(span)
        for k in 0..<span { w[k] -= mean }
        var den = 0.0
        for k in 0..<span { den += Double(w[k]) * Double(w[k]) }
        var best = -1.0; var bestBph = targetBph
        for cand in PiezoEngine.bphCandidates {
            let lag = Int((ringRate / (Double(cand) / 3600.0)).rounded())
            if lag <= 0 || lag >= span { continue }
            var num = 0.0
            for k in 0..<(span - lag) { num += Double(w[k]) * Double(w[k + lag]) }
            let ac = den > 0 ? num / den : 0
            if ac > best { best = ac; bestBph = cand }
        }
        if best > 0.2 {
            targetBph = bestBph
            expectedInterval = ringRate / (Double(bestBph) / 3600.0)
            autoBphLocked = true
            debugLog("[PZAUTOBPH] locked \(bestBph) ac=\(String(format: "%.2f", best))")
        }
    }

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
    private var outlierMargin = 0.2
    private var stabilityWindow = 15.0
    private var stabilityGain = 3.0
    private var stabilityLose = 5.0
    private var wallMin = 20.0
    private var regSkipPairs = 10        // skip the settling transient from the rate fit
    private var rateWindowSec = 20.0     // trailing window for the rate fit (ignores early offset)
    private var totalPairsAccepted = 0
    private var lastRateLogMs: Double = 0
    private var lastEmitMs: Double = 0

    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var tickCount: Int = 0

    // --- Auto-BPH lock ---
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

    private func consumeBeat(timeSec t: Double) {
        defer { prevBeatTime = t }
        guard prevBeatTime >= 0 else {
            debugLog("[PZBEAT FIRST @ \(String(format: "%.2f", t))s]"); return
        }
        let intervalRing = (t - prevBeatTime) * ringRate
        if autoBph && !autoBphLocked {
            tryLockBph(intervalRing: intervalRing)
            if !autoBphLocked { return }   // don't regress until BPH is known
        }
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
        totalPairsAccepted += 1
        // Skip the settling transient (first N pairs) so it doesn't contaminate the rate fit.
        if totalPairsAccepted <= regSkipPairs { return }
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
        guard regPoints.count >= regMinN, let lastX = regPoints.last?.x else { return nil }
        // Trailing window: the rate fit ignores the one-time start-up offset transient.
        let cutoff = lastX - rateWindowSec
        let recent = regPoints.filter { $0.x >= cutoff }
        let n = recent.count
        guard n >= regMinN else { return nil }
        let pts: [(x: Double, y: Double)] = n > 120 ? (0..<120).map { recent[Int(Double($0) * Double(n - 1) / 119.0)] } : recent
        var slopes: [Double] = []
        for i in 0..<pts.count { for j in (i+1)..<pts.count {
            let dx = pts[j].x - pts[i].x; if dx > 0.01 { slopes.append((pts[j].y - pts[i].y) / dx) }
        }}
        guard !slopes.isEmpty else { return nil }
        slopes.sort(); return slopes[slopes.count / 2]
    }

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

        if now - lastRateLogMs > 3000 {
            lastRateLogMs = now
            let spread = rateHistory.filter { wallElapsed - $0.t <= stabilityWindow }.map(\.r)
            let sp = spread.count >= 2 ? (spread.max()! - spread.min()!) : 0
            debugLog("[PZRATE @ \(String(format: "%.0f", wallElapsed))s] rate=\(rateForUpdate != nil ? String(format: "%+.1f", rateForUpdate!) : "nil") stable=\(isStable) regN=\(regPoints.count) spread=\(String(format: "%.1f", sp)) sig=\(String(format: "%.2f", tickSignalLevel))")
        }

        let dots = pendingDots; pendingDots.removeAll(keepingCapacity: true)
        let msgs = debugMessages; debugMessages.removeAll(keepingCapacity: true)
        let update = Update(
            rate: rateForUpdate, beatError: currentBeatError, tickCount: tickCount,
            confidence: conf, noiseLevel: tickSignalLevel,
            detectedIntervalMs: expectedInterval > 0 ? (expectedInterval / ringRate * 1000.0) : 0,
            detectedBph: autoBph ? (smoothedRate != nil ? targetBph : nil) : targetBph,
            cumulativeOffset: cumPairDevMs, elapsedSec: wallElapsed,
            method: regPoints.count >= regMinN ? "Piezo" : "",
            rateStable: isStable, newTicks: dots, debugMessages: msgs)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }
}
