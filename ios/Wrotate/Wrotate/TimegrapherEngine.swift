import AVFoundation
import Accelerate

/// Detects watch ticks and measures rate via span measurement.
/// Approach: detect tick events at 48kHz resolution → count N ticks over span T →
/// rate = (T - expected) / expected × 86400.
/// Accuracy improves with more ticks: 100 ticks ≈ ±15 s/day, 500 ticks ≈ ±3 s/day.
class TimegrapherEngine {

    struct Update {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let confidence: Double
        let noiseLevel: Double
        let detectedIntervalMs: Double
        let detectedBph: Int?
        let debug: DebugInfo?
    }

    struct DebugInfo {
        let sampleRate: Double
        let fftSize: Int           // total ticks detected
        let bufferSamples: Int     // ticks used in span calc
        let hpCutoff: Double
        let bestLag: Int           // BPH used
        let bestCorrelation: Double // measured interval ms
        let refinedLag: Double     // threshold value
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
    private var totalSamplesProcessed: Int64 = 0

    // High-pass filter (1kHz)
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // Short-term energy tracking (1ms window at 48kHz = 48 samples)
    private var energyWindow: [Float] = []
    private var energyWindowSize: Int = 48
    private var energyWritePos: Int = 0
    private var energySum: Float = 0

    // Noise floor tracking
    private var noiseFloor: Float = 0
    private var noiseFloorInitialized = false

    // Tick detection
    private var peakThreshold: Float = 0
    private var sensitivityMultiplier: Float = 1.3
    private var lastTickSample: Int64 = -100000
    private var minGapSamples: Int64 = 0  // minimum samples between ticks

    // Tick storage: raw 48kHz sample indices
    private var tickSamples: [Int64] = []

    // Running sample counter (precise, per-sample)
    private var sampleCounter: Int64 = 0

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var currentNoiseLevel: Double = 0
    private var selectedBph: Int = 28800

    private var lastAnalysisTime: Double = 0
    private var lastDebugInfo: DebugInfo? = nil

    // Rate history for smoothing
    private var rateHistory: [Double] = []

    // Sensitivity: 0=least sensitive, 100=most sensitive
    // Maps to threshold multiplier: 0→2.0×, 50→1.3×, 100→1.05×
    func setSensitivity(_ value: Int) {
        let v = Float(max(0, min(100, value)))
        sensitivityMultiplier = 1.05 + ((100 - v) / 100.0) * 0.95
        // Don't clear ticks on sensitivity change — span measurement is robust
        // Just update threshold for future detection
    }

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }
        selectedBph = bph
        setSensitivity(sensitivity)

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        currentNoiseLevel = 0
        totalSamplesProcessed = 0
        sampleCounter = 0
        lastAnalysisTime = 0
        hpPrevIn = 0
        hpPrevOut = 0
        noiseFloor = 0
        noiseFloorInitialized = false
        lastTickSample = -100000
        tickSamples = []
        rateHistory = []
        energySum = 0
        energyWritePos = 0

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

            // HP filter coefficient for 1kHz
            let dt = 1.0 / Float(actualSampleRate)
            let rc = 1.0 / (2.0 * Float.pi * Float(1000))
            hpAlpha = rc / (rc + dt)

            // Energy window: 1ms
            energyWindowSize = max(1, Int(actualSampleRate * 0.001))
            energyWindow = [Float](repeating: 0, count: energyWindowSize)
            energyWritePos = 0
            energySum = 0

            // Minimum gap between ticks: 70% of shortest expected interval
            // 36000 BPH = 100ms per tick, half-beat = 50ms
            // Use 40ms minimum to allow tick-tock detection
            minGapSamples = Int64(actualSampleRate * 0.04)

            inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, time in
                self?.processAudioBuffer(buffer)
            }

            try engine.start()
            isRunning = true

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
                      tickCount: tickSamples.count, ticks: [])
    }

    // MARK: - Per-sample processing

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        // Noise level for UI
        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        // Process each sample at full 48kHz resolution
        for i in 0..<frameCount {
            let x = channelData[i]

            // High-pass 1kHz
            let hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp

            // Update short-term energy (rolling sum of |hp| over 1ms)
            let absHp = abs(hp)
            let oldest = energyWindow[energyWritePos]
            energySum -= oldest
            energySum += absHp
            energyWindow[energyWritePos] = absHp
            energyWritePos = (energyWritePos + 1) % energyWindowSize

            let energy = energySum / Float(energyWindowSize)

            sampleCounter += 1

            // Skip first 0.5 seconds (filter settling)
            guard sampleCounter > Int64(actualSampleRate * 0.5) else { continue }

            // Adaptive noise floor
            if !noiseFloorInitialized {
                noiseFloor = energy
                noiseFloorInitialized = true
            }

            // Noise floor tracks quiet periods (adapts down fast, up slowly)
            if energy < noiseFloor * 1.5 {
                noiseFloor += 0.0001 * (energy - noiseFloor)
            } else {
                noiseFloor += 0.00001 * (energy - noiseFloor)
            }

            // Threshold
            peakThreshold = max(noiseFloor * sensitivityMultiplier, noiseFloor + 0.00001)

            // Tick detection: energy exceeds threshold, after minimum gap
            if energy > peakThreshold &&
               (sampleCounter - lastTickSample) > minGapSamples {
                // Confirm it's a local peak: wait for energy to drop below peak
                // Simple approach: just record this moment
                // The 1ms energy smoothing already gives us sub-ms precision
                tickSamples.append(sampleCounter)
                lastTickSample = sampleCounter

                // Bound memory
                if tickSamples.count > 5000 {
                    tickSamples.removeFirst(tickSamples.count - 5000)
                }
            }
        }
        totalSamplesProcessed += Int64(frameCount)

        // Analyze every ~1 second
        let now = CACurrentMediaTime() * 1000
        if now - lastAnalysisTime > 1000 && tickSamples.count >= 20 {
            lastAnalysisTime = now
            analyzeSpan()
        }

        let update = Update(
            rate: currentRate, beatError: currentBeatError,
            tickCount: tickSamples.count,
            confidence: currentConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval,
            detectedBph: selectedBph,
            debug: lastDebugInfo)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Span-based rate measurement

    private func analyzeSpan() {
        let ticks = tickSamples
        guard ticks.count >= 20 else { return }

        let expectedIntervalSec = 3600.0 / Double(selectedBph)
        let expectedIntervalSamples = expectedIntervalSec * actualSampleRate

        // ── SPAN MEASUREMENT ──
        // Use the full span of all detected ticks.
        // rate = (actual_span - expected_span) / expected_span × 86400
        //
        // But some "ticks" may be noise. To be robust, use a subset:
        // Find ticks that form a consistent grid at the expected interval.

        // Step 1: Compute all inter-tick intervals
        var intervals: [Double] = []
        for i in 1..<ticks.count {
            intervals.append(Double(ticks[i] - ticks[i-1]))
        }

        // Step 2: Find intervals that match expected (±15%)
        // Also match half-interval (tick-tock) and double (missed tick)
        let tolerance = expectedIntervalSamples * 0.15

        var goodTickIndices: [Int] = [0]  // always include first tick
        for i in 0..<intervals.count {
            let dt = intervals[i]
            let isMatch = abs(dt - expectedIntervalSamples) < tolerance
            let isHalf = abs(dt - expectedIntervalSamples / 2.0) < tolerance / 2.0
            let isDouble = abs(dt - expectedIntervalSamples * 2.0) < tolerance * 2.0
            if isMatch || isHalf || isDouble {
                goodTickIndices.append(i + 1)
            }
        }

        // Need at least 10 good ticks for a measurement
        guard goodTickIndices.count >= 10 else {
            lastDebugInfo = DebugInfo(
                sampleRate: actualSampleRate, fftSize: ticks.count,
                bufferSamples: goodTickIndices.count, hpCutoff: 1000,
                bestLag: selectedBph, bestCorrelation: 0,
                refinedLag: Double(peakThreshold),
                allBphCorrelations: [])
            return
        }

        // Step 3: Count total expected beats across the good ticks
        // Each "good" interval contributes 1 beat (single), 0.5 beats (half), or 2 beats (double)
        var totalBeats: Double = 0
        var prevGoodIdx = goodTickIndices[0]
        for j in 1..<goodTickIndices.count {
            let idx = goodTickIndices[j]
            let dt = Double(ticks[idx] - ticks[prevGoodIdx])

            // How many beats does this interval represent?
            let beats = round(dt / expectedIntervalSamples)
            if beats >= 0.5 && beats <= 3.0 {
                totalBeats += beats
            }
            prevGoodIdx = idx
        }

        guard totalBeats >= 5 else { return }

        // Step 4: Actual span vs expected span
        let firstGoodTick = ticks[goodTickIndices.first!]
        let lastGoodTick = ticks[goodTickIndices.last!]
        let actualSpanSamples = Double(lastGoodTick - firstGoodTick)
        let expectedSpanSamples = totalBeats * expectedIntervalSamples

        guard expectedSpanSamples > 0 else { return }

        let rate = (actualSpanSamples - expectedSpanSamples) / expectedSpanSamples * 86400.0
        let measuredIntervalMs = (actualSpanSamples / totalBeats) / actualSampleRate * 1000.0

        currentDetectedInterval = measuredIntervalMs

        // Rate smoothing: keep history, use trimmed mean
        rateHistory.append(rate)
        if rateHistory.count > 30 { rateHistory.removeFirst() }

        if rateHistory.count >= 5 {
            let sorted = rateHistory.sorted()
            let trim = max(1, sorted.count / 4)
            let trimmed = Array(sorted[trim..<(sorted.count - trim)])
            currentRate = (trimmed.reduce(0.0, +) / Double(trimmed.count) * 10).rounded() / 10
        } else {
            currentRate = (rate * 10).rounded() / 10
        }

        // Confidence based on:
        // - Number of good ticks (more = better)
        // - Fraction of intervals that are "good" (higher = cleaner signal)
        // - Measurement span (longer = more precise)
        let spanSec = actualSpanSamples / actualSampleRate
        let tickFraction = Double(goodTickIndices.count) / Double(ticks.count)
        let spanFactor = min(1.0, spanSec / 60.0)      // max at 1 minute
        let countFactor = min(1.0, Double(goodTickIndices.count) / 200.0)
        currentConfidence = tickFraction * (0.3 * countFactor + 0.7 * spanFactor)
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Beat error from alternating half-beat intervals
        let halfExpected = expectedIntervalSamples / 2.0
        let halfTolerance = halfExpected * 0.15
        var shortHalves: [Double] = []
        var longHalves: [Double] = []
        for i in stride(from: 0, to: intervals.count - 1, by: 2) {
            let a = intervals[i]
            let b = intervals[i + 1]
            if abs(a - halfExpected) < halfTolerance && abs(b - halfExpected) < halfTolerance {
                if a < b {
                    shortHalves.append(a / actualSampleRate * 1000)
                    longHalves.append(b / actualSampleRate * 1000)
                } else {
                    shortHalves.append(b / actualSampleRate * 1000)
                    longHalves.append(a / actualSampleRate * 1000)
                }
            }
        }
        if shortHalves.count >= 5 {
            let avgShort = shortHalves.reduce(0, +) / Double(shortHalves.count)
            let avgLong = longHalves.reduce(0, +) / Double(longHalves.count)
            currentBeatError = ((avgLong - avgShort) / 2.0 * 100).rounded() / 100
        } else {
            currentBeatError = 0
        }

        // Debug info
        // Pack BPH match info: for each BPH, count how many intervals match
        var bphResults: [(bph: Int, correlation: Float, lag: Int)] = []
        let standardBphs = [18000, 21600, 25200, 28800, 36000]
        for bph in standardBphs {
            let expSamples = 3600.0 / Double(bph) * actualSampleRate
            let tol = expSamples * 0.15
            var matchCount = 0
            for dt in intervals {
                if abs(dt - expSamples) < tol { matchCount += 1 }
                else if abs(dt - expSamples / 2.0) < tol / 2.0 { matchCount += 1 }
                else if abs(dt - expSamples * 2.0) < tol * 2.0 { matchCount += 1 }
            }
            bphResults.append((bph: bph, correlation: Float(matchCount), lag: intervals.count))
        }

        lastDebugInfo = DebugInfo(
            sampleRate: actualSampleRate, fftSize: ticks.count,
            bufferSamples: goodTickIndices.count, hpCutoff: 1000,
            bestLag: selectedBph, bestCorrelation: measuredIntervalMs,
            refinedLag: Double(peakThreshold),
            allBphCorrelations: bphResults)
    }
}
