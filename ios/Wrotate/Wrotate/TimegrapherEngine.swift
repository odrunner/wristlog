import AVFoundation
import Accelerate

/// Measures watch accuracy via autocorrelation at a known BPH.
///
/// Algorithm: user provides BPH → we know the exact tick interval.
/// 1. HP-filter raw 48kHz audio to isolate transients
/// 2. Compute 1ms rolling energy (rectified signal)
/// 3. Accumulate energy into a ring buffer (several seconds)
/// 4. Autocorrelate at the known BPH lag — periodic ticks produce a peak
/// 5. No watch = no periodicity = no detection (no threshold needed!)
/// 6. Rate = sub-sample refinement of the autocorrelation peak offset from ideal lag
///
/// This completely avoids amplitude thresholding — we don't need to
/// distinguish tick loudness from noise loudness. We only detect periodicity.
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
        let fftSize: Int           // energy ring buffer fill count
        let bufferSamples: Int     // analysis window samples
        let hpCutoff: Double
        let bestLag: Int           // BPH
        let bestCorrelation: Double // autocorrelation peak value
        let refinedLag: Double     // refined lag in samples
        let noiseFloor: Double     // baseline correlation
        let threshold: Double      // peak / baseline ratio
        let peakEnergy: Double     // recent peak energy
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

    // Known BPH from user
    private var targetBph: Int = 28800

    // HP filter (1kHz)
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // Short-term energy (1ms rolling window)
    private var energyWindow: [Float] = []
    private var energyWindowSize: Int = 48
    private var energyWritePos: Int = 0
    private var energySum: Float = 0

    // Energy ring buffer for autocorrelation
    // At 1ms resolution, 10 seconds = 10000 entries
    // We need at least 2× the tick interval for autocorrelation
    // 18000 BPH = 200ms interval → need 400ms minimum, we keep 10s
    private var energyRing: [Float] = []
    private var energyRingCapacity: Int = 10000  // 10 seconds at 1ms
    private var energyRingWritePos: Int = 0
    private var energyRingCount: Int = 0
    private var energySubsampleCounter: Int = 0

    // Tuning parameters
    private var hpCutoffHz: Float = 1000

    // Live debug values
    private var recentPeakEnergy: Float = 0

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0
    private var peakCount: Int = 0

    private var lastAnalysisTime: Double = 0
    private var lastDebugInfo: DebugInfo? = nil

    func setSensitivity(_ value: Int) {
        // Not used in autocorrelation approach, kept for bridge compatibility
    }

    func setTuning(multLo: Float, multHi: Float, minThreshold: Float,
                    percentile: Int, hpCutoff: Float) {
        hpCutoffHz = max(200, min(5000, hpCutoff))
        let dt = 1.0 / Float(actualSampleRate)
        let rc = 1.0 / (2.0 * Float.pi * hpCutoffHz)
        hpAlpha = rc / (rc + dt)
    }

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }
        targetBph = bph

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        currentNoiseLevel = 0
        sampleCounter = 0
        lastAnalysisTime = 0
        hpPrevIn = 0
        hpPrevOut = 0
        energySum = 0
        energyWritePos = 0
        energyRingWritePos = 0
        energyRingCount = 0
        energySubsampleCounter = 0
        recentPeakEnergy = 0
        peakCount = 0

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

            let dt = 1.0 / Float(actualSampleRate)
            let rc = 1.0 / (2.0 * Float.pi * hpCutoffHz)
            hpAlpha = rc / (rc + dt)

            energyWindowSize = max(1, Int(actualSampleRate * 0.001))  // 1ms
            energyWindow = [Float](repeating: 0, count: energyWindowSize)
            energyWritePos = 0
            energySum = 0

            // Ring buffer: 10 seconds at 1ms resolution
            energyRingCapacity = 10000
            energyRing = [Float](repeating: 0, count: energyRingCapacity)

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

            // High-pass filter
            let hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp

            // Rolling 1ms energy (mean absolute value)
            let absHp = abs(hp)
            energySum -= energyWindow[energyWritePos]
            energySum += absHp
            energyWindow[energyWritePos] = absHp
            energyWritePos = (energyWritePos + 1) % energyWindowSize

            sampleCounter += 1

            // Store one energy sample per ms into ring buffer
            energySubsampleCounter += 1
            if energySubsampleCounter >= energyWindowSize {
                energySubsampleCounter = 0
                let energy = energySum / Float(energyWindowSize)
                energyRing[energyRingWritePos] = energy
                energyRingWritePos = (energyRingWritePos + 1) % energyRingCapacity
                energyRingCount = min(energyRingCount + 1, energyRingCapacity)

                if energy > recentPeakEnergy { recentPeakEnergy = energy }
            }
        }

        // Analyze every ~2 seconds, after at least 5 seconds of data
        let now = CACurrentMediaTime() * 1000
        let elapsedSec = Double(energyRingCount) / 1000.0
        if now - lastAnalysisTime > 2000 && elapsedSec >= 5 {
            lastAnalysisTime = now
            analyzeAutocorrelation()
        }

        let update = Update(
            rate: currentRate, beatError: currentBeatError,
            tickCount: peakCount,
            confidence: currentConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval,
            detectedBph: detectedBph,
            debug: lastDebugInfo)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Autocorrelation analysis

    private func analyzeAutocorrelation() {
        let count = energyRingCount
        guard count >= 3000 else { return }  // need at least 3 seconds

        // Expected lag in ms (= energy ring indices at 1ms resolution)
        // BPH → beats per second = BPH/3600 → interval = 3600/BPH seconds = 3600000/BPH ms
        let expectedLagMs = 3600000.0 / Double(targetBph)
        let lagCenter = Int(expectedLagMs)

        // Search window: ±5% around expected lag
        let searchRadius = max(1, Int(Double(lagCenter) * 0.05))
        let lagMin = max(1, lagCenter - searchRadius)
        let lagMax = min(count / 2, lagCenter + searchRadius)
        guard lagMin < lagMax else { return }

        // Build a linear array from the ring buffer (most recent `count` samples)
        var signal = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let idx = (energyRingWritePos - count + i + energyRingCapacity) % energyRingCapacity
            signal[i] = energyRing[idx]
        }

        // Subtract mean to remove DC bias
        var mean: Float = 0
        vDSP_meanv(signal, 1, &mean, vDSP_Length(count))
        var negMean = -mean
        vDSP_vsadd(signal, 1, &negMean, &signal, 1, vDSP_Length(count))

        // Compute autocorrelation for lags in search window
        var bestLag = lagCenter
        var bestCorr: Float = -1
        var correlations = [Float](repeating: 0, count: lagMax - lagMin + 1)

        signal.withUnsafeBufferPointer { buf in
            let ptr = buf.baseAddress!
            for lag in lagMin...lagMax {
                let n = count - lag
                guard n > 0 else { continue }
                var corr: Float = 0
                vDSP_dotpr(ptr, 1, ptr + lag, 1, &corr, vDSP_Length(n))
                corr /= Float(n)
                correlations[lag - lagMin] = corr
                if corr > bestCorr {
                    bestCorr = corr
                    bestLag = lag
                }
            }
        }

        // Baseline: average correlation at distant lags (noise floor)
        // Use lags far from the peak (±30% away from expected)
        let baselineLagA = max(1, lagCenter / 2)
        let baselineLagB = min(count / 2 - 1, lagCenter * 2)
        var baselineSum: Float = 0
        var baselineN = 0

        signal.withUnsafeBufferPointer { buf in
            let ptr = buf.baseAddress!
            for testLag in [baselineLagA, baselineLagB] {
                if testLag < lagMin || testLag > lagMax {
                    let n = count - testLag
                    guard n > 0 else { continue }
                    var corr: Float = 0
                    vDSP_dotpr(ptr, 1, ptr + testLag, 1, &corr, vDSP_Length(n))
                    corr /= Float(n)
                    baselineSum += corr
                    baselineN += 1
                }
            }
        }
        let baseline = baselineN > 0 ? baselineSum / Float(baselineN) : 0

        // Peak-to-baseline ratio: strong periodicity → high ratio
        let peakRatio = baseline > 0 ? Double(bestCorr / baseline) : (bestCorr > 0 ? 10.0 : 0)

        // Sub-sample refinement via parabolic interpolation
        var refinedLag = Double(bestLag)
        if bestLag > lagMin && bestLag < lagMax {
            let idxL = bestLag - lagMin - 1
            let idxC = bestLag - lagMin
            let idxR = bestLag - lagMin + 1
            if idxL >= 0 && idxR < correlations.count {
                let a = correlations[idxL]
                let b = correlations[idxC]
                let c = correlations[idxR]
                let denom = 2.0 * (2.0 * b - a - c)
                if abs(denom) > 1e-10 {
                    let delta = Double(a - c) / Double(denom)
                    refinedLag = Double(bestLag) + delta
                }
            }
        }

        // Rate calculation: how far is the detected interval from the expected interval?
        // refinedLag is in ms, expectedLagMs is the ideal
        // drift per tick interval = refinedLag - expectedLagMs (in ms)
        // rate (s/day) = (drift / expected) × 86400
        let driftMs = refinedLag - expectedLagMs
        let rate = (driftMs / expectedLagMs) * 86400.0

        // Confidence: based on peak ratio and data duration
        let durationFactor = min(1.0, elapsedSeconds / 60.0)
        let peakFactor = min(1.0, max(0, (peakRatio - 1.0) / 4.0))  // ratio 1=noise, 5+=strong
        let confidence = peakFactor * (0.3 + 0.7 * durationFactor)

        // Only report results if there's meaningful periodicity
        if peakRatio > 1.5 {
            currentRate = (rate * 10).rounded() / 10
            currentDetectedInterval = refinedLag  // ms
            detectedBph = targetBph
            currentConfidence = min(0.99, (confidence * 100).rounded() / 100)
            peakCount = Int(elapsedSeconds * Double(targetBph) / 3600.0)  // estimated ticks
        } else {
            currentRate = nil
            currentConfidence = 0
            detectedBph = nil
            peakCount = 0
        }

        currentBeatError = nil  // not measurable via autocorrelation alone

        lastDebugInfo = DebugInfo(
            sampleRate: actualSampleRate,
            fftSize: energyRingCount,
            bufferSamples: count,
            hpCutoff: Double(hpCutoffHz),
            bestLag: targetBph,
            bestCorrelation: Double(bestCorr),
            refinedLag: refinedLag,
            noiseFloor: Double(baseline),
            threshold: peakRatio,
            peakEnergy: Double(recentPeakEnergy),
            allBphCorrelations: [
                (bph: targetBph, correlation: bestCorr, lag: bestLag)
            ])

        recentPeakEnergy = recentPeakEnergy * 0.95
    }

    private var elapsedSeconds: Double {
        return Double(energyRingCount) / 1000.0
    }
}
