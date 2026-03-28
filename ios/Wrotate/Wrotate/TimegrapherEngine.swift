import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds
/// using high-resolution autocorrelation on raw audio for robust, noise-tolerant detection.
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

    private var actualSampleRate: Double = 44100
    private var totalSamplesProcessed: Int64 = 0

    // Ring buffer for raw audio (~4 seconds)
    private var ringBuffer: [Float] = []
    private var ringCapacity: Int = 0
    private var ringWritePos: Int = 0
    private var ringSamplesWritten: Int64 = 0

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0
    private var tickCount: Int = 0

    private let standardBphs = [18000, 21600, 25200, 28800, 36000]

    // Analysis timing
    private var lastAnalysisTime: Double = 0

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }
        self.bph = bph

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        tickCount = 0
        totalSamplesProcessed = 0
        lastAnalysisTime = 0

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

            // Ring buffer: 4 seconds of audio
            ringCapacity = Int(actualSampleRate * 4)
            ringBuffer = [Float](repeating: 0, count: ringCapacity)
            ringWritePos = 0
            ringSamplesWritten = 0

            inputNode.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, time in
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
            tickCount: tickCount,
            ticks: []
        )
    }

    // MARK: - Audio processing

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        // Compute noise level
        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        // Write to ring buffer
        for i in 0..<frameCount {
            ringBuffer[ringWritePos] = channelData[i]
            ringWritePos = (ringWritePos + 1) % ringCapacity
        }
        ringSamplesWritten += Int64(frameCount)
        totalSamplesProcessed += Int64(frameCount)

        // Run analysis every ~500ms, after we have at least 2 seconds of data
        let now = CACurrentMediaTime() * 1000
        if now - lastAnalysisTime > 500 && ringSamplesWritten > Int64(actualSampleRate * 2) {
            lastAnalysisTime = now
            runAnalysis()
        }

        // Report update
        let update = Update(
            rate: currentRate,
            beatError: currentBeatError,
            tickCount: tickCount,
            confidence: currentConfidence,
            noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval,
            detectedBph: detectedBph
        )

        DispatchQueue.main.async { [weak self] in
            self?.onUpdate?(update)
        }
    }

    // MARK: - High-resolution autocorrelation analysis

    private func runAnalysis() {
        // Build rectified energy envelope at ~0.5ms resolution
        let hopSamples = max(1, Int(actualSampleRate * 0.0005))  // 0.5ms hop
        let windowSize = hopSamples * 2  // 1ms window for energy

        let availableSamples = min(Int(ringSamplesWritten), ringCapacity)
        let envelopeLength = availableSamples / hopSamples
        guard envelopeLength > 100 else { return }

        // Compute energy envelope from ring buffer
        var envelope = [Float](repeating: 0, count: envelopeLength)
        for i in 0..<envelopeLength {
            let startIdx = (ringWritePos - availableSamples + i * hopSamples + ringCapacity) % ringCapacity
            var energy: Float = 0
            for j in 0..<min(windowSize, availableSamples - i * hopSamples) {
                let idx = (startIdx + j) % ringCapacity
                let s = ringBuffer[idx]
                energy += s * s
            }
            envelope[i] = energy / Float(windowSize)
        }

        // Remove DC / slow trends from envelope
        var mean: Float = 0
        vDSP_meanv(envelope, 1, &mean, vDSP_Length(envelopeLength))
        var negMean = -mean
        vDSP_vsadd(envelope, 1, &negMean, &envelope, 1, vDSP_Length(envelopeLength))

        // Try each standard BPH and find best autocorrelation
        let hopMs = Double(hopSamples) / actualSampleRate * 1000.0

        var bestCorrelation: Float = -1
        var bestBph = 28800
        var bestLagBins: Int = 0

        for candidateBph in standardBphs {
            let expectedIntervalMs = 3600000.0 / Double(candidateBph)
            let centerLag = Int(round(expectedIntervalMs / hopMs))

            // Search ±10% around expected interval
            let searchRange = max(2, Int(round(Double(centerLag) * 0.1)))
            let minLag = max(1, centerLag - searchRange)
            let maxLag = min(envelopeLength / 2, centerLag + searchRange)

            guard maxLag > minLag else { continue }

            // Compute normalized autocorrelation at each lag
            var localBestCorr: Float = -1
            var localBestLag = centerLag

            // Compute envelope energy for normalization
            var envelopeEnergy: Float = 0
            vDSP_svesq(envelope, 1, &envelopeEnergy, vDSP_Length(envelopeLength))

            guard envelopeEnergy > 0 else { continue }

            for lag in minLag...maxLag {
                let pairs = envelopeLength - lag
                guard pairs > 0 else { continue }

                var corr: Float = 0
                // Dot product of envelope with shifted version
                vDSP_dotpr(envelope, 1, envelope.advanced(by: lag), 1, &corr, vDSP_Length(pairs))
                corr /= envelopeEnergy  // normalize

                if corr > localBestCorr {
                    localBestCorr = corr
                    localBestLag = lag
                }
            }

            if localBestCorr > bestCorrelation {
                bestCorrelation = localBestCorr
                bestBph = candidateBph
                bestLagBins = localBestLag
            }
        }

        guard bestCorrelation > 0.01 else {
            currentConfidence = 0
            return
        }

        // Parabolic interpolation for sub-bin accuracy
        let lag = bestLagBins
        if lag > 0 && lag < envelopeLength / 2 - 1 {
            let pairs = envelopeLength - lag
            var corrMinus: Float = 0
            var corrCenter: Float = 0
            var corrPlus: Float = 0
            var envelopeEnergy: Float = 0
            vDSP_svesq(envelope, 1, &envelopeEnergy, vDSP_Length(envelopeLength))

            if envelopeEnergy > 0 && lag > 1 {
                let pM = envelopeLength - (lag - 1)
                vDSP_dotpr(envelope, 1, envelope.advanced(by: lag - 1), 1, &corrMinus, vDSP_Length(pM))
                corrMinus /= envelopeEnergy

                vDSP_dotpr(envelope, 1, envelope.advanced(by: lag), 1, &corrCenter, vDSP_Length(pairs))
                corrCenter /= envelopeEnergy

                let pP = envelopeLength - (lag + 1)
                vDSP_dotpr(envelope, 1, envelope.advanced(by: lag + 1), 1, &corrPlus, vDSP_Length(pP))
                corrPlus /= envelopeEnergy

                let denom = corrMinus - 2 * corrCenter + corrPlus
                if abs(denom) > 1e-10 {
                    let delta = 0.5 * (corrMinus - corrPlus) / denom
                    let refinedLag = Double(lag) + Double(delta)
                    currentDetectedInterval = refinedLag * hopMs
                } else {
                    currentDetectedInterval = Double(lag) * hopMs
                }
            } else {
                currentDetectedInterval = Double(lag) * hopMs
            }
        } else {
            currentDetectedInterval = Double(lag) * hopMs
        }

        detectedBph = bestBph
        currentConfidence = Double(max(0, min(1, bestCorrelation * 2)))
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Rate: deviation from detected BPH's expected interval
        let expectedInterval = 3600000.0 / Double(bestBph)
        currentRate = ((currentDetectedInterval - expectedInterval) / expectedInterval) * 86400.0
        currentRate = (currentRate! * 10).rounded() / 10

        // Estimate tick count from elapsed time
        let elapsedMs = Double(totalSamplesProcessed) / actualSampleRate * 1000.0
        if currentDetectedInterval > 0 {
            tickCount = Int(elapsedMs / currentDetectedInterval)
        }

        // Beat error: compare autocorrelation at lag vs 2*lag
        // If ticks alternate (tick-tock), the correlation at lag will be lower than at 2*lag
        let doubleLag = lag * 2
        if doubleLag < envelopeLength / 2 {
            var envelopeEnergy: Float = 0
            vDSP_svesq(envelope, 1, &envelopeEnergy, vDSP_Length(envelopeLength))

            if envelopeEnergy > 0 {
                var corrDouble: Float = 0
                let pairsD = envelopeLength - doubleLag
                vDSP_dotpr(envelope, 1, envelope.advanced(by: doubleLag), 1, &corrDouble, vDSP_Length(pairsD))
                corrDouble /= envelopeEnergy

                // Beat error ≈ how much stronger the double-period correlation is
                // In a perfect tick-tock, double correlation >> single correlation
                if corrDouble > bestCorrelation {
                    // Alternating pattern detected — estimate beat error
                    let ratio = Double(corrDouble - bestCorrelation) / Double(corrDouble)
                    currentBeatError = ratio * currentDetectedInterval * 0.5
                    currentBeatError = (currentBeatError! * 100).rounded() / 100
                } else {
                    currentBeatError = 0
                }
            }
        }
    }
}
