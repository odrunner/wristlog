import AVFoundation
import Accelerate

/// Measures watch accuracy via Goertzel + autocorrelation at a known BPH.
///
/// Algorithm: user provides BPH → we know the exact tick frequency.
/// 1. Three parallel 2nd-order Butterworth HP filters (4kHz, 6kHz, 8kHz)
/// 2. Three parallel peak-hold energy ring buffers at ~12kHz
/// 3. Primary: Goertzel detection at each cutoff (best ratio wins)
/// 4. Fallback: FFT autocorrelation when Goertzel fails at all cutoffs
/// 5. Rate via fine frequency sweep (Goertzel) or period refinement (autocorr)
/// 6. Beat error via epoch folding
class TimegrapherEngine {

    struct TickDot {
        let timeSec: Double      // seconds since measurement start
        let deviationMs: Double  // cumulative timing deviation in ms
    }

    struct Update {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let confidence: Double
        let noiseLevel: Double
        let detectedIntervalMs: Double
        let detectedBph: Int?
        let debug: DebugInfo?
        let beatWaveform: [Float]?
        let tickPositions: [Int]?
        let cumulativeOffset: Double
        let elapsedSec: Double
        let method: String
        let newTicks: [TickDot]  // new tick dots since last update
        let debugMessages: [String] // debug log lines for Supabase
    }

    struct DebugInfo {
        let sampleRate: Double
        let fftSize: Int
        let bufferSamples: Int
        let hpCutoff: Double
        let bestLag: Int
        let bestCorrelation: Double
        let refinedLag: Double
        let noiseFloor: Double
        let threshold: Double
        let peakEnergy: Double
        let allBphCorrelations: [(bph: Int, correlation: Float, lag: Int)]
    }

    struct Result {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let ticks: [Double]
    }

    var onUpdate: ((Update) -> Void)?

    private var audioEngine: AVAudioEngine?
    private var isRunning = false

    private var actualSampleRate: Double = 48000
    private var sampleCounter: Int64 = 0

    // BPH — user-provided or auto-detected
    private var targetBph: Int = 28800
    private var autoBph: Bool = false
    private static let bphCandidates = [18000, 21600, 25200, 28800, 36000]

    // Cumulative offset tracking for scatter plot
    private var cumulativeOffsetMs: Double = 0
    private var lastAnalysisElapsed: Double = 0

    // Auto BPH re-detection
    private var consecutiveFailures: Int = 0

    // Real-time tick detection for timegrapher chart
    private var tickDeviationMs: Double = 0        // cumulative deviation
    private var expectedTickInterval: Double = 0   // ring samples between ticks
    private var lastTickRingPos: Int = -1           // ring position of last detected tick
    private var tickThreshold: Float = 0            // adaptive threshold for tick detection
    private var pendingTicks: [TickDot] = []        // ticks to send in next update
    private var tickDetectionActive = false
    private var ringPosSinceLastTick: Int = 0       // samples since last tick
    private var tickCount: Int = 0
    private var lastTickDeviationCheck: Double = 0  // deviation at last sanity check
    private var lastTickCountCheck: Int = 0         // tick count at last sanity check
    private var tickDebugInterval: Int = 0          // throttle debug logging
    private var debugMessages: [String] = []        // accumulated for Supabase

    // Pair-based regression: accumulate every 2 ticks to cancel beat error
    private var pairIntervalAccum: Int = 0          // sum of last 2 tick intervals
    private var pairTickPhase: Int = 0              // 0 or 1, alternates each tick
    private var pairDeviationMs: Double = 0         // cumulative pair deviation

    // Smoothed rate display
    private var smoothedRate: Double? = nil

    private func debugLog(_ msg: String) {
        print(msg)
        debugMessages.append(msg)
    }

    /// Windowed Theil-Sen estimator: median of pairwise slopes over last ~60 pairs.
    /// Window means old corruption ages out. Theil-Sen means in-window outliers are ignored.
    private let theilSenWindow = 60  // pairs (~15 seconds of data at 28800 BPH)

    private func theilSenSlope() -> Double? {
        let n = regPoints.count
        guard n >= 10 else { return nil }

        // Use only the last `theilSenWindow` points
        let startIdx = max(0, n - theilSenWindow)
        let window = Array(regPoints[startIdx..<n])
        let wn = window.count

        var slopes: [Double] = []
        slopes.reserveCapacity(wn * (wn - 1) / 2)
        for i in 0..<wn {
            for j in (i+1)..<wn {
                let dx = window[j].x - window[i].x
                if dx > 0.01 {
                    slopes.append((window[j].y - window[i].y) / dx)
                }
            }
        }
        guard !slopes.isEmpty else { return nil }
        slopes.sort()
        return slopes[slopes.count / 2]
    }

    // Theil-Sen median regression on PAIR deviations → robust to outliers
    private var regPoints: [(x: Double, y: Double)] = []  // (elapsedSec, pairDeviationMs)
    private var regN: Int = 0  // kept for compatibility (= regPoints.count)

