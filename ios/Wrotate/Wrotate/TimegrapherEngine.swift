import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds
/// using FFT-based autocorrelation on an energy envelope for sample-level precision.
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

    private var actualSampleRate: Double = 44100
    private var totalSamplesProcessed: Int64 = 0

    // Ring buffer for raw audio (~8 seconds for reliable averaging)
    private var ringBuffer: [Float] = []
    private var ringCapacity: Int = 0
    private var ringWritePos: Int = 0
    private var ringSamplesWritten: Int64 = 0

    // High-pass filter state (1st order IIR)
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.97

    // FFT setup
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

    private let standardBphs = [18000, 21600, 25200, 28800, 36000]

    private var lastAnalysisTime: Double = 0
    private var lastDebugInfo: DebugInfo? = nil

    // Smoothed rate for stability
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
        totalSamplesProcessed = 0
        lastAnalysisTime = 0
        hpPrevIn = 0
        hpPrevOut = 0
        rateHistory = []

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

            // High-pass filter coefficient: cutoff ~200Hz (lowered from 800Hz)
            // Watch ticks have significant energy in 200-4000Hz range
            let cutoffHz: Float = 200
            let dt = 1.0 / Float(actualSampleRate)
            let rc = 1.0 / (2.0 * Float.pi * cutoffHz)
            hpAlpha = rc / (rc + dt)

            // Ring buffer: 12 seconds of audio (must exceed FFT size)
            ringCapacity = Int(actualSampleRate * 12)
            ringBuffer = [Float](repeating: 0, count: ringCapacity)
            ringWritePos = 0
            ringSamplesWritten = 0

            // FFT: use power-of-2 size that fits ~4 seconds
            // At 48kHz: 4s = 192000 → next power of 2 = 262144 (~5.5s)
            let desiredN = Int(actualSampleRate * 4)
            fftLog2N = vDSP_Length(ceil(log2(Double(desiredN))))
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

        // High-pass filter and write to ring buffer
        for i in 0..<frameCount {
            let x = channelData[i]
            let y = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            hpPrevOut = y
            ringBuffer[ringWritePos] = y
            ringWritePos = (ringWritePos + 1) % ringCapacity
        }
        ringSamplesWritten += Int64(frameCount)
        totalSamplesProcessed += Int64(frameCount)

        // Run analysis every ~1s, after at least 4 seconds of data
        let now = CACurrentMediaTime() * 1000
        if now - lastAnalysisTime > 1000 && ringSamplesWritten > Int64(actualSampleRate * 4) {
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

    // MARK: - FFT-based autocorrelation on energy envelope

    private func runAnalysis() {
        guard let setup = fftSetup else {
            lastDebugInfo = DebugInfo(
                sampleRate: actualSampleRate, fftSize: -1, bufferSamples: 0,
                hpCutoff: 200, bestLag: -1, bestCorrelation: -1, refinedLag: 0,
                allBphCorrelations: []
            )
            return
        }
        let N = fftN
        let availableSamples = min(Int(ringSamplesWritten), ringCapacity)
        guard availableSamples >= N else {
            lastDebugInfo = DebugInfo(
                sampleRate: actualSampleRate, fftSize: N, bufferSamples: availableSamples,
                hpCutoff: 200, bestLag: -2, bestCorrelation: -2, refinedLag: 0,
                allBphCorrelations: []
            )
            return
        }

        // Extract the most recent N samples from ring buffer
        var signal = [Float](repeating: 0, count: N)
        let startPos = (ringWritePos - N + ringCapacity) % ringCapacity
        for i in 0..<N {
            signal[i] = ringBuffer[(startPos + i) % ringCapacity]
        }

        // Square the signal to create energy envelope
        // Squaring emphasizes loud transients (ticks) over quiet noise quadratically
        vDSP_vsq(signal, 1, &signal, 1, vDSP_Length(N))

        // Remove DC component (mean of squared signal)
        var mean: Float = 0
        vDSP_meanv(signal, 1, &mean, vDSP_Length(N))
        var negMean = -mean
        vDSP_vsadd(signal, 1, &negMean, &signal, 1, vDSP_Length(N))

        // Compute autocorrelation via FFT: autocorr = IFFT(|FFT(signal)|²)
        let halfN = N / 2
        var realp = [Float](repeating: 0, count: halfN)
        var imagp = [Float](repeating: 0, count: halfN)

        // Pack signal into split complex format
        signal.withUnsafeBufferPointer { sigBuf in
            realp.withUnsafeMutableBufferPointer { rBuf in
                imagp.withUnsafeMutableBufferPointer { iBuf in
                    var splitComplex = DSPSplitComplex(
                        realp: rBuf.baseAddress!,
                        imagp: iBuf.baseAddress!
                    )
                    sigBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                        vDSP_ctoz(complexPtr, 2, &splitComplex, 1, vDSP_Length(halfN))
                    }
                }
            }
        }

        // Forward FFT → power spectrum → inverse FFT
        var autocorr = [Float](repeating: 0, count: N)

        realp.withUnsafeMutableBufferPointer { rBuf in
            imagp.withUnsafeMutableBufferPointer { iBuf in
                var splitComplex = DSPSplitComplex(
                    realp: rBuf.baseAddress!,
                    imagp: iBuf.baseAddress!
                )
                vDSP_fft_zrip(setup, &splitComplex, 1, fftLog2N, FFTDirection(FFT_FORWARD))

                // Power spectrum: |FFT|²
                vDSP_zvmags(&splitComplex, 1, rBuf.baseAddress!, 1, vDSP_Length(halfN))
                memset(iBuf.baseAddress!, 0, halfN * MemoryLayout<Float>.size)

                // Inverse FFT → autocorrelation
                vDSP_fft_zrip(setup, &splitComplex, 1, fftLog2N, FFTDirection(FFT_INVERSE))

                // Unpack
                autocorr.withUnsafeMutableBufferPointer { outBuf in
                    outBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                        vDSP_ztoc(&splitComplex, 1, complexPtr, 2, vDSP_Length(halfN))
                    }
                }
            }
        }

        // Normalize by autocorr[0]
        let zeroPeak = autocorr[0]
        guard zeroPeak > 0 else {
            lastDebugInfo = DebugInfo(
                sampleRate: actualSampleRate, fftSize: N, bufferSamples: availableSamples,
                hpCutoff: 200, bestLag: -3, bestCorrelation: Double(zeroPeak), refinedLag: 0,
                allBphCorrelations: []
            )
            return
        }
        var scale = 1.0 / zeroPeak
        vDSP_vsmul(autocorr, 1, &scale, &autocorr, 1, vDSP_Length(N))

        // Search for best BPH match
        var bestCorrelation: Float = 0
        var bestBphCandidate = 28800
        var bestLag = 0
        var bphCorrelations: [(bph: Int, correlation: Float, lag: Int)] = []

        for candidateBph in standardBphs {
            let expectedIntervalSec = 3600.0 / Double(candidateBph)
            let centerLag = Int(round(expectedIntervalSec * actualSampleRate))

            // Search ±10% around expected lag
            let searchRange = max(10, Int(round(Double(centerLag) * 0.10)))
            let minLag = max(1, centerLag - searchRange)
            let maxLag = min(N / 3, centerLag + searchRange)

            guard maxLag > minLag, maxLag < N else { continue }

            var localBest: Float = 0
            var localBestLag = centerLag
            for lag in minLag...maxLag {
                let corr = autocorr[lag]
                if corr > localBest {
                    localBest = corr
                    localBestLag = lag
                }
            }

            // Harmonic verification: check if there's also a peak at 2x the lag
            let doubleLag = localBestLag * 2
            var harmonicBoost: Float = 1.0
            if doubleLag < N / 3 {
                let searchH = max(3, Int(round(Double(localBestLag) * 0.05)))
                let minH = max(1, doubleLag - searchH)
                let maxH = min(N / 3, doubleLag + searchH)
                var harmonicPeak: Float = 0
                for lag in minH...maxH {
                    if autocorr[lag] > harmonicPeak {
                        harmonicPeak = autocorr[lag]
                    }
                }
                if harmonicPeak > localBest * 0.3 {
                    harmonicBoost = 1.0 + harmonicPeak / localBest * 0.5
                }
            }

            let effectiveCorr = localBest * harmonicBoost
            bphCorrelations.append((bph: candidateBph, correlation: localBest, lag: localBestLag))

            if effectiveCorr > bestCorrelation {
                bestCorrelation = effectiveCorr
                bestBphCandidate = candidateBph
                bestLag = localBestLag
            }
        }

        let rawBestCorr = bphCorrelations.first(where: { $0.bph == bestBphCandidate })?.correlation ?? 0

        guard rawBestCorr > 0.01, bestLag > 0 else {
            currentConfidence = 0
            lastDebugInfo = DebugInfo(
                sampleRate: actualSampleRate, fftSize: N, bufferSamples: availableSamples,
                hpCutoff: 200, bestLag: 0, bestCorrelation: 0, refinedLag: 0,
                allBphCorrelations: bphCorrelations
            )
            return
        }

        // Parabolic interpolation for sub-sample accuracy
        var refinedLag = Double(bestLag)
        if bestLag > 1 && bestLag < N - 1 {
            let ym1 = autocorr[bestLag - 1]
            let y0 = autocorr[bestLag]
            let yp1 = autocorr[bestLag + 1]
            let denom = ym1 - 2 * y0 + yp1
            if abs(denom) > 1e-10 {
                let delta = 0.5 * Double(ym1 - yp1) / Double(denom)
                refinedLag = Double(bestLag) + delta
            }
        }

        let detectedIntervalMs = refinedLag / actualSampleRate * 1000.0
        let expectedInterval = 3600000.0 / Double(bestBphCandidate)
        let rate = ((detectedIntervalMs - expectedInterval) / expectedInterval) * 86400.0

        currentDetectedInterval = detectedIntervalMs
        detectedBph = bestBphCandidate

        // Smooth rate with median filter for stability
        rateHistory.append(rate)
        if rateHistory.count > 10 { rateHistory.removeFirst() }

        if rateHistory.count >= 3 {
            let sorted = rateHistory.sorted()
            let median = sorted[sorted.count / 2]
            currentRate = (median * 10).rounded() / 10
        } else {
            currentRate = (rate * 10).rounded() / 10
        }

        // Confidence: SNR relative to noise floor in autocorrelation
        let noiseStart = N / 6
        let noiseEnd = N / 4
        var noiseValues: [Float] = []
        if noiseEnd > noiseStart && noiseEnd < N {
            for i in noiseStart..<noiseEnd {
                noiseValues.append(abs(autocorr[i]))
            }
            noiseValues.sort()
            let noiseFloor = noiseValues.count > 0 ? noiseValues[noiseValues.count / 2] : Float(0)
            let snr = (rawBestCorr - noiseFloor) / max(noiseFloor, 0.001)
            currentConfidence = min(1.0, Double(snr) / 10.0)
        } else {
            currentConfidence = Double(min(1.0, rawBestCorr * 3))
        }
        currentConfidence = (currentConfidence * 100).rounded() / 100

        // Tick count estimate
        let elapsedMs = Double(totalSamplesProcessed) / actualSampleRate * 1000.0
        if detectedIntervalMs > 0 {
            tickCount = Int(elapsedMs / detectedIntervalMs)
        }

        // Beat error: asymmetry between tick and tock
        let halfLag = bestLag / 2
        if halfLag > 2 && halfLag < N / 3 {
            let searchH = max(2, Int(round(Double(halfLag) * 0.05)))
            let minH = max(1, halfLag - searchH)
            let maxH = min(N / 3, halfLag + searchH)
            var halfPeak: Float = 0
            var halfPeakLag = halfLag
            for lag in minH...maxH {
                if autocorr[lag] > halfPeak {
                    halfPeak = autocorr[lag]
                    halfPeakLag = lag
                }
            }

            if halfPeak > rawBestCorr * 0.2 {
                let expectedHalf = Double(bestLag) / 2.0
                let actualHalf = Double(halfPeakLag)
                let asymmetry = abs(actualHalf - expectedHalf) / expectedHalf
                currentBeatError = asymmetry * detectedIntervalMs
                currentBeatError = (currentBeatError! * 100).rounded() / 100
            } else {
                currentBeatError = 0
            }
        } else {
            currentBeatError = 0
        }

        // Store debug info
        lastDebugInfo = DebugInfo(
            sampleRate: actualSampleRate, fftSize: N, bufferSamples: availableSamples,
            hpCutoff: 200, bestLag: bestLag, bestCorrelation: Double(rawBestCorr),
            refinedLag: refinedLag, allBphCorrelations: bphCorrelations
        )
    }
}
