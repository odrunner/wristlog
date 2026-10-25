package com.wrotate.engine

// TG_ENGINE_REV: 2

import java.util.concurrent.Executor
import kotlin.math.PI
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
    val tgStabFresh: Int? = null,
    val tgBphDecisive: Double? = null,
    // Engine-set telemetry (not knobs): logged as trailing cap=/model= tokens on [TGTUNE], Android only.
    val captureSource: String? = null,
    val deviceModel: String? = null,
)

/** Swift `x.rounded()` / C `round()`: half away from zero (kotlin.math.round is half-even). */
private fun roundAway(x: Double): Double {
    val t = truncate(x)
    return if (abs(x - t) >= 0.5) t + (if (x < 0) -1.0 else 1.0) else t
}

class TimegrapherCore(
    private val analysisExecutor: Executor? = null, // null = synchronous analyze inside process() (tests AND the harness app use null); a non-null executor reproduces Swift's analysisQueue race with process() - callers must serialise the two externally
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
    private var lastRateSeenSec: Double = -1.0       // wall time of the last non-null rate (stability-honesty gap drop)
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

    // MARK: - tg-path knobs and state (Swift 1691-1729). Declared here because setTuning,
    // the [TGTUNE] echo, start()'s reset and the recalibration branch reference them; the tg
    // core that drives them is at the end of the class.

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
    private var tgStabFresh = 0         // stability-honesty (2026-10-25): 1 = only fresh tg computes join rateHistory and the stable flag drops across rate gaps; 0 = ship behaviour (every buffer re-counts the ~0.5s-cached rate, flag survives gaps)
    private var tgBphDecisive = 1.5     // auto-BPH noise gate (2026-10-25): best candidate must beat the runner-up by this ratio before locking; 1.5 = ship behaviour

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
        t.tgStabFresh?.let { v -> if (v >= 0 && v <= 1) this.tgStabFresh = v }
        t.tgBphDecisive?.let { v -> if (v >= 1 && v <= 5) this.tgBphDecisive = v }
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
                " gateMaxRej=${swiftDesc(this.tgGateMaxRej)} acquireMax=${swiftDesc(this.tgAcquireMaxSec)}" +
                " stabFresh=${this.tgStabFresh} bphDecisive=${swiftDesc(this.tgBphDecisive)}" +
                (t.captureSource?.let { " cap=$it" } ?: "") +
                (t.deviceModel?.let { " model=$it" } ?: ""),
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
        smoothedRate = null; lastUpdateLogRegN = 0; rateHistory.clear(); wasStable = false; lastRateSeenSec = -1.0
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

    /// The non-AVAudio parts of Swift rebuildAudioAfterInterruption (648-694). The capture
    /// layer tears down and rebuilds the dead capture itself, then calls this with the rate
    /// the new capture actually runs at, before feeding it to process(). `reason` lands in
    /// the [TGAUDIO RESUME] line as in Swift (e.g. "interruption-ended", "route-change-1").
    ///
    /// Pre-gap audio is discarded (energyRingCount = 0) so no analysis window ever spans the
    /// seam — the tg windows refill from fresh audio within seconds; the tick detector
    /// recalibrates. A confirmed T1 lock survives (the watch didn't change); an unconfirmed
    /// pending one is cleared rather than confirmed across a gap of unknown length.
    fun onCaptureRestart(newSampleRate: Double, reason: String = "capture-restart") {
        if (!isRunning) return
        val rateChanged = abs(newSampleRate - actualSampleRate) > actualSampleRate * 0.01
        if (rateChanged) {
            // New input hardware (e.g. AirPods mic) — re-derive everything that
            // hangs off the sample rate, exactly as start() does.
            actualSampleRate = newSampleRate
            hpFilters = Array(hpCutoffs.size) { makeBiquadHP(cutoff = hpCutoffs[it], sampleRate = actualSampleRate) }
            ringSubsampleTarget = max(1, (actualSampleRate / ringTargetRate).toInt())
            val rsr = actualSampleRate / ringSubsampleTarget.toDouble()
            energyRingCapacity = (rsr * bufferDurationSec.toDouble()).toInt()
            energyRings = Array(3) { FloatArray(energyRingCapacity) }
            energyRingWritePos = 0
        }
        energyRingCount = 0                     // discard pre-gap audio; abs counter stays monotonic
        tgRateCached = null; tgBeCached = null; tgAmpCached = null; tgFoldCached = null
        if (!tgLockConfirmed) { tgPendingLockRate = null; tgPendingLockAbs = -1 }
        // Audio-clock ppm estimator anchors are pre-gap — restart it.
        clkHaveFirst = false; clkFirstHost = 0; clkFirstFrames = 0; clkFrames = 0; clkLastLogSec = -1.0; clkPpm = null
        clkN = 0; clkSh = 0.0; clkSf = 0.0; clkShh = 0.0; clkShf = 0.0
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        if (tickDetectionActive || !autoBph) {
            tickDetectionActive = false          // force a fresh calibration pass
            activateTickDetection(ringSampleRate = ringSampleRate)
        }
        debugLog("[TGAUDIO RESUME] $reason rate=${cf(actualSampleRate, 0)} rateChanged=$rateChanged")
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
                                        smoothedRate = null; lastUpdateLogRegN = 0; rateHistory.clear(); wasStable = false; lastRateSeenSec = -1.0
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

    /** Swift processAudioBuffer tail (1267-1394): tick drain, tg compute, rate, stability, Update. */
    private fun emitUpdate() {
        // Drain pending ticks
        var ticks: List<TickDot> = ArrayList(pendingTicks)
        if (useTgAlgo) { ticks = ArrayList(tgPendingDots); tgPendingDots.clear() } // tg path: dots come from the tg grid, not the detector
        pendingTicks.clear()

        // Compute rate from Theil-Sen median regression on ALL accepted pairs
        var rateForUpdate: Double? = null
        val wallElapsed = (sampleCounter - tickStartSample).toDouble() / actualSampleRate
        // Elapsed rewinds whenever tickStartSample moves forward (capture rebuild after a
        // route change / interruption, or a recalibration restart). The stale markers then
        // sit ahead of the clock and blank the tg rate + [TGALGO] for the prior session
        // length (Android-port finding, 2026-10-25).
        if (lastTgComputeSec > wallElapsed) { lastTgComputeSec = -1.0; lastTgLogSec = -1.0 }
        // tg rate is expensive (FFT over up to 16s of ring) — refresh at most ~2x/sec and cache.
        var tgRateFresh = false
        if (wallElapsed - lastTgComputeSec > 0.5) {
            tgRateFresh = true
            lastTgComputeSec = wallElapsed
            tgRateCached = computeTgRate()
            // Fold + amplitude compute even when the toggle is off, so silent/shadow
            // sessions log amplitude in [TGALGO] too. Display stays gated on useTgAlgo.
            val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
            val nominal = 7200.0 / targetBph.toDouble() * ringSampleRate
            val env8 = recentEnvelope((ringSampleRate * 8).toInt())
            val period = tgPeriod(env8, nominal = nominal, ringSampleRate = ringSampleRate)
            if (period != null) {
                val fold = tgFoldedBeat(period = period)
                if (fold != null) {
                    tgFoldCached = fold
                    tgAmpCached = tgAmplitude(rawFold = fold, period = period)
                    tgBeCached = tgBeatError(fold = fold, period = period, ringSampleRate = ringSampleRate)
                }
                if (useTgAlgo) tgTrackDots(period = period, ringSampleRate = ringSampleRate, wallElapsed = wallElapsed)
            }
        }
        // Pick the rate source: tg autocorrelation-period (when toggled) or Theil-Sen regression.
        val regRateLog: Double? = if (regN >= regNMinimum) theilSenSlope()?.let { it * 86.4 } else null
        var candidate: Double? = null
        if (useTgAlgo) {
            candidate = tgRateCached
        } else if (regRateLog != null && abs(regRateLog) <= 200.0) {
            candidate = regRateLog
        }
        if (candidate != null) {
            val r: Double = candidate
            smoothedRate = r
            rateForUpdate = roundAway(r * 10) / 10
            lastRateSeenSec = wallElapsed
            // Track rate history for stability detection. stability-honesty (tgStabFresh=1):
            // the tg rate is cached ~0.5 s, so counting it once per audio buffer lets a single
            // reading accrue many "confirmations" — only a fresh compute may join the history.
            if (tgStabFresh == 0 || !useTgAlgo || tgRateFresh) {
                rateHistory.add(RatePoint(time = wallElapsed, rate = r))
                // Prune old entries beyond stability window
                rateHistory.removeAll { wallElapsed - it.time > stabilityWindow + 5 }
            }
        }
        // Log BOTH rates every ~2s so we get a free offline A/B even when the toggle is off.
        if (wallElapsed - lastTgLogSec > 2.0) {
            lastTgLogSec = wallElapsed
            // win= is the analysis window the headline rate came from and gate= the running
            // sigma-gate rejection count: without them a bad reading could not be attributed
            // to a short window after the fact (audit 2026-07-31).
            debugLog(
                "[TGALGO @ ${cf(wallElapsed, 0)}s] useTg=$useTgAlgo reg=${regRateLog?.let { cf(it, 1, plus = true) } ?: "nil"}" +
                    " tg=${tgRateCached?.let { cf(it, 1, plus = true) } ?: "nil"} amp=${tgAmpCached?.let { cf(it, 0) } ?: "nil"}" +
                    " be=${tgBeCached?.let { cf(it, 2) } ?: "nil"} beOn=${tgBeOnsetCached?.let { cf(it, 2) } ?: "nil"}" +
                    " win=${cf(tgLastWindowSec, 0)}s gate=$tgGateRejects ga=$tgGateAttempts fit=$tgPeriodFit" +
                    " lc=${if (tgLockConfirmed) 1 else 0} lr=$tgLockRejects ppm=${clkPpm?.let { cf(it, 2, plus = true) } ?: "nil"}",
            )
        }

        // Stability: rate has stayed within +-threshold for the full stability window
        // Uses hysteresis: easier to gain stability (3 s/day), harder to lose it (5 s/day)
        var isStable = wasStable
        if (smoothedRate != null) {
            // tg's rate is a precise per-window period measurement that settles fast, so it can
            // converge on a much shorter window/wall-min than the regression's slow slope.
            val effWindow = if (useTgAlgo) tgStabWindowSec else stabilityWindow
            val effWallMin = if (useTgAlgo) tgWallMinSec else wallElapsedMinimum
            val effThresh = if (useTgAlgo) tgStabThresh else stabilityThreshold
            val recentRates = rateHistory.filter { wallElapsed - it.time <= effWindow }
            if (recentRates.size >= 5 && wallElapsed >= effWallMin) {
                val rateMin = recentRates.minOf { it.rate }
                val rateMax = recentRates.maxOf { it.rate }
                val spread = rateMax - rateMin
                isStable = if (wasStable) {
                    spread <= (if (useTgAlgo) tgStabThresh * 1.7 else stabilityLoseThreshold)
                } else {
                    spread <= effThresh
                }
            }
        }
        // stability-honesty (tgStabFresh=1): the flag must not survive a rate gap — no rate
        // for >2s means the engine lost the signal, and "stable" would describe stale data.
        if (tgStabFresh == 1 && isStable && lastRateSeenSec >= 0 && wallElapsed - lastRateSeenSec > 2.0) {
            isStable = false
        }
        // T1/T3 (dark at ship defaults): a tg session cannot GAIN stability on an
        // unconfirmed lock, nor while the sigma-gate is rejecting most windows. The rate
        // series is built from overlapping reads of one ring, so its "stability" cannot
        // distinguish a right lock from a confident wrong one — the disjoint-segment
        // confirmation can. Losing stability is unaffected.
        if (useTgAlgo && isStable && !wasStable) {
            if (tgConfirmBand < 900 && !tgLockConfirmed) isStable = false
            if (tgGateMaxRej < 1.0) {
                val rf = tgGateRejFraction()
                if (rf != null && rf > tgGateMaxRej) isStable = false
            }
        }
        wasStable = isStable

        // Confidence based on pair count
        val tickConfidence = if (regN >= 5) min(0.99, regN.toDouble() / 250.0 + 0.3) else 0.0

        // Debug: log rate update every 8 new pairs
        if (regN > 0 && regN - lastUpdateLogRegN >= 8) {
            lastUpdateLogRegN = regN
            debugLog("[TGUPDATE] elapsed=${cf(wallElapsed, 1)}s rate=${rateForUpdate?.let { cf(it, 1) } ?: "nil"} stable=$isStable conf=${cf(tickConfidence, 2)} regN=$regN tickCount=$tickCount cumDev=${cf(pairDeviationMs, 2)}ms")
        }

        // Drain debug messages
        val dbgMsgs = drainDebugMessages()

        // T3/T4 surface state (inert until the knobs are flipped; JS ignores unknown keys)
        var sigQuality: String? = null
        if (useTgAlgo) {
            val rf = tgGateRejFraction()
            if (rf != null) {
                sigQuality = if (rf > 0.5) "poor" else (if (rf > 0.2) "fair" else "good")
            } else if (tgRateCached != null) {
                sigQuality = "good"
            }
        }
        val acquiring = useTgAlgo && tgRateCached == null &&
            wallElapsed < tgAcquireMaxSec && tgActivelyEvaluating()

        val update = Update(
            rate = rateForUpdate,
            // tg path: fold-based BE; legacy folded estimate: stable in the field. phaseSepBeatError rides per-tick devs that phase-walk (climb+flip) when watch rate != nominal BPH — kept for logging only (psBE= in TGTICK).
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
            rateStable = isStable,
            tgSignalQuality = sigQuality,
            tgAcquiring = acquiring,
            newTicks = ticks,
            debugMessages = dbgMsgs,
        )
        onUpdate?.invoke(update)
    }

    // MARK: - Combined analysis: Goertzel primary + autocorrelation fallback

    private data class BphRatio(val bph: Int, val ratio: Double)

    /** Swift analyze (1399-1443). Runs on [analysisExecutor], or inline when it is null. */
    private fun analyze(signals: List<FloatArray>, count: Int, ringSampleRate: Double) {
        // Phase 1: Auto BPH detection (only if BPH not yet locked)
        if (autoBph && detectedBph == null) {
            // Try all 3 HP cutoffs for better discrimination
            var bestCandidate = BphRatio(0, 0.0)
            var secondBestRatio = 0.0
            for (f in 0 until 3) {
                val ratios = ArrayList<BphRatio>()
                for (candidate in bphCandidates) {
                    val tf = candidate.toDouble() / 3600.0
                    val ratio = goertzelRatio(signals[f], count = count, tickFreq = tf, sampleRate = ringSampleRate)
                    ratios.add(BphRatio(bph = candidate, ratio = ratio))
                }
                // Swift `sort { $0.ratio > $1.ratio }` (stable): comparator on `>` exactly,
                // so -0.0/0.0 tie as in Swift rather than by Double.compareTo.
                ratios.sortWith { a, b -> if (a.ratio > b.ratio) -1 else if (b.ratio > a.ratio) 1 else 0 }
                if (ratios[0].ratio > bestCandidate.ratio) {
                    bestCandidate = ratios[0]
                    secondBestRatio = if (ratios.size > 1) ratios[1].ratio else 0.0
                }
            }

            // Require: (1) above threshold, (2) decisively better than runner-up (1.5x)
            val elSec = count.toDouble() / ringSampleRate
            debugLog("[TGAUTO BPH @ ${cf(elSec, 1)}s] best=${bestCandidate.bph} ratio=${cf(bestCandidate.ratio, 2)} 2nd=${cf(secondBestRatio, 2)} threshold=${swiftDesc(peakRatioThreshold)} decisive=${bestCandidate.ratio >= secondBestRatio * tgBphDecisive}")
            if (bestCandidate.ratio > peakRatioThreshold.toDouble() && (secondBestRatio < 1.0 || bestCandidate.ratio >= secondBestRatio * tgBphDecisive)) {
                targetBph = bestCandidate.bph
                detectedBph = bestCandidate.bph
                debugLog("[TGAUTO BPH LOCKED] ${bestCandidate.bph}")
                activateTickDetection(ringSampleRate = ringSampleRate)
            }
            // If not locked yet, just return — ticks will start once BPH locks
            if (detectedBph == null) {
                recentPeakEnergy *= 0.95f
                return
            }
        }

        // Phase 2: BPH is locked — only compute beat error via epoch folding
        // Rate comes from tick regression (computed in processAudioBuffer), not Goertzel
        if (!tickDetectionActive) {
            activateTickDetection(ringSampleRate = ringSampleRate)
        }
        // Epoch fold for beat error on the lowest HP cutoff signal
        detectTickEvents(signal = signals[0], count = count, ringSampleRate = ringSampleRate)
        recentPeakEnergy *= 0.95f
    }

    // Swift 1455-1461. Unreferenced in Swift too (legacy Goertzel path); ported for 1:1 completeness.
    @Suppress("unused")
    private fun updateCumulativeOffset(rate: Double, elapsedSec: Double) {
        if (lastAnalysisElapsed > 0) {
            val dt = elapsedSec - lastAnalysisElapsed
            cumulativeOffsetMs += (rate / 86400.0) * dt * 1000.0
        }
        lastAnalysisElapsed = elapsedSec
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
        smoothedRate = null; lastUpdateLogRegN = 0; rateHistory.clear(); wasStable = false; lastRateSeenSec = -1.0
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

    // Swift 1495-1520. Unreferenced in Swift too (the Goertzel rate path was superseded by
    // tick regression and then tg); ported for 1:1 completeness.
    @Suppress("unused")
    private fun applyResult(rate: Double, ratio: Double, detectedFreq: Double, ringSampleRate: Double, count: Int) {
        currentRate = roundAway(rate * 10) / 10
        currentDetectedInterval = (1.0 / detectedFreq) * 1000.0
        detectedBph = targetBph

        // Activate tick detection on first successful detection
        consecutiveFailures = 0
        if (!tickDetectionActive) activateTickDetection(ringSampleRate = ringSampleRate)

        val elapsedSec = count.toDouble() / ringSampleRate
        val durationFactor = min(1.0, elapsedSec / 60.0)
        val peakFactor = min(1.0, max(0.0, (ratio - 1.0) / 9.0))
        currentConfidence = min(0.99, roundAway((peakFactor * (0.3 + 0.7 * durationFactor)) * 100) / 100)
        peakCount = if (tickCount > 0) tickCount else (elapsedSec * targetBph.toDouble() / 3600.0).toInt()

        lastDebugInfo = DebugInfo(
            sampleRate = actualSampleRate, fftSize = energyRingCount, bufferSamples = count,
            hpCutoff = hpCutoffs[activeHpIndex].toDouble(), bestLag = targetBph,
            bestCorrelation = ratio, refinedLag = detectedFreq, noiseFloor = 0.0,
            threshold = ratio, peakEnergy = recentPeakEnergy.toDouble(),
            allBphCorrelations = listOf(
                BphCorrelation(bph = targetBph, correlation = ratio.toFloat(), lag = (detectedFreq * 1000).toInt()),
            ),
        )
        recentPeakEnergy *= 0.95f
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

    // MARK: - Goertzel detection + rate sweep
    // (goertzelPower / goertzelRatio live in Goertzel.kt.)

    private data class Detection(val score: Double, val rate: Double?, val detectedFreq: Double)

    /// Returns (ratio, rate, detectedFreq). rate is nil if ratio below threshold.
    /// Swift 1550-1595; unreferenced in Swift too, ported for 1:1 completeness.
    @Suppress("unused")
    private fun tryGoertzel(signal: FloatArray, count: Int, tickFreq: Double, ringSampleRate: Double): Detection {
        val targetPower = goertzelPower(signal, count = count, targetFreq = tickFreq, sampleRate = ringSampleRate)

        val baselineMultipliers = doubleArrayOf(0.73, 0.81, 1.19, 1.37, 1.61)
        var baselineSum = 0.0
        for (mult in baselineMultipliers) {
            baselineSum += goertzelPower(signal, count = count, targetFreq = tickFreq * mult, sampleRate = ringSampleRate)
        }
        val baseline = baselineSum / baselineMultipliers.size.toDouble()
        val ratio = if (baseline > 0) targetPower / baseline else (if (targetPower > 0) 10.0 else 0.0)

        if (!(ratio > peakRatioThreshold.toDouble())) {
            return Detection(ratio, null, tickFreq)
        }

        // Fine frequency sweep +-0.5%
        val sweepRange = tickFreq * 0.005
        val steps = 201
        var bestPower = 0.0
        var bestIdx = steps / 2
        val sweepPowers = DoubleArray(steps)

        for (i in 0 until steps) {
            val f = tickFreq - sweepRange + (2.0 * sweepRange * i.toDouble() / (steps - 1).toDouble())
            val p = goertzelPower(signal, count = count, targetFreq = f, sampleRate = ringSampleRate)
            sweepPowers[i] = p
            if (p > bestPower) { bestPower = p; bestIdx = i }
        }

        val df = 2.0 * sweepRange / (steps - 1).toDouble()
        var detectedFreq = tickFreq - sweepRange + df * bestIdx.toDouble()
        if (bestIdx > 0 && bestIdx < steps - 1) {
            val a = sweepPowers[bestIdx - 1]
            val b = sweepPowers[bestIdx]
            val c = sweepPowers[bestIdx + 1]
            val denom = 2.0 * (2.0 * b - a - c)
            if (abs(denom) > 1e-30) {
                detectedFreq += (a - c) / denom * df
            }
        }

        val rate = ((detectedFreq - tickFreq) / tickFreq) * 86400.0
        return Detection(ratio, if (abs(rate) <= 120.0) rate else null, detectedFreq)
    }

    // MARK: - FFT Autocorrelation fallback

    /// Returns (confidence, rate, detectedFreq). rate is nil if not confident.
    /// Swift 1598-1686; unreferenced in Swift too, ported for 1:1 completeness.
    @Suppress("unused")
    private fun tryAutocorrelation(signal: FloatArray, count: Int, tickFreq: Double, ringSampleRate: Double): Detection {
        // Rectify and remove mean
        val rect = FloatArray(count)
        for (i in 0 until count) rect[i] = abs(signal[i])
        val mean = vdspMean(rect, count)
        val negMean = -mean
        for (i in 0 until count) rect[i] = rect[i] + negMean // vDSP_vsadd

        // Cosine taper (10% each end)
        val tl = (count.toDouble() * 0.1).toInt()
        for (i in 0 until tl) {
            val w = (0.5 * (1.0 - kotlin.math.cos(PI * i.toDouble() / tl.toDouble()))).toFloat()
            rect[i] *= w
            rect[count - 1 - i] *= w
        }

        // FFT autocorrelation (Fft.kt; Swift: Accelerate)
        val acorr = fftAutocorrelation(rect, count)
        if (!(acorr.size >= count)) return Detection(0.0, null, tickFreq)

        // Search for peak near expected period
        val expectedPeriod = ringSampleRate / tickFreq
        val lo = max(1, (expectedPeriod * 0.95).toInt())
        val hi = min(count - 2, (expectedPeriod * 1.05).toInt())
        if (!(lo < hi)) return Detection(0.0, null, tickFreq)

        var peakIdx = lo
        var peakVal = acorr[lo]
        for (i in (lo + 1)..hi) {
            if (acorr[i] > peakVal) { peakVal = acorr[i]; peakIdx = i }
        }

        // Confidence: peak vs mean in search range
        val segAbs = FloatArray(hi - lo + 1)
        for (i in lo..hi) segAbs[i - lo] = abs(acorr[i])
        val segMean = vdspMean(segAbs, segAbs.size)
        val conf = if (segMean > 0) (peakVal / segMean).toDouble() else 0.0

        if (!(conf > 1.5)) return Detection(conf, null, tickFreq)

        // Parabolic interpolation for sub-sample precision
        val refined: Double = if (peakIdx > 0 && peakIdx < count - 1) {
            val a = acorr[peakIdx - 1].toDouble()
            val b = acorr[peakIdx].toDouble()
            val c = acorr[peakIdx + 1].toDouble()
            val d = 2.0 * (2.0 * b - a - c)
            if (abs(d) > 1e-30) peakIdx.toDouble() + (a - c) / d else peakIdx.toDouble()
        } else {
            peakIdx.toDouble()
        }

        // Harmonic refinement: check 2nd-5th harmonics
        val periods = arrayListOf(refined)
        for (mult in 2..5) {
            val expM = refined * mult.toDouble()
            val loM = (expM - refined * 0.01).toInt()
            val hiM = (expM + refined * 0.01).toInt()
            if (!(hiM < count - 1 && loM > 0)) break

            var pkIdx = loM
            var pkVal = acorr[loM]
            for (i in (loM + 1)..hiM) {
                if (acorr[i] > pkVal) { pkVal = acorr[i]; pkIdx = i }
            }

            val pkR: Double = if (pkIdx > 0 && pkIdx < count - 1) {
                val a = acorr[pkIdx - 1].toDouble()
                val b = acorr[pkIdx].toDouble()
                val c = acorr[pkIdx + 1].toDouble()
                val d = 2.0 * (2.0 * b - a - c)
                if (abs(d) > 1e-30) pkIdx.toDouble() + (a - c) / d else pkIdx.toDouble()
            } else {
                pkIdx.toDouble()
            }
            periods.add(pkR / mult.toDouble())
        }

        // Median of all period estimates
        periods.sort()
        val finalPeriod = periods[periods.size / 2]
        val detFreq = ringSampleRate / finalPeriod
        val rate = ((detFreq - tickFreq) / tickFreq) * 86400.0

        return Detection(conf, if (abs(rate) <= 120.0) rate else null, detFreq)
    }

    // MARK: - tg-style detection core (rate via autocorrelation period, not beat regression)
    // Reference: docs/research/2026-07-03-tg-algorithm-learnings.md. Toggled by useTgAlgo.
    // (Swift 1688-2155. The knobs and T1-T4 state, tgActivelyEvaluating and tgHasRecentLock
    // are declared with the part-A state above; fftAutocorrelation lives in Fft.kt.)

    private data class WindowRate(val secs: Double, val rate: Double)
    private data class CycleLag(val cyc: Double, val lag: Double)

    private fun tgRecordGateEvent(rejected: Boolean) {
        tgGateAttempts += 1
        tgGateEvents.add(GateEvent(energyRingAbs, rejected))
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        val cutoff = energyRingAbs - (ringSampleRate * 10).toInt()
        while (tgGateEvents.isNotEmpty() && tgGateEvents[0].abs < cutoff) tgGateEvents.removeAt(0)
    }

    /// sigma-gate reject fraction over the last 10 s; null until there are enough attempts to mean anything.
    private fun tgGateRejFraction(): Double? {
        if (tgGateEvents.size < 3) return null
        return tgGateEvents.count { it.rejected }.toDouble() / tgGateEvents.size.toDouble()
    }

    /// T1: advance the pending-lock / confirmed-lock state machine. `rates` is this pass's
    /// per-window estimates; the 8 s window is the confirmation instrument because once
    /// `energyRingAbs - tgPendingLockAbs >= 8 s` every sample in it postdates the pending
    /// lock — zero overlap, so agreement is evidence rather than self-confirmation.
    ///
    /// SHADOW-ALWAYS-ON: this machine runs on every session regardless of tgConfirmBand,
    /// so lc=/lr= in the TGALGO line carry a live-population A/B of the gate's verdicts
    /// while enforcement stays knob-gated at the convergence check (same playbook as the
    /// 2.1 reg-vs-tg shadow). At the dark default the ONLY effect is logging. The shadow
    /// judges with the staged band (6 s/d), not the enforcement knob — otherwise 999
    /// would confirm everything and the shadow would be data-free.
    private fun tgUpdateLockConfirmation(chosen: Double, rates: List<WindowRate>, ringSampleRate: Double) {
        if (tgLockConfirmed) return
        val shadowBand = min(tgConfirmBand, 6.0)   // staged target; a LOWERED knob tightens the shadow too
        val confirmWin = 8.0
        if (!(tgPendingLockRate != null && tgPendingLockAbs >= 0)) {
            tgPendingLockRate = chosen; tgPendingLockAbs = energyRingAbs
            return
        }
        if (!((energyRingAbs - tgPendingLockAbs).toDouble() >= confirmWin * ringSampleRate)) return
        // The 8 s window may have sigma-gate-failed this pass — then just try again next pass.
        val r1 = rates.firstOrNull { it.secs == confirmWin }?.rate ?: return
        val r0 = tgPendingLockRate!!
        if (abs(r1 - r0) <= shadowBand) {
            tgLockConfirmed = true
            debugLog("[TGALGO lock-confirm] r0=${cf(r0, 1, plus = true)} r1=${cf(r1, 1, plus = true)} band=${cf(shadowBand, 0)}")
        } else {
            tgLockRejects += 1
            debugLog("[TGALGO lock-reject] r0=${cf(r0, 1, plus = true)} r1=${cf(r1, 1, plus = true)} band=${cf(shadowBand, 0)} n=$tgLockRejects")
            tgPendingLockRate = r1; tgPendingLockAbs = energyRingAbs
        }
    }

    /// Most-recent `n` samples of the active envelope ring, linearized oldest->newest.
    private fun recentEnvelope(n: Int): FloatArray {
        val count = min(n, energyRingCount)
        if (count <= 0) return FloatArray(0)
        val ring = energyRings[activeHpIndex]
        val out = FloatArray(count)
        var idx = (energyRingWritePos - count + energyRingCapacity) % energyRingCapacity
        for (i in 0 until count) { out[i] = ring[idx]; idx = (idx + 1) % energyRingCapacity }
        return out
    }

    /// Full (tic-to-tic) period in ring samples via FFT-autocorrelation, refined across
    /// lag-cycles (tg algo.c:427-450). Returns null if the sigma-gate fails.
    ///
    /// The refinement is a straight line through the origin: the ACF peak near
    /// `cyc * nominal` sits at `cyc * period`, so every cycle measures the same period —
    /// but not equally well. A half-sample peak-location error is a half-sample of period
    /// at cyc=1 and a 40th of one at cyc=40. Averaging `lag/cyc` with EQUAL weight (what
    /// shipped through 2.3) therefore lets the worst estimates set the answer: error falls
    /// off as ln(K)/K instead of 1/K. Weighted least squares through the origin with
    /// w = cyc^2 is the right estimator for constant per-lag noise, and measured ~2x tighter
    /// in Monte-Carlo at every window >= 4s (audit 2026-07-31, scripts in that audit).
    /// tgPeriodFit keeps the old behaviour reachable from JS so the change can be A/B'd.
    private fun tgPeriod(env: FloatArray, nominal: Double, ringSampleRate: Double): Double? {
        val n = env.size
        if (!(n > (nominal * 2.5).toInt())) return null
        val e = env.copyOf()
        val mean = vdspMean(e, n)
        val negMean = -mean
        for (i in 0 until n) e[i] = e[i] + negMean          // vDSP_vsadd
        val tap = min(n / 2, (ringSampleRate * 0.1).toInt())
        if (tap > 1) {
            for (i in 0 until tap) {
                val w = (0.5 * (1 - kotlin.math.cos(i.toDouble() / tap.toDouble() * PI))).toFloat()
                e[i] *= w; e[n - 1 - i] *= w
            }
        }
        val ac = fftAutocorrelation(e, count = n)
        val tol = ringSampleRate * 0.02
        val lags = ArrayList<CycleLag>(); var cyc = 1.0
        while (nominal * cyc < n.toDouble() * 0.66) {
            val lo = (nominal * cyc - tol).toInt()
            val hi = (nominal * cyc + tol).toInt()
            if (hi >= ac.size - 1 || lo < 1) break
            var best = lo; var bv = ac[lo]
            for (k in lo..hi) { if (ac[k] > bv) { bv = ac[k]; best = k } }
            val a0 = ac[best - 1].toDouble(); val b0 = ac[best].toDouble(); val c0 = ac[best + 1].toDouble()
            val d = a0 - 2 * b0 + c0
            val frac = if (abs(d) > 1e-9) 0.5 * (a0 - c0) / d else 0.0
            lags.add(CycleLag(cyc, best.toDouble() + frac)); cyc += 1
        }
        if (lags.isEmpty()) return null
        val period = tgFitPeriod(lags)
        if (!(period > 1)) return null
        // sigma-gate, measured around the unweighted MEAN on purpose — not around the fitted
        // period. The gate asks "do the per-cycle estimates agree with each other", and
        // tgSigmaGate was tuned against the spread about their mean, which by construction
        // is the smallest such spread. Measuring it about the weighted fit instead leaves
        // the threshold nominally identical while making it 1-7% stricter in practice, and
        // that silently drops marginal windows — worst at the 4s window and low SNR, i.e.
        // precisely the weak signals that already fail most. The gate keeps its own
        // reference point; only the returned period changes.
        if (lags.size > 1) {
            val ests = lags.map { it.lag / it.cyc }
            val estMean = ests.fold(0.0) { acc, v -> acc + v } / ests.size.toDouble()
            val varr = ests.map { (it - estMean) * (it - estMean) }.fold(0.0) { acc, v -> acc + v } / ests.size.toDouble()
            if (estMean > 0 && sqrt(varr) / estMean > tgSigmaGate) {
                tgGateRejects += 1
                tgRecordGateEvent(true)     // T3/T4: an attempt that sigma-rejected
                return null
            }
        }
        tgRecordGateEvent(false)            // T3/T4: an attempt that produced a period
        return period
    }

    /// Period (ring samples) from the per-cycle ACF peak lags. See tgPeriod for why the
    /// weighting is the whole point; mode 0 reproduces the pre-2.4 estimator bit for bit.
    private fun tgFitPeriod(lags: List<CycleLag>): Double {
        when (tgPeriodFit) {
            0 -> return lags.fold(0.0) { acc, l -> acc + l.lag / l.cyc } / lags.size.toDouble()
            1 -> {
                val s = lags.map { it.lag / it.cyc }.sorted()
                return if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
            }
            else -> {
                // Weighted LS through the origin: period = sum(w*cyc*lag) / sum(w*cyc^2), w = cyc^2.
                var num = 0.0; var den = 0.0
                for ((c, l) in lags) { val w = c * c; num += w * c * l; den += w * c * c }
                if (!(den > 0)) return lags[lags.size - 1].lag / lags[lags.size - 1].cyc
                return num / den
            }
        }
    }

    /// tg-style rate: measure period over 2/4/8/16s windows of the envelope ring;
    /// use the longest window that passes the sigma-gate and yields an in-range rate.
    private fun computeTgRate(): Double? {
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        val nominal = 7200.0 / targetBph.toDouble() * ringSampleRate
        val rates = ArrayList<WindowRate>()
        for (secs in doubleArrayOf(2.0, 4.0, 8.0, 16.0, 32.0)) {
            if (!(secs <= tgMaxWindowSec)) continue
            val want = (secs * ringSampleRate).toInt()
            val env = recentEnvelope(want)
            if (env.size < (want.toDouble() * 0.9).toInt()) continue
            val period = tgPeriod(env, nominal = nominal, ringSampleRate = ringSampleRate) ?: continue
            val rate = (nominal / period - 1) * 86400
            if (abs(rate) <= 200) rates.add(WindowRate(secs, rate))
        }
        if (rates.isEmpty()) return null
        // Harmonic-reject guard: a low-BPH harmonic lock shows up as ONE window
        // reading ~2x off. The longest window is the headline, but only trust it if
        // it agrees with the median of all valid windows; otherwise fall back to the
        // median. On a clean watch every window agrees, so the longest still wins
        // (no-op). Set tgAgreeBand very high to disable.
        //
        // Needs >= 3 windows to mean anything. With exactly 2, the "median" is just
        // max(rate0, rate1) — there is no majority for it to express — so a
        // disagreement would hand the reading to whichever window happens to read
        // higher. That is a coin flip, and when it loses it discards the long window
        // (the more stable estimate) in favour of the short one (the noisier estimate,
        // and the one MORE prone to harmonic lock) — the exact inversion of intent.
        val sorted = rates.map { it.rate }.sorted()
        val median = if (sorted.size % 2 == 1) sorted[sorted.size / 2]
        else (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2
        val longestEntry = rates.maxByOrNull { it.secs }!!
        val longest = longestEntry.rate
        // A rate means the envelope is periodic at the expected BPH — that is a lock, and
        // it is what tgHoldOnLock keys off. Recorded on the absolute ring counter because
        // a recalibration rewinds wallElapsed.
        tgLastLockAbs = energyRingAbs
        tgLastWindowSec = longestEntry.secs
        val disagree = abs(longest - median) > tgAgreeBand
        // T2 (guardMode 1): windows that disagree beyond the band mean NO number is
        // trustworthy — refuse and keep acquiring, instead of shipping the median
        // (2.4 once shipped median=109.5 over longest=41.4). n==2 also refuses: with two
        // windows "median" is just max(), a coin flip documented below. A refusal clears
        // an UNCONFIRMED pending T1 lock; a confirmed lock survives one noisy pass
        // (starvation-hold semantics unchanged).
        if (tgGuardMode >= 1 && rates.size >= 2 && disagree) {
            debugLog("[TGALGO harmonic-guard] longest=${cf(longest, 1)} median=${cf(median, 1)} band=${cf(tgAgreeBand, 0)} n=${rates.size} -> nil")
            if (!tgLockConfirmed) { tgPendingLockRate = null; tgPendingLockAbs = -1 }
            return null
        }
        var chosen = longest
        if (rates.size >= 3 && disagree) {
            debugLog("[TGALGO harmonic-guard] longest=${cf(longest, 1)} median=${cf(median, 1)} band=${cf(tgAgreeBand, 0)} n=${rates.size} -> median")
            chosen = median
        }
        tgUpdateLockConfirmation(chosen = chosen, rates = rates, ringSampleRate = ringSampleRate)
        return chosen
    }

    /// Envelope sample at an absolute ring index (0 if it has scrolled out of the ring).
    private fun envAtAbs(a: Int): Float {
        val back = energyRingAbs - a
        if (!(back >= 1 && back <= min(energyRingCount, energyRingCapacity))) return 0f
        val idx = ((energyRingWritePos - back) % energyRingCapacity + energyRingCapacity) % energyRingCapacity
        return energyRings[activeHpIndex][idx]
    }

    /// Locate beats on the tg-period grid and emit per-pair cumulative-deviation dots
    /// (same convention as the detector's dots: pairing cancels beat error).
    private fun tgTrackDots(period: Double, ringSampleRate: Double, wallElapsed: Double) {
        val halfP = period / 2
        val nominalFull = 7200.0 / targetBph.toDouble() * ringSampleRate
        val win = max(2.0, halfP * 0.12)
        val absNow = energyRingAbs.toDouble()
        if (tgDotNext < 0) {
            val span = (halfP * 1.5).toInt()
            if (!(energyRingCount > span + 4)) return
            var best = -1f; var bi = energyRingAbs - span
            var a = energyRingAbs - span
            while (a < energyRingAbs) { val v = envAtAbs(a); if (v > best) { best = v; bi = a }; a += 1 }
            tgDotPrevAbs = bi.toDouble(); tgDotNext = bi.toDouble() + halfP
            tgDotPairAccum = 0.0; tgDotPairPhase = 0; tgDotSkipPairs = 1
            return
        }
        var guardCount = 0
        while (tgDotNext + win < absNow && guardCount < 64) {
            guardCount += 1
            val lo = (tgDotNext - win).toInt()
            val hi = (tgDotNext + win).toInt()
            if (energyRingAbs - lo > min(energyRingCount, energyRingCapacity)) { tgDotNext = -1.0; return }  // fell behind — resync
            var best = -1f; var bi = lo
            var a = lo
            while (a <= hi) { val v = envAtAbs(a); if (v > best) { best = v; bi = a }; a += 1 }
            val p = bi.toDouble()
            val interval = p - tgDotPrevAbs
            tgDotPrevAbs = p
            tgDotNext = p + halfP
            if (abs(interval - halfP) > halfP * 0.2) { tgDotPairAccum = 0.0; tgDotPairPhase = 0; continue }  // outlier — drop this pair
            tgDotPairAccum += interval; tgDotPairPhase += 1
            if (tgDotPairPhase == 2) {
                val devMs = (nominalFull - tgDotPairAccum) / ringSampleRate * 1000.0
                tgDotPairAccum = 0.0; tgDotPairPhase = 0
                if (tgDotSkipPairs > 0) { tgDotSkipPairs -= 1; continue }
                tgDotCumMs += devMs
                val tSec = wallElapsed - (absNow - p) / ringSampleRate
                tgPendingDots.add(TickDot(timeSec = max(0.0, tSec), deviationMs = tgDotCumMs))
            }
        }
    }

    /// Beat error (ms) from the folded beat: the toc's offset from exactly half a period.
    /// (tg derives B.E. the same way — tic->toc spacing vs period/2.)
    private fun tgBeatError(fold: FloatArray, period: Double, ringSampleRate: Double): Double? {
        val P = fold.size; if (!(P > 8)) return null
        var tic = 0; var tv = fold[0]
        for (i in 1 until P) { if (fold[i] > tv) { tv = fold[i]; tic = i } }
        // strongest point in the window [tic + 0.4P, tic + 0.6P] (circular) = toc
        var best = -1f; var toc = tic
        for (off in (P.toDouble() * 0.4).toInt()..(P.toDouble() * 0.6).toInt()) {
            val i = (tic + off) % P
            if (fold[i] > best) { best = fold[i]; toc = i }
        }
        // Sub-sample refinement. Integer bins quantise B.E. at one ring sample — 0.083 ms at
        // the default 12 kHz ring — on a quantity whose entire useful range is 0-0.5 ms, so
        // the reading moved in visible steps. Same parabolic fit the ACF peak search uses.
        val d = tgCircularSpan(from = tgRefinePeak(fold, tic), to = tgRefinePeak(fold, toc), p = P.toDouble())
        val be = abs(d - period / 2) / ringSampleRate * 1000.0
        // Shadow estimator: the same spacing measured from each pulse's leading EDGE instead
        // of its peak. Peak position walks with pulse amplitude, so a tic/toc amplitude
        // imbalance biases the peak-based figure; onsets do not. Logged only (beOn= in
        // TGALGO) until there is field data to compare the two — do not wire it to the
        // display before that comparison exists.
        val onTic = tgPulseOnset(fold, marker = tic)
        val onToc = tgPulseOnset(fold, marker = toc)
        if (onTic != null && onToc != null) {
            val od = tgCircularSpan(from = onTic, to = onToc, p = P.toDouble())
            val obe = abs(od - period / 2) / ringSampleRate * 1000.0
            tgBeOnsetCached = if (obe < 10) obe else null
        } else {
            tgBeOnsetCached = null
        }
        return if (be < 10) be else null                    // >10ms = fold not clean, don't report
    }

    /// Forward distance from `a` to `b` on a circle of length `p`.
    private fun tgCircularSpan(from: Double, to: Double, p: Double): Double {
        var d = (to - from) % p                             // Swift truncatingRemainder
        if (d < 0) d += p
        return d
    }

    /// Sub-sample peak position around an integer argmax, by parabolic fit on the three
    /// surrounding fold bins (circular). Clamped to +-1 bin so a flat top can't run away.
    private fun tgRefinePeak(fold: FloatArray, i: Int): Double {
        val P = fold.size
        val a = fold[(i - 1 + P) % P].toDouble(); val b = fold[i].toDouble(); val c = fold[(i + 1) % P].toDouble()
        val d = a - 2 * b + c
        if (!(abs(d) > 1e-12)) return i.toDouble()
        return i.toDouble() + max(-1.0, min(1.0, 0.5 * (a - c) / d))
    }

    /// Leading-edge position of the pulse peaking at `marker`, as a fractional fold index
    /// (may be negative — callers wrap it). Threshold sits halfway between the quiet region
    /// (the same P/6..P/4 window tgAmplitude uses for its noise floor) and the peak, and the
    /// crossing is linearly interpolated. null when the pulse never clears the noise.
    private fun tgPulseOnset(fold: FloatArray, marker: Int): Double? {
        val P = fold.size; if (!(P > 8)) return null
        fun at(d: Int): Float = fold[((marker - d) % P + P) % P]
        var noise = 0f
        var q = P / 6
        while (q <= P / 4) { if (at(q) > noise) noise = at(q); q += 1 }
        val peak = fold[marker]
        if (!(peak > noise)) return null
        val thr = noise + 0.5f * (peak - noise)
        var d = 1
        while (d < P / 8 && at(d) > thr) d += 1
        // d == 1 is a legitimate crossing (between the peak bin and the one before it) —
        // unlike tgAmplitude's pulseBefore, which needs room to walk on to a second peak.
        // Bailing out only when no crossing was found inside P/8.
        if (!(d < P / 8)) return null
        val hi = at(d - 1); val lo = at(d)                  // hi > thr >= lo
        val frac = if (hi > lo) (thr - lo).toDouble() / (hi - lo).toDouble() else 0.0
        return marker.toDouble() - d.toDouble() + frac
    }

    /// tg-style averaged beat: fold the recent envelope at the measured period (trimmed mean per bin).
    private fun tgFoldedBeat(period: Double): FloatArray? {
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        val P = roundAway(period).toInt(); if (!(P > 8)) return null
        val env = recentEnvelope((ringSampleRate * 8).toInt())     // up to 8s of beats
        val nBeats = env.size / P; if (!(nBeats >= 4)) return null
        val fold = FloatArray(P)
        val col = FloatArray(nBeats)
        val keep = max(1, (nBeats.toDouble() * 0.8).toInt())     // trimmed mean: drop loudest 20%
        for (p in 0 until P) {
            for (b in 0 until nBeats) col[b] = env[b * P + p]
            col.sort()
            var s = 0f; for (b in 0 until keep) s += col[b]
            fold[p] = s / keep.toFloat()
        }
        val mean = vdspMean(fold, P)
        val neg = -mean
        for (i in 0 until P) fold[i] = fold[i] + neg              // vDSP_vsadd
        return fold
    }

    /// Amplitude (degrees) from the escapement pulse-pair + lift angle. null if not plausible.
    /// tg's full recipe: 1ms leaky-max smoothing (noise bumps stopped the peak-walk early ->
    /// short dt -> amplitude read high), quiet-region noise floor, and a x1.4 threshold
    /// iteration that only accepts a mutually-consistent, plausible tic/toc pair.
    private fun tgAmplitude(rawFold: FloatArray, period: Double): Double? {
        val P = rawFold.size; if (!(P > 8)) return null
        // 1ms leaky-max (peak-hold) smoothing, two passes for circular wrap (tg algo.c:611)
        val ringSampleRate = actualSampleRate / ringSubsampleTarget.toDouble()
        val w = max(2, (ringSampleRate / 1000.0).toInt())
        val k = 1.0f - 1.0f / w.toFloat()
        val fold = rawFold.copyOf()
        var hold = 0f
        for (pass in 0 until 2) {
            for (i in 0 until P) {
                hold *= k
                if (rawFold[i] > hold) hold = rawFold[i]
                if (pass == 1 || i > w) fold[i] = hold
            }
        }
        val glob = fold.maxOrNull() ?: 0f; if (!(glob > 0)) return null
        // tic/toc markers from the smoothed fold
        var tic = 0; var tv = fold[0]
        for (i in 1 until P) { if (fold[i] > tv) { tv = fold[i]; tic = i } }
        val lo = (tic + (P.toDouble() * 0.4).toInt()) % P
        val hi = (tic + (P.toDouble() * 0.6).toInt()) % P
        var toc = lo; var bv = fold[lo]; var j = lo
        while (j != hi) { if (fold[j] > bv) { bv = fold[j]; toc = j }; j = (j + 1) % P }
        // Noise floor from the quiet region between the pulse clusters (d in [P/6, P/4]
        // before each marker), not the whole-fold mean (which the pulses inflate).
        var noise = 0f
        for (mk in intArrayOf(tic, toc)) {
            var d = P / 6
            while (d <= P / 4) { val v = fold[((mk - d) % P + P) % P]; if (v > noise) noise = v; d += 1 }
        }
        // Threshold iteration (tg algo.c:770/809): accept the first level that yields a
        // plausible, consistent pulse pair; a faint pulse that never qualifies -> null.
        var thr = max(0.01f * glob, 1.4f * noise)
        var iters = 0
        while (thr < glob && iters < 12) {
            fun pulseBefore(marker: Int): Int? {
                fun at(d: Int): Float = fold[((marker - d) % P + P) % P]
                var d = P / 8
                while (d > 2 && at(d) <= thr) d -= 1     // threshold crossing
                if (!(d > 2)) return null
                while (d > 3 && at(d - 1) > at(d)) d -= 1 // walk to the pulse peak
                return d
            }
            val amps = ArrayList<Double>()
            var ok = true
            for (mk in intArrayOf(tic, toc)) {
                val dt = pulseBefore(mk)
                if (dt == null) { ok = false; break }
                val s = kotlin.math.sin(PI * dt.toDouble() / period)
                if (!(s > 0)) { ok = false; break }
                amps.add(liftAngleDeg / (2 * s))
            }
            // Plausibility gate. The floor used to be a hardcoded 135 deg, which inverted the
            // feature: a watch genuinely running at 120 deg — exactly the one whose owner needs
            // telling — reported nothing at all, while a healthy one reported fine. 21% of
            // tg-locked sessions produced no amplitude (audit 2026-07-31). tgAmpMinDeg drops
            // the floor to 90 deg so a low reading comes through and the UI can colour it red.
            if (ok && amps.size == 2 && amps.all { tgAmpMinDeg <= it && it <= 360 } && abs(amps[0] - amps[1]) <= 60) {
                return (amps[0] + amps[1]) / 2
            }
            thr *= 1.4f; iters += 1
        }
        return null
    }

    // MARK: - Beat error via epoch folding (Swift 2222-2327)

    private fun detectTickEvents(signal: FloatArray, count: Int, ringSampleRate: Double) {
        val tickFreq = targetBph.toDouble() / 3600.0
        val beatFreq = tickFreq / 2.0
        val beatPeriod = ringSampleRate / beatFreq
        val periodSamples = roundAway(beatPeriod).toInt()

        if (!(count >= periodSamples * 8)) return

        // Epoch fold at beat period
        val folded = DoubleArray(periodSamples)
        val foldCount = IntArray(periodSamples)
        for (i in 0 until count) {
            val idx = i % periodSamples
            folded[idx] += signal[i].toDouble()
            foldCount[idx] += 1
        }
        for (i in 0 until periodSamples) {
            if (foldCount[i] > 0) folded[i] /= foldCount[i].toDouble()
        }

        // Smooth the folded profile
        val smoothW = max(1, periodSamples / 50)
        val smoothed = DoubleArray(periodSamples)
        for (i in 0 until periodSamples) {
            var s = 0.0; var c = 0
            for (j in -smoothW..smoothW) {
                val idx = (i + j + periodSamples) % periodSamples
                s += folded[idx]; c += 1
            }
            smoothed[i] = s / c.toDouble()
        }

        // Find peak 1 (global max)
        var peak1Idx = 0
        var peak1Val = smoothed[0]
        for (i in 1 until periodSamples) {
            if (smoothed[i] > peak1Val) { peak1Val = smoothed[i]; peak1Idx = i }
        }

        // Find peak 2 (max outside +-25% exclusion zone)
        val exclusion = periodSamples / 4
        var peak2Idx = -1
        var peak2Val = -1.0
        for (i in 0 until periodSamples) {
            val dist = min(abs(i - peak1Idx), periodSamples - abs(i - peak1Idx))
            if (dist > exclusion && smoothed[i] > peak2Val) {
                peak2Val = smoothed[i]; peak2Idx = i
            }
        }
        if (!(peak2Idx >= 0)) {
            currentBeatError = null; return
        }

        // Quality gate: both peaks must have good prominence
        var floor = smoothed[0] // Swift smoothed.min(): first element, replaced on `<`
        for (v in smoothed) if (v < floor) floor = v
        val prom1 = peak1Val - floor
        val prom2 = peak2Val - floor
        val promRatio = if (prom1 > 0) prom2 / prom1 else 0.0
        if (!(promRatio > 0.25)) {
            currentBeatError = null; return
        }

        // Compute beat error
        val gap1 = (peak2Idx - peak1Idx + periodSamples) % periodSamples
        val gap2 = periodSamples - gap1
        val gap1Ms = gap1.toDouble() / ringSampleRate * 1000.0
        val gap2Ms = gap2.toDouble() / ringSampleRate * 1000.0
        val be = abs(gap1Ms - gap2Ms)

        val halfPeriodMs = periodSamples.toDouble() / ringSampleRate * 1000.0 / 2.0
        val minGapFraction = 0.35
        if (!(be < 5.0 &&
                gap1Ms > halfPeriodMs * minGapFraction &&
                gap2Ms > halfPeriodMs * minGapFraction)
        ) {
            currentBeatError = null; return
        }

        currentBeatError = roundAway(be * 100) / 100

        // Waveform: downsample the active ring's last 500ms for visualization
        val vizRingSamples = min(count, (ringSampleRate * 0.5).toInt())
        val vizStart = count - vizRingSamples
        val targetPoints = 200
        val step = max(1, vizRingSamples / targetPoints)
        val waveform = ArrayList<Float>(targetPoints)
        var i = 0
        while (i < vizRingSamples) {
            var maxVal = 0f
            val end = min(i + step, vizRingSamples)
            for (j in i until end) {
                if (signal[vizStart + j] > maxVal) maxVal = signal[vizStart + j]
            }
            waveform.add(maxVal)
            i += step
        }
        lastBeatWaveform = waveform.toFloatArray()

        // Tick positions in waveform
        val ticksInViz = (vizRingSamples.toDouble() / beatPeriod * 2).toInt()
        val tickPos = ArrayList<Int>()
        for (t in 0 until ticksInViz) {
            val sampleInViz = (t.toDouble() * beatPeriod / 2.0).toInt() % vizRingSamples
            val wfIdx = sampleInViz / step
            if (wfIdx >= 0 && wfIdx < waveform.size) tickPos.add(wfIdx)
        }
        lastTickPositions = tickPos.toIntArray()
    }

    /// Trimmed mean: removes top/bottom fraction of values, averages the rest.
    /// Swift 2330-2336; unreferenced in Swift too, ported for 1:1 completeness.
    @Suppress("unused")
    private fun trimmedMean(values: List<Double>, fraction: Double): Double {
        val sorted = values.sorted()
        val trimCount = max(0, (sorted.size.toDouble() * fraction).toInt())
        val trimmed = if (trimCount < sorted.size - trimCount) sorted.subList(trimCount, sorted.size - trimCount) else emptyList()
        if (trimmed.isEmpty()) return sorted[sorted.size / 2]
        return trimmed.fold(0.0) { a, b -> a + b } / trimmed.size.toDouble()
    }
}

/**
 * vDSP_meanv stand-in: the mean of the first [n] floats. Summed in Double and rounded once,
 * which is the correctly-rounded mean; vDSP's own vectorised Float summation order is not
 * specified, so the last bit can differ from it (no effect on any logged figure in the
 * golden runs).
 */
private fun vdspMean(x: FloatArray, n: Int): Float {
    if (n <= 0) return 0f
    var s = 0.0
    for (i in 0 until n) s += x[i].toDouble()
    return (s / n).toFloat()
}