    // 2nd-order Butterworth HP filter state (biquad)
    private struct BiquadState {
        var b0: Float = 0; var b1: Float = 0; var b2: Float = 0
        var a1: Float = 0; var a2: Float = 0
        var x1: Float = 0; var x2: Float = 0
        var y1: Float = 0; var y2: Float = 0
        var cutoffHz: Float = 4000
    }

    // Three parallel HP filters at different cutoffs
    private let hpCutoffs: [Float] = [4000, 6000, 8000]
    private var hpFilters: [BiquadState] = []

    // Three parallel energy ring buffers
    private var energyRings: [[Float]] = []
    private var energyRingCapacity: Int = 360000
    private var bufferDurationSec: Float = 30.0
    private var energyRingWritePos: Int = 0
    private var energyRingCount: Int = 0
    private var energySubsampleCounter: Int = 0
    private var ringSubsampleTarget: Int = 4  // 48kHz / 4 = 12kHz

    // Per-filter subsample peaks
    private var subsamplePeaks: [Float] = [0, 0, 0]

    // Tuning parameters
    private var peakRatioThreshold: Float = 3.0

    // Live debug values
    private var recentPeakEnergy: Float = 0

    // Which cutoff index was used for the active detection
    private var activeHpIndex: Int = 0

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0
    private var peakCount: Int = 0
    private var detectionMethod: String = ""

    private var lastAnalysisTime: Double = 0
    private var isAnalyzing = false
    private var lastDebugInfo: DebugInfo? = nil
    private var lastBeatWaveform: [Float]? = nil
    private var lastTickPositions: [Int]? = nil

    func setSensitivity(_ value: Int) {
        // Kept for bridge compatibility
    }

    func setTuning(multLo: Float, multHi: Float, minThreshold: Float,
                    percentile: Int, hpCutoff: Float,
                    peakRatioThreshold thresh: Float = 3.0,
                    bufferSeconds bufSec: Float = 30.0) {
        peakRatioThreshold = max(1.0, thresh)
        bufferDurationSec = max(5, min(120, bufSec))
    }

    // MARK: - Biquad HP filter

    private func makeBiquadHP(cutoff: Float, sampleRate: Double) -> BiquadState {
        let w0 = 2.0 * Float.pi * cutoff / Float(sampleRate)
        let cosW0 = cos(w0)
        let sinW0 = sin(w0)
        let alpha = sinW0 / (2.0 * 0.7071) // Q = 0.7071 (Butterworth)
        let a0 = 1.0 + alpha
        var state = BiquadState()
        state.b0 = (1.0 + cosW0) / 2.0 / a0
        state.b1 = -(1.0 + cosW0) / a0
        state.b2 = (1.0 + cosW0) / 2.0 / a0
        state.a1 = -2.0 * cosW0 / a0
        state.a2 = (1.0 - alpha) / a0
        state.cutoffHz = cutoff
        return state
    }

    private func applyBiquad(_ state: inout BiquadState, sample x: Float) -> Float {
        let y = state.b0 * x + state.b1 * state.x1 + state.b2 * state.x2
                - state.a1 * state.y1 - state.a2 * state.y2
        state.x2 = state.x1; state.x1 = x
        state.y2 = state.y1; state.y1 = y
        return y
    }

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        currentNoiseLevel = 0
        sampleCounter = 0
        lastAnalysisTime = 0
        energyRingWritePos = 0
        energyRingCount = 0
        energySubsampleCounter = 0
        recentPeakEnergy = 0
        peakCount = 0
        activeHpIndex = 0
        detectionMethod = ""
        cumulativeOffsetMs = 0
        lastAnalysisElapsed = 0
        isAnalyzing = false
        tickDetectionActive = false
        tickDeviationMs = 0
        expectedTickInterval = 0
        lastTickRingPos = -1
        ringPosSinceLastTick = 0
        tickCount = 0
        pendingTicks = []
        tickThreshold = 0
        consecutiveFailures = 0
        lastTickDeviationCheck = 0
        lastTickCountCheck = 0
        regPoints = []; regN = 0
        pairIntervalAccum = 0; pairTickPhase = 0; pairDeviationMs = 0
        smoothedRate = nil
        lastDebugInfo = nil
        lastBeatWaveform = nil
        lastTickPositions = nil
        subsamplePeaks = [0, 0, 0]

