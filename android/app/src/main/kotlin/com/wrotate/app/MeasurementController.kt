package com.wrotate.app

import com.wrotate.engine.TimegrapherCore
import com.wrotate.engine.Tuning
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicReference

/**
 * Drives one measurement session: parses the `timegrapher` bridge messages, wires [AudioCapture]
 * to [TimegrapherCore] (single capture thread, `analysisExecutor = null`), and emits the
 * `_tgNativeCallback` events the page expects (via [emit]). Mirrors the iOS `TimegrapherBridge`.
 *
 * Mid-session `tuning` (the page posts it ~200 ms after start, and on knob/BPH changes) is
 * enqueued and applied on the capture thread at the top of the next buffer — never cross-thread —
 * honoring the Plan 1 single-driver contract.
 */
class MeasurementController(
    private val core: TimegrapherCore,
    private val capture: CaptureHandle,
    private val emit: (String) -> Unit,
    private val deviceModel: String,
    private val onMeasuringChange: (Boolean) -> Unit = {},
    // Seam for tests: defaults to the real core; a test injects a spy to observe the thread.
    private val applyTuning: (Tuning) -> Unit = core::setTuning,
) {
    private val pending = AtomicReference<Tuning?>(null)

    /** Entry point for the `timegrapher` handler; parses the action and dispatches. */
    fun handleTimegrapherMessage(json: String) {
        val o = JSONObject(json)
        when (o.optString("action")) {
            "ping" -> emit(BridgeMessages.pong())
            "start" -> start(o.optInt("bph", 28800))
            "stop" -> stop()
            "tuning" -> enqueueTuning(parseTuning(o))
            // tg mode ignores sensitivity; piezo is not ported.
            "sensitivity", "tuningPiezo" -> {}
        }
    }

    fun start(bph: Int) {
        if (!capture.open()) {
            emit(BridgeMessages.error("Microphone unavailable. Allow it in Settings and try again."))
            return
        }
        core.onUpdate = { u -> emit(BridgeMessages.updateEvent(u)) }
        // Android always runs the validated tg engine (Standard retired); source/algo are vestigial.
        core.start(bph, true, capture.sampleRate)
        // Initial tuning carries platform telemetry (cap=/model= on [TGTUNE]); applied before audio.
        applyTuning(Tuning(captureSource = capture.sourceTag, deviceModel = deviceModel))
        onMeasuringChange(true)
        capture.start { f, n ->
            drainTuning()
            core.process(f, n)
        }
        emit(BridgeMessages.started())
    }

    /** Enqueue tuning from any thread; it is applied on the capture thread (see [drainTuning]). */
    fun enqueueTuning(t: Tuning) {
        pending.set(t)
    }

    private fun drainTuning() {
        pending.getAndSet(null)?.let { applyTuning(it) }
    }

    fun stop() {
        capture.stop()
        val r = core.stop()
        onMeasuringChange(false)
        emit(BridgeMessages.stopped(r))
    }

    private fun parseTuning(o: JSONObject): Tuning {
        fun d(k: String): Double? = if (o.has(k) && !o.isNull(k)) o.getDouble(k) else null
        fun i(k: String): Int? = if (o.has(k) && !o.isNull(k)) o.getInt(k) else null
        fun f(k: String): Float? = d(k)?.toFloat()
        fun b(k: String): Boolean? = if (o.has(k) && !o.isNull(k)) o.getBoolean(k) else null
        return Tuning(
            multLo = f("multLo"), multHi = f("multHi"), minThreshold = f("minThreshold"),
            percentile = i("percentile"), hpCutoff = f("hpCutoff"),
            peakRatioThreshold = f("peakRatioThreshold"), bufferSeconds = f("bufferSeconds"),
            regSkipPairs = i("regSkipPairs"), regMinN = i("regMinN"), wallMinSec = d("wallMinSec"),
            stabWindow = d("stabWindow"), stabThresh = d("stabThresh"), stabLoseThresh = d("stabLoseThresh"),
            maxPairThresh = d("maxPairThresh"), minPairThresh = d("minPairThresh"),
            coldStartThresh = d("coldStartThresh"), pairMadMult = d("pairMadMult"),
            maxTickDevMs = d("maxTickDevMs"), calibDuration = i("calibDuration"),
            outlierMargin = d("outlierMargin"), outlierMarginLowBph = d("outlierMarginLowBph"),
            calibPercentile = d("calibPercentile"), calibMultiplier = d("calibMultiplier"),
            calibMultiplierRecal = d("calibMultiplierRecal"), maxRecalibrations = i("maxRecalibrations"),
            recalTriggerSec = d("recalTriggerSec"), thresholdDecay = d("thresholdDecay"),
            thresholdDecayNoTicks = d("thresholdDecayNoTicks"), tickDetectMult = d("tickDetectMult"),
            minSpacingMult = d("minSpacingMult"), maxBphCorrections = i("maxBphCorrections"),
            noiseFloorMult = d("noiseFloorMult"), peakDetectGate = d("peakDetectGate"),
            phaseLock = b("phaseLock"), phaseLockWindow = d("phaseLockWindow"), phaseLockMaxMiss = i("phaseLockMaxMiss"),
            liftAngle = d("liftAngle"), tgSigma = d("tgSigma"), tgStabWin = d("tgStabWin"),
            tgWallMin = d("tgWallMin"), tgStabTh = d("tgStabTh"), tgMaxWin = d("tgMaxWin"),
            tgAgree = d("tgAgree"), tgPeriodFit = i("tgPeriodFit"), tgHoldOnLock = b("tgHoldOnLock"),
            tgAmpMin = d("tgAmpMin"), tgConfirmBand = d("tgConfirmBand"), tgGuardMode = i("tgGuardMode"),
            tgGateMaxRej = d("tgGateMaxRej"), tgAcquireMax = d("tgAcquireMax"),
            tgStabFresh = i("tgStabFresh"), tgBphDecisive = d("tgBphDecisive"),
        )
    }
}
