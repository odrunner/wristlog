import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds
/// using peak-based transient detection for sub-millisecond timing precision.
class TimegrapherEngine {

    struct Update {
        let rate: Double?          // seconds/day deviation
        let beatError: Double?     // milliseconds
        let tickCount: Int
        let confidence: Double     // 0–1
        let noiseLevel: Double     // 0–1
        let detectedIntervalMs: Double
        let detectedBph: Int?      // auto-detected BPH
    }

    struct Result {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let ticks: [Double]        // timestamps in ms since start
    }

    var onUpdate: ((Update) -> Void)?

    private var audioEngine: AVAudioEngine?
    private var isRunning = false
    private var bph: Int = 28800
    private var sensitivity: Int = 50

    // Tick detection state
    private var actualSampleRate: Double = 44100
    private var startSampleOffset: Int64 = 0       // sample count at start
    private var totalSamplesProcessed: Int64 = 0
    private var tickTimestamps: [Double] = []       // ms since start, from sample position
    private var tickIntervals: [Double] = []        // ms between consecutive ticks

    // Peak detection
    private var peakHoldoff: Int = 0                // samples to skip after a detected peak
    private var noiseFloor: Float = 0               // adaptive noise floor
    private var peakThreshold: Float = 0.01         // dynamic threshold

    // Analysis
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var currentNoiseLevel: Double = 0
    private var detectedBph: Int? = nil
    private let standardBphs = [18000, 21600, 25200, 28800, 36000]

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }
        self.bph = bph
        self.sensitivity = sensitivity

        tickTimestamps = []
        tickIntervals = []
        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        totalSamplesProcessed = 0
        noiseFloor = 0
        peakThreshold = 0.01

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [])
            try session.setPreferredSampleRate(44100)
            try session.setActive(true)

            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }

            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            actualSampleRate = format.sampleRate

            // Holdoff: skip 60% of expected tick interval after each detection
            let expectedIntervalSamples = actualSampleRate * 3600.0 / Double(bph)
            peakHoldoff = Int(expectedIntervalSamples * 0.6)

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
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

        return Result(
            rate: currentRate,
            beatError: currentBeatError,
            tickCount: tickTimestamps.count,
            ticks: tickTimestamps
        )
    }

    // MARK: - Audio processing

    private var holdoffCounter: Int = 0

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        // Compute RMS for noise level display
        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        // Adaptive noise floor (slow-follow RMS)
        let alpha: Float = 0.02
        noiseFloor = noiseFloor * (1 - alpha) + rms * alpha

        // Threshold: noise floor multiplied by sensitivity factor
        // sensitivity 0-100 maps to threshold multiplier 8x-3x
        let sensMultiplier = Float(8.0 - 5.0 * Double(sensitivity) / 100.0)
        peakThreshold = max(0.002, noiseFloor * sensMultiplier)

        // Scan for peaks (transient tick sounds)
        for i in 0..<frameCount {
            let sample = abs(channelData[i])

            if holdoffCounter > 0 {
                holdoffCounter -= 1
                continue
            }

            if sample > peakThreshold {
                // Found a peak — record precise timestamp
                let samplePosition = totalSamplesProcessed + Int64(i)
                let timestampMs = Double(samplePosition) / actualSampleRate * 1000.0

                // Record interval from previous tick
                if let lastTick = tickTimestamps.last {
                    let interval = timestampMs - lastTick
                    let expectedInterval = 3600000.0 / Double(bph)

                    // Accept only intervals within 50% of expected
                    if interval > expectedInterval * 0.5 && interval < expectedInterval * 1.5 {
                        tickIntervals.append(interval)
                        tickTimestamps.append(timestampMs)
                    }
                    // If interval is very small, skip (noise/echo)
                    // If interval is very large, still record the tick to restart
                    else if interval > expectedInterval * 1.5 {
                        tickTimestamps.append(timestampMs)
                    }
                } else {
                    // First tick
                    tickTimestamps.append(timestampMs)
                }

                holdoffCounter = peakHoldoff
            }
        }

        totalSamplesProcessed += Int64(frameCount)

        // Analyze collected intervals
        analyzeIntervals()

        // Report update
        let update = Update(
            rate: currentRate,
            beatError: currentBeatError,
            tickCount: tickTimestamps.count,
            confidence: currentConfidence,
            noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval,
            detectedBph: detectedBph
        )

        DispatchQueue.main.async { [weak self] in
            self?.onUpdate?(update)
        }
    }

    private func analyzeIntervals() {
        let count = tickIntervals.count
        guard count >= 4 else {
            currentConfidence = 0
            return
        }

        // Use only the last 200 intervals for analysis (sliding window)
        let recentIntervals = count > 200 ? Array(tickIntervals.suffix(200)) : tickIntervals

        // Sort for median calculation
        let sorted = recentIntervals.sorted()
        let n = sorted.count
        let median = n % 2 == 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2.0 : sorted[n/2]

        // Filter outliers: keep values within 5% of median
        let filtered = recentIntervals.filter { abs($0 - median) / median < 0.05 }
        guard filtered.count >= 3 else {
            currentConfidence = Double(recentIntervals.count) / 20.0
            return
        }

        // Calculate mean of filtered intervals
        let mean = filtered.reduce(0, +) / Double(filtered.count)

        // Standard deviation
        let variance = filtered.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(filtered.count)
        let stddev = sqrt(variance)

        currentDetectedInterval = mean

        // Auto-detect BPH: find the standard BPH closest to detected interval
        var bestBph = bph
        var bestDiff = Double.infinity
        for candidateBph in standardBphs {
            let candidateInterval = 3600000.0 / Double(candidateBph)
            let diff = abs(mean - candidateInterval)
            if diff < bestDiff {
                bestDiff = diff
                bestBph = candidateBph
            }
        }
        detectedBph = bestBph

        // Rate calculation using auto-detected BPH
        let expectedInterval = 3600000.0 / Double(bestBph)
        currentRate = ((mean - expectedInterval) / expectedInterval) * 86400.0
        currentRate = (currentRate! * 10).rounded() / 10

        // Confidence: based on consistency (low stddev = high confidence) and sample count
        let cv = stddev / mean  // coefficient of variation
        let consistencyScore = max(0, 1.0 - cv * 20)  // cv of 0.05 → 0, cv of 0 → 1
        let sampleScore = min(1.0, Double(filtered.count) / 30.0)
        currentConfidence = (consistencyScore * 0.7 + sampleScore * 0.3)
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Beat error: difference between alternating intervals (tick vs tock)
        if filtered.count >= 6 {
            var evenIntervals: [Double] = []
            var oddIntervals: [Double] = []
            // Use the original recent intervals (not sorted) for alternating pattern
            let recent = count > 60 ? Array(tickIntervals.suffix(60)) : tickIntervals
            for (i, interval) in recent.enumerated() {
                if abs(interval - mean) / mean < 0.05 {
                    if i % 2 == 0 {
                        evenIntervals.append(interval)
                    } else {
                        oddIntervals.append(interval)
                    }
                }
            }
            if evenIntervals.count >= 3 && oddIntervals.count >= 3 {
                let evenMean = evenIntervals.reduce(0, +) / Double(evenIntervals.count)
                let oddMean = oddIntervals.reduce(0, +) / Double(oddIntervals.count)
                currentBeatError = abs(evenMean - oddMean)
                currentBeatError = (currentBeatError! * 100).rounded() / 100
            } else {
                currentBeatError = 0
            }
        }
    }
}
