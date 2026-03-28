import AVFoundation
import Accelerate

/// Detects watch ticks and measures rate via grid-matching.
///
/// Algorithm: "assume it's accurate, then measure how wrong it is"
/// 1. Detect tick events at 48kHz
/// 2. For each candidate BPH, build a perfect grid from the first tick
/// 3. Match detected ticks to nearest grid position (within ±10%)
/// 4. Best BPH = most ticks on grid
/// 5. Rate = cumulative drift of matched ticks from their grid positions
///
/// Noise ticks don't align with any grid, so they're automatically ignored.
/// Accuracy improves with time as drift accumulates and averages out.
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
        let bufferSamples: Int     // ticks matched to grid
        let hpCutoff: Double
        let bestLag: Int           // auto-detected BPH
        let bestCorrelation: Double // measured interval ms
        let refinedLag: Double     // threshold value
        let allBphCorrelations: [(bph: Int, correlation: Float, lag: Int)]
        // correlation = grid-matched ticks, lag = total ticks
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
    private var sampleCounter: Int64 = 0

    // HP filter
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // Short-term energy (1ms rolling window)
    private var energyWindow: [Float] = []
    private var energyWindowSize: Int = 48
    private var energyWritePos: Int = 0
    private var energySum: Float = 0

    // Noise floor: use a ring buffer of recent energy values, take percentile
    private var energyHistory: [Float] = []
    private var energyHistoryCapacity: Int = 2000  // ~2 seconds of 1kHz samples
    private var energyHistoryWritePos: Int = 0
    private var energyHistoryCount: Int = 0
    private var energySubsampleCounter: Int = 0
    private var computedNoiseFloor: Float = 0

    // Sensitivity
    private var sensitivityMultiplier: Float = 1.5

    // Tick detection — rising edge required
    private var lastTickSample: Int64 = -100000
    private var minGapSamples: Int64 = 0
    private var tickSamples: [Int64] = []
    private var wasAboveThreshold: Bool = false

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0

    private let standardBphs = [18000, 21600, 25200, 28800, 36000]
    private var lastAnalysisTime: Double = 0
    private var lastDebugInfo: DebugInfo? = nil

    func setSensitivity(_ value: Int) {
        // 0% → 2.5× noise (strict), 50% → 1.5×, 100% → 1.05× (sensitive)
        let v = Float(max(0, min(100, value)))
        sensitivityMultiplier = 1.05 + ((100.0 - v) / 100.0) * 1.45
    }

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }
        setSensitivity(sensitivity)

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        currentNoiseLevel = 0
        totalSamplesProcessed = 0
        sampleCounter = 0
        lastAnalysisTime = 0
        hpPrevIn = 0
        hpPrevOut = 0
        lastTickSample = -100000
        tickSamples = []
        wasAboveThreshold = false
        energySum = 0
        energyWritePos = 0
        energyHistoryWritePos = 0
        energyHistoryCount = 0
        energySubsampleCounter = 0
        computedNoiseFloor = 0

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
            let rc = 1.0 / (2.0 * Float.pi * Float(1000))
            hpAlpha = rc / (rc + dt)

            energyWindowSize = max(1, Int(actualSampleRate * 0.001))
            energyWindow = [Float](repeating: 0, count: energyWindowSize)
            energyWritePos = 0
            energySum = 0

            // Energy history: store 1 value per ~1ms → 2000 values = 2 seconds
            energyHistoryCapacity = 2000
            energyHistory = [Float](repeating: 0, count: energyHistoryCapacity)

            minGapSamples = Int64(actualSampleRate * 0.04)  // 40ms minimum

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

    // MARK: - Noise floor via percentile

    private func updateNoiseFloor(_ energy: Float) {
        // Store energy value every ~48 samples (1ms) to build histogram
        energySubsampleCounter += 1
        guard energySubsampleCounter >= energyWindowSize else { return }
        energySubsampleCounter = 0

        energyHistory[energyHistoryWritePos] = energy
        energyHistoryWritePos = (energyHistoryWritePos + 1) % energyHistoryCapacity
        energyHistoryCount = min(energyHistoryCount + 1, energyHistoryCapacity)

        // Recompute noise floor every 100 entries (~100ms)
        if energyHistoryCount >= 100 && energyHistoryWritePos % 100 == 0 {
            // Take 50th percentile (median) of recent energy values
            // Threshold = median × multiplier rejects ambient noise well
            // because ticks are brief transients far above the median
            let count = energyHistoryCount
            var sorted = [Float](repeating: 0, count: count)
            for i in 0..<count {
                sorted[i] = energyHistory[i]
            }
            sorted.sort()
            let pIdx = count * 50 / 100  // 50th percentile (median)
            computedNoiseFloor = sorted[pIdx]
        }
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

            // High-pass 1kHz
            let hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp

            // Rolling 1ms energy
            let absHp = abs(hp)
            energySum -= energyWindow[energyWritePos]
            energySum += absHp
            energyWindow[energyWritePos] = absHp
            energyWritePos = (energyWritePos + 1) % energyWindowSize

            let energy = energySum / Float(energyWindowSize)

            sampleCounter += 1

            // Update noise floor histogram
            updateNoiseFloor(energy)

            // Skip first 2 seconds (filter settling + noise floor initialization)
            guard sampleCounter > Int64(actualSampleRate * 2) else { continue }
            guard computedNoiseFloor > 0 else { continue }

            // Tick detection — require rising edge (energy must cross threshold from below)
            // This rejects sustained ambient noise that stays above threshold
            let threshold = computedNoiseFloor * sensitivityMultiplier
            if energy > threshold {
                if !wasAboveThreshold && (sampleCounter - lastTickSample) > minGapSamples {
                    tickSamples.append(sampleCounter)
                    lastTickSample = sampleCounter
                    if tickSamples.count > 10000 {
                        tickSamples.removeFirst(tickSamples.count - 10000)
                    }
                }
                wasAboveThreshold = true
            } else {
                wasAboveThreshold = false
            }
        }
        totalSamplesProcessed += Int64(frameCount)

        // Analyze every ~2 seconds, after at least 10 seconds of ticks
        let now = CACurrentMediaTime() * 1000
        let elapsedSec = Double(sampleCounter) / actualSampleRate
        if now - lastAnalysisTime > 2000 && tickSamples.count >= 30 && elapsedSec > 10 {
            lastAnalysisTime = now
            analyzeGrid()
        }

        let update = Update(
            rate: currentRate, beatError: currentBeatError,
            tickCount: tickSamples.count,
            confidence: currentConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval,
            detectedBph: detectedBph,
            debug: lastDebugInfo)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Grid-matching analysis

    private func analyzeGrid() {
        let ticks = tickSamples
        guard ticks.count >= 30 else { return }

        // Require minimum 30 seconds of data for meaningful results
        let spanSec = Double(ticks.last! - ticks.first!) / actualSampleRate
        guard spanSec >= 30 else { return }

        // Try each standard BPH: build a perfect grid, measure what fraction of
        // expected beats were actually detected. This normalizes for grid density —
        // a denser grid (higher BPH) has more positions, so raw match count is biased.
        var bestBph = 28800
        var bestMatchRate: Double = 0
        var bestOffsets: [(gridIdx: Int, offset: Double)] = []
        var bestInterval: Double = 0
        var bestMatched = 0
        var bestGridPositions = 0
        var bphResults: [(bph: Int, correlation: Float, lag: Int)] = []

        for candidateBph in standardBphs {
            let gridInterval = actualSampleRate * 3600.0 / Double(candidateBph)
            let tolerance = gridInterval * 0.10  // ±10% window

            let result = matchGrid(ticks: ticks, gridInterval: gridInterval, tolerance: tolerance)

            // Key metric: fraction of grid positions matched (not raw count)
            // This is fair across BPHs because tolerance is proportional to interval
            let matchRate = result.gridPositions > 0
                ? Double(result.matched) / Double(result.gridPositions) : 0

            bphResults.append((bph: candidateBph,
                              correlation: Float(result.matched),
                              lag: result.gridPositions))

            if matchRate > bestMatchRate {
                bestMatchRate = matchRate
                bestBph = candidateBph
                bestMatched = result.matched
                bestGridPositions = result.gridPositions
                bestOffsets = result.offsets
                bestInterval = gridInterval
            }
        }

        // Need at least 20 matched ticks and 25% grid coverage
        guard bestMatched >= 20 && bestMatchRate > 0.25 else {
            lastDebugInfo = DebugInfo(
                sampleRate: actualSampleRate, fftSize: ticks.count,
                bufferSamples: bestMatched, hpCutoff: 1000,
                bestLag: bestBph, bestCorrelation: 0,
                refinedLag: Double(computedNoiseFloor * sensitivityMultiplier),
                allBphCorrelations: bphResults)
            return
        }

        detectedBph = bestBph

        // Rate via linear regression on matched offsets
        // Each matched tick has (gridIdx, offset) where offset = tickPos - gridPos
        // If the watch drifts, offsets grow linearly with gridIdx
        // Slope = drift per grid interval (in samples)
        // rate (s/day) = slope / gridInterval × 86400
        let rate: Double
        if bestOffsets.count >= 10 {
            let slope = linearRegressionSlope(bestOffsets)
            rate = (slope / bestInterval) * 86400.0
        } else {
            rate = 0
        }

        currentRate = (rate * 10).rounded() / 10
        currentDetectedInterval = bestInterval / actualSampleRate * 1000.0

        // Confidence based on match rate, count, and span
        let spanFactor = min(1.0, spanSec / 60.0)
        let countFactor = min(1.0, Double(bestMatched) / 200.0)
        currentConfidence = bestMatchRate * (0.4 * countFactor + 0.6 * spanFactor)
        currentConfidence = min(0.99, currentConfidence)
        currentConfidence = (currentConfidence * 100).rounded() / 100

        currentBeatError = 0

        lastDebugInfo = DebugInfo(
            sampleRate: actualSampleRate, fftSize: ticks.count,
            bufferSamples: bestMatched, hpCutoff: 1000,
            bestLag: bestBph, bestCorrelation: currentDetectedInterval,
            refinedLag: Double(computedNoiseFloor * sensitivityMultiplier),
            allBphCorrelations: bphResults)
    }

    // MARK: - Linear regression

    /// Returns slope of best-fit line through (gridIdx, offset) pairs.
    /// Slope = samples of drift per grid interval.
    private func linearRegressionSlope(_ points: [(gridIdx: Int, offset: Double)]) -> Double {
        let n = Double(points.count)
        guard n >= 2 else { return 0 }
        var sumX: Double = 0, sumY: Double = 0, sumXY: Double = 0, sumXX: Double = 0
        for p in points {
            let x = Double(p.gridIdx)
            let y = p.offset
            sumX += x; sumY += y; sumXY += x * y; sumXX += x * x
        }
        let denom = n * sumXX - sumX * sumX
        guard abs(denom) > 1e-10 else { return 0 }
        return (n * sumXY - sumX * sumY) / denom
    }

    // MARK: - Grid matching

    private struct GridResult {
        let matched: Int
        let gridPositions: Int
        let offsets: [(gridIdx: Int, offset: Double)]
    }

    /// Build a perfect grid starting from tick[0], match detected ticks to grid positions.
    /// Returns matched count, total grid positions, and per-match offsets for rate calculation.
    private func matchGrid(ticks: [Int64], gridInterval: Double,
                           tolerance: Double) -> GridResult {
        guard ticks.count >= 2 else {
            return GridResult(matched: 0, gridPositions: 0, offsets: [])
        }

        let origin = Double(ticks[0])
        var matched = 0
        var offsets: [(gridIdx: Int, offset: Double)] = []
        var tickIdx = 1
        var gridIdx = 1

        let totalSpan = Double(ticks.last! - ticks.first!)
        let maxGridIdx = Int(totalSpan / gridInterval) + 2

        while tickIdx < ticks.count && gridIdx < maxGridIdx {
            let gridPos = origin + Double(gridIdx) * gridInterval
            let tickPos = Double(ticks[tickIdx])
            let diff = tickPos - gridPos

            if abs(diff) < tolerance {
                matched += 1
                offsets.append((gridIdx: gridIdx, offset: diff))
                tickIdx += 1
                gridIdx += 1
            } else if tickPos < gridPos - tolerance {
                tickIdx += 1
            } else {
                gridIdx += 1
            }
        }

        return GridResult(matched: matched, gridPositions: maxGridIdx - 1, offsets: offsets)
    }
}
