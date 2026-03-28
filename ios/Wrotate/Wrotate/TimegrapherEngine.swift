import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds.
/// Uses Bartlett's method: averages autocorrelation over multiple segments.
/// More recording time → more segments → accuracy improves as √N.
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
        let fftSize: Int
        let bufferSamples: Int
        let hpCutoff: Double
        let bestLag: Int
        let bestCorrelation: Double
        let refinedLag: Double
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

    // Envelope ring buffer at decimated rate
    private var envBuffer: [Float] = []
    private var envCapacity: Int = 0
    private var envWritePos: Int = 0
    private var envSamplesWritten: Int64 = 0
    private var envSampleRate: Double = 2000

    // High-pass filter (1kHz on raw audio)
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // Envelope lowpass (80Hz)
    private var lpEnvState: Float = 0
    private var lpEnvAlpha: Float = 0.0

    // Decimation
    private var envAccum: Float = 0
    private var envAccumCount: Int = 0
    private var envDecimation: Int = 24

    // FFT (fixed size for one segment)
    private var fftSetup: FFTSetup?
    private var fftLog2N: vDSP_Length = 0
    private var fftN: Int = 0  // samples per segment (~6s at 2kHz = 12288)

    // Accumulated average autocorrelation (Bartlett's method)
    private var accumAutocorr: [Float] = []
    private var segmentCount: Int = 0
    private var warmupDone = false

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0
    private var tickCount: Int = 0

    private let standardBphs = [18000, 21600, 25200, 28800, 36000]

    private var lastAnalysisTime: Double = 0
    private var lastDebugInfo: DebugInfo? = nil
    private var lockedBph: Int? = nil
    private var rateHistory: [Double] = []

    // Track which envelope data we've already processed
    private var lastProcessedEnvPos: Int64 = 0

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        tickCount = 0
        totalSamplesProcessed = 0
        lastAnalysisTime = 0
        hpPrevIn = 0
        hpPrevOut = 0
        lpEnvState = 0
        envAccum = 0
        envAccumCount = 0
        rateHistory = []
        lockedBph = nil
        segmentCount = 0
        warmupDone = false
        lastProcessedEnvPos = 0
        accumAutocorr = []

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

            // Lowpass 80Hz envelope
            let lpRc = 1.0 / (2.0 * Float.pi * Float(80))
            lpEnvAlpha = dt / (lpRc + dt)

            // Decimate to ~2kHz
            envDecimation = max(1, Int(actualSampleRate / 2000))
            envSampleRate = actualSampleRate / Double(envDecimation)

            // Large ring buffer: 120 seconds of envelope
            // This allows accumulating many segments over a long recording
            envCapacity = Int(envSampleRate * 120)
            envBuffer = [Float](repeating: 0, count: envCapacity)
            envWritePos = 0
            envSamplesWritten = 0

            // FFT segment size: ~6 seconds at envelope rate
            let desiredN = Int(envSampleRate * 6)
            fftLog2N = vDSP_Length(ceil(log2(Double(desiredN))))
            fftN = 1 << Int(fftLog2N)
            fftSetup = vDSP_create_fftsetup(fftLog2N, FFTRadix(kFFTRadix2))

            accumAutocorr = [Float](repeating: 0, count: fftN)

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
        if let s = fftSetup { vDSP_destroy_fftsetup(s); fftSetup = nil }
        try? AVAudioSession.sharedInstance().setActive(false)
        return Result(rate: currentRate, beatError: currentBeatError, tickCount: tickCount, ticks: [])
    }

    // MARK: - Audio processing

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        // Pipeline: HP 1kHz → rectify → LP 80Hz → decimate
        for i in 0..<frameCount {
            let x = channelData[i]
            let hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp

            lpEnvState += lpEnvAlpha * (abs(hp) - lpEnvState)

            envAccum += lpEnvState
            envAccumCount += 1
            if envAccumCount >= envDecimation {
                envBuffer[envWritePos] = envAccum / Float(envAccumCount)
                envWritePos = (envWritePos + 1) % envCapacity
                envSamplesWritten += 1
                envAccum = 0
                envAccumCount = 0
            }
        }
        totalSamplesProcessed += Int64(frameCount)

        // Skip first 8 seconds (warm-up: let filters settle)
        if !warmupDone {
            if envSamplesWritten > Int64(envSampleRate * 8) {
                warmupDone = true
                lastProcessedEnvPos = envSamplesWritten
            }
            // Still send updates (with no data) so UI is responsive
            let update = Update(
                rate: nil, beatError: nil, tickCount: 0,
                confidence: 0, noiseLevel: currentNoiseLevel,
                detectedIntervalMs: 0, detectedBph: nil, debug: nil)
            DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
            return
        }

        // Check if we have a new complete segment to process
        let newSamples = envSamplesWritten - lastProcessedEnvPos
        let now = CACurrentMediaTime() * 1000
        if newSamples >= Int64(fftN) && now - lastAnalysisTime > 2000 {
            lastAnalysisTime = now
            processNewSegments()
        }

        let update = Update(
            rate: currentRate, beatError: currentBeatError, tickCount: tickCount,
            confidence: currentConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval, detectedBph: detectedBph,
            debug: lastDebugInfo)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Process new segments and update accumulated autocorrelation

    private func processNewSegments() {
        guard let setup = fftSetup else { return }
        let N = fftN
        let halfN = N / 2

        // How many new complete segments since last processing?
        let newSamples = envSamplesWritten - lastProcessedEnvPos
        let newSegments = Int(newSamples) / N
        guard newSegments > 0 else { return }

        // Process each new segment
        for seg in 0..<newSegments {
            let segStart = lastProcessedEnvPos + Int64(seg * N)
            var signal = [Float](repeating: 0, count: N)

            // Extract segment from ring buffer
            let ringStart = Int(segStart % Int64(envCapacity))
            for i in 0..<N {
                signal[i] = envBuffer[(ringStart + i) % envCapacity]
            }

            // Remove DC
            var mean: Float = 0
            vDSP_meanv(signal, 1, &mean, vDSP_Length(N))
            var negMean = -mean
            vDSP_vsadd(signal, 1, &negMean, &signal, 1, vDSP_Length(N))

            // Autocorrelation via FFT
            var realp = [Float](repeating: 0, count: halfN)
            var imagp = [Float](repeating: 0, count: halfN)

            signal.withUnsafeBufferPointer { sigBuf in
                realp.withUnsafeMutableBufferPointer { rBuf in
                    imagp.withUnsafeMutableBufferPointer { iBuf in
                        var split = DSPSplitComplex(realp: rBuf.baseAddress!, imagp: iBuf.baseAddress!)
                        sigBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { ptr in
                            vDSP_ctoz(ptr, 2, &split, 1, vDSP_Length(halfN))
                        }
                    }
                }
            }

            var segAutocorr = [Float](repeating: 0, count: N)

            realp.withUnsafeMutableBufferPointer { rBuf in
                imagp.withUnsafeMutableBufferPointer { iBuf in
                    var split = DSPSplitComplex(realp: rBuf.baseAddress!, imagp: iBuf.baseAddress!)
                    vDSP_fft_zrip(setup, &split, 1, fftLog2N, FFTDirection(FFT_FORWARD))
                    vDSP_zvmags(&split, 1, rBuf.baseAddress!, 1, vDSP_Length(halfN))
                    memset(iBuf.baseAddress!, 0, halfN * MemoryLayout<Float>.size)
                    vDSP_fft_zrip(setup, &split, 1, fftLog2N, FFTDirection(FFT_INVERSE))
                    segAutocorr.withUnsafeMutableBufferPointer { outBuf in
                        outBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { ptr in
                            vDSP_ztoc(&split, 1, ptr, 2, vDSP_Length(halfN))
                        }
                    }
                }
            }

            // Normalize segment autocorrelation
            let zp = segAutocorr[0]
            if zp > 0 {
                var s = 1.0 / zp
                vDSP_vsmul(segAutocorr, 1, &s, &segAutocorr, 1, vDSP_Length(N))
            }

            // Add to accumulated average
            vDSP_vadd(accumAutocorr, 1, segAutocorr, 1, &accumAutocorr, 1, vDSP_Length(N))
            segmentCount += 1
        }

        lastProcessedEnvPos += Int64(newSegments * N)

        // Now analyze the averaged autocorrelation
        analyzeAccumulated()
    }

    // MARK: - Analyze the accumulated (averaged) autocorrelation

    private func analyzeAccumulated() {
        let N = fftN
        guard segmentCount > 0 else { return }

        // Compute average: divide accumulated by segment count
        var avg = accumAutocorr
        var divisor = Float(segmentCount)
        vDSP_vsdiv(avg, 1, &divisor, &avg, 1, vDSP_Length(N))

        // Search for best BPH
        var bestScore: Float = 0
        var bestBphCandidate = 28800
        var bestLag = 0
        var bphCorrelations: [(bph: Int, correlation: Float, lag: Int)] = []

        for candidateBph in standardBphs {
            let intervalSec = 3600.0 / Double(candidateBph)
            let centerLag = Int(round(intervalSec * envSampleRate))
            let searchRange = max(3, Int(round(Double(centerLag) * 0.10)))
            let minLag = max(1, centerLag - searchRange)
            let maxLag = min(N / 3, centerLag + searchRange)
            guard maxLag > minLag else { continue }

            var localBest: Float = 0
            var localBestLag = centerLag
            for lag in minLag...maxLag {
                if avg[lag] > localBest {
                    localBest = avg[lag]
                    localBestLag = lag
                }
            }

            // Harmonic scoring: peaks at 2x and 3x reinforce
            var score = localBest
            for mult in [2, 3] {
                let mLag = localBestLag * mult
                if mLag < N / 3 {
                    let hr = max(2, Int(round(Double(localBestLag) * 0.05)))
                    var hPeak: Float = 0
                    for lag in max(1, mLag - hr)...min(N / 3, mLag + hr) {
                        if avg[lag] > hPeak { hPeak = avg[lag] }
                    }
                    score += hPeak * (mult == 2 ? 0.5 : 0.3)
                }
            }

            bphCorrelations.append((bph: candidateBph, correlation: localBest, lag: localBestLag))
            if score > bestScore {
                bestScore = score
                bestBphCandidate = candidateBph
                bestLag = localBestLag
            }
        }

        let rawCorr = bphCorrelations.first(where: { $0.bph == bestBphCandidate })?.correlation ?? 0

        guard rawCorr > 0.005, bestLag > 0 else {
            currentConfidence = 0
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: fftN, bufferSamples: Int(envSamplesWritten),
                hpCutoff: 1000, bestLag: 0, bestCorrelation: 0, refinedLag: 0,
                allBphCorrelations: bphCorrelations)
            return
        }

        // BPH locking
        let useBph: Int
        if let locked = lockedBph {
            let lockedCorr = bphCorrelations.first(where: { $0.bph == locked })?.correlation ?? 0
            if rawCorr > lockedCorr * 1.5 && segmentCount > 3 {
                lockedBph = bestBphCandidate
                useBph = bestBphCandidate
                rateHistory = []
            } else {
                useBph = locked
                if bestBphCandidate != locked, let entry = bphCorrelations.first(where: { $0.bph == locked }) {
                    bestLag = entry.lag
                }
            }
        } else {
            lockedBph = bestBphCandidate
            useBph = bestBphCandidate
        }

        // Parabolic interpolation
        var refinedLag = Double(bestLag)
        if bestLag > 1 && bestLag < N - 1 {
            let ym1 = avg[bestLag - 1]
            let y0 = avg[bestLag]
            let yp1 = avg[bestLag + 1]
            let denom = ym1 - 2 * y0 + yp1
            if abs(denom) > 1e-10 {
                refinedLag = Double(bestLag) + 0.5 * Double(ym1 - yp1) / Double(denom)
            }
        }

        let detectedIntervalMs = refinedLag / envSampleRate * 1000.0
        let expectedInterval = 3600000.0 / Double(useBph)
        let rate = ((detectedIntervalMs - expectedInterval) / expectedInterval) * 86400.0

        currentDetectedInterval = detectedIntervalMs
        detectedBph = useBph

        // Rate with outlier rejection (more aggressive as segments grow)
        rateHistory.append(rate)
        if rateHistory.count > 30 { rateHistory.removeFirst() }

        if rateHistory.count >= 7 {
            let sorted = rateHistory.sorted()
            let trimCount = max(1, sorted.count / 4)  // trim 25% each side
            let trimmed = Array(sorted[trimCount..<(sorted.count - trimCount)])
            currentRate = ((trimmed.reduce(0.0, +) / Double(trimmed.count)) * 10).rounded() / 10
        } else if rateHistory.count >= 3 {
            let sorted = rateHistory.sorted()
            currentRate = (sorted[sorted.count / 2] * 10).rounded() / 10
        } else {
            currentRate = (rate * 10).rounded() / 10
        }

        // Confidence: SNR × segment count factor
        let noiseStart = N / 6
        let noiseEnd = N / 4
        var snrConf: Double = 0
        if noiseEnd > noiseStart {
            var noiseVals: [Float] = []
            for i in noiseStart..<noiseEnd { noiseVals.append(abs(avg[i])) }
            noiseVals.sort()
            let floor = noiseVals.count > 0 ? noiseVals[noiseVals.count / 2] : Float(0)
            let snr = (rawCorr - floor) / max(floor, 0.001)
            snrConf = min(1.0, Double(snr) / 8.0)
        }
        let segFactor = min(1.0, Double(segmentCount) / 10.0)
        currentConfidence = snrConf * (0.3 + 0.7 * segFactor)
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Monotonic tick count
        tickCount = Int(Double(totalSamplesProcessed) / actualSampleRate * Double(useBph) / 3600.0)

        // Beat error
        let halfLag = bestLag / 2
        if halfLag > 2 && halfLag < N / 3 {
            let sH = max(2, Int(round(Double(halfLag) * 0.05)))
            var hPeak: Float = 0
            var hPeakLag = halfLag
            for lag in max(1, halfLag - sH)...min(N / 3, halfLag + sH) {
                if avg[lag] > hPeak { hPeak = avg[lag]; hPeakLag = lag }
            }
            if hPeak > rawCorr * 0.2 {
                let asymmetry = abs(Double(hPeakLag) - Double(bestLag) / 2.0) / (Double(bestLag) / 2.0)
                currentBeatError = (asymmetry * detectedIntervalMs * 100).rounded() / 100
            } else {
                currentBeatError = 0
            }
        } else {
            currentBeatError = 0
        }

        lastDebugInfo = DebugInfo(
            sampleRate: envSampleRate, fftSize: fftN, bufferSamples: Int(envSamplesWritten),
            hpCutoff: 1000, bestLag: bestLag, bestCorrelation: Double(rawCorr),
            refinedLag: refinedLag, allBphCorrelations: bphCorrelations)
    }
}
