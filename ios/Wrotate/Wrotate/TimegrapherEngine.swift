import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds
/// using FFT-based autocorrelation on high-pass filtered audio for sample-level precision.
class TimegrapherEngine {

    struct Update {
        let rate: Double?          // seconds/day deviation
        let beatError: Double?     // milliseconds
        let tickCount: Int
        let confidence: Double     // 0–1
        let noiseLevel: Double     // 0–1
        let detectedIntervalMs: Double
        let detectedBph: Int?      // auto-detected BPH
        // Debug info
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

    // Ring buffer for raw audio (~6 seconds for good averaging)
    private var ringBuffer: [Float] = []
    private var ringCapacity: Int = 0
    private var ringWritePos: Int = 0
    private var ringSamplesWritten: Int64 = 0

    // High-pass filter state (1st order IIR)
    private var hpPrevIn: Float = 0
    private var hpPrevOut: Float = 0
    private var hpAlpha: Float = 0.95  // ~1kHz cutoff at 44.1kHz

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

            // High-pass filter coefficient: alpha = RC/(RC+dt), cutoff ~1kHz
            let cutoffHz: Float = 800
            let dt = 1.0 / Float(actualSampleRate)
            let rc = 1.0 / (2.0 * Float.pi * cutoffHz)
            hpAlpha = rc / (rc + dt)

            // Ring buffer: 6 seconds of audio
            ringCapacity = Int(actualSampleRate * 6)
            ringBuffer = [Float](repeating: 0, count: ringCapacity)
            ringWritePos = 0
            ringSamplesWritten = 0

            // FFT: use power-of-2 size that fits ~4 seconds
            let desiredN = Int(actualSampleRate * 4)
            fftLog2N = vDSP_Length(ceil(log2(Double(desiredN))))
            fftN = 1 << Int(fftLog2N)
            fftSetup = vDSP_create_fftsetup(fftLog2N, FFTRadix(kFFTRadix2))

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