        // Set BPH mode after all resets
        if bph == 0 {
            autoBph = true
            targetBph = 28800 // default until auto-detected
        } else {
            autoBph = false
            targetBph = bph
            detectedBph = bph // user-selected = immediately locked
        }
        debugLog("[TGSTART] bph=\(bph) autoBph=\(autoBph) targetBph=\(targetBph) detectedBph=\(String(describing: detectedBph))")

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [])
            try session.setPreferredSampleRate(48000)
            try session.setActive(true)

            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }

            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            actualSampleRate = format.sampleRate

            // Initialize 3 biquad HP filters
            hpFilters = hpCutoffs.map { makeBiquadHP(cutoff: $0, sampleRate: actualSampleRate) }

            // Ring buffer at ~12kHz
            ringSubsampleTarget = max(1, Int(actualSampleRate / 12000))
            let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
            energyRingCapacity = Int(ringSampleRate * Double(bufferDurationSec))
            energyRings = (0..<3).map { _ in [Float](repeating: 0, count: energyRingCapacity) }

            inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, time in
                self?.processAudioBuffer(buffer)
            }

            try engine.start()
            isRunning = true

            // If BPH is user-selected, start tick detection immediately
            if !autoBph {
                activateTickDetection(ringSampleRate: ringSampleRate)
            }

        } catch {
            print("[Timegrapher] Audio setup error: \(error.localizedDescription)")
        }
    }

    func stop() -> Result {
        isRunning = false
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        try? AVAudioSession.sharedInstance().setActive(false)
        return Result(rate: currentRate, beatError: currentBeatError,
                      tickCount: peakCount, ticks: [])
    }

    // MARK: - Per-sample processing

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        for i in 0..<frameCount {
            let x = channelData[i]

            // Run through all 3 HP filters
            for f in 0..<3 {
                let hp = applyBiquad(&hpFilters[f], sample: x)
                let absHp = abs(hp)
                if absHp > subsamplePeaks[f] { subsamplePeaks[f] = absHp }
            }

            sampleCounter += 1

            energySubsampleCounter += 1
            if energySubsampleCounter >= ringSubsampleTarget {
                energySubsampleCounter = 0
                let peakEnergy = subsamplePeaks[0]
                for f in 0..<3 {
                    energyRings[f][energyRingWritePos] = subsamplePeaks[f]
                    subsamplePeaks[f] = 0
                }
                energyRingWritePos = (energyRingWritePos + 1) % energyRingCapacity
                energyRingCount = min(energyRingCount + 1, energyRingCapacity)

                if peakEnergy > recentPeakEnergy { recentPeakEnergy = peakEnergy }

                // Real-time tick detection on the active HP filter's energy
                if tickDetectionActive {
                    let energy = subsamplePeaks.isEmpty ? peakEnergy : energyRings[activeHpIndex][(energyRingWritePos - 1 + energyRingCapacity) % energyRingCapacity]
                    ringPosSinceLastTick += 1

                    // Track peak energy (slow decay) — represents tick impulse height
                    if energy > tickThreshold { tickThreshold = energy }
                    else { tickThreshold *= 0.9999 }
                    let threshold = tickThreshold * 0.3

                    let minSpacing = Int(expectedTickInterval * 0.9)
                    let ringSR = actualSampleRate / Double(ringSubsampleTarget)

                    // Debug: log every ~1 second
                    tickDebugInterval += 1
                    if tickDebugInterval % Int(ringSR) == 0 {
                        let elDbg = Double(sampleCounter) / actualSampleRate
                        debugLog("[TGDEBUG \(String(format: "%.1f", elDbg))s] energy=\(String(format: "%.6f", energy)) thresh=\(String(format: "%.6f", threshold)) tickThresh=\(String(format: "%.6f", tickThreshold)) tickCount=\(tickCount) regN=\(regN) pairDev=\(String(format: "%.2f", pairDeviationMs))")
                    }

                    if energy > threshold && ringPosSinceLastTick >= minSpacing {
                        let actualInterval = ringPosSinceLastTick
                        let elapsedSec = Double(sampleCounter) / actualSampleRate

                        if lastTickRingPos >= 0 {
                            // Outlier gate: discard intervals > ±15% of expected
                            let ratio = Double(actualInterval) / expectedTickInterval
                            if ratio < 0.85 || ratio > 1.15 {
                                // Outlier — skip this tick, don't update deviation or regression
                                debugLog("[TGTICK SKIP @ \(String(format: "%.2f", elapsedSec))s] interval=\(actualInterval) ratio=\(String(format: "%.3f", ratio)) OUTLIER")
                                lastTickRingPos = energyRingWritePos
                                ringPosSinceLastTick = 0
                            } else {
                                let deviationThisTick = (Double(actualInterval) - expectedTickInterval) / ringSR * 1000.0
                                tickDeviationMs += deviationThisTick
                                tickCount += 1
                                pendingTicks.append(TickDot(timeSec: elapsedSec, deviationMs: tickDeviationMs))

                                // Pair-based regression: accumulate 2 ticks, then feed one pair
                                pairIntervalAccum += actualInterval
                                pairTickPhase += 1
                                if pairTickPhase >= 2 {
                                    // One full tick-tock pair completed
                                    let pairExpected = expectedTickInterval * 2.0
                                    let pairDevThisPair = (Double(pairIntervalAccum) - pairExpected) / ringSR * 1000.0
                                    pairDeviationMs += pairDevThisPair
                                    // Feed pair into Theil-Sen regression
                                    regPoints.append((x: elapsedSec, y: pairDeviationMs))
                                    regN = regPoints.count
                                    pairIntervalAccum = 0
                                    pairTickPhase = 0
                                }

                                debugLog("[TGTICK #\(tickCount) @ \(String(format: "%.2f", elapsedSec))s] interval=\(actualInterval) devThis=\(String(format: "%.3f", deviationThisTick))ms cumDev=\(String(format: "%.3f", tickDeviationMs))ms pairDev=\(String(format: "%.3f", pairDeviationMs))ms energy=\(String(format: "%.6f", energy))")

                                // Debug: log regression rate every 50 ticks
                                if tickCount % 50 == 0 && regN >= 10 {
                                    if let slope = theilSenSlope() {
                                        let regRate = slope * 86.4
                                        debugLog("[TGRATE @ tick \(tickCount)] regN=\(regN) slope=\(String(format: "%.6f", slope))ms/s rate=\(String(format: "%.1f", regRate))s/day pairDev=\(String(format: "%.3f", pairDeviationMs))ms")
                                    }
                                }

                                // Sanity check every 100 ticks
                                if tickCount - lastTickCountCheck >= 100 && lastTickCountCheck > 0 {
                                    let dtCheck = max(1.0, elapsedSec)
                                    let deviationRate = abs(pairDeviationMs) / dtCheck
                                    if deviationRate > 50.0 {
                                        debugLog("[TGSANITY RESET] devRate=\(String(format: "%.1f", deviationRate))ms/s pairDev=\(String(format: "%.1f", pairDeviationMs))ms")
                                        tickDetectionActive = false
                                        pendingTicks = []
                                        tickCount = 0
                                        tickDeviationMs = 0
                                        pairDeviationMs = 0; pairIntervalAccum = 0; pairTickPhase = 0
                                        regPoints = []; regN = 0
                                        smoothedRate = nil
                                        if autoBph { detectedBph = nil; consecutiveFailures = 0 }
                                    }
                                    lastTickCountCheck = tickCount
                                    lastTickDeviationCheck = pairDeviationMs
                                }
                            }
                        } else {
                            // First tick — no deviation yet
                            tickCount += 1
                            pendingTicks.append(TickDot(timeSec: elapsedSec, deviationMs: 0))
                            debugLog("[TGTICK #1 FIRST @ \(String(format: "%.2f", elapsedSec))s] energy=\(String(format: "%.6f", energy)) threshold=\(String(format: "%.6f", threshold))")
                        }
                        lastTickRingPos = energyRingWritePos
                        ringPosSinceLastTick = 0
                    }
                }
            }
        }

        // Analyze every ~1 second, after at least 5 seconds of data
        // Run on background queue to avoid blocking audio thread
        let now = CACurrentMediaTime() * 1000
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let elapsedSec = Double(energyRingCount) / ringSampleRate
        if now - lastAnalysisTime > 1000 && elapsedSec >= 5 && !isAnalyzing {
            lastAnalysisTime = now
            isAnalyzing = true
            // Snapshot ring data for background analysis
            let count = energyRingCount
            var signals = [[Float]]()
            for f in 0..<3 { signals.append(linearize(ringIndex: f, count: count)) }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.analyze(signals: signals, count: count, ringSampleRate: ringSampleRate)
                self?.isAnalyzing = false
            }
        }

        // Drain pending ticks
        let ticks = pendingTicks
        pendingTicks = []

        // Compute rate from Theil-Sen median regression (robust to outlier pairs)
        var rateForUpdate: Double? = nil
        if regN >= 10 {  // 10 pairs = 20 ticks
            if let slope = theilSenSlope() {
                let regRate = slope * 86.4 // → s/day
                if abs(regRate) <= 200.0 {
                    // Exponential moving average for smooth display
                    if let prev = smoothedRate {
                        let alpha = max(0.05, 0.3 / (1.0 + Double(regN) / 20.0))
                        smoothedRate = prev * (1.0 - alpha) + regRate * alpha
                    } else {
                        smoothedRate = regRate
                    }
                    rateForUpdate = (smoothedRate! * 10).rounded() / 10
                }
            }
        }

        // Confidence based on pair count
        let tickConfidence = regN >= 5 ? min(0.99, Double(regN) / 250.0 + 0.3) : 0.0
        let wallElapsed = Double(sampleCounter) / actualSampleRate

        // Debug: log rate update every ~2 seconds
        if Int(wallElapsed * 2) % 2 == 0 && regN > 0 && tickCount % 16 == 0 {
            debugLog("[TGUPDATE] elapsed=\(String(format: "%.1f", wallElapsed))s rate=\(rateForUpdate != nil ? String(format: "%.1f", rateForUpdate!) : "nil") conf=\(String(format: "%.2f", tickConfidence)) regN=\(regN) tickCount=\(tickCount) cumDev=\(String(format: "%.2f", tickDeviationMs))ms")
        }

        // Drain debug messages
        let dbgMsgs = debugMessages
        debugMessages = []

        let update = Update(
            rate: rateForUpdate, beatError: currentBeatError,
            tickCount: tickCount,
            confidence: tickConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: expectedTickInterval > 0 ? 1000.0 / (actualSampleRate / Double(ringSubsampleTarget) / expectedTickInterval) : 0,
            detectedBph: detectedBph,
            debug: lastDebugInfo,
            beatWaveform: lastBeatWaveform,
            tickPositions: lastTickPositions,
            cumulativeOffset: tickDeviationMs,
            elapsedSec: wallElapsed,
            method: regN >= 10 ? "Ticks" : "",
            newTicks: ticks,
            debugMessages: dbgMsgs)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Combined analysis: Goertzel primary + autocorrelation fallback

    private func analyze(signals: [[Float]], count: Int, ringSampleRate: Double) {
        // Phase 1: Auto BPH detection (only if BPH not yet locked)
        if autoBph && detectedBph == nil {
            // Try all 3 HP cutoffs for better discrimination
            var bestCandidate: (bph: Int, ratio: Double) = (0, 0)
            var secondBestRatio: Double = 0
            for f in 0..<3 {
                var ratios: [(bph: Int, ratio: Double)] = []
                for candidate in TimegrapherEngine.bphCandidates {
                    let tf = Double(candidate) / 3600.0
                    let ratio = goertzelRatio(signals[f], count: count, tickFreq: tf, sampleRate: ringSampleRate)
                    ratios.append((bph: candidate, ratio: ratio))
                }
                ratios.sort { $0.ratio > $1.ratio }
                if ratios[0].ratio > bestCandidate.ratio {
                    bestCandidate = ratios[0]
                    secondBestRatio = ratios.count > 1 ? ratios[1].ratio : 0
                }
            }

            // Require: (1) above threshold, (2) decisively better than runner-up (1.5x)
            let elSec = Double(count) / ringSampleRate
            debugLog("[TGAUTO BPH @ \(String(format: "%.1f", elSec))s] best=\(bestCandidate.bph) ratio=\(String(format: "%.2f", bestCandidate.ratio)) 2nd=\(String(format: "%.2f", secondBestRatio)) threshold=\(peakRatioThreshold) decisive=\(bestCandidate.ratio >= secondBestRatio * 1.5)")
            if bestCandidate.ratio > Double(peakRatioThreshold) && (secondBestRatio < 1.0 || bestCandidate.ratio >= secondBestRatio * 1.5) {
                targetBph = bestCandidate.bph
                detectedBph = bestCandidate.bph
                debugLog("[TGAUTO BPH LOCKED] \(bestCandidate.bph)")
                activateTickDetection(ringSampleRate: ringSampleRate)
            }
            // If not locked yet, just return — ticks will start once BPH locks
            if detectedBph == nil {
                recentPeakEnergy *= 0.95
                return
            }
        }

        // Phase 2: BPH is locked — only compute beat error via epoch folding
        // Rate comes from tick regression (computed in processAudioBuffer), not Goertzel
        if !tickDetectionActive {
            activateTickDetection(ringSampleRate: ringSampleRate)
        }
        // Epoch fold for beat error on the lowest HP cutoff signal
        detectTickEvents(signal: signals[0], count: count, ringSampleRate: ringSampleRate)
        recentPeakEnergy *= 0.95
    }

    /// Lightweight ratio-only Goertzel — no sweep, just target vs baselines.
    private func goertzelRatio(_ signal: [Float], count: Int, tickFreq: Double, sampleRate: Double) -> Double {
        let tp = goertzelPower(signal, count: count, targetFreq: tickFreq, sampleRate: sampleRate)
        let mults = [0.73, 0.81, 1.19, 1.37, 1.61]
        var blSum = 0.0
        for m in mults { blSum += goertzelPower(signal, count: count, targetFreq: tickFreq * m, sampleRate: sampleRate) }
        let bl = blSum / Double(mults.count)
        return bl > 0 ? tp / bl : (tp > 0 ? 10.0 : 0)
    }

    private func updateCumulativeOffset(rate: Double, elapsedSec: Double) {
        if lastAnalysisElapsed > 0 {
            let dt = elapsedSec - lastAnalysisElapsed
            cumulativeOffsetMs += (rate / 86400.0) * dt * 1000.0
        }
        lastAnalysisElapsed = elapsedSec
    }

    private func activateTickDetection(ringSampleRate: Double) {
        guard !tickDetectionActive else { return }
        tickDetectionActive = true
        expectedTickInterval = ringSampleRate / (Double(targetBph) / 3600.0)
        tickDeviationMs = 0
        lastTickRingPos = -1
        ringPosSinceLastTick = 0
        tickCount = 0
        pendingTicks = []
        tickDebugInterval = 0
        pairIntervalAccum = 0; pairTickPhase = 0; pairDeviationMs = 0
        smoothedRate = nil
        regPoints = []; regN = 0
        // Seed threshold from recent peak energy
        tickThreshold = recentPeakEnergy > 0 ? recentPeakEnergy : 0.01
        debugLog("[TGACTIVATE] bph=\(targetBph) autoBph=\(autoBph) expectedInterval=\(String(format: "%.1f", expectedTickInterval)) ringSR=\(String(format: "%.0f", ringSampleRate)) tickThreshold=\(String(format: "%.6f", tickThreshold)) recentPeak=\(String(format: "%.6f", recentPeakEnergy))")
    }

    private func applyResult(rate: Double, ratio: Double, detectedFreq: Double,
                             ringSampleRate: Double, count: Int) {
        currentRate = (rate * 10).rounded() / 10
        currentDetectedInterval = (1.0 / detectedFreq) * 1000.0
        detectedBph = targetBph

        // Activate tick detection on first successful detection
        consecutiveFailures = 0
        if !tickDetectionActive { activateTickDetection(ringSampleRate: ringSampleRate) }

        let elapsedSec = Double(count) / ringSampleRate
        let durationFactor = min(1.0, elapsedSec / 60.0)
        let peakFactor = min(1.0, max(0, (ratio - 1.0) / 9.0))
        currentConfidence = min(0.99, ((peakFactor * (0.3 + 0.7 * durationFactor)) * 100).rounded() / 100)
        peakCount = tickCount > 0 ? tickCount : Int(elapsedSec * Double(targetBph) / 3600.0)

        lastDebugInfo = DebugInfo(
            sampleRate: actualSampleRate, fftSize: energyRingCount, bufferSamples: count,
            hpCutoff: Double(hpCutoffs[activeHpIndex]), bestLag: targetBph,
            bestCorrelation: ratio, refinedLag: detectedFreq, noiseFloor: 0,
            threshold: ratio, peakEnergy: Double(recentPeakEnergy),
            allBphCorrelations: [
                (bph: targetBph, correlation: Float(ratio), lag: Int(detectedFreq * 1000))
            ])
        recentPeakEnergy *= 0.95
    }

    // MARK: - Linearize ring buffer

    private func linearize(ringIndex f: Int, count: Int) -> [Float] {
        var signal = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let idx = (energyRingWritePos - count + i + energyRingCapacity) % energyRingCapacity
            signal[i] = energyRings[f][idx]
        }
        return signal
    }

    // MARK: - Goertzel detection + rate sweep

    private func goertzelPower(_ signal: [Float], count: Int, targetFreq: Double, sampleRate: Double) -> Double {
        let k = targetFreq * Double(count) / sampleRate
        let w = 2.0 * Double.pi * k / Double(count)
        let coeff = Float(2.0 * cos(w))
        var s1: Float = 0, s2: Float = 0
        for i in 0..<count {
            let s0 = signal[i] + coeff * s1 - s2
            s2 = s1
            s1 = s0
        }
        let power = Double(s1 * s1 + s2 * s2 - coeff * s1 * s2)
        return power / Double(count * count)
    }

    /// Returns (ratio, rate, detectedFreq). rate is nil if ratio below threshold.
    private func tryGoertzel(_ signal: [Float], count: Int, tickFreq: Double, ringSampleRate: Double) -> (Double, Double?, Double) {
        let targetPower = goertzelPower(signal, count: count, targetFreq: tickFreq, sampleRate: ringSampleRate)

        let baselineMultipliers = [0.73, 0.81, 1.19, 1.37, 1.61]
        var baselineSum = 0.0
        for mult in baselineMultipliers {
            baselineSum += goertzelPower(signal, count: count, targetFreq: tickFreq * mult, sampleRate: ringSampleRate)
        }
        let baseline = baselineSum / Double(baselineMultipliers.count)
        let ratio = baseline > 0 ? targetPower / baseline : (targetPower > 0 ? 10.0 : 0)

        guard ratio > Double(peakRatioThreshold) else {
            return (ratio, nil, tickFreq)
        }

        // Fine frequency sweep ±0.5%
        let sweepRange = tickFreq * 0.005
        let steps = 201
        var bestPower = 0.0
        var bestIdx = steps / 2
        var sweepPowers = [Double](repeating: 0, count: steps)

        for i in 0..<steps {
            let f = tickFreq - sweepRange + (2.0 * sweepRange * Double(i) / Double(steps - 1))
            let p = goertzelPower(signal, count: count, targetFreq: f, sampleRate: ringSampleRate)
            sweepPowers[i] = p
            if p > bestPower { bestPower = p; bestIdx = i }
        }

        let df = 2.0 * sweepRange / Double(steps - 1)
        var detectedFreq = tickFreq - sweepRange + df * Double(bestIdx)
        if bestIdx > 0 && bestIdx < steps - 1 {
            let a = sweepPowers[bestIdx - 1]
            let b = sweepPowers[bestIdx]
            let c = sweepPowers[bestIdx + 1]
            let denom = 2.0 * (2.0 * b - a - c)
            if abs(denom) > 1e-30 {
                detectedFreq += (a - c) / denom * df
            }
        }

        let rate = ((detectedFreq - tickFreq) / tickFreq) * 86400.0
        return (ratio, abs(rate) <= 120.0 ? rate : nil, detectedFreq)
    }

    // MARK: - FFT Autocorrelation fallback

    /// Returns (confidence, rate, detectedFreq). rate is nil if not confident.
    private func tryAutocorrelation(_ signal: [Float], count: Int, tickFreq: Double, ringSampleRate: Double) -> (Double, Double?, Double) {
        // Rectify and remove mean
        var rect = [Float](repeating: 0, count: count)
        for i in 0..<count { rect[i] = abs(signal[i]) }
        var mean: Float = 0
        vDSP_meanv(rect, 1, &mean, vDSP_Length(count))
        var negMean = -mean
        vDSP_vsadd(rect, 1, &negMean, &rect, 1, vDSP_Length(count))

        // Cosine taper (10% each end)
        let tl = Int(Double(count) * 0.1)
        for i in 0..<tl {
            let w = Float(0.5 * (1.0 - cos(Double.pi * Double(i) / Double(tl))))
            rect[i] *= w
            rect[count - 1 - i] *= w
        }

        // FFT autocorrelation via Accelerate
        let acorr = fftAutocorrelation(rect, count: count)
        guard acorr.count >= count else { return (0, nil, tickFreq) }

        // Search for peak near expected period
        let expectedPeriod = ringSampleRate / tickFreq
        let lo = max(1, Int(expectedPeriod * 0.95))
        let hi = min(count - 2, Int(expectedPeriod * 1.05))
        guard lo < hi else { return (0, nil, tickFreq) }

        var peakIdx = lo
        var peakVal = acorr[lo]
        for i in (lo + 1)...hi {
            if acorr[i] > peakVal { peakVal = acorr[i]; peakIdx = i }
        }

        // Confidence: peak vs mean in search range
        var segMean: Float = 0
        var segAbs = [Float](repeating: 0, count: hi - lo + 1)
        for i in lo...hi { segAbs[i - lo] = abs(acorr[i]) }
        vDSP_meanv(segAbs, 1, &segMean, vDSP_Length(segAbs.count))
        let conf = segMean > 0 ? Double(peakVal / segMean) : 0

        guard conf > 1.5 else { return (conf, nil, tickFreq) }

        // Parabolic interpolation for sub-sample precision
        var refined: Double
        if peakIdx > 0 && peakIdx < count - 1 {
            let a = Double(acorr[peakIdx - 1])
            let b = Double(acorr[peakIdx])
            let c = Double(acorr[peakIdx + 1])
            let d = 2.0 * (2.0 * b - a - c)
            refined = abs(d) > 1e-30 ? Double(peakIdx) + (a - c) / d : Double(peakIdx)
        } else {
            refined = Double(peakIdx)
        }

        // Harmonic refinement: check 2nd–5th harmonics
        var periods = [refined]
        for mult in 2...5 {
            let expM = refined * Double(mult)
            let loM = Int(expM - refined * 0.01)
            let hiM = Int(expM + refined * 0.01)
            guard hiM < count - 1 && loM > 0 else { break }

            var pkIdx = loM
            var pkVal = acorr[loM]
            for i in (loM + 1)...hiM {
                if acorr[i] > pkVal { pkVal = acorr[i]; pkIdx = i }
            }

            var pkR: Double
            if pkIdx > 0 && pkIdx < count - 1 {
                let a = Double(acorr[pkIdx - 1])
                let b = Double(acorr[pkIdx])
                let c = Double(acorr[pkIdx + 1])
                let d = 2.0 * (2.0 * b - a - c)
                pkR = abs(d) > 1e-30 ? Double(pkIdx) + (a - c) / d : Double(pkIdx)
            } else {
                pkR = Double(pkIdx)
            }
            periods.append(pkR / Double(mult))
        }

        // Median of all period estimates
        periods.sort()
        let finalPeriod = periods[periods.count / 2]
        let detFreq = ringSampleRate / finalPeriod
        let rate = ((detFreq - tickFreq) / tickFreq) * 86400.0

        return (conf, abs(rate) <= 120.0 ? rate : nil, detFreq)
    }

    /// FFT-based autocorrelation using Accelerate's vDSP.
    private func fftAutocorrelation(_ signal: [Float], count: Int) -> [Float] {
        // Next power of 2 for FFT (>= 2*count for linear autocorrelation)
        var fftSize = 1
        while fftSize < 2 * count { fftSize *= 2 }
        let log2n = vDSP_Length(log2(Double(fftSize)))

        guard let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
            return [Float](repeating: 0, count: count)
        }
        defer { vDSP_destroy_fftsetup(fftSetup) }

        // Zero-pad signal
        var padded = [Float](repeating: 0, count: fftSize)
        for i in 0..<count { padded[i] = signal[i] }

        // FFT via split complex
        let halfN = fftSize / 2
        var realp = [Float](repeating: 0, count: halfN)
        var imagp = [Float](repeating: 0, count: halfN)
        var result = [Float](repeating: 0, count: fftSize)

        realp.withUnsafeMutableBufferPointer { rBuf in
            imagp.withUnsafeMutableBufferPointer { iBuf in
                var split = DSPSplitComplex(realp: rBuf.baseAddress!, imagp: iBuf.baseAddress!)

                // Interleaved real → split complex
                padded.withUnsafeBufferPointer { pBuf in
                    pBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                        vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(halfN))
                    }
                }

                // Forward FFT
                vDSP_fft_zrip(fftSetup, &split, 1, log2n, FFTDirection(kFFTDirection_Forward))

                // Power spectrum: |FFT|^2
                for i in 0..<halfN {
                    let r = rBuf[i]
                    let im = iBuf[i]
                    rBuf[i] = r * r + im * im
                    iBuf[i] = 0
                }

                // Inverse FFT
                vDSP_fft_zrip(fftSetup, &split, 1, log2n, FFTDirection(kFFTDirection_Inverse))

                // Split complex → interleaved real
                result.withUnsafeMutableBufferPointer { resBuf in
                    resBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                        vDSP_ztoc(&split, 1, complexPtr, 2, vDSP_Length(halfN))
                    }
                }
            }
        }

        // Scale
        var scale = 1.0 / Float(fftSize)
        vDSP_vsmul(result, 1, &scale, &result, 1, vDSP_Length(fftSize))

        return Array(result.prefix(count))
    }

    // MARK: - Beat error via epoch folding

    private func detectTickEvents(signal: [Float], count: Int, ringSampleRate: Double) {
        let tickFreq = Double(targetBph) / 3600.0
        let beatFreq = tickFreq / 2.0
        let beatPeriod = ringSampleRate / beatFreq
        let periodSamples = Int(round(beatPeriod))

        guard count >= periodSamples * 8 else { return }

        // Epoch fold at beat period
        var folded = [Double](repeating: 0, count: periodSamples)
        var foldCount = [Int](repeating: 0, count: periodSamples)
        for i in 0..<count {
            let idx = i % periodSamples
            folded[idx] += Double(signal[i])
            foldCount[idx] += 1
        }
        for i in 0..<periodSamples {
            if foldCount[i] > 0 { folded[i] /= Double(foldCount[i]) }
        }

        // Smooth the folded profile
        let smoothW = max(1, periodSamples / 50)
        var smoothed = [Double](repeating: 0, count: periodSamples)
        for i in 0..<periodSamples {
            var s = 0.0; var c = 0
            for j in -smoothW...smoothW {
                let idx = (i + j + periodSamples) % periodSamples
                s += folded[idx]; c += 1
            }
            smoothed[i] = s / Double(c)
        }

        // Find peak 1 (global max)
        var peak1Idx = 0
        var peak1Val = smoothed[0]
        for i in 1..<periodSamples {
            if smoothed[i] > peak1Val { peak1Val = smoothed[i]; peak1Idx = i }
        }

        // Find peak 2 (max outside ±25% exclusion zone)
        let exclusion = periodSamples / 4
        var peak2Idx = -1
        var peak2Val = -1.0
        for i in 0..<periodSamples {
            let dist = min(abs(i - peak1Idx), periodSamples - abs(i - peak1Idx))
            if dist > exclusion && smoothed[i] > peak2Val {
                peak2Val = smoothed[i]; peak2Idx = i
            }
        }
        guard peak2Idx >= 0 else {
            currentBeatError = nil; return
        }

        // Quality gate: both peaks must have good prominence
        let floor = smoothed.min() ?? 0
        let prom1 = peak1Val - floor
        let prom2 = peak2Val - floor
        let promRatio = prom1 > 0 ? prom2 / prom1 : 0
        guard promRatio > 0.25 else {
            currentBeatError = nil; return
        }

        // Compute beat error
        let gap1 = (peak2Idx - peak1Idx + periodSamples) % periodSamples
        let gap2 = periodSamples - gap1
        let gap1Ms = Double(gap1) / ringSampleRate * 1000.0
        let gap2Ms = Double(gap2) / ringSampleRate * 1000.0
        let be = abs(gap1Ms - gap2Ms)

        let halfPeriodMs = Double(periodSamples) / ringSampleRate * 1000.0 / 2.0
        let minGapFraction = 0.35
        guard be < 5.0
            && gap1Ms > halfPeriodMs * minGapFraction
            && gap2Ms > halfPeriodMs * minGapFraction else {
            currentBeatError = nil; return
        }

        currentBeatError = (be * 100).rounded() / 100

        // Waveform: downsample the active ring's last 500ms for visualization
        let vizRingSamples = min(count, Int(ringSampleRate * 0.5))
        let vizStart = count - vizRingSamples
        let targetPoints = 200
        let step = max(1, vizRingSamples / targetPoints)
        var waveform = [Float]()
        waveform.reserveCapacity(targetPoints)
        for i in stride(from: 0, to: vizRingSamples, by: step) {
            var maxVal: Float = 0
            let end = min(i + step, vizRingSamples)
            for j in i..<end {
                if signal[vizStart + j] > maxVal { maxVal = signal[vizStart + j] }
            }
            waveform.append(maxVal)
        }
        lastBeatWaveform = waveform

        // Tick positions in waveform
        let ticksInViz = Int(Double(vizRingSamples) / beatPeriod * 2)
        var tickPos: [Int] = []
        for t in 0..<ticksInViz {
            let sampleInViz = Int(Double(t) * beatPeriod / 2.0) % vizRingSamples
            let wfIdx = sampleInViz / step
            if wfIdx >= 0 && wfIdx < waveform.count { tickPos.append(wfIdx) }
        }
        lastTickPositions = tickPos
    }

    /// Trimmed mean: removes top/bottom fraction of values, averages the rest.
    private func trimmedMean(_ values: [Double], fraction: Double) -> Double {
        let sorted = values.sorted()
        let trimCount = max(0, Int(Double(sorted.count) * fraction))
        let trimmed = Array(sorted[trimCount..<(sorted.count - trimCount)])
        guard !trimmed.isEmpty else { return sorted[sorted.count / 2] }
        return trimmed.reduce(0, +) / Double(trimmed.count)
    }
}
