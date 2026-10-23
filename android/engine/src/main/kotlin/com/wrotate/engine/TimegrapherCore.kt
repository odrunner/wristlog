package com.wrotate.engine

import java.util.concurrent.Executor
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.truncate

// 1:1 Kotlin port of ios/Wrotate/Wrotate/TimegrapherEngine.swift with audio capture factored
// out: the capture layer feeds FloatArray buffers into process(), so every path runs on the JVM
// without a device. Member names, constants, defaults and log-line formats match the Swift
// source; comments explaining tuned values are carried over. Swift line references below are
// to that file. Deltas from Swift (fixed by the port design, plan Task 5):
//  1. capture is external: start() takes the sample rate and does none of the AVAudioSession /
//     AVAudioEngine work (Swift 528-556 collapse to deriving the rings/filters).
//  2. the once-per-second analysis throttle (Swift 1252, wall clock) runs on AUDIO time
//     (sampleCounter / actualSampleRate) so replays are deterministic.
//  3. debugLog appends to debugMessages and calls the settable logSink instead of print.
//  4. noteAudioClock takes host-time nanos from the capture layer (Swift: AVAudioTime).
//
// Measures watch accuracy via Goertzel + autocorrelation at a known BPH.
//
// Algorithm: user provides BPH -> we know the exact tick frequency.
// 1. Three parallel 2nd-order Butterworth HP filters (4kHz, 6kHz, 8kHz)
// 2. Three parallel peak-hold energy ring buffers at ~24kHz (web-tunable)
// 3. Primary: Goertzel detection at each cutoff (best ratio wins)
// 4. Fallback: FFT autocorrelation when Goertzel fails at all cutoffs
// 5. Rate via fine frequency sweep (Goertzel) or period refinement (autocorr)
// 6. Beat error via epoch folding

data class TickDot(
    val timeSec: Double,      // seconds since measurement start
    val deviationMs: Double,  // cumulative timing deviation in ms
)

/** Swift DebugInfo.allBphCorrelations element `(bph: Int, correlation: Float, lag: Int)`. */
data class BphCorrelation(val bph: Int, val correlation: Float, val lag: Int)

data class DebugInfo(
    val sampleRate: Double,
    val fftSize: Int,
    val bufferSamples: Int,
    val hpCutoff: Double,
    val bestLag: Int,
    val bestCorrelation: Double,
    val refinedLag: Double,
    val noiseFloor: Double,
    val threshold: Double,
    val peakEnergy: Double,
    val allBphCorrelations: List<BphCorrelation>,
)

data class Update(
    val rate: Double?,
    val beatError: Double?,
    val tickCount: Int,
    val confidence: Double,
    val noiseLevel: Double,
    val detectedIntervalMs: Double,
    val detectedBph: Int?,
    val debug: DebugInfo?,
    val beatWaveform: FloatArray?,
    val amplitude: Double?,       // degrees (tg path); null if unavailable
    val tickPositions: IntArray?,
    val cumulativeOffset: Double,
    val elapsedSec: Double,
    val method: String,
    val rateStable: Boolean,      // true when rate has converged (+-2 s/day for 15s)
    val tgSignalQuality: String?, // T3: "good"/"fair"/"poor" from the sigma-gate reject fraction (tg path; null otherwise)
    val tgAcquiring: Boolean,     // T4: tg is evaluating windows, no rate yet, within the acquire runway — JS should not declare no-signal while true
    val newTicks: List<TickDot>,  // new tick dots since last update
    val debugMessages: List<String>, // debug log lines for Supabase
)

/** Swift Result minus `ticks`, which Swift always returns empty. */
data class Result(val rate: Double?, val beatError: Double?, val tickCount: Int)

/**
 * One nullable field per Swift `setTuning` parameter (Swift 347-384), same names (the Swift
 * argument labels) and the same validation ranges, applied in [TimegrapherCore.setTuning].
 * null = "not supplied". The five leading Swift parameters (multLo..hpCutoff) are accepted
 * and ignored, exactly as in Swift; `peakRatioThreshold` and `bufferSeconds` were defaulted
 * Swift parameters (3.0 / 30.0), so null applies those defaults, also as Swift does.
 * `calibDuration` is accepted and ignored in Swift too (calibration is always 2 s).
 */
data class Tuning(
    val multLo: Float? = null,
    val multHi: Float? = null,
    val minThreshold: Float? = null,
    val percentile: Int? = null,
    val hpCutoff: Float? = null,
    val peakRatioThreshold: Float? = null,
    val bufferSeconds: Float? = null,
    val regSkipPairs: Int? = null,
    val regMinN: Int? = null,
    val wallMinSec: Double? = null,
    val stabWindow: Double? = null,
    val stabThresh: Double? = null,
    val stabLoseThresh: Double? = null,
    val maxPairThresh: Double? = null,
    val minPairThresh: Double? = null,
    val coldStartThresh: Double? = null,
    val pairMadMult: Double? = null,
    val maxTickDevMs: Double? = null,
    val calibDuration: Int? = null,
    val ringTargetRate: Double? = null,
    val outlierMargin: Double? = null,
    val outlierMarginLowBph: Double? = null,
    val calibPercentile: Double? = null,
    val calibMultiplier: Double? = null,
    val calibMultiplierRecal: Double? = null,
    val maxRecalibrations: Int? = null,
    val recalTriggerSec: Double? = null,
    val thresholdDecay: Double? = null,
    val thresholdDecayNoTicks: Double? = null,
    val tickDetectMult: Double? = null,
    val minSpacingMult: Double? = null,
    val maxBphCorrections: Int? = null,
    val noiseFloorMult: Double? = null,
    val peakDetectGate: Double? = null,
    val phaseLock: Boolean? = null,
    val phaseLockWindow: Double? = null,
    val phaseLockMaxMiss: Int? = null,
    val liftAngle: Double? = null,
    val tgSigma: Double? = null,
    val tgStabWin: Double? = null,
    val tgWallMin: Double? = null,
    val tgStabTh: Double? = null,
    val tgMaxWin: Double? = null,
    val tgAgree: Double? = null,
    val tgPeriodFit: Int? = null,
    val tgHoldOnLock: Boolean? = null,
    val tgAmpMin: Double? = null,
    val tgConfirmBand: Double? = null,
    val tgGuardMode: Int? = null,
    val tgGateMaxRej: Double? = null,
    val tgAcquireMax: Double? = null,
)

/** Swift `x.rounded()` / C `round()`: half away from zero (kotlin.math.round is half-even). */
private fun roundAway(x: Double): Double {
    val t = truncate(x)
    return if (abs(x - t) >= 0.5) t + (if (x < 0) -1.0 else 1.0) else t
}