        // Run analysis every ~800ms, after at least 3 seconds of data
        let now = CACurrentMediaTime() * 1000
        if now - lastAnalysisTime > 800 && ringSamplesWritten > Int64(actualSampleRate * 3) {
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

    // MARK: - FFT-based autocorrelation

    private func runAnalysis() {
        guard let setup = fftSetup else { return }
        let N = fftN
        let availableSamples = min(Int(ringSamplesWritten), ringCapacity)
        guard availableSamples >= N else { return }

        // Extract the most recent N samples from ring buffer into a linear array
        var signal = [Float](repeating: 0, count: N)
        let startPos = (ringWritePos - N + ringCapacity) % ringCapacity
        for i in 0..<N {
            signal[i] = ringBuffer[(startPos + i) % ringCapacity]
        }

        // Rectify the signal (absolute value) to create an envelope
        // This converts the oscillating tick waveform into positive energy pulses
        vDSP_vabs(signal, 1, &signal, 1, vDSP_Length(N))

        // Apply a simple smoothing (moving average over ~0.5ms) to create a cleaner envelope
        let smoothWindow = max(1, Int(actualSampleRate * 0.0005))
        if smoothWindow > 1 {
            var smoothed = [Float](repeating: 0, count: N)
            var windowF = Float(smoothWindow)
            // Use a simple box filter via vDSP_vswsum isn't ideal, just do manual
            var runSum: Float = 0
            for i in 0..<smoothWindow { runSum += signal[i] }
            smoothed[0] = runSum / windowF
            for i in 1..<N {
                if i + smoothWindow - 1 < N {
                    runSum += signal[i + smoothWindow - 1]
                }
                if i > 0 {
                    runSum -= signal[i - 1]
                }
                smoothed[i] = runSum / windowF
            }
            signal = smoothed
        }

        // Remove DC component
        var mean: Float = 0
        vDSP_meanv(signal, 1, &mean, vDSP_Length(N))
        var negMean = -mean
        vDSP_vsadd(signal, 1, &negMean, &signal, 1, vDSP_Length(N))

        // Compute autocorrelation via FFT:
        // autocorr = IFFT(|FFT(signal)|²)

        // Prepare split complex for FFT
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

        // Forward FFT
        realp.withUnsafeMutableBufferPointer { rBuf in
            imagp.withUnsafeMutableBufferPointer { iBuf in
                var splitComplex = DSPSplitComplex(
                    realp: rBuf.baseAddress!,
                    imagp: iBuf.baseAddress!
                )
                vDSP_fft_zrip(setup, &splitComplex, 1, fftLog2N, FFTDirection(FFT_FORWARD))

                // Compute power spectrum: |FFT|² = real² + imag²
                // Store back in real, zero imag
                vDSP_zvmags(&splitComplex, 1, rBuf.baseAddress!, 1, vDSP_Length(halfN))
                // Move magnitude to real part, zero imaginary
                memset(iBuf.baseAddress!, 0, halfN * MemoryLayout<Float>.size)

                // Inverse FFT to get autocorrelation
                vDSP_fft_zrip(setup, &splitComplex, 1, fftLog2N, FFTDirection(FFT_INVERSE))

                // Unpack back to linear array for analysis
                var autocorr = [Float](repeating: 0, count: N)
                autocorr.withUnsafeMutableBufferPointer { outBuf in
                    outBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                        vDSP_ztoc(&splitComplex, 1, complexPtr, 2, vDSP_Length(halfN))
                    }
                }

                // Normalize by autocorr[0] (the energy at zero lag)
                let zeroPeak = autocorr[0]
                guard zeroPeak > 0 else { return }
                var scale = 1.0 / zeroPeak
                vDSP_vsmul(autocorr, 1, &scale, &autocorr, 1, vDSP_Length(N))

                // Search for best BPH match, collecting per-BPH correlations
                var bestCorrelation: Float = 0
                var bestBphCandidate = 28800
                var bestLag = 0
                var bphCorrelations: [(bph: Int, correlation: Float, lag: Int)] = []

                for candidateBph in self.standardBphs {
                    let expectedIntervalSec = 3600.0 / Double(candidateBph)
                    let centerLag = Int(round(expectedIntervalSec * self.actualSampleRate))

                    // Search ±8% around expected
                    let searchRange = max(10, Int(round(Double(centerLag) * 0.08)))
                    let minLag = max(1, centerLag - searchRange)
                    let maxLag = min(N / 4, centerLag + searchRange)

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
                    bphCorrelations.append((bph: candidateBph, correlation: localBest, lag: localBestLag))

                    if localBest > bestCorrelation {
                        bestCorrelation = localBest
                        bestBphCandidate = candidateBph
                        bestLag = localBestLag
                    }
                }

                guard bestCorrelation > 0.02, bestLag > 0 else {
                    self.currentConfidence = 0
                    self.lastDebugInfo = DebugInfo(
                        sampleRate: self.actualSampleRate, fftSize: N, bufferSamples: availableSamples,
                        hpCutoff: 800, bestLag: 0, bestCorrelation: 0, refinedLag: 0,
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

                let detectedIntervalMs = refinedLag / self.actualSampleRate * 1000.0
                let expectedInterval = 3600000.0 / Double(bestBphCandidate)
                let rate = ((detectedIntervalMs - expectedInterval) / expectedInterval) * 86400.0

                self.currentDetectedInterval = detectedIntervalMs
                self.detectedBph = bestBphCandidate
                self.currentRate = (rate * 10).rounded() / 10
                self.currentConfidence = Double(min(1.0, bestCorrelation * 3))
                self.currentConfidence = (self.currentConfidence * 100).rounded() / 100

                // Tick count estimate
                let elapsedMs = Double(self.totalSamplesProcessed) / self.actualSampleRate * 1000.0
                if detectedIntervalMs > 0 {
                    self.tickCount = Int(elapsedMs / detectedIntervalMs)
                }

                // Beat error: compare correlation at lag vs 2*lag
                let doubleLag = bestLag * 2
                if doubleLag < N / 2 {
                    let corrDouble = autocorr[doubleLag]
                    if corrDouble > bestCorrelation {
                        let ratio = Double(corrDouble - bestCorrelation) / Double(corrDouble)
                        self.currentBeatError = ratio * detectedIntervalMs * 0.5
                        self.currentBeatError = (self.currentBeatError! * 100).rounded() / 100
                    } else {
                        self.currentBeatError = 0
                    }
                } else {
                    self.currentBeatError = 0
                }

                // Store debug info
                self.lastDebugInfo = DebugInfo(
                    sampleRate: self.actualSampleRate, fftSize: N, bufferSamples: availableSamples,
                    hpCutoff: 800, bestLag: bestLag, bestCorrelation: Double(bestCorrelation),
                    refinedLag: refinedLag, allBphCorrelations: bphCorrelations
                )
            }
        }
    }
}
