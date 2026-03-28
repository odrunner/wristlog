import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds
/// using FFT-based autocorrelation on an envelope signal for sample-level precision.
class TimegrapherEngine {

    struct Update {
        let rate: Double?          // seconds/day deviation
        let beatError: Double?     // milliseconds
        let tickCount: Int
        let confidence: Double     // 0–1
        let noiseLevel: Double     // 0–1
        let detectedIntervalMs: Double
        let detectedBph: Int?      // auto-detected BPH
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
    private var bph: Int = 28800

    private var actualSampleRate: Double = 48000
    private var totalSamplesProcessed: Int64 = 0

    // Ring buffer stores the ENVELOPE (not raw audio)
    // This keeps the ring buffer small and the FFT fast
    private var envBuffer: [Float] = []
    private var envCapacity: Int = 0
    private var envWritePos: Int = 0
    private var envSamplesWritten: Int64 = 0
    private var envSampleRate: Double = 2000  // envelope at 2kHz

    // High-pass filter state (1st order IIR, 1kHz cutoff)
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // Envelope lowpass state (1st order IIR, 80Hz cutoff)
    private var lpEnvState: Float = 0
    private var lpEnvAlpha: Float = 0.0

    // Accumulator for downsampling raw audio → envelope rate
    private var envAccum: Float = 0
    private var envAccumCount: Int = 0
    private var envDecimation: Int = 24  // 48000/2000 = 24

    // FFT setup (for envelope autocorrelation)
    private var fftSetup: FFTSetup?
    private var fftLog2N: vDSP_Length = 0
    private var fftN: Int = 0

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0
    private var tickCount: Int = 0
    private var lastTickCount: Int = 0

    private let standardBphs = [18000, 21600, 25200, 28800, 36000]

    private var lastAnalysisTime: Double = 0
    private var lastDebugInfo: DebugInfo? = nil

    // BPH stability: require consecutive detections before switching
    private var bphVotes: [Int: Int] = [:]  // bph → consecutive count
    private var lockedBph: Int? = nil
    private var rateHistory: [Double] = []

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }
        self.bph = bph

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        tickCount = 0
        lastTickCount = 0
        totalSamplesProcessed = 0
        lastAnalysisTime = 0
        hpPrevIn = 0
        hpPrevOut = 0
        lpEnvState = 0
        envAccum = 0
        envAccumCount = 0
        rateHistory = []
        bphVotes = [:]
        lockedBph = nil

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

            // High-pass filter: 1kHz cutoff
            // Watch ticks are impulsive with energy mostly above 1kHz
            let hpCutoffHz: Float = 1000
            let dt = 1.0 / Float(actualSampleRate)
            let hpRc = 1.0 / (2.0 * Float.pi * hpCutoffHz)
            hpAlpha = hpRc / (hpRc + dt)

            // Envelope lowpass: 80Hz cutoff (applied at raw sample rate)
            // Creates smooth bumps from tick impulses
            let lpCutoffHz: Float = 80
            let lpRc = 1.0 / (2.0 * Float.pi * lpCutoffHz)
            lpEnvAlpha = dt / (lpRc + dt)

            // Decimation factor: downsample envelope to ~2kHz
            // Tick intervals are 100-200ms, so 2kHz (0.5ms resolution) is plenty
            envDecimation = max(1, Int(actualSampleRate / envSampleRate))
            envSampleRate = actualSampleRate / Double(envDecimation)

            // Envelope ring buffer: 10 seconds at envelope rate
            envCapacity = Int(envSampleRate * 10)
            envBuffer = [Float](repeating: 0, count: envCapacity)
            envWritePos = 0
            envSamplesWritten = 0

            // FFT for envelope: power-of-2 that fits ~6 seconds at envelope rate
            let desiredEnvN = Int(envSampleRate * 6)
            fftLog2N = vDSP_Length(ceil(log2(Double(desiredEnvN))))
            fftN = 1 << Int(fftLog2N)
            fftSetup = vDSP_create_fftsetup(fftLog2N, FFTRadix(kFFTRadix2))

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

        if let setup = fftSetup {
            vDSP_destroy_fftsetup(setup)
            fftSetup = nil
        }

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

