import AVFoundation
import Accelerate

/// Captures microphone audio via AVAudioEngine and detects mechanical watch tick sounds.
/// Results are reported through the `onUpdate` callback.
class TimegrapherEngine {

    struct Update {
        let rate: Double?          // seconds/day deviation
        let beatError: Double?     // milliseconds
        let tickCount: Int
        let confidence: Double     // 0–1
        let noiseLevel: Double     // 0–1
        let detectedIntervalMs: Double
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
    private var startTime: Double = 0
    private var tickTimestamps: [Double] = []
    private var envelope: [Float] = []
    private var envCapacity: Int = 0
    private var envWrite: Int = 0
    private var envCount: Int = 0
    private var windowDurationMs: Double = 0

    // Analysis state
    private var lastAnalysisTime: Double = 0
    private let analysisIntervalMs: Double = 1000
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0

    private let sampleRate: Double = 44100
    private let windowSamples: Int = 64

    func start(bph: Int, sensitivity: Int) {
        guard !isRunning else { return }
        self.bph = bph
        self.sensitivity = sensitivity

        tickTimestamps = []
        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        lastAnalysisTime = 0

        // Calculate envelope buffer capacity (~10 seconds of data)
        windowDurationMs = Double(windowSamples) / sampleRate * 1000
        envCapacity = Int(ceil(10000 / windowDurationMs))
        envelope = [Float](repeating: 0, count: envCapacity)
        envWrite = 0
        envCount = 0

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.measurement, mode: .default, options: [])
            try session.setPreferredSampleRate(sampleRate)
            try session.setActive(true)

            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }

            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            let bufferSize: AVAudioFrameCount = 2048

            startTime = CACurrentMediaTime() * 1000

            inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: format) { [weak self] buffer, time in
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

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)
        let now = CACurrentMediaTime() * 1000

        // Calculate noise level (RMS)
        var rms: Float = 0
        var maxAmp: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        vDSP_maxmgv(channelData, 1, &maxAmp, vDSP_Length(frameCount))

        let noiseLevel = min(1.0, Double(maxAmp) * 2)

        // Build envelope: energy per window
        var offset = 0
        while offset + windowSamples <= frameCount {
            var energy: Float = 0
            vDSP_svesq(channelData.advanced(by: offset), 1, &energy, vDSP_Length(windowSamples))
            energy /= Float(windowSamples)

            envelope[envWrite % envCapacity] = energy
            envWrite += 1
            envCount = min(envCount + 1, envCapacity)
            offset += windowSamples
        }

        // Run autocorrelation analysis periodically
        if now - lastAnalysisTime > analysisIntervalMs && envCount > envCapacity * 3 / 10 {
            lastAnalysisTime = now
            runAutocorrelation()
        }

        // Generate synthetic tick timestamps from detected interval
        let expectedInterval = 3600000.0 / Double(bph)
        if let _ = currentRate, currentConfidence > 0.1, currentDetectedInterval > 0 {
            let elapsed = now - startTime
            let expectedTicks = Int(elapsed / currentDetectedInterval)
            while tickTimestamps.count < expectedTicks && tickTimestamps.count < 10000 {
                let nextTick = Double(tickTimestamps.count + 1) * currentDetectedInterval
                tickTimestamps.append(nextTick)
            }
        }

        // Report update
        let update = Update(
            rate: currentRate,
            beatError: currentBeatError,
            tickCount: tickTimestamps.count,
            confidence: currentConfidence,
            noiseLevel: noiseLevel,
            detectedIntervalMs: currentDetectedInterval
        )

        DispatchQueue.main.async { [weak self] in
            self?.onUpdate?(update)
        }
    }

    private func runAutocorrelation() {
        let expectedInterval = 3600000.0 / Double(bph)
        let minLag = max(2, Int(round((expectedInterval * 0.7) / windowDurationMs)))
        let maxLag = Int(round((expectedInterval * 1.3) / windowDurationMs))

        let N = envCount
        guard N > 0, maxLag < N / 2 else { return }

        // Compute mean
        var mean: Float = 0
        vDSP_meanv(envelope, 1, &mean, vDSP_Length(N))

        // Compute variance
        var variance: Float = 0
        var temp = [Float](repeating: 0, count: N)
        var negMean = -mean
        vDSP_vsadd(envelope, 1, &negMean, &temp, 1, vDSP_Length(N))
        vDSP_svesq(temp, 1, &variance, vDSP_Length(N))
        variance /= Float(N)

        guard variance > 0 else { return }

        var bestLag = 0
        var bestCorr: Float = -1

        for lag in minLag...min(maxLag, N / 2 - 1) {
            var corr: Float = 0
            let pairs = N - lag
            for i in 0..<pairs {
                corr += (envelope[i] - mean) * (envelope[(i + lag) % envCapacity] - mean)
            }
            corr = corr / (Float(pairs) * variance)
            if corr > bestCorr {
                bestCorr = corr
                bestLag = lag
            }
        }

        currentDetectedInterval = Double(bestLag) * windowDurationMs
        currentConfidence = Double(max(0, bestCorr))
        currentRate = ((currentDetectedInterval - expectedInterval) / expectedInterval) * 86400
        currentRate = (currentRate! * 10).rounded() / 10

        // Beat error estimation
        let doubleLag = bestLag * 2
        if doubleLag < N / 2 {
            var corrDouble: Float = 0
            let pairsD = N - doubleLag
            for i in 0..<pairsD {
                corrDouble += (envelope[i] - mean) * (envelope[(i + doubleLag) % envCapacity] - mean)
            }
            corrDouble = corrDouble / (Float(pairsD) * variance)

            if corrDouble > bestCorr {
                let halfLag = bestLag / 2
                if halfLag >= minLag {
                    currentBeatError = abs(currentDetectedInterval - Double(halfLag) * windowDurationMs * 2)
                    currentBeatError = (currentBeatError! * 100).rounded() / 100
                }
            } else {
                currentBeatError = 0
            }
        }
    }
}
