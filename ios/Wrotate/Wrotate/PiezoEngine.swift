import AVFoundation
import Accelerate

/// Piezo (contact-pickup) timegrapher engine. Separate from TimegrapherEngine:
/// trusts the clean, strong, low-frequency impulses a contact piezo produces, via
/// direct time-domain beat detection. Emits the same Update contract as the mic engine.
class PiezoEngine {

    struct TickDot { let timeSec: Double; let deviationMs: Double }

    struct Update {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let confidence: Double
        let noiseLevel: Double
        let detectedIntervalMs: Double
        let detectedBph: Int?
        let cumulativeOffset: Double
        let elapsedSec: Double
        let method: String
        let rateStable: Bool
        let newTicks: [TickDot]
        let debugMessages: [String]
    }

    struct Result { let rate: Double?; let beatError: Double?; let tickCount: Int }

    var onUpdate: ((Update) -> Void)?

    private var audioEngine: AVAudioEngine?
    private var isRunning = false
    private var routeChangeObserver: NSObjectProtocol?
    private var actualSampleRate: Double = 48000

    // BPH
    private var targetBph: Int = 28800
    private var autoBph: Bool = false
    static let bphCandidates = [18000, 21600, 25200, 28800, 36000]

    // Diagnostics
    private var diagBufCount = 0
    private var diagChMaxPeak: [Float] = []
    private var diagChSumRms: [Float] = []
    private var debugMessages: [String] = []
    private var currentNoiseLevel: Double = 0

    private func debugLog(_ m: String) { print(m); debugMessages.append(m) }

    func start(bph: Int, autoPickChannel: Bool = true) {
        guard !isRunning else { return }
        if bph == 0 { autoBph = true; targetBph = 28800 } else { autoBph = false; targetBph = bph }
        diagBufCount = 0; diagChMaxPeak = []; diagChSumRms = []
        debugLog("[PZSTART] bph=\(bph) autoBph=\(autoBph)")

        do {
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            // .default (not .measurement): measurement crushes USB input to near-silence.
            try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothA2DP])
            try session.setPreferredSampleRate(48000)

            if let inputs = session.availableInputs {
                let preferred = inputs.first { $0.portType == .usbAudio }
                    ?? inputs.first { $0.portType == .lineIn }
                    ?? inputs.first { $0.portType == .headsetMic }
                    ?? inputs.first { $0.portType != .builtInMic }
                if let p = preferred {
                    try? session.setPreferredInput(p)
                    debugLog("[PZINPUT] preferred → \(p.portName) [\(p.portType.rawValue)]")
                }
            }
            try session.setActive(true)
            debugLog("[PZINPUT] inputGain=\(String(format: "%.2f", session.inputGain)) settable=\(session.isInputGainSettable)")
            if session.isInputGainSettable { try? session.setInputGain(1.0) }

            if let existing = routeChangeObserver { NotificationCenter.default.removeObserver(existing) }
            routeChangeObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
            ) { [weak self] note in self?.handleRouteChange(note) }

            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }
            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            actualSampleRate = format.sampleRate
            let route = session.currentRoute.inputs.map { "\($0.portName)[\($0.portType.rawValue)]" }.joined(separator: ",")
            debugLog("[PZINPUT] route=\(route) rate=\(String(format: "%.0f", actualSampleRate)) ch=\(format.channelCount)")

            configureDSP(sampleRate: actualSampleRate)

            inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
                self?.processAudioBuffer(buffer)
            }
            try engine.start()
            isRunning = true
        } catch {
            print("[Piezo] Audio setup error: \(error.localizedDescription)")
        }
    }

    func stop() -> Result {
        isRunning = false
        if let obs = routeChangeObserver { NotificationCenter.default.removeObserver(obs); routeChangeObserver = nil }
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return Result(rate: currentRate, beatError: currentBeatError, tickCount: tickCount)
    }

    deinit { if let obs = routeChangeObserver { NotificationCenter.default.removeObserver(obs) } }

    private func handleRouteChange(_ notification: Notification) {
        guard isRunning else { return }
        guard let info = notification.userInfo,
              let raw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        switch reason {
        case .newDeviceAvailable, .oldDeviceUnavailable:
            let bphToRestart = autoBph ? 0 : targetBph
            debugLog("[PZINPUT] route changed (\(raw)) — restarting, bph=\(bphToRestart)")
            _ = stop(); start(bph: bphToRestart)
        default: break
        }
    }

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channels = buffer.floatChannelData else { return }
        let frameCount = Int(buffer.frameLength)
        let channelCount = max(1, Int(buffer.format.channelCount))

        var chRms = [Float](repeating: 0, count: channelCount)
        var chPeak = [Float](repeating: 0, count: channelCount)
        for c in 0..<channelCount {
            vDSP_rmsqv(channels[c], 1, &chRms[c], vDSP_Length(frameCount))
            vDSP_maxmgv(channels[c], 1, &chPeak[c], vDSP_Length(frameCount))
        }
        var chosen = 0
        var best = chPeak[0]
        for c in 1..<channelCount where chPeak[c] > best { best = chPeak[c]; chosen = c }
        let channelData = channels[chosen]
        currentNoiseLevel = min(1.0, Double(chRms[chosen]) * 10)

        // [PZ] diagnostics ~1/s
        if diagChMaxPeak.count != channelCount {
            diagChMaxPeak = [Float](repeating: 0, count: channelCount)
            diagChSumRms = [Float](repeating: 0, count: channelCount); diagBufCount = 0
        }
        for c in 0..<channelCount { if chPeak[c] > diagChMaxPeak[c] { diagChMaxPeak[c] = chPeak[c] }; diagChSumRms[c] += chRms[c] }
        diagBufCount += 1
        if diagBufCount >= 12 {
            let pk = diagChMaxPeak.map { String(format: "%.5f", $0) }.joined(separator: ",")
            let rm = (0..<channelCount).map { String(format: "%.5f", diagChSumRms[$0] / Float(diagBufCount)) }.joined(separator: ",")
            debugLog("[PZDIAG] chosen=ch\(chosen) rawPeak=[\(pk)] rawRms=[\(rm)]")
            diagChMaxPeak = [Float](repeating: 0, count: channelCount)
            diagChSumRms = [Float](repeating: 0, count: channelCount); diagBufCount = 0
        }

        processDSP(channelData, frameCount: frameCount)
        emitUpdate()
    }

    // Placeholders satisfied in later tasks (declared here so the file compiles):
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var tickCount: Int = 0
    private func configureDSP(sampleRate: Double) {}
    private func processDSP(_ data: UnsafeMutablePointer<Float>, frameCount: Int) {}
    private func emitUpdate() {}
}