        // Compute noise level from raw signal
        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        // Process each sample: high-pass → rectify → lowpass envelope → decimate
        for i in 0..<frameCount {
            let x = channelData[i]

            // 1st order high-pass at 1kHz
            let hp = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = hp

            // Full-wave rectify
            let rectified = abs(hp)

            // 1st order lowpass at 80Hz → smooth envelope
            lpEnvState += lpEnvAlpha * (rectified - lpEnvState)

            // Accumulate for decimation
            envAccum += lpEnvState
            envAccumCount += 1

            if envAccumCount >= envDecimation {
                let envSample = envAccum / Float(envAccumCount)
                envBuffer[envWritePos] = envSample
                envWritePos = (envWritePos + 1) % envCapacity
                envSamplesWritten += 1
                envAccum = 0
                envAccumCount = 0
            }
        }
        totalSamplesProcessed += Int64(frameCount)

        // Run analysis every ~1s, after at least 4 seconds of envelope data
        let now = CACurrentMediaTime() * 1000
        if now - lastAnalysisTime > 1000 && envSamplesWritten > Int64(envSampleRate * 4) {
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
            detectedBph: detectedBph,
            debug: lastDebugInfo
        )

        DispatchQueue.main.async { [weak self] in
            self?.onUpdate?(update)
        }
    }

    // MARK: - FFT-based autocorrelation on envelope

    private func runAnalysis() {
        guard let setup = fftSetup else {
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: -1, bufferSamples: 0,
                hpCutoff: 1000, bestLag: -1, bestCorrelation: -1, refinedLag: 0,
                allBphCorrelations: []
            )
            return
        }
        let N = fftN
        let availableSamples = min(Int(envSamplesWritten), envCapacity)
        guard availableSamples >= N else {
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: N, bufferSamples: availableSamples,
                hpCutoff: 1000, bestLag: -2, bestCorrelation: -2, refinedLag: 0,
                allBphCorrelations: []
            )
            return
        }

        // Extract the most recent N envelope samples
        var signal = [Float](repeating: 0, count: N)
        let startPos = (envWritePos - N + envCapacity) % envCapacity
        for i in 0..<N {
            signal[i] = envBuffer[(startPos + i) % envCapacity]
        }

        // Remove DC
        var mean: Float = 0
        vDSP_meanv(signal, 1, &mean, vDSP_Length(N))
        var negMean = -mean
        vDSP_vsadd(signal, 1, &negMean, &signal, 1, vDSP_Length(N))

        // Autocorrelation via FFT: IFFT(|FFT(signal)|²)
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

        var autocorr = [Float](repeating: 0, count: N)

        realp.withUnsafeMutableBufferPointer { rBuf in
            imagp.withUnsafeMutableBufferPointer { iBuf in
                var split = DSPSplitComplex(realp: rBuf.baseAddress!, imagp: iBuf.baseAddress!)

                vDSP_fft_zrip(setup, &split, 1, fftLog2N, FFTDirection(FFT_FORWARD))
                vDSP_zvmags(&split, 1, rBuf.baseAddress!, 1, vDSP_Length(halfN))
                memset(iBuf.baseAddress!, 0, halfN * MemoryLayout<Float>.size)
                vDSP_fft_zrip(setup, &split, 1, fftLog2N, FFTDirection(FFT_INVERSE))

                autocorr.withUnsafeMutableBufferPointer { outBuf in
                    outBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { ptr in
                        vDSP_ztoc(&split, 1, ptr, 2, vDSP_Length(halfN))
                    }
                }
            }
        }

        // Normalize
        let zeroPeak = autocorr[0]
        guard zeroPeak > 0 else {
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: N, bufferSamples: availableSamples,
                hpCutoff: 1000, bestLag: -3, bestCorrelation: Double(zeroPeak), refinedLag: 0,
                allBphCorrelations: []
            )
            return
        }
        var normScale = 1.0 / zeroPeak
        vDSP_vsmul(autocorr, 1, &normScale, &autocorr, 1, vDSP_Length(N))

        // Search for best BPH — use envelope sample rate for lag calculation
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
                if autocorr[lag] > localBest {
                    localBest = autocorr[lag]
                    localBestLag = lag
                }
            }

            // Harmonic check at 2x lag
            let dblLag = localBestLag * 2
            var harmonicBoost: Float = 1.0
            if dblLag < N / 3 {
                let hRange = max(2, Int(round(Double(localBestLag) * 0.05)))
                let hMin = max(1, dblLag - hRange)
                let hMax = min(N / 3, dblLag + hRange)
                var hPeak: Float = 0
                for lag in hMin...hMax {
                    if autocorr[lag] > hPeak { hPeak = autocorr[lag] }
                }
                if hPeak > localBest * 0.3 {
                    harmonicBoost = 1.0 + hPeak / localBest * 0.5
                }
            }

            bphCorrelations.append((bph: candidateBph, correlation: localBest, lag: localBestLag))

            let effective = localBest * harmonicBoost
            if effective > bestCorrelation {
                bestCorrelation = effective
                bestBphCandidate = candidateBph
                bestLag = localBestLag
            }
        }

        let rawCorr = bphCorrelations.first(where: { $0.bph == bestBphCandidate })?.correlation ?? 0

        guard rawCorr > 0.01, bestLag > 0 else {
            currentConfidence = 0
            lastDebugInfo = DebugInfo(
                sampleRate: envSampleRate, fftSize: N, bufferSamples: availableSamples,
                hpCutoff: 1000, bestLag: 0, bestCorrelation: 0, refinedLag: 0,
                allBphCorrelations: bphCorrelations
            )
            return
        }

        // BPH locking: require 3 consecutive same-BPH detections before switching
        for key in bphVotes.keys { bphVotes[key] = 0 }
        bphVotes[bestBphCandidate, default: 0] += 1
        // Actually track across calls — increment winner, reset others
        let useBph: Int
        if let locked = lockedBph {
            if bestBphCandidate == locked {
                useBph = locked
            } else {
                bphVotes[bestBphCandidate, default: 0] += 1
                if bphVotes[bestBphCandidate, default: 0] >= 3 {
                    lockedBph = bestBphCandidate
                    useBph = bestBphCandidate
                    rateHistory = []  // reset rate history on BPH change
                } else {
                    useBph = locked  // keep old BPH
                    // Recalculate bestLag for the locked BPH
                    if let lockedEntry = bphCorrelations.first(where: { $0.bph == locked }) {
                        bestLag = lockedEntry.lag
                    }
                }
            }
        } else {
            lockedBph = bestBphCandidate
            useBph = bestBphCandidate
        }

        // Parabolic interpolation
        var refinedLag = Double(bestLag)
        if bestLag > 1 && bestLag < N - 1 {
            let ym1 = autocorr[bestLag - 1]
            let y0 = autocorr[bestLag]
            let yp1 = autocorr[bestLag + 1]
            let denom = ym1 - 2 * y0 + yp1
            if abs(denom) > 1e-10 {
                refinedLag = Double(bestLag) + 0.5 * Double(ym1 - yp1) / Double(denom)
            }
        }

        // Convert envelope lag to real time
        let detectedIntervalMs = refinedLag / envSampleRate * 1000.0
        let expectedInterval = 3600000.0 / Double(useBph)
        let rate = ((detectedIntervalMs - expectedInterval) / expectedInterval) * 86400.0

        currentDetectedInterval = detectedIntervalMs
        detectedBph = useBph

        // Median-smoothed rate
        rateHistory.append(rate)
        if rateHistory.count > 10 { rateHistory.removeFirst() }
        if rateHistory.count >= 3 {
            let sorted = rateHistory.sorted()
            currentRate = (sorted[sorted.count / 2] * 10).rounded() / 10
        } else {
            currentRate = (rate * 10).rounded() / 10
        }

        // Confidence from SNR
        let noiseStart = N / 6
        let noiseEnd = N / 4
        if noiseEnd > noiseStart {
            var noiseVals: [Float] = []
            for i in noiseStart..<noiseEnd { noiseVals.append(abs(autocorr[i])) }
            noiseVals.sort()
            let floor = noiseVals.count > 0 ? noiseVals[noiseVals.count / 2] : Float(0)
            let snr = (rawCorr - floor) / max(floor, 0.001)
            currentConfidence = min(1.0, Double(snr) / 10.0)
        } else {
            currentConfidence = Double(min(1.0, rawCorr * 3))
        }
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Monotonic tick count: only add new ticks since last analysis
        let elapsedSec = Double(totalSamplesProcessed) / actualSampleRate
        let bphRate = Double(useBph) / 3600.0  // ticks per second
        tickCount = Int(elapsedSec * bphRate)

        // Beat error
        let halfLag = bestLag / 2
        if halfLag > 2 && halfLag < N / 3 {
            let sH = max(2, Int(round(Double(halfLag) * 0.05)))
            let hMin = max(1, halfLag - sH)
            let hMax = min(N / 3, halfLag + sH)
            var hPeak: Float = 0
            var hPeakLag = halfLag
            for lag in hMin...hMax {
                if autocorr[lag] > hPeak { hPeak = autocorr[lag]; hPeakLag = lag }
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
            sampleRate: envSampleRate, fftSize: N, bufferSamples: availableSamples,
            hpCutoff: 1000, bestLag: bestLag, bestCorrelation: Double(rawCorr),
            refinedLag: refinedLag, allBphCorrelations: bphCorrelations
        )
    }
}
