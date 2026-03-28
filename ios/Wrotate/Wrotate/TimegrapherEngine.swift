import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds.
/// Uses envelope-based autocorrelation that accumulates over time for increasing accuracy.
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

    // Envelope lowpass (80Hz on rectified signal)
    private var lpEnvState: Float = 0
    private var lpEnvAlpha: Float = 0.0

    // Decimation
    private var envAccum: Float = 0
    private var envAccumCount: Int = 0
    private var envDecimation: Int = 24

    // Envelope high-pass (3Hz, removes slow drift before autocorrelation)
    private var envHpPrevIn: Float = 0
    private var envHpPrevOut: Float = 0
    private var envHpAlpha: Float = 0.99

    // FFT
    private var fftSetup: FFTSetup?
    private var fftLog2N: vDSP_Length = 0
    private var fftN: Int = 0

    // === ACCUMULATED AUTOCORRELATION ===
    // This is the key to improving accuracy over time.
    // Each analysis adds to this running average; noise cancels, peaks reinforce.
    private var accumAutocorr: [Float] = []
    private var analysisCount: Int = 0

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

    // Rate history for outlier rejection
    private var rateHistory: [Double] = []
    private var lockedBph: Int? = nil

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
        envHpPrevIn = 0
        envHpPrevOut = 0
        rateHistory = []
        lockedBph = nil
        analysisCount = 0
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

            // High-pass on raw audio: 1kHz
            let dt = 1.0 / Float(actualSampleRate)
            let hpRc = 1.0 / (2.0 * Float.pi * Float(1000))
            hpAlpha = hpRc / (hpRc + dt)

            // Lowpass on rectified signal: 80Hz envelope
            let lpRc = 1.0 / (2.0 * Float.pi * Float(80))
            lpEnvAlpha = dt / (lpRc + dt)

            // Decimation to ~2kHz
            envDecimation = max(1, Int(actualSampleRate / 2000))
            envSampleRate = actualSampleRate / Double(envDecimation)

            // Envelope high-pass at 3Hz (removes slow drift)
            let envDt = 1.0 / Float(envSampleRate)
            let envHpRc = 1.0 / (2.0 * Float.pi * Float(3))
            envHpAlpha = envHpRc / (envHpRc + envDt)

            // Envelope ring buffer: 12 seconds
            envCapacity = Int(envSampleRate * 12)
            envBuffer = [Float](repeating: 0, count: envCapacity)
            envWritePos = 0
            envSamplesWritten = 0

            // FFT: ~6 seconds at envelope rate
            let desiredN = Int(envSampleRate * 6)
            fftLog2N = vDSP_Length(ceil(log2(Double(desiredN))))
            fftN = 1 << Int(fftLog2N)
            fftSetup = vDSP_create_fftsetup(fftLog2N, FFTRadix(kFFTRadix2))

            // Initialize accumulated autocorrelation
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

        // Pipeline: high-pass 1kHz → rectify → lowpass 80Hz → high-pass 3Hz → decimate
        for i in 0..<frameCount {
            let x = channelData[i]

            // High-pass 1kHz
            let hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp

            // Rectify + lowpass 80Hz envelope
            lpEnvState += lpEnvAlpha * (abs(hp) - lpEnvState)

            // Decimate
            envAccum += lpEnvState
            envAccumCount += 1
            if envAccumCount >= envDecimation {
                var envSample = envAccum / Float(envAccumCount)

                // High-pass 3Hz on envelope (remove slow drift/trends)
                let envHp = envHpAlpha * (envHpPrevOut + envSample - envHpPrevIn)
                envHpPrevIn = envSample
                envHpPrevOut = envHp
                envSample = envHp

                envBuffer[envWritePos] = envSample
                envWritePos = (envWritePos + 1) % envCapacity
                envSamplesWritten += 1
                envAccum = 0
                envAccumCount = 0
            }
        }
        totalSamplesProcessed += Int64(frameCount)

        // Analyze every ~2s after 6s of data
        let now = CACurrentMediaTime() * 1000
        if now - lastAnalysisTime > 2000 && envSamplesWritten > Int64(envSampleRate * 6) {
            lastAnalysisTime = now
            runAnalysis()
        }

        let update = Update(
            rate: currentRate, beatError: currentBeatError, tickCount: tickCount,
            confidence: currentConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: currentDetectedInterval, detectedBph: detectedBph,
            debug: lastDebugInfo
        )
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Accumulated autocorrelation analysis

    private func runAnalysis() {
        guard let setup = fftSetup else {
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: -1, bufferSamples: 0,
                hpCutoff: 1000, bestLag: -1, bestCorrelation: -1, refinedLag: 0,
                allBphCorrelations: [])
            return
        }
        let N = fftN
        let available = min(Int(envSamplesWritten), envCapacity)
        guard available >= N else {
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: N, bufferSamples: available,
                hpCutoff: 1000, bestLag: -2, bestCorrelation: -2, refinedLag: 0,
                allBphCorrelations: [])
            return
        }

        // Extract latest N envelope samples
        var signal = [Float](repeating: 0, count: N)
        let startPos = (envWritePos - N + envCapacity) % envCapacity
        for i in 0..<N { signal[i] = envBuffer[(startPos + i) % envCapacity] }

        // Remove DC
        var mean: Float = 0
        vDSP_meanv(signal, 1, &mean, vDSP_Length(N))
        var negMean = -mean
        vDSP_vsadd(signal, 1, &negMean, &signal, 1, vDSP_Length(N))

        // Autocorrelation via FFT
        let halfN = N / 2
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

        var thisAutocorr = [Float](repeating: 0, count: N)

        realp.withUnsafeMutableBufferPointer { rBuf in
            imagp.withUnsafeMutableBufferPointer { iBuf in
                var split = DSPSplitComplex(realp: rBuf.baseAddress!, imagp: iBuf.baseAddress!)
                vDSP_fft_zrip(setup, &split, 1, fftLog2N, FFTDirection(FFT_FORWARD))
                vDSP_zvmags(&split, 1, rBuf.baseAddress!, 1, vDSP_Length(halfN))
                memset(iBuf.baseAddress!, 0, halfN * MemoryLayout<Float>.size)
                vDSP_fft_zrip(setup, &split, 1, fftLog2N, FFTDirection(FFT_INVERSE))
                thisAutocorr.withUnsafeMutableBufferPointer { outBuf in
                    outBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { ptr in
                        vDSP_ztoc(&split, 1, ptr, 2, vDSP_Length(halfN))
                    }
                }
            }
        }

        // Normalize this autocorrelation by its zero-lag value
        let zeroPeak = thisAutocorr[0]
        guard zeroPeak > 0 else {
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: N, bufferSamples: available,
                hpCutoff: 1000, bestLag: -3, bestCorrelation: 0, refinedLag: 0,
                allBphCorrelations: [])
            return
        }
        var normScale = 1.0 / zeroPeak
        vDSP_vsmul(thisAutocorr, 1, &normScale, &thisAutocorr, 1, vDSP_Length(N))

        // === ACCUMULATE ===
        // Exponential moving average: accum = alpha * new + (1-alpha) * accum
        // Alpha decreases as we get more samples, so early readings have less weight
        // and accuracy improves over time
        analysisCount += 1
        let alpha: Float = max(0.05, 1.0 / Float(analysisCount))
        // For first analysis, just use the current one
        if analysisCount == 1 {
            accumAutocorr = thisAutocorr
        } else {
            var oneMinusAlpha = 1.0 - alpha
            var a = alpha
            // accumAutocorr = alpha * thisAutocorr + (1-alpha) * accumAutocorr
            vDSP_vsmul(thisAutocorr, 1, &a, &thisAutocorr, 1, vDSP_Length(N))
            vDSP_vsmul(accumAutocorr, 1, &oneMinusAlpha, &accumAutocorr, 1, vDSP_Length(N))
            vDSP_vadd(thisAutocorr, 1, accumAutocorr, 1, &accumAutocorr, 1, vDSP_Length(N))
        }

        // Re-normalize accumulated autocorrelation so peak at lag 0 = 1
        let accumZero = accumAutocorr[0]
        var useAutocorr = accumAutocorr
        if accumZero > 0 {
            var s = 1.0 / accumZero
            vDSP_vsmul(useAutocorr, 1, &s, &useAutocorr, 1, vDSP_Length(N))
        }

        // Search for best BPH in the accumulated autocorrelation
        var bestCorrelation: Float = 0
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
                if useAutocorr[lag] > localBest {
                    localBest = useAutocorr[lag]
                    localBestLag = lag
                }
            }

            // Harmonic check at 2x and 3x
            var harmonicScore: Float = localBest
            let dblLag = localBestLag * 2
            if dblLag < N / 3 {
                let hr = max(2, Int(round(Double(localBestLag) * 0.05)))
                var hPeak: Float = 0
                for lag in max(1, dblLag - hr)...min(N / 3, dblLag + hr) {
                    if useAutocorr[lag] > hPeak { hPeak = useAutocorr[lag] }
                }
                harmonicScore += hPeak * 0.5
            }
            let trpLag = localBestLag * 3
            if trpLag < N / 3 {
                let hr = max(2, Int(round(Double(localBestLag) * 0.05)))
                var hPeak: Float = 0
                for lag in max(1, trpLag - hr)...min(N / 3, trpLag + hr) {
                    if useAutocorr[lag] > hPeak { hPeak = useAutocorr[lag] }
                }
                harmonicScore += hPeak * 0.3
            }

            bphCorrelations.append((bph: candidateBph, correlation: localBest, lag: localBestLag))

            if harmonicScore > bestCorrelation {
                bestCorrelation = harmonicScore
                bestBphCandidate = candidateBph
                bestLag = localBestLag
            }
        }

        let rawCorr = bphCorrelations.first(where: { $0.bph == bestBphCandidate })?.correlation ?? 0

        guard rawCorr > 0.005, bestLag > 0 else {
            currentConfidence = 0
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: N, bufferSamples: available,
                hpCutoff: 1000, bestLag: 0, bestCorrelation: 0, refinedLag: 0,
                allBphCorrelations: bphCorrelations)
            return
        }

        // Lock BPH once we have enough data
        let useBph: Int
        if let locked = lockedBph {
            if bestBphCandidate == locked || analysisCount < 5 {
                useBph = locked
            } else {
                // Allow BPH change only if new candidate has significantly higher correlation
                let lockedCorr = bphCorrelations.first(where: { $0.bph == locked })?.correlation ?? 0
                if rawCorr > lockedCorr * 1.5 {
                    lockedBph = bestBphCandidate
                    useBph = bestBphCandidate
                    rateHistory = []
                } else {
                    useBph = locked
                    if let entry = bphCorrelations.first(where: { $0.bph == locked }) {
                        bestLag = entry.lag
                    }
                }
            }
        } else {
            lockedBph = bestBphCandidate
            useBph = bestBphCandidate
        }

        // Parabolic interpolation on accumulated autocorrelation
        var refinedLag = Double(bestLag)
        if bestLag > 1 && bestLag < N - 1 {
            let ym1 = useAutocorr[bestLag - 1]
            let y0 = useAutocorr[bestLag]
            let yp1 = useAutocorr[bestLag + 1]
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

        // Rate history with outlier rejection
        // As analysisCount grows, be more aggressive at rejecting outliers
        rateHistory.append(rate)
        if rateHistory.count > 20 { rateHistory.removeFirst() }

        if rateHistory.count >= 5 {
            // Trim outliers: remove top/bottom 20% and average the middle
            let sorted = rateHistory.sorted()
            let trimCount = max(1, sorted.count / 5)
            let trimmed = Array(sorted[trimCount..<(sorted.count - trimCount)])
            let sum = trimmed.reduce(0.0, +)
            currentRate = ((sum / Double(trimmed.count)) * 10).rounded() / 10
        } else if rateHistory.count >= 3 {
            let sorted = rateHistory.sorted()
            currentRate = (sorted[sorted.count / 2] * 10).rounded() / 10
        } else {
            currentRate = (rate * 10).rounded() / 10
        }

        // Confidence improves with analysis count and correlation strength
        let noiseStart = N / 6
        let noiseEnd = N / 4
        var snrConfidence: Double = 0
        if noiseEnd > noiseStart {
            var noiseVals: [Float] = []
            for i in noiseStart..<noiseEnd { noiseVals.append(abs(useAutocorr[i])) }
            noiseVals.sort()
            let floor = noiseVals.count > 0 ? noiseVals[noiseVals.count / 2] : Float(0)
            let snr = (rawCorr - floor) / max(floor, 0.001)
            snrConfidence = min(1.0, Double(snr) / 8.0)
        }
        // Blend in analysis count: more analyses = more confidence
        let countFactor = min(1.0, Double(analysisCount) / 15.0)
        currentConfidence = snrConfidence * (0.5 + 0.5 * countFactor)
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Tick count: monotonically increasing
        let elapsedSec = Double(totalSamplesProcessed) / actualSampleRate
        tickCount = Int(elapsedSec * Double(useBph) / 3600.0)

        // Beat error
        let halfLag = bestLag / 2
        if halfLag > 2 && halfLag < N / 3 {
            let sH = max(2, Int(round(Double(halfLag) * 0.05)))
            var hPeak: Float = 0
            var hPeakLag = halfLag
            for lag in max(1, halfLag - sH)...min(N / 3, halfLag + sH) {
                if useAutocorr[lag] > hPeak { hPeak = useAutocorr[lag]; hPeakLag = lag }
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
            sampleRate: envSampleRate, fftSize: N, bufferSamples: available,
            hpCutoff: 1000, bestLag: bestLag, bestCorrelation: Double(rawCorr),
            refinedLag: refinedLag, allBphCorrelations: bphCorrelations)
    }
}
