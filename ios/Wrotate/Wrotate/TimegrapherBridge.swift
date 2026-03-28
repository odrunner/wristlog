import WebKit

/// Bridges JS ↔ Native for the timegrapher feature.
/// JS sends:   window.webkit.messageHandlers.timegrapher.postMessage({ action: 'start', bph: 28800, sensitivity: 50 })
/// Native sends: window._tgNativeCallback({ event: 'update', ... })
class TimegrapherBridge {

    private let engine = TimegrapherEngine()
    private weak var webView: WKWebView?
    private var updateTimer: Timer?

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    func handleMessage(_ body: [String: Any]) {
        guard let action = body["action"] as? String else { return }

        switch action {
        case "ping":
            sendToJS(["event": "pong"])

        case "start":
            let bph = body["bph"] as? Int ?? 28800
            let sensitivity = body["sensitivity"] as? Int ?? 50
            startMeasurement(bph: bph, sensitivity: sensitivity)

        case "stop":
            stopMeasurement()

        default:
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
                        "detectedBph": update.detectedBph as Any
                    ]
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
                            "allBphCorrelations": bphCorrs
                        ] as [String: Any]
                    }
                    self?.sendToJS(payload)
                }

                self.engine.start(bph: bph, sensitivity: sensitivity)
                self.sendToJS(["event": "started"])
            }
        }
    }

    private func stopMeasurement() {
        let result = engine.stop()
        sendToJS([
            "event": "stopped",
            "rate": result.rate as Any,
            "beatError": result.beatError as Any,
            "tickCount": result.tickCount
        ])
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
