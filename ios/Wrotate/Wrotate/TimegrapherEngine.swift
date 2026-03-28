import AVFoundation
import Accelerate

/// Detects mechanical watch ticks via peak detection and interval fitting.
/// Approach: detect tick transients → measure intervals → fit to expected BPH.
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
        let fftSize: Int           // repurposed: total ticks detected
        let bufferSamples: Int     // repurposed: matching intervals count
        let hpCutoff: Double
        let bestLag: Int           // repurposed: locked BPH
        let bestCorrelation: Double // repurposed: mean interval ms
        let refinedLag: Double     // repurposed: threshold used
        let allBphCorrelations: [(bph: Int, correlation: Float, lag: Int)]
        // correlation = matching interval count, lag = total intervals checked
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

    // Envelope at decimated rate
    private var envSampleRate: Double = 2000
    private var envDecimation: Int = 24

    // High-pass 1kHz on raw audio
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // Lowpass 80Hz envelope
    private var lpEnvState: Float = 0
    private var lpEnvAlpha: Float = 0.0

    // Decimation accumulator
    private var envAccum: Float = 0
    private var envAccumCount: Int = 0

    // Tick detection
    private var envSamplesWritten: Int64 = 0
    private var recentEnvelope: [Float] = []     // rolling window of envelope samples
    private var recentEnvCapacity: Int = 0       // ~10 seconds worth
    private var recentEnvWritePos: Int = 0

    // Detected tick timestamps (in envelope sample index)
    private var tickTimes: [Int64] = []          // global envelope sample index of each tick
    private var lastTickEnvIdx: Int64 = -1000    // last detected tick (to enforce minimum gap)
    private var noiseFloor: Float = 0
    private var peakThreshold: Float = 0

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0

    private let standardBphs = [18000, 21600, 25200, 28800, 36000]
    private var lockedBph: Int? = nil

    private var lastAnalysisTime: Double = 0
    private var lastDebugInfo: DebugInfo? = nil

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        totalSamplesProcessed = 0
        lastAnalysisTime = 0
        hpPrevIn = 0
        hpPrevOut = 0
        lpEnvState = 0
        envAccum = 0
        envAccumCount = 0
        envSamplesWritten = 0
        tickTimes = []
        lastTickEnvIdx = -1000
        noiseFloor = 0
        peakThreshold = 0
        lockedBph = nil
        currentNoiseLevel = 0

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

            // High-pass 1kHz
            let dt = 1.0 / Float(actualSampleRate)
            let hpRc = 1.0 / (2.0 * Float.pi * Float(1000))
            hpAlpha = hpRc / (hpRc + dt)

            // Lowpass 80Hz
            let lpRc = 1.0 / (2.0 * Float.pi * Float(80))
            lpEnvAlpha = dt / (lpRc + dt)

            // Decimate to ~2kHz
            envDecimation = max(1, Int(actualSampleRate / 2000))
            envSampleRate = actualSampleRate / Double(envDecimation)

            // Rolling envelope window: 2 seconds (for peak detection context)
            recentEnvCapacity = Int(envSampleRate * 2)
            recentEnvelope = [Float](repeating: 0, count: recentEnvCapacity)
            recentEnvWritePos = 0

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
                      tickCount: tickTimes.count, ticks: [])
    }

    // MARK: - Audio → envelope → tick detection

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        // Pipeline: HP 1kHz → rectify → LP 80Hz → decimate → peak detect
        for i in 0..<frameCount {
            let x = channelData[i]
            let hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp

            lpEnvState += lpEnvAlpha * (abs(hp) - lpEnvState)

            envAccum += lpEnvState
            envAccumCount += 1
            if envAccumCount >= envDecimation {
                let envSample = envAccum / Float(envAccumCount)
                envAccum = 0
                envAccumCount = 0

                // Store in rolling window
                recentEnvelope[recentEnvWritePos] = envSample
                recentEnvWritePos = (recentEnvWritePos + 1) % recentEnvCapacity
                envSamplesWritten += 1

                // Track running stats for adaptive threshold
                // Use two EMAs: slow (noise floor) and fast (tracks peaks)
                let slowAlpha: Float = 0.01   // ~100 sample time constant
                let fastAlpha: Float = 0.1    // ~10 sample time constant

                // Initialize on first sample
                if envSamplesWritten == 1 {
                    noiseFloor = envSample
                    peakThreshold = envSample * 2
                }

                // Noise floor tracks the quieter samples (only adapts downward fast)
                if envSample < noiseFloor * 1.5 {
                    noiseFloor += slowAlpha * (envSample - noiseFloor)
                } else {
                    // When signal is above noise, adapt very slowly upward
                    noiseFloor += (slowAlpha * 0.1) * (envSample - noiseFloor)
                }

                // Threshold: detect peaks that are significantly above noise
                // A watch tick should be 2-3x the ambient noise envelope
                peakThreshold = noiseFloor * 2.5

                // Minimum gap: 50ms (fastest BPH=36000 has 100ms interval,
                // but tick-tock gives 50ms half-intervals)
                let minGap: Int64 = Int64(envSampleRate * 0.05)

                // Skip first 2 seconds while noise floor settles
                let currentIdx = envSamplesWritten - 1
                guard currentIdx > Int64(envSampleRate * 2) else { continue }

                // Peak detection: above threshold, after minimum gap,
                // and is a local maximum (higher than surrounding samples)
                if envSample > peakThreshold &&
                   (currentIdx - lastTickEnvIdx) > minGap {
                    // Check it's a local max: higher than 2 samples before and after
                    // (we check "before" only since "after" hasn't arrived yet —
                    //  we'll use a delayed detection: check if the sample 2 ago was a peak)
                    let checkPos = (recentEnvWritePos - 3 + recentEnvCapacity) % recentEnvCapacity
                    let candidate = recentEnvelope[checkPos]
                    let before1 = recentEnvelope[(checkPos - 1 + recentEnvCapacity) % recentEnvCapacity]
                    let before2 = recentEnvelope[(checkPos - 2 + recentEnvCapacity) % recentEnvCapacity]
                    let after1 = recentEnvelope[(checkPos + 1) % recentEnvCapacity]
                    let after2 = recentEnvelope[(checkPos + 2) % recentEnvCapacity]

                    if candidate > before1 && candidate > before2 &&
                       candidate > after1 && candidate > after2 &&
                       candidate > peakThreshold {
                        let tickIdx = currentIdx - 3  // offset for delayed check
                        if (tickIdx - lastTickEnvIdx) > minGap {
                            tickTimes.append(tickIdx)
                            lastTickEnvIdx = tickIdx

                            if tickTimes.count > 2000 {
                                tickTimes.removeFirst(tickTimes.count - 2000)
                            }
                        }
                    }
                }
            }
        }
        totalSamplesProcessed += Int64(frameCount)

        // Analyze every ~1 second
        let now = CACurrentMediaTime() * 1000
        if now - lastAnalysisTime > 1000 && tickTimes.count >= 10 {
            lastAnalysisTime = now
            analyzeIntervals()
        }

        let update = Update(
            rate: currentRate, beatError: currentBeatError,
            tickCount: tickTimes.count,
            confidence: currentConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval, detectedBph: detectedBph,
            debug: lastDebugInfo)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Interval analysis: fit ticks to BPH grid

    private func analyzeIntervals() {
        let ticks = tickTimes
        guard ticks.count >= 10 else { return }

        // Compute all consecutive inter-tick intervals
        var intervals: [Double] = []
        for i in 1..<ticks.count {
            let dt = Double(ticks[i] - ticks[i - 1]) / envSampleRate * 1000.0  // ms
            intervals.append(dt)
        }

        // For each candidate BPH, count how many intervals match
        var bphResults: [(bph: Int, correlation: Float, lag: Int)] = []
        var bestBph = 28800
        var bestMatchCount = 0
        var bestMatchingIntervals: [Double] = []

        for candidateBph in standardBphs {
            let expectedMs = 3600000.0 / Double(candidateBph)
            let tolerance = expectedMs * 0.08  // ±8% tolerance

            // Count intervals that match this BPH (within tolerance)
            // Also allow half-intervals (tick-tock pairs may merge)
            // and double-intervals (missed ticks)
            var matching: [Double] = []

            for dt in intervals {
                // Direct match
                if abs(dt - expectedMs) < tolerance {
                    matching.append(dt)
                }
                // Half interval match (two ticks detected per beat)
                else if abs(dt - expectedMs / 2.0) < tolerance / 2.0 {
                    // Don't add — this means we're detecting half-beats
                    // We'll handle this separately
                }
                // Double interval (missed one tick)
                else if abs(dt - expectedMs * 2.0) < tolerance * 2.0 {
                    matching.append(dt / 2.0)  // treat as two intervals
                }
            }

            bphResults.append((bph: candidateBph,
                              correlation: Float(matching.count),
                              lag: intervals.count))

            if matching.count > bestMatchCount {
                bestMatchCount = matching.count
                bestBph = candidateBph
                bestMatchingIntervals = matching
            }
        }

        // Also try half-beat matching: some watches produce distinct tick and tock
        // at 2x the BPH rate. Check if half-BPH intervals dominate.
        for candidateBph in standardBphs {
            let halfExpectedMs = 3600000.0 / Double(candidateBph) / 2.0
            let tolerance = halfExpectedMs * 0.08
            var halfMatching: [Double] = []
            for dt in intervals {
                if abs(dt - halfExpectedMs) < tolerance {
                    halfMatching.append(dt * 2.0)  // convert to full-beat interval
                }
            }
            if halfMatching.count > bestMatchCount {
                bestMatchCount = halfMatching.count
                bestBph = candidateBph
                bestMatchingIntervals = halfMatching
            }
        }

        // Need at least 5 matching intervals to make a call
        guard bestMatchCount >= 5 else {
            currentConfidence = 0
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: ticks.count,
                bufferSamples: bestMatchCount, hpCutoff: 1000,
                bestLag: bestBph, bestCorrelation: 0,
                refinedLag: Double(peakThreshold),
                allBphCorrelations: bphResults)
            return
        }

        // Lock BPH
        if lockedBph == nil { lockedBph = bestBph }
        let useBph = lockedBph ?? bestBph

        // Recalculate matching intervals for locked BPH if different
        let finalIntervals: [Double]
        if useBph == bestBph {
            finalIntervals = bestMatchingIntervals
        } else {
            let expectedMs = 3600000.0 / Double(useBph)
            let tolerance = expectedMs * 0.08
            var matching: [Double] = []
            for dt in intervals {
                if abs(dt - expectedMs) < tolerance { matching.append(dt) }
                else if abs(dt - expectedMs * 2.0) < tolerance * 2.0 { matching.append(dt / 2.0) }
            }
            // Also check half-beats
            let halfExpectedMs = expectedMs / 2.0
            let halfTol = halfExpectedMs * 0.08
            for dt in intervals {
                if abs(dt - halfExpectedMs) < halfTol { matching.append(dt * 2.0) }
            }
            finalIntervals = matching.isEmpty ? bestMatchingIntervals : matching
        }

        guard finalIntervals.count >= 5 else {
            currentConfidence = 0
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: ticks.count,
                bufferSamples: finalIntervals.count, hpCutoff: 1000,
                bestLag: useBph, bestCorrelation: 0,
                refinedLag: Double(peakThreshold),
                allBphCorrelations: bphResults)
            return
        }

        // Compute rate from matching intervals
        // Use trimmed mean: sort, drop top/bottom 10%, average middle
        let sorted = finalIntervals.sorted()
        let trimCount = max(1, sorted.count / 10)
        let trimmed: [Double]
        if sorted.count > 10 {
            trimmed = Array(sorted[trimCount..<(sorted.count - trimCount)])
        } else {
            // For small samples, just use median
            trimmed = [sorted[sorted.count / 2]]
        }

        let meanInterval = trimmed.reduce(0.0, +) / Double(trimmed.count)
        let expectedInterval = 3600000.0 / Double(useBph)
        let rate = ((meanInterval - expectedInterval) / expectedInterval) * 86400.0

        currentDetectedInterval = meanInterval
        detectedBph = useBph
        currentRate = (rate * 10).rounded() / 10

        // Confidence: based on fraction of intervals that match + total count
        let matchFraction = Double(finalIntervals.count) / Double(max(1, intervals.count))
        let countFactor = min(1.0, Double(finalIntervals.count) / 50.0)
        currentConfidence = matchFraction * (0.3 + 0.7 * countFactor)
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Beat error from alternating intervals
        // Tick-tock pattern: intervals should alternate short-long
        // Beat error = |short - long| / 2
        if finalIntervals.count >= 10 {
            var shortIntervals: [Double] = []
            var longIntervals: [Double] = []
            // Look at consecutive pairs of raw intervals near expected
            let expectedMs = 3600000.0 / Double(useBph)
            let halfExpected = expectedMs / 2.0
            let tolerance = halfExpected * 0.15
            for i in stride(from: 0, to: intervals.count - 1, by: 2) {
                let a = intervals[i]
                let b = intervals[i + 1]
                // Check if these are half-beat intervals (tick-tock)
                if abs(a - halfExpected) < tolerance && abs(b - halfExpected) < tolerance {
                    if a < b {
                        shortIntervals.append(a)
                        longIntervals.append(b)
                    } else {
                        shortIntervals.append(b)
                        longIntervals.append(a)
                    }
                }
            }
            if shortIntervals.count >= 3 {
                let avgShort = shortIntervals.reduce(0.0, +) / Double(shortIntervals.count)
                let avgLong = longIntervals.reduce(0.0, +) / Double(longIntervals.count)
                currentBeatError = ((avgLong - avgShort) / 2.0 * 100).rounded() / 100
            } else {
                currentBeatError = 0
            }
        } else {
            currentBeatError = 0
        }

        lastDebugInfo = DebugInfo(
            sampleRate: envSampleRate, fftSize: ticks.count,
            bufferSamples: finalIntervals.count, hpCutoff: 1000,
            bestLag: useBph, bestCorrelation: meanInterval,
            refinedLag: Double(peakThreshold),
            allBphCorrelations: bphResults)
    }
}
