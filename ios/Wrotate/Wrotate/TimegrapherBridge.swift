import WebKit

/// Bridges JS ↔ Native for the timegrapher feature.
/// JS sends:   window.webkit.messageHandlers.timegrapher.postMessage({ action: 'start', bph: 28800, sensitivity: 50 })
/// Native sends: window._tgNativeCallback({ event: 'update', ... })
class TimegrapherBridge {

    private let engine = TimegrapherEngine()
    private let piezo = PiezoEngine()
    private var usingPiezo = false
    private var piezoBph = 0
    private weak var webView: WKWebView?
    private var updateTimer: Timer?

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    func handleMessage(_ body: [String: Any]) {
        guard let action = body["action"] as? String else { return }

        print("[TG BRIDGE] action=\(action) body=\(body)")

        switch action {
        case "ping":
            sendToJS(["event": "pong"])

        case "start":
            let bph = body["bph"] as? Int ?? 28800
            let sensitivity = body["sensitivity"] as? Int ?? 50
            let source = body["source"] as? String ?? "mic"
            usingPiezo = (source == "piezo")
            print("[TG BRIDGE START] source=\(source) bph=\(bph) sensitivity=\(sensitivity)")
            if usingPiezo { startPiezo(bph: bph) } else { startMeasurement(bph: bph, sensitivity: sensitivity) }

        case "stop":
            print("[TG BRIDGE STOP]")
            if usingPiezo { stopPiezo() } else { stopMeasurement() }

        case "sensitivity":
            let value = body["value"] as? Int ?? 50
            engine.setSensitivity(value)

        case "tuning":
            let multLo = body["multLo"] as? Double ?? 8.0
            let multHi = body["multHi"] as? Double ?? 1.5
            let minThresh = body["minThreshold"] as? Double ?? 0.001
            let percentile = body["percentile"] as? Int ?? 50
            let hpCutoff = body["hpCutoff"] as? Int ?? 3000
            let peakRatioThreshold = body["peakRatioThreshold"] as? Double ?? 2.0
            let bufferSeconds = body["bufferSeconds"] as? Double ?? 30.0
            let regSkipPairs = body["regSkipPairs"] as? Int
            let regMinN = body["regMinN"] as? Int
            let wallMinSec = body["wallMinSec"] as? Double
            let stabWindow = body["stabWindow"] as? Double
            let stabThresh = body["stabThresh"] as? Double
            let stabLoseThresh = body["stabLoseThresh"] as? Double
            let maxPairThresh = body["maxPairThresh"] as? Double
            let minPairThresh = body["minPairThresh"] as? Double
            let coldStartThresh = body["coldStartThresh"] as? Double
            let pairMadMult = body["pairMadMult"] as? Double
            let maxTickDevMs = body["maxTickDevMs"] as? Double
            let calibDuration = body["calibDuration"] as? Int
            let outlierMargin = body["outlierMargin"] as? Double
            let outlierMarginLowBph = body["outlierMarginLowBph"] as? Double
            let calibPercentile = body["calibPercentile"] as? Double
            let calibMultiplier = body["calibMultiplier"] as? Double
            let calibMultiplierRecal = body["calibMultiplierRecal"] as? Double
            let maxRecalibrations = body["maxRecalibrations"] as? Int
            let recalTriggerSec = body["recalTriggerSec"] as? Double
            let thresholdDecay = body["thresholdDecay"] as? Double
            let thresholdDecayNoTicks = body["thresholdDecayNoTicks"] as? Double
            let tickDetectMult = body["tickDetectMult"] as? Double
            let minSpacingMult = body["minSpacingMult"] as? Double
            let maxBphCorrections = body["maxBphCorrections"] as? Int
            let noiseFloorMult = body["noiseFloorMult"] as? Double
            let peakDetectGate = body["peakDetectGate"] as? Double
            print("[TG BRIDGE TUNING] peakRatio=\(peakRatioThreshold) bufSec=\(bufferSeconds) regSkip=\(regSkipPairs ?? -1) regMinN=\(regMinN ?? -1) maxPairTh=\(maxPairThresh ?? -1)")
            engine.setTuning(multLo: Float(multLo), multHi: Float(multHi),
                             minThreshold: Float(minThresh),
                             percentile: percentile, hpCutoff: Float(hpCutoff),
                             peakRatioThreshold: Float(peakRatioThreshold),
                             bufferSeconds: Float(bufferSeconds),
                             regSkipPairs: regSkipPairs,
                             regMinN: regMinN,
                             wallMinSec: wallMinSec,
                             stabWindow: stabWindow,
                             stabThresh: stabThresh,
                             stabLoseThresh: stabLoseThresh,
                             maxPairThresh: maxPairThresh,
                             minPairThresh: minPairThresh,
                             coldStartThresh: coldStartThresh,
                             pairMadMult: pairMadMult,
                             maxTickDevMs: maxTickDevMs,
                             calibDuration: calibDuration,
                             outlierMargin: outlierMargin,
                             outlierMarginLowBph: outlierMarginLowBph,
                             calibPercentile: calibPercentile,
                             calibMultiplier: calibMultiplier,
                             calibMultiplierRecal: calibMultiplierRecal,
                             maxRecalibrations: maxRecalibrations,
                             recalTriggerSec: recalTriggerSec,
                             thresholdDecay: thresholdDecay,
                             thresholdDecayNoTicks: thresholdDecayNoTicks,
                             tickDetectMult: tickDetectMult,
                             minSpacingMult: minSpacingMult,
                             maxBphCorrections: maxBphCorrections,
                             noiseFloorMult: noiseFloorMult,
                             peakDetectGate: peakDetectGate)

        case "tuningPiezo":
            piezo.setTuning(
                bpLow: body["bpLow"] as? Double, bpHigh: body["bpHigh"] as? Double,
                envSmoothing: body["envSmoothing"] as? Double, threshMult: body["threshMult"] as? Double,
                threshDecay: body["threshDecay"] as? Double, refractoryFrac: body["refractoryFrac"] as? Double,
                outlierMargin: body["outlierMargin"] as? Double,
                searchWin: body["searchWin"] as? Double, smoothMs: body["smoothMs"] as? Double,
                regSkip: body["regSkip"] as? Int, stabThresh: body["stabThresh"] as? Double,
                stabWindow: body["stabWindow"] as? Double, wallMin: body["wallMin"] as? Double,
                rateWindow: body["rateWindow"] as? Double)

        default:
            print("[TG BRIDGE] unknown action: \(action)")
            break
        }
    }

