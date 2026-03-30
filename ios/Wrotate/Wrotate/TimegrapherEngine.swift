import AVFoundation
import Accelerate

/// Measures watch accuracy via Goertzel algorithm at a known BPH.
///
/// Algorithm: user provides BPH → we know the exact tick frequency.
/// 1. HP-filter raw 48kHz audio (4kHz default) to isolate tick transients
/// 2. Peak-hold energy into a ring buffer at ~12kHz
/// 3. Goertzel at the tick frequency — measures power at that exact frequency
/// 4. Compare to baseline power at incommensurate frequencies
/// 5. High ratio = periodic ticks detected; low ratio = ambient noise
/// 6. Rate = fine frequency sweep around expected, parabolic interpolation
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
        let bestCorrelation: Double // Goertzel power at tick freq
        let refinedLag: Double     // detected frequency
        let noiseFloor: Double     // baseline power
        let threshold: Double      // Goertzel ratio
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

    // HP filter
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // Peak energy within each subsample group
    private var subsamplePeak: Float = 0

    // Energy ring buffer
    private var energyRing: [Float] = []
    private var energyRingCapacity: Int = 360000
    private var bufferDurationSec: Float = 30.0
    private var energyRingWritePos: Int = 0
    private var energyRingCount: Int = 0
    private var energySubsampleCounter: Int = 0
    private var ringSubsampleTarget: Int = 4  // 48kHz / 4 = 12kHz

    // Tuning parameters
    private var hpCutoffHz: Float = 4000
    private var peakRatioThreshold: Float = 2.5

    // Live debug values
    private var recentPeakEnergy: Float = 0

    // Ratio smoothing + hysteresis
    private var smoothedRatio: Double = 0
    private let ratioSmoothAlpha: Double = 0.3  // EMA smoothing factor (lower = smoother)
    private var isDetected: Bool = false          // hysteresis state

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
        // Kept for bridge compatibility
    }

    func setTuning(multLo: Float, multHi: Float, minThreshold: Float,
                    percentile: Int, hpCutoff: Float,
                    peakRatioThreshold thresh: Float = 2.5,
                    bufferSeconds bufSec: Float = 30.0) {
        hpCutoffHz = max(200, min(8000, hpCutoff))
        peakRatioThreshold = max(1.0, thresh)
        let dt = 1.0 / Float(actualSampleRate)
        let rc = 1.0 / (2.0 * Float.pi * hpCutoffHz)
        hpAlpha = rc / (rc + dt)
        // Store for next start() — don't resize mid-recording
        bufferDurationSec = max(5, min(120, bufSec))
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
        subsamplePeak = 0
        energyRingWritePos = 0
        energyRingCount = 0
        energySubsampleCounter = 0
        recentPeakEnergy = 0
        peakCount = 0
        smoothedRatio = 0
        isDetected = false
        lastDebugInfo = nil

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

            // Ring buffer at ~12kHz
            ringSubsampleTarget = max(1, Int(actualSampleRate / 12000))
            let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
            energyRingCapacity = Int(ringSampleRate * Double(bufferDurationSec))
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

            // Peak-hold within each subsample group
            let absHp = abs(hp)
            if absHp > subsamplePeak { subsamplePeak = absHp }

            sampleCounter += 1

            energySubsampleCounter += 1
            if energySubsampleCounter >= ringSubsampleTarget {
                energySubsampleCounter = 0
                let energy = subsamplePeak
                subsamplePeak = 0
                energyRing[energyRingWritePos] = energy
                energyRingWritePos = (energyRingWritePos + 1) % energyRingCapacity
                energyRingCount = min(energyRingCount + 1, energyRingCapacity)

                if energy > recentPeakEnergy { recentPeakEnergy = energy }
            }
        }

        // Analyze every ~2 seconds, after at least 10 seconds of data
        let now = CACurrentMediaTime() * 1000
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let elapsedSec = Double(energyRingCount) / ringSampleRate
        if now - lastAnalysisTime > 2000 && elapsedSec >= 10 {
            lastAnalysisTime = now
            analyzeGoertzel()
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

    // MARK: - Goertzel analysis

    /// Compute power at a single frequency using the Goertzel algorithm.
    /// Much more efficient than autocorrelation — O(N) for one frequency.
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

    private func analyzeGoertzel() {
        let count = energyRingCount
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        guard count >= Int(ringSampleRate * 10) else { return }

        let tickFreq = Double(targetBph) / 3600.0  // Hz

        // Build linear array from ring buffer
        var signal = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let idx = (energyRingWritePos - count + i + energyRingCapacity) % energyRingCapacity
            signal[i] = energyRing[idx]
        }

        // === DETECTION: Goertzel at tick frequency vs baseline ===
        let targetPower = goertzelPower(signal, count: count, targetFreq: tickFreq, sampleRate: ringSampleRate)

        // Baseline: average power at several incommensurate frequencies
        let baselineMultipliers = [0.73, 0.81, 1.19, 1.37, 1.61]
        var baselineSum = 0.0
        for mult in baselineMultipliers {
            baselineSum += goertzelPower(signal, count: count, targetFreq: tickFreq * mult, sampleRate: ringSampleRate)
        }
        let baseline = baselineSum / Double(baselineMultipliers.count)

        let rawRatio = baseline > 0 ? targetPower / baseline : (targetPower > 0 ? 10.0 : 0)

        // Smooth ratio with EMA to prevent flicker on borderline signals
        smoothedRatio = smoothedRatio == 0 ? rawRatio : (ratioSmoothAlpha * rawRatio + (1 - ratioSmoothAlpha) * smoothedRatio)
        let goertzelRatio = smoothedRatio

        // Hysteresis: detect at threshold, maintain at 70% of threshold
        let detectThreshold = Double(peakRatioThreshold)
        let maintainThreshold = detectThreshold * 0.7
        if goertzelRatio >= detectThreshold {
            isDetected = true
        } else if goertzelRatio < maintainThreshold {
            isDetected = false
        }
        // else: between maintain and detect thresholds — keep current state

        // === RATE: Fine frequency sweep ±0.5% ===
        var detectedFreq = tickFreq
        if isDetected {
            let sweepRange = tickFreq * 0.005  // ±0.5%
            let steps = 101
            var bestPower = 0.0
            var bestIdx = steps / 2
            var sweepPowers = [Double](repeating: 0, count: steps)

            for i in 0..<steps {
                let f = tickFreq - sweepRange + (2.0 * sweepRange * Double(i) / Double(steps - 1))
                let p = goertzelPower(signal, count: count, targetFreq: f, sampleRate: ringSampleRate)
                sweepPowers[i] = p
                if p > bestPower {
                    bestPower = p
                    bestIdx = i
                }
            }

            // Parabolic interpolation
            let df = 2.0 * sweepRange / Double(steps - 1)
            detectedFreq = tickFreq - sweepRange + df * Double(bestIdx)
            if bestIdx > 0 && bestIdx < steps - 1 {
                let a = sweepPowers[bestIdx - 1]
                let b = sweepPowers[bestIdx]
                let c = sweepPowers[bestIdx + 1]
                let denom = 2.0 * (2.0 * b - a - c)
                if abs(denom) > 1e-30 {
                    let delta = (a - c) / denom
                    detectedFreq += delta * df
                }
            }
        }

        let rate = ((detectedFreq - tickFreq) / tickFreq) * 86400.0
        let detectedIntervalSec = 1.0 / detectedFreq

        // Confidence
        let elapsedSec = Double(count) / ringSampleRate
        let durationFactor = min(1.0, elapsedSec / 60.0)
        let peakFactor = min(1.0, max(0, (goertzelRatio - 1.0) / 9.0))
        let confidence = peakFactor * (0.3 + 0.7 * durationFactor)

        // Report results — require detection (with hysteresis) AND plausible rate
        // Any mechanical watch running beyond ±120 s/day is almost certainly a false positive
        if isDetected && abs(rate) <= 120.0 {
            currentRate = (rate * 10).rounded() / 10
            currentDetectedInterval = detectedIntervalSec * 1000.0
            detectedBph = targetBph
            currentConfidence = min(0.99, (confidence * 100).rounded() / 100)
            peakCount = Int(elapsedSec * Double(targetBph) / 3600.0)
        } else {
            currentRate = nil
            currentConfidence = 0
            detectedBph = nil
            peakCount = 0
        }

        currentBeatError = nil

        lastDebugInfo = DebugInfo(
            sampleRate: actualSampleRate,
            fftSize: energyRingCount,
            bufferSamples: count,
            hpCutoff: Double(hpCutoffHz),
            bestLag: targetBph,
            bestCorrelation: targetPower,
            refinedLag: detectedFreq,
            noiseFloor: baseline,
            threshold: goertzelRatio,
            peakEnergy: Double(recentPeakEnergy),
            allBphCorrelations: [
                (bph: targetBph, correlation: Float(goertzelRatio), lag: Int(detectedFreq * 1000))
            ])

        recentPeakEnergy = recentPeakEnergy * 0.95
    }
}