class TimegrapherCore(
    private val analysisExecutor: Executor? = null, // null = synchronous (tests); app passes a single-thread executor
) {
    private data class RegPoint(val x: Double, val y: Double)
    private data class RatePoint(val time: Double, val rate: Double)
    private data class GateEvent(val abs: Int, val rejected: Boolean)

    companion object {
        private val bphCandidates = listOf(18000, 21600, 25200, 28800, 36000)
    }

    /** Invoked on the processing/analysis thread; callers marshal to UI. */
    var onUpdate: ((Update) -> Unit)? = null

    /** Receives every debugLog line as it is logged (design delta 3; Swift printed it). */
    var logSink: ((String) -> Unit)? = null

    private var isRunning = false

    private var actualSampleRate: Double = 48000.0
    private var sampleCounter: Long = 0

    // Audio-clock calibration (measurement only — nothing reads these yet).
    // Every rate is (nominal/period - 1)*86400, where `nominal` is built from
    // actualSampleRate and `period` is measured in real captured samples. If the capture
    // clock does not run at exactly the rate the format advertises, that error lands
    // straight in the s/day figure at 0.0864 s/day per ppm, identically for every watch on
    // that device. Nothing cross-checked it before (audit 2026-07-31), so we regress
    // captured frames against the host clock and log the ratio. Neither clock is absolute
    // truth — this sizes the disagreement, it does not correct it.
    // Least-squares slope of frames-against-host over the whole session. The first cut
    // anchored on the FIRST buffer and took a two-point ratio, which made the noisiest
    // sample in the session the pivot for every later estimate: the reported figure then
    // climbed monotonically (+14.1 -> +19.7 ppm over 90s in one field run) and never
    // settled, so it measured startup transient as much as clock error. Skipping the
    // settling period and regressing all samples converges instead of drifting.
    private var clkHaveFirst = false
    private var clkFirstHost: Long = 0          // host-time nanos (Swift: mach host ticks)
    private var clkFirstFrames: Long = 0
    private var clkFrames: Long = 0
    private var clkLastLogSec: Double = -1.0
    private var clkPpm: Double? = null
    private var clkSettleSec: Double = 2.0   // ignore samples before this; buffer pacing is irregular at start
    private var clkN = 0
    private var clkSh = 0.0
    private var clkSf = 0.0
    private var clkShh = 0.0
    private var clkShf = 0.0

    // BPH — user-provided or auto-detected
    private var targetBph: Int = 28800
    private var autoBph: Boolean = false

    // Cumulative offset tracking for scatter plot
    private var cumulativeOffsetMs: Double = 0.0
    private var lastAnalysisElapsed: Double = 0.0

    // Auto BPH re-detection
    private var consecutiveFailures: Int = 0

    // Real-time tick detection for timegrapher chart
    private var tickDeviationMs: Double = 0.0       // cumulative deviation
    private var expectedTickInterval: Double = 0.0  // ring samples between ticks
    private var lastTickRingPos: Int = -1           // ring position of last detected tick
    private var tickThreshold: Float = 0f           // adaptive threshold for tick detection
    private val pendingTicks = ArrayList<TickDot>() // ticks to send in next update
    private var tickDetectionActive = false
    private var tickCalibrating = false             // true during calibration phase (no ticks accepted)
    private var calibrationSamples: Int = 0         // ring samples seen during calibration
    private var calibrationDuration: Int = 24000    // ~2s at 12kHz ring rate
    private val calibrationEnergies = ArrayList<Float>() // per-sample energies during calibration (for percentile)
    private var calibNoiseFloor: Float = 0f         // median energy from calibration — threshold decay floor
    private var recalibrationsDone: Int = 0         // how many times we've auto-recalibrated this session
    private var maxRecalibrations: Int = 4          // cap to avoid infinite loops
    private var ringPosSinceLastTick: Int = 0       // samples since last tick
    private var tickCount: Int = 0
    private var lastTickDeviationCheck: Double = 0.0 // deviation at last sanity check
    private var lastTickCountCheck: Int = 0         // tick count at last sanity check
    private var tickDebugInterval: Int = 0          // throttle debug logging
    private val debugMessages = ArrayList<String>() // accumulated for Supabase
    private val debugLock = Any()                   // debugLog may run on the analysis executor too

    // Sub-sample interpolation for tick timing
    private var lastTickFracOffset: Double = 0.0    // fractional ring position offset of last tick
    private var tickStartSample: Long = 0           // sampleCounter at tick activation (for relative elapsed)

    // Phase recovery for high beat error watches
    private var consecutivePairRejects: Int = 0     // consecutive pair rejections (pairDev > threshold)
    private var rejectDevSum: Double = 0.0          // sum of |pairDev| during reject streak
    private var knownBeatError: Double = 0.0        // estimated beat error from individual tick deviations (ms)
    private val recentTickDevs = ArrayList<Double>() // last N individual tick deviations (signed)
    private var beatErrorWindowSize: Int = 20       // how many tick devs to track for beat error estimation
    // Phase-separated beat error: BE = |mean(dev|phase0) - mean(dev|phase1)|; averaging cancels jitter
    // (spec docs/superpowers/specs/2026-06-10-phase-separated-beat-error.md). Replaces the folded estimator.
    private var tickPhaseIndex: Int = 0             // cumulative expected-impulse count — skip-robust parity source
    private val beDevsByParity = arrayOf(ArrayList<Double>(), ArrayList<Double>()) // rolling signed-dev buckets, phase 0 / phase 1
    private val beBucketWindow: Int = 30            // per-bucket rolling size
    private val beMinPerBucket: Int = 8             // min samples per bucket before BE is valid
    private var phaseSepBeatError: Double? = null   // estimator output (ms), null until both buckets fill

    // Adaptive BPH correction: detect consistent pair deviation or outlier ratio -> switch BPH
    private val bphCorrectionRejects = ArrayList<Double>()  // signed pairDev values during reject streak
    private val bphCorrectionOutliers = ArrayList<Double>() // consecutive outlier ratios
    private val bphCorrectionAttempted = HashSet<Int>()     // BPH values already tried this session
    private var bphCorrectionCount: Int = 0         // how many BPH switches done this session
    private var maxBphCorrections: Int = 2          // cap corrections to avoid infinite loops

    // Pair-based regression: accumulate every 2 ticks to cancel beat error
    private var pairIntervalAccum: Double = 0.0     // sum of last 2 tick intervals (fractional)
    private var pairTickPhase: Int = 0              // 0 or 1, alternates each tick
    private var pairDeviationMs: Double = 0.0       // cumulative pair deviation
    // Stashed first-tick info (held until pair is validated)
    private var pendingFirstTickDev: Double = 0.0
    private var pendingFirstTickTime: Double = 0.0
    private var pendingFirstTickInterval: Double = 0.0
    private var pendingFirstTickEnergy: Float = 0f
    // Adaptive pair gate: starts at 2ms, tightens as we learn the noise profile
    private val recentPairDevs = ArrayList<Double>() // last N |pairDev| values (ALL pairs, not just accepted)
    private var adaptiveWindowSize: Int = 30        // pairs to track for MAD
    private var coldStartThreshold: Double = 2.0    // ms, before we have enough data
    private var minAdaptiveThreshold: Double = 1.0  // floor
    private var maxAdaptiveThreshold: Double = 2.0  // ceiling
    private var adaptiveMultiplier: Double = 3.0    // MAD multiplier
    private var maxTickDev: Double = 10.0           // individual tick sanity limit (ms)
    private var outlierMargin: Double = 0.15        // +-fraction for tick interval outlier gate
    private var outlierMarginLowBph: Double = 0.20  // wider margin for <=21600 bph
    private var regressionSkipPairs: Int = 5        // skip first N pairs from regression (threshold still adapting)
    private var totalPairsAccepted: Int = 0         // total clean pairs (including skipped)

    // Calibration tunables (previously hardcoded)
    private var calibPercentile: Double = 0.98      // energy percentile for threshold
    private var calibMultiplier: Float = 1.2f       // first calibration multiplier on percentile
    private var calibMultiplierRecal: Float = 0.8f  // recalibration multiplier (softer)
    private var recalTriggerSec: Double = 3.0       // seconds of no ticks before recalibrating
    private var tickThresholdDecay: Float = 0.9999f // threshold decay when ticks are flowing
    private var tickThresholdDecayNoTicks: Float = 0.995f // faster decay when starved of ticks
    private var tickDetectMult: Float = 0.3f        // energy > tickThreshold * this = tick detected
    private var minSpacingMult: Double = 0.9        // minSpacing = expectedInterval * this
    private var noiseFloorMult: Float = 2.0f        // threshold decay floor = calibMedian * this (0 = disabled)

    // Peak detection: wait for energy to decline before firing tick
    private var pendingTickCross: Boolean = false   // threshold crossed, waiting for peak
    private var pendingTickPeakEnergy: Float = 0f   // highest energy seen during pending
    // Phase-locked selection: once locked, pick the candidate crest closest to the predicted tick.
    private var phaseLockEnabled: Boolean = true    // default ON — validated on Kurono (twin-peak). JLC read high but it's a flaky watch (Weishi itself unstable, -22→+4), so discounted. Regression-checking clean watches (Hamilton/Tudor) next. A/B-overridable via setTuning.
    private var phaseLockWindow: Double = 0.4       // acceptance half-window as fraction of interval
    private var phaseLockMaxMiss: Int = 3           // consecutive misses before dropping lock
    private var plHaveCand: Boolean = false
    private var plBestInterval: Int = 0
    private var plBestDist: Int = Int.MAX_VALUE
    private var plMissCount: Int = 0
    private var plApplyCarry: Boolean = false
    private var plPendingCarry: Int = 0
    private var peakDetectGate: Float = 3.0f        // use peak detection only when energy > threshold * this

    // Rate display and stability tracking (all tunable from JS)
    private var smoothedRate: Double? = null
    private var lastUpdateLogRegN: Int = 0
    private val rateHistory = ArrayList<RatePoint>() // recent rates for stability check
    private var regNMinimum: Int = 10               // minimum regression points before showing rate
    private var stabilityWindow: Double = 15.0      // seconds to check stability over
    private var stabilityThreshold: Double = 3.0    // s/day — rate must stay within this range
    private var stabilityLoseThreshold: Double = 5.0 // s/day — wider threshold to LOSE stability (prevents flicker)
    private var wallElapsedMinimum: Double = 20.0   // minimum elapsed time before allowing convergence
    private var wasStable: Boolean = false

    private fun debugLog(msg: String) {
        synchronized(debugLock) { debugMessages.add(msg) }
        logSink?.invoke(msg)
    }

    private fun drainDebugMessages(): List<String> = synchronized(debugLock) {
        val out = ArrayList(debugMessages)
        debugMessages.clear()
        out
    }

    /// Adaptive pair gate threshold based on median + MAD of ALL recent pairs.
    /// Tracks all pairs (accepted + rejected) to see the true noise profile.
    private fun currentPairThreshold(): Double {
        if (recentPairDevs.size < 10) return coldStartThreshold
        val sorted = recentPairDevs.sorted()
        val median = sorted[sorted.size / 2]
        val absDevs = sorted.map { abs(it - median) }.sorted()
        val mad = absDevs[absDevs.size / 2]
        val threshold = max(minAdaptiveThreshold, min(maxAdaptiveThreshold, median + adaptiveMultiplier * mad))
        return threshold
    }

    /// Theil-Sen estimator on ALL accepted pairs. Uses all data for maximum stability.
    /// When n > 120, subsamples to keep O(n^2) manageable (~7000 slope pairs max).
    private fun theilSenSlope(): Double? {
        val n = regPoints.size
        if (n < regNMinimum) return null

        // For large n, subsample evenly to ~120 points (keeps O(n^2) fast)
        val points: List<RegPoint> = if (n > 120) {
            val step = (n - 1).toDouble() / 119.0
            (0 until 120).map { i -> regPoints[(i.toDouble() * step).toInt()] }
        } else {
            regPoints
        }
        val wn = points.size

        val slopes = ArrayList<Double>(wn * (wn - 1) / 2)
        for (i in 0 until wn) {
            for (j in (i + 1) until wn) {
                val dx = points[j].x - points[i].x
                if (dx > 0.01) {
                    slopes.add((points[j].y - points[i].y) / dx)
                }
            }
        }
        if (slopes.isEmpty()) return null
        slopes.sort()
        return slopes[slopes.size / 2]
    }

    // Theil-Sen median regression on PAIR deviations -> robust to outliers
    private val regPoints = ArrayList<RegPoint>() // (elapsedSec, pairDeviationMs)
    private var regN: Int = 0 // kept for compatibility (= regPoints.count)

    // Three parallel HP filters at different cutoffs. BiquadState is a class (Swift: struct):
    // each filter is built by its own makeBiquadHP call and never copied.
    private val hpCutoffs: FloatArray = floatArrayOf(4000f, 6000f, 8000f)
    private var hpFilters: Array<BiquadState> = emptyArray()

    // Three parallel energy ring buffers
    private var energyRings: Array<FloatArray> = emptyArray()
    private var energyRingCapacity: Int = 360000
    private var bufferDurationSec: Float = 30.0f
    private var energyRingWritePos: Int = 0
    private var energyRingCount: Int = 0
    private var energySubsampleCounter: Int = 0
    private var ringSubsampleTarget: Int = 4      // 48kHz / 4 = 12kHz
    private var ringTargetRate: Double = 12000.0  // target ring sample rate (web-tunable)
    private var useTgAlgo = false                 // rate via autocorrelation period (tg) vs regression
    // tg dots: beats located on the tg-period grid over the envelope — the dots must come
    // from the algorithm that produces the number, not the legacy detector (tg path only).
    private var energyRingAbs = 0                 // absolute ring-sample counter (write side)
    private var tgDotNext: Double = -1.0          // predicted next beat (abs ring); -1 = bootstrap
    private var tgDotPrevAbs: Double = -1.0
    private var tgDotPairAccum: Double = 0.0
    private var tgDotPairPhase = 0
    private var tgDotCumMs: Double = 0.0
    private var tgDotSkipPairs = 0
    private val tgPendingDots = ArrayList<TickDot>()
    private var tgRateCached: Double? = null      // cached tg rate (recomputed ~2x/sec)
    private var tgBeCached: Double? = null        // cached tg beat error (ms, from the fold)
    private var tgAmpCached: Double? = null       // cached tg amplitude (degrees)
    private var tgFoldCached: FloatArray? = null  // cached folded beat waveform
    private var liftAngleDeg: Double = 52.0       // escapement lift angle for amplitude (tunable)
    private var lastTgComputeSec: Double = -1.0
    private var lastTgLogSec: Double = -1.0

    // Per-filter subsample peaks
    private val subsamplePeaks = floatArrayOf(0f, 0f, 0f)

    // Tuning parameters
    private var peakRatioThreshold: Float = 3.0f

    // Live debug values
    private var recentPeakEnergy: Float = 0f

    // Which cutoff index was used for the active detection
    private var activeHpIndex: Int = 0

    // Results
    private var currentRate: Double? = null
    private var currentBeatError: Double? = null
    private var currentConfidence: Double = 0.0
    private var currentDetectedInterval: Double = 0.0
    private var detectedBph: Int? = null
    private var currentNoiseLevel: Double = 0.0
    private var peakCount: Int = 0
    private var detectionMethod: String = ""

    private var lastAnalysisTime: Double = 0.0    // ms of AUDIO time (design delta 2)
    @Volatile private var isAnalyzing = false
    private var lastDebugInfo: DebugInfo? = null
    private var lastBeatWaveform: FloatArray? = null
    private var lastTickPositions: IntArray? = null

    // MARK: - tg-path state read by part A (Swift 1691-1729). Declared here because setTuning,
    // the [TGTUNE] echo, start()'s reset and the recalibration branch reference them; the tg
    // core that drives them is Task 6.

    // tg-path convergence knobs — all JS-tunable via the tuning message (no rebuild needed)
    private var tgSigmaGate = 3e-4        // reject a window if per-cycle period estimates disagree
    private var tgStabWindowSec = 6.0     // rate must hold steady this long
    private var tgWallMinSec = 8.0        // earliest possible convergence
    private var tgStabThresh = 3.0        // steady = within this band (s/day)
    private var tgMaxWindowSec = 16.0     // longest analysis window (32 = precision mode; needs bufferSeconds >= window+6)
    private var tgAgreeBand = 12.0        // harmonic-reject guard: longest-window rate must agree with the window median within this (s/day); set very high (e.g. 999) to disable
    private var tgPeriodFit = 2           // 0 = legacy equal-weight mean, 1 = median, 2 = weighted fit (see tgPeriod)
    private var tgHoldOnLock = true       // don't let the tick detector tear down a session the tg core is measuring fine
    private var tgAmpMinDeg = 90.0        // lowest amplitude the plausibility gate will report (was hardcoded 135)
    private var tgLastLockAbs: Int = -1   // energyRingAbs when computeTgRate last produced a rate
    private var tgLastWindowSec = 0.0     // analysis window that produced the last rate (logged)
    private var tgGateRejects = 0         // cumulative sigma-gate window rejections (logged)
    private var tgBeOnsetCached: Double? = null // shadow onset-based beat error (logged, not displayed)
    private var tgRecalSuppressed = false // logged once per session when tgHoldOnLock first blocks a recalibration

    // Lock-validation knobs (docs/spec-tg-lock-validation.md, 2026-08-15). ALL ship defaults
    // reproduce 2.4 behaviour exactly — the bundle rides DARK in the 2.5 binary and each knob
    // is flipped server-side, one per weekly cycle. Evidence for the defaults being inert:
    // confirmBand >= 900 marks every lock confirmed; guardMode 0 is the 2.4 median fallback
    // bit for bit; gateMaxRej 1.0 can never exceed a fraction; acquireMax 15 matches the
    // teardown timing the recal loop already produces.
    private var tgConfirmBand = 999.0   // T1: disjoint-segment confirm band (s/day); >= 900 = off. Staged target: 6.0
    private var tgGuardMode = 0         // T2: harmonic-guard disagreement: 0 = median fallback (2.4), 1 = refuse (nil)
    private var tgGateMaxRej = 1.0      // T3: block convergence-GAIN while sigma-gate reject fraction (last 10 s) exceeds this; >= 1 = off. Staged target: 0.5
    private var tgAcquireMaxSec = 15.0  // T4: pre-lock runway — zero-tick recals don't consume teardown attempts while tg is evaluating, until this wall time; 15 = off. Staged target: 45

    // T1 state: a lock is CONFIRMED only when a rate measured over audio that shares zero
    // samples with the locking segment agrees within tgConfirmBand. Overlapping windows
    // self-confirm (field: within-session movement 0.3 s/d even on wild locks, while the
    // same watch re-measured minutes later moves 8-50 s/d), so this is the only in-session
    // signal that separates a right lock from a confident wrong one.
    private var tgPendingLockRate: Double? = null
    private var tgPendingLockAbs = -1     // energyRingAbs when the pending lock was taken
    private var tgLockConfirmed = false
    private var tgLockRejects = 0         // logged as lr= in TGALGO
    // T3/T4 state: rolling sigma-gate window attempts (ring-abs stamped, pruned past 10 s)
    private val tgGateEvents = ArrayList<GateEvent>()
    private var tgGateAttempts = 0        // cumulative, logged as ga= in TGALGO

    /// True while the tg core evaluated at least one window in the last 5 s (passed OR
    /// sigma-rejected) — i.e. the envelope has candidate periodicity worth waiting on.
    /// (Swift 1747-1751; read by the zero-tick recalibration branch.)
    private fun tgActivelyEvaluating(): Boolean {
        val last = tgGateEvents.lastOrNull() ?: return false
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        return (energyRingAbs - last.abs).toDouble() < ringSampleRate * 5.0
    }

    /// (Swift 1943-1947; read by both recalibration branches.) A starving tick detector is
    /// not a reason to recalibrate — or tear down — a session that is measuring perfectly
    /// well. 26% of Pro V2 sessions hit at least one recalibration and their convergence
    /// rate collapsed from 86% to 26% (audit 2026-07-31).
    private fun tgHasRecentLock(): Boolean {
        if (!(tgHoldOnLock && useTgAlgo && tgLastLockAbs >= 0)) return false
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        return (energyRingAbs - tgLastLockAbs).toDouble() < ringSampleRate * 3.0
    }

    fun setTuning(t: Tuning) {
        t.tgPeriodFit?.let { v -> if (v >= 0 && v <= 2) this.tgPeriodFit = v }
        t.tgHoldOnLock?.let { v -> this.tgHoldOnLock = v }
        t.tgAmpMin?.let { v -> if (v >= 40 && v <= 200) tgAmpMinDeg = v }
        // Lock-validation knobs (spec T1-T4); validation ranges keep a fat-fingered admin
        // value from bricking measurement. See the knob declarations for ship defaults.
        t.tgConfirmBand?.let { v -> if (v >= 1) this.tgConfirmBand = v }
        t.tgGuardMode?.let { v -> if (v >= 0 && v <= 1) this.tgGuardMode = v }
        t.tgGateMaxRej?.let { v -> if (v > 0 && v <= 1) this.tgGateMaxRej = v }
        t.tgAcquireMax?.let { v -> if (v >= 10 && v <= 120) this.tgAcquireMaxSec = v }
        t.liftAngle?.let { v -> if (v >= 20 && v <= 80) liftAngleDeg = v }
        t.tgSigma?.let { v -> if (v > 0) tgSigmaGate = v }
        t.tgStabWin?.let { v -> if (v >= 2) tgStabWindowSec = v }
        t.tgWallMin?.let { v -> if (v >= 3) tgWallMinSec = v }
        t.tgStabTh?.let { v -> if (v > 0) tgStabThresh = v }
        t.tgMaxWin?.let { v -> if (v >= 8 && v <= 60) tgMaxWindowSec = v }
        t.tgAgree?.let { v -> if (v > 0) tgAgreeBand = v }
        peakRatioThreshold = max(1.0f, t.peakRatioThreshold ?: 3.0f)
        bufferDurationSec = max(5f, min(120f, t.bufferSeconds ?: 30.0f))
        t.regSkipPairs?.let { regressionSkipPairs = it }
        t.regMinN?.let { regNMinimum = it }
        t.wallMinSec?.let { wallElapsedMinimum = it }
        t.stabWindow?.let { stabilityWindow = it }
        t.stabThresh?.let { stabilityThreshold = it }
        t.stabLoseThresh?.let { stabilityLoseThreshold = it }
        t.maxPairThresh?.let { maxAdaptiveThreshold = it }
        t.minPairThresh?.let { minAdaptiveThreshold = it }
        t.coldStartThresh?.let { coldStartThreshold = it }
        t.pairMadMult?.let { adaptiveMultiplier = it }
        t.maxTickDevMs?.let { maxTickDev = it }
        t.ringTargetRate?.let { this.ringTargetRate = it }
        t.outlierMargin?.let { this.outlierMargin = it }
        t.outlierMarginLowBph?.let { this.outlierMarginLowBph = it }
        t.calibPercentile?.let { this.calibPercentile = it }
        t.calibMultiplier?.let { this.calibMultiplier = it.toFloat() }
        t.calibMultiplierRecal?.let { this.calibMultiplierRecal = it.toFloat() }
        t.maxRecalibrations?.let { this.maxRecalibrations = it }
        t.recalTriggerSec?.let { this.recalTriggerSec = it }
        t.thresholdDecay?.let { this.tickThresholdDecay = it.toFloat() }
        t.thresholdDecayNoTicks?.let { this.tickThresholdDecayNoTicks = it.toFloat() }
        t.tickDetectMult?.let { this.tickDetectMult = it.toFloat() }
        t.minSpacingMult?.let { this.minSpacingMult = it }
        t.maxBphCorrections?.let { this.maxBphCorrections = it }
        t.noiseFloorMult?.let { this.noiseFloorMult = it.toFloat() }
        t.peakDetectGate?.let { this.peakDetectGate = it.toFloat() }
        t.phaseLock?.let { this.phaseLockEnabled = it }
        t.phaseLockWindow?.let { this.phaseLockWindow = it }
        t.phaseLockMaxMiss?.let { this.phaseLockMaxMiss = it }
        debugLog(
            "[TGTUNE] regSkip=$regressionSkipPairs regMinN=$regNMinimum wallMin=${swiftDesc(wallElapsedMinimum)}" +
                " stabWin=${swiftDesc(stabilityWindow)} stabThresh=${swiftDesc(stabilityThreshold)}" +
                " stabLose=${swiftDesc(stabilityLoseThreshold)} maxPairTh=${swiftDesc(maxAdaptiveThreshold)}" +
                " minPairTh=${swiftDesc(minAdaptiveThreshold)} coldStart=${swiftDesc(coldStartThreshold)}" +
                " madMult=${swiftDesc(adaptiveMultiplier)} maxTickDev=${swiftDesc(maxTickDev)}" +
                " calibDur=$calibrationDuration ringTarget=${swiftDesc(this.ringTargetRate)}" +
                " outlier=${swiftDesc(this.outlierMargin)}/${swiftDesc(this.outlierMarginLowBph)}" +
                " calibP=${swiftDesc(this.calibPercentile)}" +
                " calibM=${swiftDesc(this.calibMultiplier)}/${swiftDesc(this.calibMultiplierRecal)}" +
                " maxRecal=${this.maxRecalibrations} recalTrig=${swiftDesc(this.recalTriggerSec)}" +
                " decay=${swiftDesc(this.tickThresholdDecay)}/${swiftDesc(this.tickThresholdDecayNoTicks)}" +
                " detectM=${swiftDesc(this.tickDetectMult)} minSpace=${swiftDesc(this.minSpacingMult)}" +
                " maxBphCorr=${this.maxBphCorrections} noiseFloor=${swiftDesc(this.noiseFloorMult)}" +
                " peakGate=${swiftDesc(this.peakDetectGate)}" +
                " phaseLock=${this.phaseLockEnabled}/${swiftDesc(this.phaseLockWindow)}" +
                " tgKnobs=${swiftDesc(tgSigmaGate)}/${swiftDesc(tgStabWindowSec)}/${swiftDesc(tgWallMinSec)}/${swiftDesc(tgStabThresh)}" +
                " maxWin=${swiftDesc(tgMaxWindowSec)} agreeBand=${swiftDesc(tgAgreeBand)} lift=${swiftDesc(liftAngleDeg)}" +
                " periodFit=${this.tgPeriodFit} holdOnLock=${this.tgHoldOnLock} ampMin=${swiftDesc(tgAmpMinDeg)}" +
                " confirmBand=${swiftDesc(this.tgConfirmBand)} guardMode=${this.tgGuardMode}" +
                " gateMaxRej=${swiftDesc(this.tgGateMaxRej)} acquireMax=${swiftDesc(this.tgAcquireMaxSec)}",
        )
    }

    fun start(bph: Int, useTgAlgo: Boolean, sampleRate: Double) {
        if (isRunning) return
        this.useTgAlgo = useTgAlgo

        currentRate = null
        currentBeatError = null
        currentConfidence = 0.0
        currentDetectedInterval = 0.0
        detectedBph = null
        currentNoiseLevel = 0.0
        sampleCounter = 0
        lastAnalysisTime = 0.0
        energyRingWritePos = 0
        energyRingAbs = 0
        tgDotNext = -1.0; tgDotPrevAbs = -1.0; tgDotPairAccum = 0.0; tgDotPairPhase = 0
        tgDotCumMs = 0.0; tgDotSkipPairs = 0; tgPendingDots.clear()
        energyRingCount = 0
        energySubsampleCounter = 0
        recentPeakEnergy = 0f
        peakCount = 0
        activeHpIndex = 0
        detectionMethod = ""
        cumulativeOffsetMs = 0.0
        lastAnalysisElapsed = 0.0
        isAnalyzing = false
        tickDetectionActive = false
        tickDeviationMs = 0.0
        expectedTickInterval = 0.0
        lastTickRingPos = -1
        ringPosSinceLastTick = 0
        tickCount = 0
        pendingTicks.clear()
        tickThreshold = 0f
        calibNoiseFloor = 0f
        consecutiveFailures = 0
        lastTickDeviationCheck = 0.0
        lastTickCountCheck = 0
        regPoints.clear(); regN = 0; totalPairsAccepted = 0
        pairIntervalAccum = 0.0; pairTickPhase = 0; pairDeviationMs = 0.0
        lastTickFracOffset = 0.0; tickStartSample = 0
        pendingFirstTickDev = 0.0; pendingFirstTickTime = 0.0; pendingFirstTickInterval = 0.0; pendingFirstTickEnergy = 0f
        recentPairDevs.clear()
        consecutivePairRejects = 0; rejectDevSum = 0.0; knownBeatError = 0.0; recentTickDevs.clear(); tickPhaseIndex = 0
        beDevsByParity[0].clear(); beDevsByParity[1].clear(); phaseSepBeatError = null
        bphCorrectionRejects.clear(); bphCorrectionOutliers.clear(); bphCorrectionAttempted.clear(); bphCorrectionCount = 0
        smoothedRate = null; lastUpdateLogRegN = 0; rateHistory.clear(); wasStable = false
        lastDebugInfo = null
        lastBeatWaveform = null
        lastTickPositions = null
        subsamplePeaks.fill(0f)

        // Set BPH mode after all resets
        if (bph == 0) {
            autoBph = true
            targetBph = 28800 // default until auto-detected
        } else {
            autoBph = false
            targetBph = bph
            detectedBph = bph // user-selected = immediately locked
        }
        tgRateCached = null; tgBeCached = null; tgAmpCached = null; tgFoldCached = null; lastTgComputeSec = -1.0; lastTgLogSec = -1.0
        tgLastLockAbs = -1; tgLastWindowSec = 0.0; tgGateRejects = 0; tgBeOnsetCached = null; tgRecalSuppressed = false
        tgPendingLockRate = null; tgPendingLockAbs = -1; tgLockConfirmed = false; tgLockRejects = 0
        tgGateEvents.clear(); tgGateAttempts = 0
        clkHaveFirst = false; clkFirstHost = 0; clkFirstFrames = 0; clkFrames = 0; clkLastLogSec = -1.0; clkPpm = null
        clkN = 0; clkSh = 0.0; clkSf = 0.0; clkShh = 0.0; clkShf = 0.0
        debugLog("[TGSTART] bph=$bph autoBph=$autoBph targetBph=$targetBph detectedBph=${swiftDescribing(detectedBph)} useTg=$useTgAlgo")

        // Swift 528-556 minus the AVAudioSession/AVAudioEngine work (design delta 1): the
        // capture layer owns the device and reports its actual rate here.
        actualSampleRate = sampleRate

        // Initialize 3 biquad HP filters
        hpFilters = Array(hpCutoffs.size) { makeBiquadHP(cutoff = hpCutoffs[it], sampleRate = actualSampleRate) }

        // Ring buffer at target rate (default 24kHz, web-tunable)
        ringSubsampleTarget = max(1, (actualSampleRate / ringTargetRate).toInt())
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        energyRingCapacity = (ringSampleRate * bufferDurationSec.toDouble()).toInt()
        energyRings = Array(3) { FloatArray(energyRingCapacity) }

        isRunning = true

        // If BPH is user-selected, start tick detection immediately
        if (!autoBph) {
            activateTickDetection(ringSampleRate = ringSampleRate)
        }
    }

    /** Task 6: the non-AVAudio parts of Swift rebuildAudioAfterInterruption (648-694). */
    @Suppress("UNUSED_PARAMETER")
    fun onCaptureRestart(newSampleRate: Double) {
        // Task 6
    }

    fun stop(): Result {
        isRunning = false
        // folded estimate: stable in the field. phaseSepBeatError rides per-tick devs that
        // phase-walk (climb+flip) when watch rate != nominal BPH — kept for logging only (psBE= in TGTICK).
        return Result(rate = currentRate, beatError = currentBeatError, tickCount = peakCount)
    }

    /// Compare captured frames against the host clock. Runs on the capture thread, same as
    /// process, so it shares debugMessages with it. `hostTimeNs` stamps the FIRST frame of
    /// this buffer, so the frame count is read before the buffer is added. Pass a negative
    /// hostTimeNs when the capture layer has no valid timestamp for the buffer (Swift:
    /// `!when.isHostTimeValid`) so the frames still count.
    fun noteAudioClock(hostTimeNs: Long, frames: Int) {
        if (hostTimeNs < 0) { clkFrames += frames.toLong(); return }
        if (!clkHaveFirst) {
            clkHaveFirst = true
            clkFirstHost = hostTimeNs
            clkFirstFrames = clkFrames
        } else if (hostTimeNs > clkFirstHost) {
            val hostSec = (hostTimeNs - clkFirstHost).toDouble() / 1e9
            val frameSec = (clkFrames - clkFirstFrames).toDouble() / actualSampleRate
            if (hostSec > clkSettleSec && frameSec > 0) {
                clkN += 1
                clkSh += hostSec; clkSf += frameSec
                clkShh += hostSec * hostSec; clkShf += hostSec * frameSec
                val n = clkN.toDouble()
                val den = n * clkShh - clkSh * clkSh
                // Needs a real spread of host times before the slope means anything.
                if (clkN >= 8 && den > 1e-9) {
                    val slope = (n * clkShf - clkSh * clkSf) / den
                    val ppm = (slope - 1.0) * 1e6
                    clkPpm = ppm
                    val el = sampleCounter.toDouble() / actualSampleRate
                    if (el - clkLastLogSec > 10) {
                        clkLastLogSec = el
                        debugLog(
                            "[TGCLOCK] fs=${cf(actualSampleRate, 0)} host=${cf(hostSec, 3)}s frames=${cf(frameSec, 3)}s" +
                                " n=$clkN ppm=${cf(ppm, 2, plus = true)} (=${cf(ppm * 0.0864, 2, plus = true)} s/day)",
                        )
                    }
                }
            }
        }
        clkFrames += frames.toLong()
    }

    // MARK: - Per-sample processing

    /** Swift processAudioBuffer (747-1395). Feed mono float samples [0, count). */
    fun process(samples: FloatArray, count: Int = samples.size) {
        if (!isRunning) return
        val frameCount = count

        // vDSP_rmsqv
        var sumSq = 0.0
        for (i in 0 until frameCount) { val s = samples[i].toDouble(); sumSq += s * s }
        val rms: Float = if (frameCount > 0) sqrt(sumSq / frameCount).toFloat() else 0f
        currentNoiseLevel = min(1.0, rms.toDouble() * 10)

        for (i in 0 until frameCount) {
            val x = samples[i]

            // Run through all 3 HP filters
            for (f in 0 until 3) {
                val hp = applyBiquad(hpFilters[f], x)
                val absHp = abs(hp)
                if (absHp > subsamplePeaks[f]) subsamplePeaks[f] = absHp
            }

            sampleCounter += 1

            energySubsampleCounter += 1
            if (energySubsampleCounter >= ringSubsampleTarget) {
                energySubsampleCounter = 0
                val peakEnergy = subsamplePeaks[0]
                for (f in 0 until 3) {
                    energyRings[f][energyRingWritePos] = subsamplePeaks[f]
                    subsamplePeaks[f] = 0f
                }
                energyRingWritePos = (energyRingWritePos + 1) % energyRingCapacity
                energyRingAbs += 1
                energyRingCount = min(energyRingCount + 1, energyRingCapacity)

                if (peakEnergy > recentPeakEnergy) recentPeakEnergy = peakEnergy

                // Real-time tick detection on the active HP filter's energy
                if (tickDetectionActive) {
                    val energy = if (subsamplePeaks.isEmpty()) peakEnergy
                    else energyRings[activeHpIndex][(energyRingWritePos - 1 + energyRingCapacity) % energyRingCapacity]

                    // Calibration phase: observe energy to learn tick amplitude, no ticks accepted
                    if (tickCalibrating) {
                        calibrationEnergies.add(energy)
                        calibrationSamples += 1
                        if (calibrationSamples >= calibrationDuration) {
                            tickCalibrating = false
                            // Robust percentile instead of peak: resists transient spikes (bumps, taps)
                            val sorted = calibrationEnergies.toFloatArray()
                            sorted.sort()
                            val pIdx = max(0, min(sorted.size - 1, (sorted.size.toDouble() * calibPercentile).toInt()))
                            val p98 = sorted[pIdx]
                            // Save noise floor (median energy) as threshold decay floor
                            val medIdx = sorted.size / 2
                            calibNoiseFloor = sorted[medIdx]
                            // Progressively softer threshold on each recalibration
                            val calibMult: Float = if (recalibrationsDone == 0) calibMultiplier
                            else calibMultiplierRecal / max(1, recalibrationsDone).toFloat()
                            tickThreshold = p98 * calibMult
                            calibrationEnergies.clear()
                            calibrationEnergies.trimToSize()
                            tickStartSample = sampleCounter // reset elapsed to exclude calibration
                            debugLog("[TGCALIBRATED] tickThreshold=${cf(tickThreshold.toDouble(), 6)} (p98=${cf(p98.toDouble(), 6)} mult=${swiftDesc(calibMult)}) after $calibrationSamples samples recal=$recalibrationsDone")
                        }
                        continue
                    }

                    ringPosSinceLastTick += 1
                    if (plApplyCarry) { ringPosSinceLastTick += plPendingCarry; plApplyCarry = false }

                    // Track peak energy; decay toward noise floor (not zero)
                    if (energy > tickThreshold) {
                        tickThreshold = energy
                    } else {
                        tickThreshold *= (if (tickCount == 0) tickThresholdDecayNoTicks else tickThresholdDecay)
                        if (noiseFloorMult > 0) {
                            val floor = calibNoiseFloor * noiseFloorMult
                            if (tickThreshold < floor) tickThreshold = floor
                        }
                    }
                    val threshold = tickThreshold * tickDetectMult

                    val minSpacing = (expectedTickInterval * minSpacingMult).toInt()
                    val ringSR = actualSampleRate / ringSubsampleTarget.toDouble()

                    // Debug: log every ~1 second
                    tickDebugInterval += 1
                    if (tickDebugInterval % ringSR.toInt() == 0) {
                        val elDbg = (sampleCounter - tickStartSample).toDouble() / actualSampleRate
                        val rateStr = smoothedRate?.let { cf(it, 1) } ?: "nil"
                        debugLog("[TGDEBUG ${cf(elDbg, 1)}s] energy=${cf(energy.toDouble(), 6)} thresh=${cf(threshold.toDouble(), 6)} tickThresh=${cf(tickThreshold.toDouble(), 6)} tickCount=$tickCount regN=$regN pairDev=${cf(pairDeviationMs, 2)} rate=$rateStr")

                        // Fallback recalibration: if calibration latched onto a transient and no ticks
                        // have been detected after recalTriggerSec, restart calibration with a fresh window.
                        // Skipped while the tg core has a lock — recalibrating also rewinds
                        // tickStartSample, which resets the tg convergence clock and throws away a
                        // measurement that was already converging.
                        if (tickCount == 0 && elDbg > recalTriggerSec && tgHasRecentLock()) {
                            if (!tgRecalSuppressed) {
                                tgRecalSuppressed = true
                                debugLog("[TGRECALIBRATE SKIP] tg core holds a lock (win=${cf(tgLastWindowSec, 0)}s) — not resetting the detector")
                            }
                        } else if (tickCount == 0 && elDbg > recalTriggerSec && recalibrationsDone < maxRecalibrations) {
                            // T4 pre-lock runway (dark unless tgAcquireMaxSec is raised past 15):
                            // while the tg core is actively evaluating windows, a zero-tick recal
                            // still reruns calibration but doesn't consume a teardown attempt —
                            // the tick detector must not exhaust its retries under a session the
                            // sigma-gate is still working (deep dive 2026-08-15: 347/379 sessions
                            // dead at ~15 s had the gate counter climbing).
                            val tgRunway = useTgAlgo && tgAcquireMaxSec > 15.0 &&
                                elDbg < tgAcquireMaxSec && tgActivelyEvaluating()
                            if (!tgRunway) recalibrationsDone += 1
                            tickCalibrating = true
                            plHaveCand = false; plBestDist = Int.MAX_VALUE; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
                            calibrationSamples = 0
                            calibrationEnergies.clear()
                            tickThreshold = 0f
                            tickStartSample = sampleCounter
                            pendingTickCross = false
                            debugLog("[TGRECALIBRATE] no ticks after ${cf(elDbg, 1)}s — restarting calibration (attempt $recalibrationsDone/$maxRecalibrations)${if (tgRunway) " [tg-runway: not counted]" else ""}")
                        }
                    }

                    // Peak detection: wait for energy to decline past peak before firing
                    var shouldFireTick = false
                    val usesPeakDetect = energy > threshold * peakDetectGate
                    if (energy > threshold && ringPosSinceLastTick >= minSpacing) {
                        if (usesPeakDetect) {
                            if (!pendingTickCross || energy > pendingTickPeakEnergy) {
                                pendingTickCross = true
                                pendingTickPeakEnergy = energy
                            } else {
                                pendingTickCross = false
                                shouldFireTick = true
                            }
                        } else {
                            pendingTickCross = false
                            shouldFireTick = true
                        }
                    } else if (pendingTickCross) {
                        pendingTickCross = false
                        shouldFireTick = true
                    }

                    // Phase-locked selection: when locked, defer firing and pick the crest closest to
                    // the predicted tick time (ignores a louder twin ~3.5ms away). No-op pre-lock and
                    // on single-peak watches (one candidate in window => same tick as before).
                    val plActive = phaseLockEnabled && lastTickRingPos >= 0 && expectedTickInterval > 0
                    if (plActive) {
                        val expI = expectedTickInterval.toInt()
                        val lo = (expectedTickInterval * (1.0 - phaseLockWindow)).toInt()
                        val hi = (expectedTickInterval * (1.0 + phaseLockWindow)).toInt()
                        if (shouldFireTick) {
                            val intv = ringPosSinceLastTick
                            if (intv >= lo && intv <= hi) {
                                val d = abs(intv - expI)
                                if (!plHaveCand || d < plBestDist) { plHaveCand = true; plBestInterval = intv; plBestDist = d }
                            }
                            shouldFireTick = false   // defer; decide at window close
                        }
                        if (ringPosSinceLastTick > hi) {
                            if (plHaveCand) {
                                plPendingCarry = ringPosSinceLastTick - plBestInterval
                                plApplyCarry = true
                                ringPosSinceLastTick = plBestInterval   // fire path reads this as the interval
                                shouldFireTick = true
                                plMissCount = 0
                            } else {
                                plMissCount += 1
                                ringPosSinceLastTick -= expI            // re-predict next beat
                                if (plMissCount >= phaseLockMaxMiss) { lastTickRingPos = -1; plMissCount = 0 }
                            }
                            plHaveCand = false; plBestDist = Int.MAX_VALUE
                        }
                    }

                    if (shouldFireTick) {
                        val intInterval = ringPosSinceLastTick
                        val elapsedSec = (sampleCounter - tickStartSample).toDouble() / actualSampleRate

                        // Sub-sample peak interpolation: parabolic fit on 3 energy values
                        var tickFracOffset = 0.0
                        if (intInterval >= 3) {
                            val ring = energyRings[activeHpIndex]
                            val n = (energyRingWritePos - 1 + energyRingCapacity) % energyRingCapacity
                            val nm1 = (n - 1 + energyRingCapacity) % energyRingCapacity
                            val nm2 = (n - 2 + energyRingCapacity) % energyRingCapacity
                            val en = ring[n].toDouble()
                            val enm1 = ring[nm1].toDouble()
                            val enm2 = ring[nm2].toDouble()

                            if (enm1 >= en && enm1 >= enm2 && enm1 > 0) {
                                // Peak at nm1: parabola through nm2(-1), nm1(0), n(+1)
                                val d = enm2 - 2.0 * enm1 + en
                                if (abs(d) > 1e-10) {
                                    val p = 0.5 * (enm2 - en) / d // offset from nm1
                                    tickFracOffset = -1.0 + max(-0.5, min(0.5, p))
                                } else {
                                    tickFracOffset = -1.0
                                }
                            }
                            // else: peak at current position, offset = 0
                        }

                        // Fractional interval = integer interval + this offset - last offset
                        val actualInterval = intInterval.toDouble() + tickFracOffset - lastTickFracOffset
                        lastTickFracOffset = tickFracOffset

                        if (lastTickRingPos >= 0) {
                            // Outlier gate: wider for low-BPH (longer intervals = more timing jitter)
                            val margin = if (targetBph <= 21600) outlierMarginLowBph else outlierMargin
                            val ratio = actualInterval / expectedTickInterval
                            if (ratio < (1.0 - margin) || ratio > (1.0 + margin)) {
                                // Outlier — skip this tick, don't update deviation or regression
                                debugLog("[TGTICK SKIP @ ${cf(elapsedSec, 2)}s] interval=${cf(actualInterval, 1)} ratio=${cf(ratio, 3)} OUTLIER")

                                // Track consistent outliers for BPH correction
                                bphCorrectionOutliers.add(ratio)
                                if (bphCorrectionOutliers.size >= 8 && bphCorrectionCount < maxBphCorrections) {
                                    val ratios = bphCorrectionOutliers.takeLast(8)
                                    val meanRatio = ratios.sum() / ratios.size.toDouble()
                                    val variance = ratios.sumOf { (it - meanRatio) * (it - meanRatio) } / ratios.size.toDouble()
                                    val stddev = sqrt(variance)
                                    if (stddev < 0.05) {
                                        val impliedBph = roundAway(targetBph.toDouble() / meanRatio).toInt()
                                        var bestCandidate: Int? = null
                                        var bestDist = Int.MAX_VALUE
                                        for (candidate in bphCandidates) {
                                            val dist = abs(candidate - impliedBph)
                                            if (dist < bestDist && candidate != targetBph) {
                                                bestDist = dist
                                                bestCandidate = candidate
                                            }
                                        }
                                        val newBph = bestCandidate
                                        if (newBph != null && bestDist.toDouble() / impliedBph.toDouble() < 0.15) {
                                            debugLog("[TGBPH CORRECT OUTLIER] consistent ratio=${cf(meanRatio, 3)} (stddev=${cf(stddev, 3)}) implies $impliedBph BPH → switching to $newBph")
                                            bphCorrectionAttempted.add(targetBph)
                                            bphCorrectionAttempted.add(newBph)
                                            bphCorrectionCount += 1
                                            targetBph = newBph
                                            detectedBph = newBph
                                            tickDetectionActive = false
                                            activateTickDetection(ringSampleRate = ringSR)
                                            lastTickRingPos = energyRingWritePos
                                            ringPosSinceLastTick = 0
                                            continue
                                        } else {
                                            bphCorrectionOutliers.clear()
                                        }
                                    }
                                }

                                lastTickRingPos = energyRingWritePos
                                ringPosSinceLastTick = 0
                            } else {
                                bphCorrectionOutliers.clear()
                                val deviationThisTick = (expectedTickInterval - actualInterval) / ringSR * 1000.0

                                // Individual tick deviation sanity check
                                if (abs(deviationThisTick) > maxTickDev) {
                                    debugLog("[TGTICK DEV_SKIP @ ${cf(elapsedSec, 2)}s] dev=${cf(deviationThisTick, 1)}ms maxTickDev=${cf(maxTickDev, 1)}ms")
                                    // If mid-pair, discard the pair
                                    if (pairTickPhase == 1) {
                                        pairIntervalAccum = 0.0
                                        pairTickPhase = 0
                                    }
                                    lastTickRingPos = energyRingWritePos
                                    ringPosSinceLastTick = 0
                                    continue
                                }

                                // Track individual tick deviations for beat error estimation
                                recentTickDevs.add(deviationThisTick)
                                if (recentTickDevs.size > beatErrorWindowSize) {
                                    recentTickDevs.removeAt(0)
                                }
                                // Estimate beat error: median of |tickDev| (alternating +-BE pattern)
                                if (recentTickDevs.size >= 10) {
                                    val absDevs = recentTickDevs.map { abs(it) }.sorted()
                                    knownBeatError = absDevs[absDevs.size / 2]
                                }

                                // Phase-separated beat error: split signed devs by skip-robust parity,
                                // BE = |mean(phase0) - mean(phase1)|. Only clean 1-step intervals contribute;
                                // skips advance the parity counter (>=2 steps) so phase never desyncs.
                                val beSteps = max(1, roundAway(actualInterval / expectedTickInterval).toInt())
                                tickPhaseIndex += beSteps
                                if (beSteps == 1) {
                                    val beP = tickPhaseIndex and 1
                                    beDevsByParity[beP].add(deviationThisTick)
                                    if (beDevsByParity[beP].size > beBucketWindow) beDevsByParity[beP].removeAt(0)
                                    if (beDevsByParity[0].size >= beMinPerBucket && beDevsByParity[1].size >= beMinPerBucket) {
                                        val beM0 = beDevsByParity[0].sum() / beDevsByParity[0].size.toDouble()
                                        val beM1 = beDevsByParity[1].sum() / beDevsByParity[1].size.toDouble()
                                        phaseSepBeatError = roundAway(abs(beM0 - beM1) * 100) / 100
                                    }
                                }

                                // Pair-based: accumulate 2 ticks, validate pair before plotting
                                pairIntervalAccum += actualInterval
                                pairTickPhase += 1

                                if (pairTickPhase == 1) {
                                    // First tick of pair — stash info, don't plot yet
                                    pendingFirstTickDev = deviationThisTick
                                    pendingFirstTickTime = elapsedSec
                                    pendingFirstTickInterval = actualInterval
                                    pendingFirstTickEnergy = energy
                                    lastTickRingPos = energyRingWritePos
                                    ringPosSinceLastTick = 0
                                    continue  // wait for second tick
                                }

                                // Second tick — validate the pair
                                val pairExpected = expectedTickInterval * 2.0
                                val pairDevThisPair = (pairExpected - pairIntervalAccum) / ringSR * 1000.0

                                // Track pair deviations for adaptive threshold (used for debug logging)
                                recentPairDevs.add(abs(pairDevThisPair))
                                if (recentPairDevs.size > adaptiveWindowSize) {
                                    recentPairDevs.removeAt(0)
                                }
                                val pairThresh = currentPairThreshold()

                                // Phase recovery: detect mis-phased pairs (tick+tick or tock+tock)
                                // Match pairDev ~ 1x or 2x beatError (+-40%):
                                //   1x occurs when same-phase ticks pair up
                                //   2x occurs when both tick and tock are detected (alternating intervals)
                                val absDev = abs(pairDevThisPair)
                                val isMisPhased = knownBeatError >= 1.0 && (
                                    (absDev >= knownBeatError * 0.6 && absDev <= knownBeatError * 1.4) ||
                                        (absDev >= knownBeatError * 1.6 && absDev <= knownBeatError * 2.4)
                                    )

                                if (isMisPhased) {
                                    consecutivePairRejects += 1
                                    rejectDevSum += abs(pairDevThisPair)
                                    debugLog("[TGPHASE REJECT #$consecutivePairRejects @ ${cf(elapsedSec, 2)}s] pairDev=${cf(pairDevThisPair, 3)}ms beatErr=${cf(knownBeatError, 1)}ms")

                                    if (consecutivePairRejects >= 2) {
                                        // Phase flip confirmed — skip one tick to realign
                                        // Keep current tick as "first" of next pair
                                        debugLog("[TGPHASE RECOVER @ ${cf(elapsedSec, 2)}s] skipping tick to realign after $consecutivePairRejects rejects, avgDev=${cf(rejectDevSum / consecutivePairRejects.toDouble(), 1)}ms")
                                        pairTickPhase = 1
                                        pairIntervalAccum = actualInterval
                                        pendingFirstTickDev = deviationThisTick
                                        pendingFirstTickTime = elapsedSec
                                        pendingFirstTickInterval = actualInterval
                                        pendingFirstTickEnergy = energy
                                        consecutivePairRejects = 0
                                        rejectDevSum = 0.0
                                        lastTickRingPos = energyRingWritePos
                                        ringPosSinceLastTick = 0
                                        continue  // wait for second tick of realigned pair
                                    }

                                    // Not enough rejects yet — discard this pair, reset for next
                                    pairIntervalAccum = 0.0
                                    pairTickPhase = 0
                                    lastTickRingPos = energyRingWritePos
                                    ringPosSinceLastTick = 0
                                    continue
                                }

                                // Not mis-phased — reset phase reject streak
                                consecutivePairRejects = 0
                                rejectDevSum = 0.0

                                // Pair gate: reject pairs with deviation above adaptive threshold
                                // Use tighter threshold for first 10 pairs after skip (adaptive not yet reliable)
                                val effectiveThresh = pairThresh
                                if (abs(pairDevThisPair) > effectiveThresh) {
                                    debugLog("[TGTICK PAIR_REJECT @ ${cf(elapsedSec, 2)}s] pairDev=${cf(pairDevThisPair, 3)}ms thresh=${cf(effectiveThresh, 2)}ms")

                                    // Adaptive BPH correction: track consistent pair deviations
                                    // Guard: don't trigger during cold start (first 5s of tick detection)
                                    bphCorrectionRejects.add(pairDevThisPair)
                                    if (bphCorrectionRejects.size >= 8 && bphCorrectionCount < maxBphCorrections && elapsedSec >= 5.0) {
                                        val devs = bphCorrectionRejects.takeLast(8)
                                        val meanDev = devs.sum() / devs.size.toDouble()
                                        val variance = devs.sumOf { (it - meanDev) * (it - meanDev) } / devs.size.toDouble()
                                        val stddev = sqrt(variance)
                                        // Consistent if stddev < 30% of |mean| and mean is significant (>2ms)
                                        if (abs(meanDev) > 2.0 && stddev < abs(meanDev) * 0.3) {
                                            val ringSR2 = actualSampleRate / ringSubsampleTarget.toDouble() // Swift shadows ringSR here (same value)
                                            val actualPairSamples = expectedTickInterval * 2.0 - (meanDev * ringSR2 / 1000.0)
                                            val actualTickHz = ringSR2 / (actualPairSamples / 2.0)
                                            val impliedBph = roundAway(actualTickHz * 3600.0).toInt()
                                            // Find nearest standard BPH candidate
                                            var bestCandidate: Int? = null
                                            var bestDist = Int.MAX_VALUE
                                            for (candidate in bphCandidates) {
                                                val dist = abs(candidate - impliedBph)
                                                if (dist < bestDist && !bphCorrectionAttempted.contains(candidate) && candidate != targetBph) {
                                                    bestDist = dist
                                                    bestCandidate = candidate
                                                }
                                            }
                                            // Switch if nearest candidate is within 15% of implied BPH
                                            val newBph = bestCandidate
                                            if (newBph != null && bestDist.toDouble() / impliedBph.toDouble() < 0.15) {
                                                debugLog("[TGBPH CORRECT] consistent pairDev=${cf(meanDev, 1)}ms (stddev=${cf(stddev, 1)}ms) implies $impliedBph BPH → switching to $newBph")
                                                bphCorrectionAttempted.add(targetBph)
                                                bphCorrectionAttempted.add(newBph)
                                                bphCorrectionCount += 1
                                                targetBph = newBph
                                                detectedBph = newBph
                                                // Restart tick detection with new BPH
                                                tickDetectionActive = false
                                                activateTickDetection(ringSampleRate = ringSR2)
                                                lastTickRingPos = energyRingWritePos
                                                ringPosSinceLastTick = 0
                                                continue
                                            } else {
                                                // No standard BPH matches — likely a calibration issue
                                                // (threshold too high, only detecting every Nth tick)
                                                // Force softer recalibration if not already exhausted
                                                debugLog("[TGBPH REJECT] implied $impliedBph BPH — no standard candidate. Forcing soft recalibration.")
                                                bphCorrectionRejects.clear()
                                                if (recalibrationsDone < maxRecalibrations && !tgHasRecentLock()) {
                                                    recalibrationsDone += 1
                                                    tickCalibrating = true
                                                    plHaveCand = false; plBestDist = Int.MAX_VALUE; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
                                                    calibrationSamples = 0
                                                    calibrationEnergies.clear()
                                                    tickThreshold = 0f
                                                    tickCount = 0
                                                    pairIntervalAccum = 0.0; pairTickPhase = 0
                                                    lastTickRingPos = -1
                                                    ringPosSinceLastTick = 0
                                                    continue
                                                }
                                            }
                                        }
                                    }

                                    pairIntervalAccum = 0.0
                                    pairTickPhase = 0
                                    lastTickRingPos = energyRingWritePos
                                    ringPosSinceLastTick = 0
                                    continue
                                }

                                pairIntervalAccum = 0.0
                                pairTickPhase = 0
                                bphCorrectionRejects.clear()

                                // Update tick count
                                tickCount += 2
                                totalPairsAccepted += 1

                                // Skip first N pairs entirely (threshold still adapting,
                                // early pairs can have huge deviations that corrupt cumulative tracking)
                                if (totalPairsAccepted <= regressionSkipPairs) {
                                    debugLog("[TGTICK SKIP-EARLY #$tickCount @ ${cf(elapsedSec, 2)}s] pairDev=${cf(pairDevThisPair, 3)}ms (skipped, pair $totalPairsAccepted/$regressionSkipPairs)")
                                    lastTickRingPos = energyRingWritePos
                                    ringPosSinceLastTick = 0
                                    continue
                                }

                                // Accumulate cumulative deviation only after skip period
                                pairDeviationMs += pairDevThisPair
                                regPoints.add(RegPoint(x = elapsedSec, y = pairDeviationMs))
                                regN = regPoints.size

                                // Plot single dot at pair midpoint using cumulative pairDev
                                val pairMidTime = (pendingFirstTickTime + elapsedSec) / 2.0
                                pendingTicks.add(TickDot(timeSec = pairMidTime, deviationMs = pairDeviationMs))
                                debugLog("[TGTICK #$tickCount @ ${cf(pairMidTime, 2)}s] pairDev=${cf(pairDevThisPair, 3)}ms cumPairDev=${cf(pairDeviationMs, 3)}ms thresh=${cf(pairThresh, 2)}ms beatErr=${cf(knownBeatError, 1)}ms ticks=${cf(pendingFirstTickDev, 1)},${cf(deviationThisTick, 1)}ms psBE=${phaseSepBeatError?.let { cf(it, 2) } ?: "-"}ms foldedBE=${currentBeatError?.let { cf(it, 2) } ?: "-"}ms energy=${cf(energy.toDouble(), 6)}")

                                // Debug: log regression rate every 25 pairs (~50 ticks)
                                if (regN % 25 == 0 && regN >= 20) {
                                    val slope = theilSenSlope()
                                    if (slope != null) {
                                        val regRate = slope * 86.4
                                        debugLog("[TGRATE @ tick $tickCount] regN=$regN slope=${cf(slope, 6)}ms/s rate=${cf(regRate, 1)}s/day pairDev=${cf(pairDeviationMs, 3)}ms")
                                    }
                                }

                                // Sanity check every 100 ticks
                                if (tickCount - lastTickCountCheck >= 100 && lastTickCountCheck > 0) {
                                    val dtCheck = max(1.0, elapsedSec)
                                    val deviationRate = abs(pairDeviationMs) / dtCheck
                                    if (deviationRate > 50.0) {
                                        debugLog("[TGSANITY RESET] devRate=${cf(deviationRate, 1)}ms/s pairDev=${cf(pairDeviationMs, 1)}ms")
                                        tickDetectionActive = false
                                        pendingTicks.clear()
                                        tickCount = 0
                                        tickDeviationMs = 0.0
                                        pairDeviationMs = 0.0; pairIntervalAccum = 0.0; pairTickPhase = 0; lastTickFracOffset = 0.0
                                        pendingTickCross = false; pendingTickPeakEnergy = 0f; plHaveCand = false; plBestDist = Int.MAX_VALUE; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
                                        consecutivePairRejects = 0; rejectDevSum = 0.0; knownBeatError = 0.0; recentTickDevs.clear(); tickPhaseIndex = 0
                                        beDevsByParity[0].clear(); beDevsByParity[1].clear(); phaseSepBeatError = null
                                        regPoints.clear(); regN = 0; recentPairDevs.clear(); totalPairsAccepted = 0
                                        smoothedRate = null; lastUpdateLogRegN = 0; rateHistory.clear(); wasStable = false
                                        if (autoBph) { detectedBph = null; consecutiveFailures = 0 }
                                    }
                                    lastTickCountCheck = tickCount
                                    lastTickDeviationCheck = pairDeviationMs
                                }
                            }
                        } else {
                            // First tick — reference point, no plot (will be part of first pair)
                            debugLog("[TGTICK FIRST @ ${cf(elapsedSec, 2)}s] energy=${cf(energy.toDouble(), 6)} threshold=${cf(threshold.toDouble(), 6)}")
                        }
                        lastTickRingPos = energyRingWritePos
                        ringPosSinceLastTick = 0
                    }
                }
            }
        }

        // Analyze every ~1 second, after at least 5 seconds of data
        // Run on background executor to avoid blocking the capture thread.
        // Design delta 2: `now` is AUDIO time (Swift: CACurrentMediaTime) so replays are deterministic.
        val now = sampleCounter.toDouble() / actualSampleRate * 1000
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        val elapsedSec = energyRingCount.toDouble() / ringSampleRate
        if (now - lastAnalysisTime > 1000 && elapsedSec >= 5 && !isAnalyzing) {
            lastAnalysisTime = now
            isAnalyzing = true
            // Snapshot ring data for background analysis
            val snapCount = energyRingCount
            val signals = (0 until 3).map { f -> linearize(ringIndex = f, count = snapCount) }
            val ex = analysisExecutor
            if (ex == null) {
                analyze(signals = signals, count = snapCount, ringSampleRate = ringSampleRate)
                isAnalyzing = false
            } else {
                ex.execute {
                    analyze(signals = signals, count = snapCount, ringSampleRate = ringSampleRate)
                    isAnalyzing = false
                }
            }
        }

        emitUpdate()
    }

    /**
     * Minimal Update assembly so part A's state is observable. Task 6 adds the tg
     * compute/caching block and stability/convergence (Swift 1276-1349); Task 7 replaces this
     * with the full assembly (Swift 1268-1274 + 1350-1394: regression rate, TGUPDATE log,
     * T3/T4 surface state). Until then rate is null and rateStable false.
     */
    private fun emitUpdate() {
        // Drain pending ticks
        var ticks: List<TickDot> = ArrayList(pendingTicks)
        if (useTgAlgo) { ticks = ArrayList(tgPendingDots); tgPendingDots.clear() } // tg path: dots come from the tg grid, not the detector
        pendingTicks.clear()

        val wallElapsed = (sampleCounter - tickStartSample).toDouble() / actualSampleRate
        // Confidence based on pair count
        val tickConfidence = if (regN >= 5) min(0.99, regN.toDouble() / 250.0 + 0.3) else 0.0
        // Drain debug messages
        val dbgMsgs = drainDebugMessages()

        val update = Update(
            rate = null, // Task 6/7
            beatError = if (useTgAlgo) tgBeCached else currentBeatError,
            tickCount = tickCount,
            confidence = tickConfidence, noiseLevel = currentNoiseLevel,
            detectedIntervalMs = if (expectedTickInterval > 0) 1000.0 / (actualSampleRate / ringSubsampleTarget.toDouble() / expectedTickInterval) else 0.0,
            detectedBph = detectedBph,
            debug = lastDebugInfo,
            beatWaveform = if (useTgAlgo) (tgFoldCached ?: lastBeatWaveform) else lastBeatWaveform,
            amplitude = if (useTgAlgo) tgAmpCached else null,
            tickPositions = lastTickPositions,
            cumulativeOffset = pairDeviationMs,
            elapsedSec = wallElapsed,
            method = if (regN >= regNMinimum) "Ticks" else "",
            rateStable = false, // Task 6
            tgSignalQuality = null, // Task 6/7
            tgAcquiring = false, // Task 6/7
            newTicks = ticks,
            debugMessages = dbgMsgs,
        )
        onUpdate?.invoke(update)
    }

    // MARK: - Combined analysis: Goertzel primary + autocorrelation fallback

    /** Task 7: Swift analyze (1399-1443) — auto-BPH and epoch-fold beat error. */
    @Suppress("UNUSED_PARAMETER")
    private fun analyze(signals: List<FloatArray>, count: Int, ringSampleRate: Double) {
        // Task 7
    }

    private fun activateTickDetection(ringSampleRate: Double) {
        if (tickDetectionActive) return
        tickDetectionActive = true
        expectedTickInterval = ringSampleRate / (targetBph.toDouble() / 3600.0)
        tickDeviationMs = 0.0
        lastTickRingPos = -1
        ringPosSinceLastTick = 0
        tickCount = 0
        pendingTicks.clear()
        tickDebugInterval = 0
        pairIntervalAccum = 0.0; pairTickPhase = 0; pairDeviationMs = 0.0
        lastTickFracOffset = 0.0
        recentPairDevs.clear()
        pendingTickCross = false; pendingTickPeakEnergy = 0f; plHaveCand = false; plBestDist = Int.MAX_VALUE; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
        consecutivePairRejects = 0; rejectDevSum = 0.0; knownBeatError = 0.0; recentTickDevs.clear(); tickPhaseIndex = 0
        beDevsByParity[0].clear(); beDevsByParity[1].clear(); phaseSepBeatError = null
        bphCorrectionOutliers.clear()
        // Note: bphCorrectionRejects intentionally NOT cleared — accumulates across recalibrations
        smoothedRate = null; lastUpdateLogRegN = 0; rateHistory.clear(); wasStable = false
        regPoints.clear(); regN = 0; totalPairsAccepted = 0
        // Start calibration: observe energy for 2s to learn tick amplitude before accepting ticks
        // Always calibrate for 2 seconds regardless of ring rate or JS-supplied value
        val calibSamples = (ringSampleRate * 2.0).toInt()
        calibrationDuration = calibSamples
        tickThreshold = 0f
        tickCalibrating = true
        calibrationSamples = 0
        calibrationEnergies.clear()
        recalibrationsDone = 0
        tickStartSample = sampleCounter
        debugLog("[TGACTIVATE] bph=$targetBph autoBph=$autoBph expectedInterval=${cf(expectedTickInterval, 1)} ringSR=${cf(ringSampleRate, 0)} CALIBRATING for $calibrationDuration samples")
    }

    // MARK: - Linearize ring buffer

    private fun linearize(ringIndex: Int, count: Int): FloatArray {
        val f = ringIndex
        val signal = FloatArray(count)
        for (i in 0 until count) {
            val idx = (energyRingWritePos - count + i + energyRingCapacity) % energyRingCapacity
            signal[i] = energyRings[f][idx]
        }
        return signal
    }
}