    private func startMeasurement(bph: Int, sensitivity: Int) {
        // Request mic permission if needed
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if !granted {
                    self.sendToJS(["event": "error", "message": "Microphone permission denied. Go to Settings → WRotate → Microphone to allow."])
                    return
                }

                self.engine.onUpdate = { [weak self] update in
                    var payload: [String: Any] = [
                        "event": "update",
                        "rate": update.rate as Any,
                        "beatError": update.beatError as Any,
                        "tickCount": update.tickCount,
                        "confidence": update.confidence,
                        "noiseLevel": update.noiseLevel,
                        "detectedIntervalMs": update.detectedIntervalMs,
                        "detectedBph": update.detectedBph as Any,
                        "cumulativeOffset": update.cumulativeOffset,
                        "elapsedSec": update.elapsedSec,
                        "method": update.method,
                        "rateStable": update.rateStable
                    ]
                    if !update.newTicks.isEmpty {
                        payload["newTicks"] = update.newTicks.map {
                            ["t": $0.timeSec, "d": $0.deviationMs] as [String: Any]
                        }
                    }
                    if !update.debugMessages.isEmpty {
                        payload["debugMessages"] = update.debugMessages
                    }
                    if let waveform = update.beatWaveform {
                        payload["beatWaveform"] = waveform
                    }
                    if let tickPos = update.tickPositions {
                        payload["tickPositions"] = tickPos
                    }
                    if let dbg = update.debug {
                        let bphCorrs = dbg.allBphCorrelations.map { ["bph": $0.bph, "corr": $0.correlation, "lag": $0.lag] as [String: Any] }
                        payload["debug"] = [
                            "sampleRate": dbg.sampleRate,
                            "fftSize": dbg.fftSize,
                            "bufferSamples": dbg.bufferSamples,
                            "hpCutoff": dbg.hpCutoff,
                            "bestLag": dbg.bestLag,
                            "bestCorrelation": dbg.bestCorrelation,
                            "refinedLag": dbg.refinedLag,
                            "noiseFloor": dbg.noiseFloor,
                            "threshold": dbg.threshold,
                            "peakEnergy": dbg.peakEnergy,
                            "allBphCorrelations": bphCorrs
                        ] as [String: Any]
                    }
                    self?.sendToJS(payload)
                }

                self.engine.start(bph: bph, sensitivity: sensitivity)
                UIApplication.shared.isIdleTimerDisabled = true
                self.sendToJS(["event": "started"])
            }
        }
    }

    private func stopMeasurement() {
        UIApplication.shared.isIdleTimerDisabled = false
        let result = engine.stop()
        sendToJS([
            "event": "stopped",
            "rate": result.rate as Any,
            "beatError": result.beatError as Any,
            "tickCount": result.tickCount
        ])
    }

    private func startPiezo(bph: Int) {
        piezoBph = bph
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if !granted {
                    self.sendToJS(["event": "error", "message": "Microphone permission denied. Go to Settings → WRotate → Microphone to allow."]); return
                }
                self.piezo.onUpdate = { [weak self] u in
                    var p: [String: Any] = [
                        "event": "update", "rate": u.rate as Any, "beatError": u.beatError as Any,
                        "tickCount": u.tickCount, "confidence": u.confidence, "noiseLevel": u.noiseLevel,
                        "detectedIntervalMs": u.detectedIntervalMs, "detectedBph": u.detectedBph as Any,
                        "cumulativeOffset": u.cumulativeOffset, "elapsedSec": u.elapsedSec,
                        "method": u.method, "rateStable": u.rateStable]
                    if !u.newTicks.isEmpty { p["newTicks"] = u.newTicks.map { ["t": $0.timeSec, "d": $0.deviationMs] as [String: Any] } }
                    if !u.debugMessages.isEmpty { p["debugMessages"] = u.debugMessages }
                    self?.sendToJS(p)
                }
                self.piezo.start(bph: bph)
                UIApplication.shared.isIdleTimerDisabled = true
                self.sendToJS(["event": "started"])
            }
        }
    }

    private func stopPiezo() {
        UIApplication.shared.isIdleTimerDisabled = false
        let r = piezo.stop()
        if let cap = piezo.exportRawCapture() {
            sendToJS(["event": "rawCapture", "b64": cap.b64, "rate": cap.rate, "n": cap.n, "bph": piezoBph])
        }
        sendToJS(["event": "stopped", "rate": r.rate as Any, "beatError": r.beatError as Any, "tickCount": r.tickCount])
    }

    private func sendToJS(_ data: [String: Any]) {
        guard let webView = webView else { return }

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: data)
            guard let jsonString = String(data: jsonData, encoding: .utf8) else { return }

            let js = "if(window._tgNativeCallback) window._tgNativeCallback(\(jsonString));"
            DispatchQueue.main.async {
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        } catch {
            print("[TimegrapherBridge] JSON error: \(error)")
        }
    }
}

import AVFoundation
