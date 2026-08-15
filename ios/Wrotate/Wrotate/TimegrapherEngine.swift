import AVFoundation
import Accelerate

/// Measures watch accuracy via Goertzel + autocorrelation at a known BPH.
///
/// Algorithm: user provides BPH → we know the exact tick frequency.
/// 1. Three parallel 2nd-order Butterworth HP filters (4kHz, 6kHz, 8kHz)
/// 2. Three parallel peak-hold energy ring buffers at ~24kHz (web-tunable)
/// 3. Primary: Goertzel detection at each cutoff (best ratio wins)
/// 4. Fallback: FFT autocorrelation when Goertzel fails at all cutoffs
/// 5. Rate via fine frequency sweep (Goertzel) or period refinement (autocorr)
/// 6. Beat error via epoch folding
class TimegrapherEngine {

    struct TickDot {
        let timeSec: Double      // seconds since measurement start
        let deviationMs: Double  // cumulative timing deviation in ms
    }

    struct Update {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let confidence: Double
        let noiseLevel: Double
        let detectedIntervalMs: Double
        let detectedBph: Int?
        let debug: DebugInfo?
        let beatWaveform: [Float]?
        let amplitude: Double?    // degrees (tg path); nil if unavailable
        let tickPositions: [Int]?
        let cumulativeOffset: Double
        let elapsedSec: Double
        let method: String
        let rateStable: Bool      // true when rate has converged (±2 s/day for 15s)
        let tgSignalQuality: String?  // T3: "good"/"fair"/"poor" from the σ-gate reject fraction (tg path; nil otherwise)
        let tgAcquiring: Bool     // T4: tg is evaluating windows, no rate yet, within the acquire runway — JS should not declare no-signal while true
        let newTicks: [TickDot]   // new tick dots since last update
        let debugMessages: [String] // debug log lines for Supabase
    }

    struct DebugInfo {
        let sampleRate: Double
        let fftSize: Int
        let bufferSamples: Int
        let hpCutoff: Double
        let bestLag: Int
        let bestCorrelation: Double
        let refinedLag: Double
        let noiseFloor: Double
        let threshold: Double
        let peakEnergy: Double
        let allBphCorrelations: [(bph: Int, correlation: Float, lag: Int)]
    }

    struct Result {
        let rate: Double?
        let beatError: Double?
        let tickCount: Int
        let ticks: [Double]
    }

    var onUpdate: ((Update) -> Void)?
    /// Audio-interruption lifecycle: "began" (system killed the tap: call/Siri/alarm),
    /// "resumed" (tap rebuilt, measurement continuing on fresh audio), "failed" (session
    /// could not be reactivated — JS should stop pretending to listen). Before 2.5 there
    /// was NO handling at all: the tap died, isRunning stayed true, and the UI showed a
    /// frozen "listening" forever (field: ~4% of sessions have the audio clock >= 20 s
    /// behind wall clock; one froze at 80 s of audio across 41 real minutes).
    var onInterruption: ((String) -> Void)?

    private var audioEngine: AVAudioEngine?
    private var isRunning = false
    private var interruptionObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    private var configObserver: NSObjectProtocol?

    private var actualSampleRate: Double = 48000
    private var sampleCounter: Int64 = 0

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
    private var clkFirstHost: UInt64 = 0
    private var clkFirstFrames: Int64 = 0
    private var clkFrames: Int64 = 0
    private var clkLastLogSec: Double = -1
    private var clkPpm: Double? = nil
    private var clkSettleSec: Double = 2.0   // ignore samples before this; buffer pacing is irregular at start
    private var clkN = 0
    private var clkSh = 0.0, clkSf = 0.0, clkShh = 0.0, clkShf = 0.0

    // BPH — user-provided or auto-detected
    private var targetBph: Int = 28800
    private var autoBph: Bool = false
    private static let bphCandidates = [18000, 21600, 25200, 28800, 36000]

    // Cumulative offset tracking for scatter plot
    private var cumulativeOffsetMs: Double = 0
    private var lastAnalysisElapsed: Double = 0

    // Auto BPH re-detection
    private var consecutiveFailures: Int = 0

    // Real-time tick detection for timegrapher chart
    private var tickDeviationMs: Double = 0        // cumulative deviation
    private var expectedTickInterval: Double = 0   // ring samples between ticks
    private var lastTickRingPos: Int = -1           // ring position of last detected tick
    private var tickThreshold: Float = 0            // adaptive threshold for tick detection
    private var pendingTicks: [TickDot] = []        // ticks to send in next update
    private var tickDetectionActive = false
    private var tickCalibrating = false              // true during calibration phase (no ticks accepted)
    private var calibrationSamples: Int = 0          // ring samples seen during calibration
    private var calibrationDuration: Int = 24000     // ~2s at 12kHz ring rate
    private var calibrationEnergies: [Float] = []    // per-sample energies during calibration (for percentile)
    private var calibNoiseFloor: Float = 0           // median energy from calibration — threshold decay floor
    private var recalibrationsDone: Int = 0          // how many times we've auto-recalibrated this session
    private var maxRecalibrations: Int = 4           // cap to avoid infinite loops
    private var ringPosSinceLastTick: Int = 0       // samples since last tick
    private var tickCount: Int = 0
    private var lastTickDeviationCheck: Double = 0  // deviation at last sanity check
    private var lastTickCountCheck: Int = 0         // tick count at last sanity check
    private var tickDebugInterval: Int = 0          // throttle debug logging
    private var debugMessages: [String] = []        // accumulated for Supabase

    // Sub-sample interpolation for tick timing
    private var lastTickFracOffset: Double = 0      // fractional ring position offset of last tick
    private var tickStartSample: Int64 = 0          // sampleCounter at tick activation (for relative elapsed)

    // Phase recovery for high beat error watches
    private var consecutivePairRejects: Int = 0     // consecutive pair rejections (pairDev > threshold)
    private var rejectDevSum: Double = 0            // sum of |pairDev| during reject streak
    private var knownBeatError: Double = 0          // estimated beat error from individual tick deviations (ms)
    private var recentTickDevs: [Double] = []       // last N individual tick deviations (signed)
    private var beatErrorWindowSize: Int = 20       // how many tick devs to track for beat error estimation
    // Phase-separated beat error: BE = |mean(dev|phase0) - mean(dev|phase1)|; averaging cancels jitter
    // (spec docs/superpowers/specs/2026-06-10-phase-separated-beat-error.md). Replaces the folded estimator.
    private var tickPhaseIndex: Int = 0             // cumulative expected-impulse count — skip-robust parity source
    private var beDevsByParity: [[Double]] = [[], []] // rolling signed-dev buckets, phase 0 / phase 1
    private let beBucketWindow: Int = 30            // per-bucket rolling size
    private let beMinPerBucket: Int = 8             // min samples per bucket before BE is valid
    private var phaseSepBeatError: Double? = nil    // estimator output (ms), nil until both buckets fill

    // Adaptive BPH correction: detect consistent pair deviation or outlier ratio → switch BPH
    private var bphCorrectionRejects: [Double] = [] // signed pairDev values during reject streak
    private var bphCorrectionOutliers: [Double] = [] // consecutive outlier ratios
    private var bphCorrectionAttempted: Set<Int> = [] // BPH values already tried this session
    private var bphCorrectionCount: Int = 0         // how many BPH switches done this session
    private var maxBphCorrections: Int = 2          // cap corrections to avoid infinite loops

    // Pair-based regression: accumulate every 2 ticks to cancel beat error
    private var pairIntervalAccum: Double = 0       // sum of last 2 tick intervals (fractional)
    private var pairTickPhase: Int = 0              // 0 or 1, alternates each tick
    private var pairDeviationMs: Double = 0         // cumulative pair deviation
    // Stashed first-tick info (held until pair is validated)
    private var pendingFirstTickDev: Double = 0
    private var pendingFirstTickTime: Double = 0
    private var pendingFirstTickInterval: Double = 0
    private var pendingFirstTickEnergy: Float = 0
    // Adaptive pair gate: starts at 2ms, tightens as we learn the noise profile
    private var recentPairDevs: [Double] = []       // last N |pairDev| values (ALL pairs, not just accepted)
    private var adaptiveWindowSize: Int = 30        // pairs to track for MAD
    private var coldStartThreshold: Double = 2.0    // ms, before we have enough data
    private var minAdaptiveThreshold: Double = 1.0  // floor
    private var maxAdaptiveThreshold: Double = 2.0  // ceiling
    private var adaptiveMultiplier: Double = 3.0    // MAD multiplier
    private var maxTickDev: Double = 10.0            // individual tick sanity limit (ms)
    private var outlierMargin: Double = 0.15          // ±fraction for tick interval outlier gate
    private var outlierMarginLowBph: Double = 0.20    // wider margin for ≤21600 bph
    private var regressionSkipPairs: Int = 5         // skip first N pairs from regression (threshold still adapting)
    private var totalPairsAccepted: Int = 0          // total clean pairs (including skipped)

    // Calibration tunables (previously hardcoded)
    private var calibPercentile: Double = 0.98       // energy percentile for threshold
    private var calibMultiplier: Float = 1.2         // first calibration multiplier on percentile
    private var calibMultiplierRecal: Float = 0.8    // recalibration multiplier (softer)
    private var recalTriggerSec: Double = 3.0        // seconds of no ticks before recalibrating
    private var tickThresholdDecay: Float = 0.9999   // threshold decay when ticks are flowing
    private var tickThresholdDecayNoTicks: Float = 0.995 // faster decay when starved of ticks
    private var tickDetectMult: Float = 0.3          // energy > tickThreshold * this = tick detected
    private var minSpacingMult: Double = 0.9         // minSpacing = expectedInterval * this
    private var noiseFloorMult: Float = 2.0          // threshold decay floor = calibMedian * this (0 = disabled)

    // Peak detection: wait for energy to decline before firing tick
    private var pendingTickCross: Bool = false        // threshold crossed, waiting for peak
    private var pendingTickPeakEnergy: Float = 0      // highest energy seen during pending
    // Phase-locked selection: once locked, pick the candidate crest closest to the predicted tick.
    private var phaseLockEnabled: Bool = true        // default ON — validated on Kurono (twin-peak). JLC read high but it's a flaky watch (Weishi itself unstable, -22→+4), so discounted. Regression-checking clean watches (Hamilton/Tudor) next. A/B-overridable via setTuning.
    private var phaseLockWindow: Double = 0.4         // acceptance half-window as fraction of interval
    private var phaseLockMaxMiss: Int = 3             // consecutive misses before dropping lock
    private var plHaveCand: Bool = false
    private var plBestInterval: Int = 0
    private var plBestDist: Int = Int.max
    private var plMissCount: Int = 0
    private var plApplyCarry: Bool = false
    private var plPendingCarry: Int = 0
    private var peakDetectGate: Float = 3.0           // use peak detection only when energy > threshold * this

    // Rate display and stability tracking (all tunable from JS)
    private var smoothedRate: Double? = nil
    private var lastUpdateLogRegN: Int = 0
    private var rateHistory: [(time: Double, rate: Double)] = []  // recent rates for stability check
    private var regNMinimum: Int = 10                // minimum regression points before showing rate
    private var stabilityWindow: Double = 15.0       // seconds to check stability over
    private var stabilityThreshold: Double = 3.0     // s/day — rate must stay within this range
    private var stabilityLoseThreshold: Double = 5.0 // s/day — wider threshold to LOSE stability (prevents flicker)
    private var wallElapsedMinimum: Double = 20.0    // minimum elapsed time before allowing convergence
    private var wasStable: Bool = false

    private func debugLog(_ msg: String) {
        print(msg)
        debugMessages.append(msg)
    }

    /// Adaptive pair gate threshold based on median + MAD of ALL recent pairs.
    /// Tracks all pairs (accepted + rejected) to see the true noise profile.
    private func currentPairThreshold() -> Double {
        guard recentPairDevs.count >= 10 else { return coldStartThreshold }
        let sorted = recentPairDevs.sorted()
        let median = sorted[sorted.count / 2]
        let absDevs = sorted.map { abs($0 - median) }.sorted()
        let mad = absDevs[absDevs.count / 2]
        let threshold = max(minAdaptiveThreshold, min(maxAdaptiveThreshold, median + adaptiveMultiplier * mad))
        return threshold
    }

    /// Theil-Sen estimator on ALL accepted pairs. Uses all data for maximum stability.
    /// When n > 120, subsamples to keep O(n²) manageable (~7000 slope pairs max).
    private func theilSenSlope() -> Double? {
        let n = regPoints.count
        guard n >= regNMinimum else { return nil }

        // For large n, subsample evenly to ~120 points (keeps O(n²) fast)
        let points: [(x: Double, y: Double)]
        if n > 120 {
            let step = Double(n - 1) / 119.0
            points = (0..<120).map { i in regPoints[Int(Double(i) * step)] }
        } else {
            points = regPoints
        }
        let wn = points.count

        var slopes: [Double] = []
        slopes.reserveCapacity(wn * (wn - 1) / 2)
        for i in 0..<wn {
            for j in (i+1)..<wn {
                let dx = points[j].x - points[i].x
                if dx > 0.01 {
                    slopes.append((points[j].y - points[i].y) / dx)
                }
            }
        }
        guard !slopes.isEmpty else { return nil }
        slopes.sort()
        return slopes[slopes.count / 2]
    }

    // Theil-Sen median regression on PAIR deviations → robust to outliers
    private var regPoints: [(x: Double, y: Double)] = []  // (elapsedSec, pairDeviationMs)
    private var regN: Int = 0  // kept for compatibility (= regPoints.count)

    // 2nd-order Butterworth HP filter state (biquad)
    private struct BiquadState {
        var b0: Float = 0; var b1: Float = 0; var b2: Float = 0
        var a1: Float = 0; var a2: Float = 0
        var x1: Float = 0; var x2: Float = 0
        var y1: Float = 0; var y2: Float = 0
        var cutoffHz: Float = 4000
    }

    // Three parallel HP filters at different cutoffs
    private let hpCutoffs: [Float] = [4000, 6000, 8000]
    private var hpFilters: [BiquadState] = []

    // Three parallel energy ring buffers
    private var energyRings: [[Float]] = []
    private var energyRingCapacity: Int = 360000
    private var bufferDurationSec: Float = 30.0
    private var energyRingWritePos: Int = 0
    private var energyRingCount: Int = 0
    private var energySubsampleCounter: Int = 0
    private var ringSubsampleTarget: Int = 4  // 48kHz / 4 = 12kHz
    private var ringTargetRate: Double = 12000 // target ring sample rate (web-tunable)
    private var useTgAlgo = false              // rate via autocorrelation period (tg) vs regression
    // tg dots: beats located on the tg-period grid over the envelope — the dots must come
    // from the algorithm that produces the number, not the legacy detector (tg path only).
    private var energyRingAbs = 0              // absolute ring-sample counter (write side)
    private var tgDotNext: Double = -1         // predicted next beat (abs ring); -1 = bootstrap
    private var tgDotPrevAbs: Double = -1
    private var tgDotPairAccum: Double = 0
    private var tgDotPairPhase = 0
    private var tgDotCumMs: Double = 0
    private var tgDotSkipPairs = 0
    private var tgPendingDots: [TickDot] = []
    private var tgRateCached: Double? = nil    // cached tg rate (recomputed ~2x/sec)
    private var tgBeCached: Double? = nil      // cached tg beat error (ms, from the fold)
    private var tgAmpCached: Double? = nil     // cached tg amplitude (degrees)
    private var tgFoldCached: [Float]? = nil   // cached folded beat waveform
    private var liftAngleDeg: Double = 52.0    // escapement lift angle for amplitude (tunable)
    private var lastTgComputeSec: Double = -1
    private var lastTgLogSec: Double = -1

    // Per-filter subsample peaks
    private var subsamplePeaks: [Float] = [0, 0, 0]

    // Tuning parameters
    private var peakRatioThreshold: Float = 3.0

    // Live debug values
    private var recentPeakEnergy: Float = 0

    // Which cutoff index was used for the active detection
    private var activeHpIndex: Int = 0

    // Results
    private var currentRate: Double? = nil
    private var currentBeatError: Double? = nil
    private var currentConfidence: Double = 0
    private var currentDetectedInterval: Double = 0
    private var detectedBph: Int? = nil
    private var currentNoiseLevel: Double = 0
    private var peakCount: Int = 0
    private var detectionMethod: String = ""

    private var lastAnalysisTime: Double = 0
    private var isAnalyzing = false
    private var lastDebugInfo: DebugInfo? = nil
    private var lastBeatWaveform: [Float]? = nil
    private var lastTickPositions: [Int]? = nil

    func setSensitivity(_ value: Int) {
        // Kept for bridge compatibility
    }

    func setTuning(multLo: Float, multHi: Float, minThreshold: Float,
                    percentile: Int, hpCutoff: Float,
                    peakRatioThreshold thresh: Float = 3.0,
                    bufferSeconds bufSec: Float = 30.0,
                    regSkipPairs: Int? = nil,
                    regMinN: Int? = nil,
                    wallMinSec: Double? = nil,
                    stabWindow: Double? = nil,
                    stabThresh: Double? = nil,
                    stabLoseThresh: Double? = nil,
                    maxPairThresh: Double? = nil,
                    minPairThresh: Double? = nil,
                    coldStartThresh: Double? = nil,
                    pairMadMult: Double? = nil,
                    maxTickDevMs: Double? = nil,
                    calibDuration: Int? = nil,
                    ringTargetRate: Double? = nil,
                    outlierMargin: Double? = nil,
                    outlierMarginLowBph: Double? = nil,
                    calibPercentile: Double? = nil,
                    calibMultiplier: Double? = nil,
                    calibMultiplierRecal: Double? = nil,
                    maxRecalibrations: Int? = nil,
                    recalTriggerSec: Double? = nil,
                    thresholdDecay: Double? = nil,
                    thresholdDecayNoTicks: Double? = nil,
                    tickDetectMult: Double? = nil,
                    minSpacingMult: Double? = nil,
                    maxBphCorrections: Int? = nil,
                    noiseFloorMult: Double? = nil,
                    peakDetectGate: Double? = nil,
                    phaseLock: Bool? = nil, phaseLockWindow: Double? = nil, phaseLockMaxMiss: Int? = nil,
                    liftAngle: Double? = nil,
                    tgSigma: Double? = nil, tgStabWin: Double? = nil, tgWallMin: Double? = nil, tgStabTh: Double? = nil,
                    tgMaxWin: Double? = nil, tgAgree: Double? = nil,
                    tgPeriodFit: Int? = nil, tgHoldOnLock: Bool? = nil, tgAmpMin: Double? = nil,
                    tgConfirmBand: Double? = nil, tgGuardMode: Int? = nil,
                    tgGateMaxRej: Double? = nil, tgAcquireMax: Double? = nil) {
        if let v = tgPeriodFit, v >= 0, v <= 2 { self.tgPeriodFit = v }
        if let v = tgHoldOnLock { self.tgHoldOnLock = v }
        if let v = tgAmpMin, v >= 40, v <= 200 { tgAmpMinDeg = v }
        // Lock-validation knobs (spec T1-T4); validation ranges keep a fat-fingered admin
        // value from bricking measurement. See the knob declarations for ship defaults.
        if let v = tgConfirmBand, v >= 1 { self.tgConfirmBand = v }
        if let v = tgGuardMode, v >= 0, v <= 1 { self.tgGuardMode = v }
        if let v = tgGateMaxRej, v > 0, v <= 1 { self.tgGateMaxRej = v }
        if let v = tgAcquireMax, v >= 10, v <= 120 { self.tgAcquireMaxSec = v }
        if let v = liftAngle, v >= 20, v <= 80 { liftAngleDeg = v }
        if let v = tgSigma, v > 0 { tgSigmaGate = v }
        if let v = tgStabWin, v >= 2 { tgStabWindowSec = v }
        if let v = tgWallMin, v >= 3 { tgWallMinSec = v }
        if let v = tgStabTh, v > 0 { tgStabThresh = v }
        if let v = tgMaxWin, v >= 8, v <= 60 { tgMaxWindowSec = v }
        if let v = tgAgree, v > 0 { tgAgreeBand = v }
        peakRatioThreshold = max(1.0, thresh)
        bufferDurationSec = max(5, min(120, bufSec))
        if let v = regSkipPairs { regressionSkipPairs = v }
        if let v = regMinN { regNMinimum = v }
        if let v = wallMinSec { wallElapsedMinimum = v }
        if let v = stabWindow { stabilityWindow = v }
        if let v = stabThresh { stabilityThreshold = v }
        if let v = stabLoseThresh { stabilityLoseThreshold = v }
        if let v = maxPairThresh { maxAdaptiveThreshold = v }
        if let v = minPairThresh { minAdaptiveThreshold = v }
        if let v = coldStartThresh { coldStartThreshold = v }
        if let v = pairMadMult { adaptiveMultiplier = v }
        if let v = maxTickDevMs { maxTickDev = v }
        if let v = ringTargetRate { self.ringTargetRate = v }
        if let v = outlierMargin { self.outlierMargin = v }
        if let v = outlierMarginLowBph { self.outlierMarginLowBph = v }
        if let v = calibPercentile { self.calibPercentile = v }
        if let v = calibMultiplier { self.calibMultiplier = Float(v) }
        if let v = calibMultiplierRecal { self.calibMultiplierRecal = Float(v) }
        if let v = maxRecalibrations { self.maxRecalibrations = v }
        if let v = recalTriggerSec { self.recalTriggerSec = v }
        if let v = thresholdDecay { self.tickThresholdDecay = Float(v) }
        if let v = thresholdDecayNoTicks { self.tickThresholdDecayNoTicks = Float(v) }
        if let v = tickDetectMult { self.tickDetectMult = Float(v) }
        if let v = minSpacingMult { self.minSpacingMult = v }
        if let v = maxBphCorrections { self.maxBphCorrections = v }
        if let v = noiseFloorMult { self.noiseFloorMult = Float(v) }
        if let v = peakDetectGate { self.peakDetectGate = Float(v) }
        if let v = phaseLock { self.phaseLockEnabled = v }
        if let v = phaseLockWindow { self.phaseLockWindow = v }
        if let v = phaseLockMaxMiss { self.phaseLockMaxMiss = v }
        debugLog("[TGTUNE] regSkip=\(regressionSkipPairs) regMinN=\(regNMinimum) wallMin=\(wallElapsedMinimum) stabWin=\(stabilityWindow) stabThresh=\(stabilityThreshold) stabLose=\(stabilityLoseThreshold) maxPairTh=\(maxAdaptiveThreshold) minPairTh=\(minAdaptiveThreshold) coldStart=\(coldStartThreshold) madMult=\(adaptiveMultiplier) maxTickDev=\(maxTickDev) calibDur=\(calibrationDuration) ringTarget=\(self.ringTargetRate) outlier=\(self.outlierMargin)/\(self.outlierMarginLowBph) calibP=\(self.calibPercentile) calibM=\(self.calibMultiplier)/\(self.calibMultiplierRecal) maxRecal=\(self.maxRecalibrations) recalTrig=\(self.recalTriggerSec) decay=\(self.tickThresholdDecay)/\(self.tickThresholdDecayNoTicks) detectM=\(self.tickDetectMult) minSpace=\(self.minSpacingMult) maxBphCorr=\(self.maxBphCorrections) noiseFloor=\(self.noiseFloorMult) peakGate=\(self.peakDetectGate) phaseLock=\(self.phaseLockEnabled)/\(self.phaseLockWindow) tgKnobs=\(tgSigmaGate)/\(tgStabWindowSec)/\(tgWallMinSec)/\(tgStabThresh) maxWin=\(tgMaxWindowSec) agreeBand=\(tgAgreeBand) lift=\(liftAngleDeg) periodFit=\(self.tgPeriodFit) holdOnLock=\(self.tgHoldOnLock) ampMin=\(tgAmpMinDeg) confirmBand=\(self.tgConfirmBand) guardMode=\(self.tgGuardMode) gateMaxRej=\(self.tgGateMaxRej) acquireMax=\(self.tgAcquireMaxSec)")
    }

    // MARK: - Biquad HP filter

    private func makeBiquadHP(cutoff: Float, sampleRate: Double) -> BiquadState {
        let w0 = 2.0 * Float.pi * cutoff / Float(sampleRate)
        let cosW0 = cos(w0)
        let sinW0 = sin(w0)
        let alpha = sinW0 / (2.0 * 0.7071) // Q = 0.7071 (Butterworth)
        let a0 = 1.0 + alpha
        var state = BiquadState()
        state.b0 = (1.0 + cosW0) / 2.0 / a0
        state.b1 = -(1.0 + cosW0) / a0
        state.b2 = (1.0 + cosW0) / 2.0 / a0
        state.a1 = -2.0 * cosW0 / a0
        state.a2 = (1.0 - alpha) / a0
        state.cutoffHz = cutoff
        return state
    }

    private func applyBiquad(_ state: inout BiquadState, sample x: Float) -> Float {
        let y = state.b0 * x + state.b1 * state.x1 + state.b2 * state.x2
                - state.a1 * state.y1 - state.a2 * state.y2
        state.x2 = state.x1; state.x1 = x
        state.y2 = state.y1; state.y1 = y
        return y
    }

    func start(bph: Int, sensitivity: Int, useTgAlgo: Bool = false) {
        guard !isRunning else { return }
        self.useTgAlgo = useTgAlgo

        currentRate = nil
        currentBeatError = nil
        currentConfidence = 0
        currentDetectedInterval = 0
        detectedBph = nil
        currentNoiseLevel = 0
        sampleCounter = 0
        lastAnalysisTime = 0
        energyRingWritePos = 0
        energyRingAbs = 0
        tgDotNext = -1; tgDotPrevAbs = -1; tgDotPairAccum = 0; tgDotPairPhase = 0
        tgDotCumMs = 0; tgDotSkipPairs = 0; tgPendingDots = []
        energyRingCount = 0
        energySubsampleCounter = 0
        recentPeakEnergy = 0
        peakCount = 0
        activeHpIndex = 0
        detectionMethod = ""
        cumulativeOffsetMs = 0
        lastAnalysisElapsed = 0
        isAnalyzing = false
        tickDetectionActive = false
        tickDeviationMs = 0
        expectedTickInterval = 0
        lastTickRingPos = -1
        ringPosSinceLastTick = 0
        tickCount = 0
        pendingTicks = []
        tickThreshold = 0
        calibNoiseFloor = 0
        consecutiveFailures = 0
        lastTickDeviationCheck = 0
        lastTickCountCheck = 0
        regPoints = []; regN = 0; totalPairsAccepted = 0
        pairIntervalAccum = 0.0; pairTickPhase = 0; pairDeviationMs = 0
        lastTickFracOffset = 0; tickStartSample = 0
        pendingFirstTickDev = 0; pendingFirstTickTime = 0; pendingFirstTickInterval = 0; pendingFirstTickEnergy = 0
        recentPairDevs = []
        consecutivePairRejects = 0; rejectDevSum = 0; knownBeatError = 0; recentTickDevs = []; tickPhaseIndex = 0; beDevsByParity = [[], []]; phaseSepBeatError = nil
        bphCorrectionRejects = []; bphCorrectionOutliers = []; bphCorrectionAttempted = []; bphCorrectionCount = 0
        smoothedRate = nil; lastUpdateLogRegN = 0; rateHistory = []; wasStable = false
        lastDebugInfo = nil
        lastBeatWaveform = nil
        lastTickPositions = nil
        subsamplePeaks = [0, 0, 0]

        // Set BPH mode after all resets
        if bph == 0 {
            autoBph = true
            targetBph = 28800 // default until auto-detected
        } else {
            autoBph = false
            targetBph = bph
            detectedBph = bph // user-selected = immediately locked
        }
        tgRateCached = nil; tgBeCached = nil; tgAmpCached = nil; tgFoldCached = nil; lastTgComputeSec = -1; lastTgLogSec = -1
        tgLastLockAbs = -1; tgLastWindowSec = 0; tgGateRejects = 0; tgBeOnsetCached = nil; tgRecalSuppressed = false
        tgPendingLockRate = nil; tgPendingLockAbs = -1; tgLockConfirmed = false; tgLockRejects = 0
        tgGateEvents.removeAll(keepingCapacity: true); tgGateAttempts = 0
        clkHaveFirst = false; clkFirstHost = 0; clkFirstFrames = 0; clkFrames = 0; clkLastLogSec = -1; clkPpm = nil
        clkN = 0; clkSh = 0; clkSf = 0; clkShh = 0; clkShf = 0
        debugLog("[TGSTART] bph=\(bph) autoBph=\(autoBph) targetBph=\(targetBph) detectedBph=\(String(describing: detectedBph)) useTg=\(useTgAlgo)")

        do {
            let session = AVAudioSession.sharedInstance()
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .allowBluetoothA2DP, .defaultToSpeaker])
            try session.setPreferredSampleRate(48000)
            try session.setActive(true)

            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }

            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            actualSampleRate = format.sampleRate

            // Initialize 3 biquad HP filters
            hpFilters = hpCutoffs.map { makeBiquadHP(cutoff: $0, sampleRate: actualSampleRate) }

            // Ring buffer at target rate (default 24kHz, web-tunable)
            ringSubsampleTarget = max(1, Int(actualSampleRate / ringTargetRate))
            let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
            energyRingCapacity = Int(ringSampleRate * Double(bufferDurationSec))
            energyRings = (0..<3).map { _ in [Float](repeating: 0, count: energyRingCapacity) }

            inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, time in
                self?.noteAudioClock(time, frames: Int(buffer.frameLength))
                self?.processAudioBuffer(buffer)
            }

            try engine.start()
            isRunning = true
            installAudioObservers()

            // If BPH is user-selected, start tick detection immediately
            if !autoBph {
                activateTickDetection(ringSampleRate: ringSampleRate)
            }

        } catch {
            print("[Timegrapher] Audio setup error: \(error.localizedDescription)")
        }
    }

    /// Interruption/route/config observers. Without these, iOS killing the tap (call,
    /// Siri, alarm, AirPods connecting) leaves the session in a silent freeze: the
    /// [TGDEBUG] heartbeat is buffer-driven so it just stops, while the UI keeps showing
    /// "listening". PiezoEngine has had a route observer since day one; this engine —
    /// the one every mic session uses — never did.
    private func installAudioObservers() {
        removeAudioObservers()
        let nc = NotificationCenter.default
        interruptionObserver = nc.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in self?.handleAudioInterruption(note) }
        routeObserver = nc.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] note in self?.handleRouteChange(note) }
        // The engine object is replaced on every rebuild, so observe with object: nil
        // and let the handler consult current state.
        configObserver = nc.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self, self.isRunning else { return }
            // No debugLog before the tap is down: debugMessages is unsynchronised with
            // the audio thread, which may still be firing on a config change. The
            // [TGAUDIO RESUME] line inside the rebuild carries the reason.
            self.rebuildAudioAfterInterruption(reason: "config-change")
        }
    }

    private func removeAudioObservers() {
        let nc = NotificationCenter.default
        if let o = interruptionObserver { nc.removeObserver(o); interruptionObserver = nil }
        if let o = routeObserver { nc.removeObserver(o); routeObserver = nil }
        if let o = configObserver { nc.removeObserver(o); configObserver = nil }
    }

    private func handleAudioInterruption(_ note: Notification) {
        guard isRunning,
              let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            debugLog("[TGAUDIO INTERRUPT began]")
            onInterruption?("began")
        case .ended:
            // Attempt resume regardless of .shouldResume — worst case reactivation
            // throws and JS gets "failed" instead of an eternal frozen spinner.
            let opts = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map { AVAudioSession.InterruptionOptions(rawValue: $0) } ?? []
            debugLog("[TGAUDIO INTERRUPT ended] shouldResume=\(opts.contains(.shouldResume))")
            rebuildAudioAfterInterruption(reason: "interruption-ended")
        @unknown default:
            break
        }
    }

    private func handleRouteChange(_ note: Notification) {
        guard isRunning,
              let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        switch reason {
        case .oldDeviceUnavailable, .newDeviceAvailable, .categoryChange:
            // No debugLog here — the tap may still be firing (see config observer note).
            rebuildAudioAfterInterruption(reason: "route-change-\(raw)")
        default:
            break
        }
    }

    /// Tear the dead tap down and rebuild on the current session/route. Pre-gap audio is
    /// discarded (energyRingCount = 0) so no analysis window ever spans the seam — the
    /// tg windows refill from fresh audio within seconds; the tick detector recalibrates.
    /// A confirmed T1 lock survives (the watch didn't change); an unconfirmed pending one
    /// is cleared rather than confirmed across a gap of unknown length.
    private func rebuildAudioAfterInterruption(reason: String) {
        guard isRunning else { return }
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setActive(true)
            audioEngine = AVAudioEngine()
            guard let engine = audioEngine else { return }
            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)
            let rateChanged = abs(format.sampleRate - actualSampleRate) > actualSampleRate * 0.01
            if rateChanged {
                // New input hardware (e.g. AirPods mic) — re-derive everything that
                // hangs off the sample rate, exactly as start() does.
                actualSampleRate = format.sampleRate
                hpFilters = hpCutoffs.map { makeBiquadHP(cutoff: $0, sampleRate: actualSampleRate) }
                ringSubsampleTarget = max(1, Int(actualSampleRate / ringTargetRate))
                let rsr = actualSampleRate / Double(ringSubsampleTarget)
                energyRingCapacity = Int(rsr * Double(bufferDurationSec))
                energyRings = (0..<3).map { _ in [Float](repeating: 0, count: energyRingCapacity) }
                energyRingWritePos = 0
            }
            energyRingCount = 0                     // discard pre-gap audio; abs counter stays monotonic
            tgRateCached = nil; tgBeCached = nil; tgAmpCached = nil; tgFoldCached = nil
            if !tgLockConfirmed { tgPendingLockRate = nil; tgPendingLockAbs = -1 }
            // Audio-clock ppm estimator anchors are pre-gap — restart it.
            clkHaveFirst = false; clkFirstHost = 0; clkFirstFrames = 0; clkFrames = 0; clkLastLogSec = -1; clkPpm = nil
            clkN = 0; clkSh = 0; clkSf = 0; clkShh = 0; clkShf = 0
            let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
            inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, time in
                self?.noteAudioClock(time, frames: Int(buffer.frameLength))
                self?.processAudioBuffer(buffer)
            }
            try engine.start()
            if tickDetectionActive || !autoBph {
                tickDetectionActive = false          // force a fresh calibration pass
                activateTickDetection(ringSampleRate: ringSampleRate)
            }
            debugLog("[TGAUDIO RESUME] \(reason) rate=\(String(format: "%.0f", actualSampleRate)) rateChanged=\(rateChanged)")
            onInterruption?("resumed")
        } catch {
            debugLog("[TGAUDIO RESUME FAILED] \(reason): \(error.localizedDescription)")
            onInterruption?("failed")
        }
    }

    func stop() -> Result {
        isRunning = false
        removeAudioObservers()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return Result(rate: currentRate, beatError: currentBeatError,   // folded estimate: stable in the field. phaseSepBeatError rides per-tick devs that phase-walk (climb+flip) when watch rate != nominal BPH — kept for logging only (psBE= in TGTICK).
                      tickCount: peakCount, ticks: [])
    }

    deinit { removeAudioObservers() }

    /// Compare captured frames against the host clock. Runs on the audio thread, same as
    /// processAudioBuffer, so it shares debugMessages without extra synchronisation.
    /// `when.hostTime` stamps the FIRST frame of this buffer, so the frame count is read
    /// before the buffer is added.
    private func noteAudioClock(_ when: AVAudioTime, frames: Int) {
        guard when.isHostTimeValid else { clkFrames += Int64(frames); return }
        if !clkHaveFirst {
            clkHaveFirst = true
            clkFirstHost = when.hostTime
            clkFirstFrames = clkFrames
        } else if when.hostTime > clkFirstHost {
            let hostSec = AVAudioTime.seconds(forHostTime: when.hostTime - clkFirstHost)
            let frameSec = Double(clkFrames - clkFirstFrames) / actualSampleRate
            if hostSec > clkSettleSec, frameSec > 0 {
                clkN += 1
                clkSh += hostSec; clkSf += frameSec
                clkShh += hostSec * hostSec; clkShf += hostSec * frameSec
                let n = Double(clkN)
                let den = n * clkShh - clkSh * clkSh
                // Needs a real spread of host times before the slope means anything.
                if clkN >= 8, den > 1e-9 {
                    let slope = (n * clkShf - clkSh * clkSf) / den
                    let ppm = (slope - 1.0) * 1e6
                    clkPpm = ppm
                    let el = Double(sampleCounter) / actualSampleRate
                    if el - clkLastLogSec > 10 {
                        clkLastLogSec = el
                        debugLog(String(format: "[TGCLOCK] fs=%.0f host=%.3fs frames=%.3fs n=%d ppm=%+.2f (=%+.2f s/day)",
                                        actualSampleRate, hostSec, frameSec, clkN, ppm, ppm * 0.0864))
                    }
                }
            }
        }
        clkFrames += Int64(frames)
    }

    // MARK: - Per-sample processing

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard isRunning, let channelData = buffer.floatChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)

        var rms: Float = 0
        vDSP_rmsqv(channelData, 1, &rms, vDSP_Length(frameCount))
        currentNoiseLevel = min(1.0, Double(rms) * 10)

        for i in 0..<frameCount {
            let x = channelData[i]

            // Run through all 3 HP filters
            for f in 0..<3 {
                let hp = applyBiquad(&hpFilters[f], sample: x)
                let absHp = abs(hp)
                if absHp > subsamplePeaks[f] { subsamplePeaks[f] = absHp }
            }

            sampleCounter += 1

            energySubsampleCounter += 1
            if energySubsampleCounter >= ringSubsampleTarget {
                energySubsampleCounter = 0
                let peakEnergy = subsamplePeaks[0]
                for f in 0..<3 {
                    energyRings[f][energyRingWritePos] = subsamplePeaks[f]
                    subsamplePeaks[f] = 0
                }
                energyRingWritePos = (energyRingWritePos + 1) % energyRingCapacity
                energyRingAbs += 1
                energyRingCount = min(energyRingCount + 1, energyRingCapacity)

                if peakEnergy > recentPeakEnergy { recentPeakEnergy = peakEnergy }

                // Real-time tick detection on the active HP filter's energy
                if tickDetectionActive {
                    let energy = subsamplePeaks.isEmpty ? peakEnergy : energyRings[activeHpIndex][(energyRingWritePos - 1 + energyRingCapacity) % energyRingCapacity]

                    // Calibration phase: observe energy to learn tick amplitude, no ticks accepted
                    if tickCalibrating {
                        calibrationEnergies.append(energy)
                        calibrationSamples += 1
                        if calibrationSamples >= calibrationDuration {
                            tickCalibrating = false
                            // Robust percentile instead of peak: resists transient spikes (bumps, taps)
                            var sorted = calibrationEnergies
                            sorted.sort()
                            let pIdx = max(0, min(sorted.count - 1, Int(Double(sorted.count) * calibPercentile)))
                            let p98 = sorted[pIdx]
                            // Save noise floor (median energy) as threshold decay floor
                            let medIdx = sorted.count / 2
                            calibNoiseFloor = sorted[medIdx]
                            // Progressively softer threshold on each recalibration
                            let calibMult: Float = recalibrationsDone == 0 ? calibMultiplier : calibMultiplierRecal / Float(max(1, recalibrationsDone))
                            tickThreshold = p98 * calibMult
                            calibrationEnergies.removeAll(keepingCapacity: false)
                            tickStartSample = sampleCounter // reset elapsed to exclude calibration
                            debugLog("[TGCALIBRATED] tickThreshold=\(String(format: "%.6f", tickThreshold)) (p98=\(String(format: "%.6f", p98)) mult=\(calibMult)) after \(calibrationSamples) samples recal=\(recalibrationsDone)")
                        }
                        continue
                    }

                    ringPosSinceLastTick += 1
                    if plApplyCarry { ringPosSinceLastTick += plPendingCarry; plApplyCarry = false }

                    // Track peak energy; decay toward noise floor (not zero)
                    if energy > tickThreshold { tickThreshold = energy }
                    else {
                        tickThreshold *= (tickCount == 0 ? tickThresholdDecayNoTicks : tickThresholdDecay)
                        if noiseFloorMult > 0 {
                            let floor = calibNoiseFloor * noiseFloorMult
                            if tickThreshold < floor { tickThreshold = floor }
                        }
                    }
                    let threshold = tickThreshold * tickDetectMult

                    let minSpacing = Int(expectedTickInterval * minSpacingMult)
                    let ringSR = actualSampleRate / Double(ringSubsampleTarget)

                    // Debug: log every ~1 second
                    tickDebugInterval += 1
                    if tickDebugInterval % Int(ringSR) == 0 {
                        let elDbg = Double(sampleCounter - tickStartSample) / actualSampleRate
                        let rateStr = smoothedRate != nil ? String(format: "%.1f", smoothedRate!) : "nil"
                        debugLog("[TGDEBUG \(String(format: "%.1f", elDbg))s] energy=\(String(format: "%.6f", energy)) thresh=\(String(format: "%.6f", threshold)) tickThresh=\(String(format: "%.6f", tickThreshold)) tickCount=\(tickCount) regN=\(regN) pairDev=\(String(format: "%.2f", pairDeviationMs)) rate=\(rateStr)")

                        // Fallback recalibration: if calibration latched onto a transient and no ticks
                        // have been detected after recalTriggerSec, restart calibration with a fresh window.
                        // Skipped while the tg core has a lock — recalibrating also rewinds
                        // tickStartSample, which resets the tg convergence clock and throws away a
                        // measurement that was already converging.
                        if tickCount == 0 && elDbg > recalTriggerSec && tgHasRecentLock() {
                            if !tgRecalSuppressed {
                                tgRecalSuppressed = true
                                debugLog("[TGRECALIBRATE SKIP] tg core holds a lock (win=\(String(format: "%.0f", tgLastWindowSec))s) — not resetting the detector")
                            }
                        } else if tickCount == 0 && elDbg > recalTriggerSec && recalibrationsDone < maxRecalibrations {
                            // T4 pre-lock runway (dark unless tgAcquireMaxSec is raised past 15):
                            // while the tg core is actively evaluating windows, a zero-tick recal
                            // still reruns calibration but doesn't consume a teardown attempt —
                            // the tick detector must not exhaust its retries under a session the
                            // σ-gate is still working (deep dive 2026-08-15: 347/379 sessions
                            // dead at ~15 s had the gate counter climbing).
                            let tgRunway = useTgAlgo && tgAcquireMaxSec > 15.0
                                && elDbg < tgAcquireMaxSec && tgActivelyEvaluating()
                            if !tgRunway { recalibrationsDone += 1 }
                            tickCalibrating = true
                            plHaveCand = false; plBestDist = Int.max; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
                            calibrationSamples = 0
                            calibrationEnergies.removeAll(keepingCapacity: true)
                            tickThreshold = 0
                            tickStartSample = sampleCounter
                            pendingTickCross = false
                            debugLog("[TGRECALIBRATE] no ticks after \(String(format: "%.1f", elDbg))s — restarting calibration (attempt \(recalibrationsDone)/\(maxRecalibrations))\(tgRunway ? " [tg-runway: not counted]" : "")")
                        }
                    }

                    // Peak detection: wait for energy to decline past peak before firing
                    var shouldFireTick = false
                    let usesPeakDetect = energy > threshold * peakDetectGate
                    if energy > threshold && ringPosSinceLastTick >= minSpacing {
                        if usesPeakDetect {
                            if !pendingTickCross || energy > pendingTickPeakEnergy {
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
                    } else if pendingTickCross {
                        pendingTickCross = false
                        shouldFireTick = true
                    }

                    // Phase-locked selection: when locked, defer firing and pick the crest closest to
                    // the predicted tick time (ignores a louder twin ~3.5ms away). No-op pre-lock and
                    // on single-peak watches (one candidate in window => same tick as before).
                    let plActive = phaseLockEnabled && lastTickRingPos >= 0 && expectedTickInterval > 0
                    if plActive {
                        let expI = Int(expectedTickInterval)
                        let lo = Int(expectedTickInterval * (1.0 - phaseLockWindow))
                        let hi = Int(expectedTickInterval * (1.0 + phaseLockWindow))
                        if shouldFireTick {
                            let intv = ringPosSinceLastTick
                            if intv >= lo && intv <= hi {
                                let d = abs(intv - expI)
                                if !plHaveCand || d < plBestDist { plHaveCand = true; plBestInterval = intv; plBestDist = d }
                            }
                            shouldFireTick = false   // defer; decide at window close
                        }
                        if ringPosSinceLastTick > hi {
                            if plHaveCand {
                                plPendingCarry = ringPosSinceLastTick - plBestInterval
                                plApplyCarry = true
                                ringPosSinceLastTick = plBestInterval   // fire path reads this as the interval
                                shouldFireTick = true
                                plMissCount = 0
                            } else {
                                plMissCount += 1
                                ringPosSinceLastTick -= expI            // re-predict next beat
                                if plMissCount >= phaseLockMaxMiss { lastTickRingPos = -1; plMissCount = 0 }
                            }
                            plHaveCand = false; plBestDist = Int.max
                        }
                    }

                    if shouldFireTick {
                        let intInterval = ringPosSinceLastTick
                        let elapsedSec = Double(sampleCounter - tickStartSample) / actualSampleRate

                        // Sub-sample peak interpolation: parabolic fit on 3 energy values
                        var tickFracOffset: Double = 0.0
                        if intInterval >= 3 {
                            let ring = energyRings[activeHpIndex]
                            let n = (energyRingWritePos - 1 + energyRingCapacity) % energyRingCapacity
                            let nm1 = (n - 1 + energyRingCapacity) % energyRingCapacity
                            let nm2 = (n - 2 + energyRingCapacity) % energyRingCapacity
                            let en = Double(ring[n])
                            let enm1 = Double(ring[nm1])
                            let enm2 = Double(ring[nm2])

                            if enm1 >= en && enm1 >= enm2 && enm1 > 0 {
                                // Peak at nm1: parabola through nm2(-1), nm1(0), n(+1)
                                let d = enm2 - 2.0 * enm1 + en
                                if abs(d) > 1e-10 {
                                    let p = 0.5 * (enm2 - en) / d // offset from nm1
                                    tickFracOffset = -1.0 + max(-0.5, min(0.5, p))
                                } else {
                                    tickFracOffset = -1.0
                                }
                            }
                            // else: peak at current position, offset = 0
                        }

                        // Fractional interval = integer interval + this offset - last offset
                        let actualInterval = Double(intInterval) + tickFracOffset - lastTickFracOffset
                        lastTickFracOffset = tickFracOffset

                        if lastTickRingPos >= 0 {
                            // Outlier gate: wider for low-BPH (longer intervals = more timing jitter)
                            let margin = targetBph <= 21600 ? outlierMarginLowBph : outlierMargin
                            let ratio = actualInterval / expectedTickInterval
                            if ratio < (1.0 - margin) || ratio > (1.0 + margin) {
                                // Outlier — skip this tick, don't update deviation or regression
                                debugLog("[TGTICK SKIP @ \(String(format: "%.2f", elapsedSec))s] interval=\(String(format: "%.1f", actualInterval)) ratio=\(String(format: "%.3f", ratio)) OUTLIER")

                                // Track consistent outliers for BPH correction
                                bphCorrectionOutliers.append(ratio)
                                if bphCorrectionOutliers.count >= 8 && bphCorrectionCount < maxBphCorrections {
                                    let ratios = bphCorrectionOutliers.suffix(8)
                                    let meanRatio = ratios.reduce(0, +) / Double(ratios.count)
                                    let variance = ratios.map { ($0 - meanRatio) * ($0 - meanRatio) }.reduce(0, +) / Double(ratios.count)
                                    let stddev = sqrt(variance)
                                    if stddev < 0.05 {
                                        let impliedBph = Int(round(Double(targetBph) / meanRatio))
                                        var bestCandidate: Int? = nil
                                        var bestDist = Int.max
                                        for candidate in TimegrapherEngine.bphCandidates {
                                            let dist = abs(candidate - impliedBph)
                                            if dist < bestDist && candidate != targetBph {
                                                bestDist = dist
                                                bestCandidate = candidate
                                            }
                                        }
                                        if let newBph = bestCandidate, Double(bestDist) / Double(impliedBph) < 0.15 {
                                            debugLog("[TGBPH CORRECT OUTLIER] consistent ratio=\(String(format: "%.3f", meanRatio)) (stddev=\(String(format: "%.3f", stddev))) implies \(impliedBph) BPH → switching to \(newBph)")
                                            bphCorrectionAttempted.insert(targetBph)
                                            bphCorrectionAttempted.insert(newBph)
                                            bphCorrectionCount += 1
                                            targetBph = newBph
                                            detectedBph = newBph
                                            tickDetectionActive = false
                                            activateTickDetection(ringSampleRate: ringSR)
                                            lastTickRingPos = energyRingWritePos
                                            ringPosSinceLastTick = 0
                                            continue
                                        } else {
                                            bphCorrectionOutliers = []
                                        }
                                    }
                                }

                                lastTickRingPos = energyRingWritePos
                                ringPosSinceLastTick = 0
                            } else {
                                bphCorrectionOutliers = []
                                let deviationThisTick = (expectedTickInterval - actualInterval) / ringSR * 1000.0

                                // Individual tick deviation sanity check
                                if abs(deviationThisTick) > maxTickDev {
                                    debugLog("[TGTICK DEV_SKIP @ \(String(format: "%.2f", elapsedSec))s] dev=\(String(format: "%.1f", deviationThisTick))ms maxTickDev=\(String(format: "%.1f", maxTickDev))ms")
                                    // If mid-pair, discard the pair
                                    if pairTickPhase == 1 {
                                        pairIntervalAccum = 0
                                        pairTickPhase = 0
                                    }
                                    lastTickRingPos = energyRingWritePos
                                    ringPosSinceLastTick = 0
                                    continue
                                }

                                // Track individual tick deviations for beat error estimation
                                recentTickDevs.append(deviationThisTick)
                                if recentTickDevs.count > beatErrorWindowSize {
                                    recentTickDevs.removeFirst()
                                }
                                // Estimate beat error: median of |tickDev| (alternating ±BE pattern)
                                if recentTickDevs.count >= 10 {
                                    let absDevs = recentTickDevs.map { abs($0) }.sorted()
                                    knownBeatError = absDevs[absDevs.count / 2]
                                }

                                // Phase-separated beat error: split signed devs by skip-robust parity,
                                // BE = |mean(phase0) - mean(phase1)|. Only clean 1-step intervals contribute;
                                // skips advance the parity counter (>=2 steps) so phase never desyncs.
                                let beSteps = max(1, Int((actualInterval / expectedTickInterval).rounded()))
                                tickPhaseIndex += beSteps
                                if beSteps == 1 {
                                    let beP = tickPhaseIndex & 1
                                    beDevsByParity[beP].append(deviationThisTick)
                                    if beDevsByParity[beP].count > beBucketWindow { beDevsByParity[beP].removeFirst() }
                                    if beDevsByParity[0].count >= beMinPerBucket && beDevsByParity[1].count >= beMinPerBucket {
                                        let beM0 = beDevsByParity[0].reduce(0, +) / Double(beDevsByParity[0].count)
                                        let beM1 = beDevsByParity[1].reduce(0, +) / Double(beDevsByParity[1].count)
                                        phaseSepBeatError = (abs(beM0 - beM1) * 100).rounded() / 100
                                    }
                                }

                                // Pair-based: accumulate 2 ticks, validate pair before plotting
                                pairIntervalAccum += actualInterval
                                pairTickPhase += 1

                                if pairTickPhase == 1 {
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
                                let pairExpected = expectedTickInterval * 2.0
                                let pairDevThisPair = (pairExpected - pairIntervalAccum) / ringSR * 1000.0

                                // Track pair deviations for adaptive threshold (used for debug logging)
                                recentPairDevs.append(abs(pairDevThisPair))
                                if recentPairDevs.count > adaptiveWindowSize {
                                    recentPairDevs.removeFirst()
                                }
                                let pairThresh = currentPairThreshold()

                                // Phase recovery: detect mis-phased pairs (tick+tick or tock+tock)
                                // Match pairDev ≈ 1× or 2× beatError (±40%):
                                //   1× occurs when same-phase ticks pair up
                                //   2× occurs when both tick and tock are detected (alternating intervals)
                                let absDev = abs(pairDevThisPair)
                                let isMisPhased = knownBeatError >= 1.0 && (
                                    (absDev >= knownBeatError * 0.6 && absDev <= knownBeatError * 1.4) ||
                                    (absDev >= knownBeatError * 1.6 && absDev <= knownBeatError * 2.4)
                                )

                                if isMisPhased {
                                    consecutivePairRejects += 1
                                    rejectDevSum += abs(pairDevThisPair)
                                    debugLog("[TGPHASE REJECT #\(consecutivePairRejects) @ \(String(format: "%.2f", elapsedSec))s] pairDev=\(String(format: "%.3f", pairDevThisPair))ms beatErr=\(String(format: "%.1f", knownBeatError))ms")

                                    if consecutivePairRejects >= 2 {
                                        // Phase flip confirmed — skip one tick to realign
                                        // Keep current tick as "first" of next pair
                                        debugLog("[TGPHASE RECOVER @ \(String(format: "%.2f", elapsedSec))s] skipping tick to realign after \(consecutivePairRejects) rejects, avgDev=\(String(format: "%.1f", rejectDevSum / Double(consecutivePairRejects)))ms")
                                        pairTickPhase = 1
                                        pairIntervalAccum = actualInterval
                                        pendingFirstTickDev = deviationThisTick
                                        pendingFirstTickTime = elapsedSec
                                        pendingFirstTickInterval = actualInterval
                                        pendingFirstTickEnergy = energy
                                        consecutivePairRejects = 0
                                        rejectDevSum = 0
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
                                rejectDevSum = 0

                                // Pair gate: reject pairs with deviation above adaptive threshold
                                // Use tighter threshold for first 10 pairs after skip (adaptive not yet reliable)
                                let effectiveThresh = pairThresh
                                if abs(pairDevThisPair) > effectiveThresh {
                                    debugLog("[TGTICK PAIR_REJECT @ \(String(format: "%.2f", elapsedSec))s] pairDev=\(String(format: "%.3f", pairDevThisPair))ms thresh=\(String(format: "%.2f", effectiveThresh))ms")

                                    // Adaptive BPH correction: track consistent pair deviations
                                    // Guard: don't trigger during cold start (first 5s of tick detection)
                                    bphCorrectionRejects.append(pairDevThisPair)
                                    if bphCorrectionRejects.count >= 8 && bphCorrectionCount < maxBphCorrections && elapsedSec >= 5.0 {
                                        let devs = bphCorrectionRejects.suffix(8)
                                        let meanDev = devs.reduce(0, +) / Double(devs.count)
                                        let variance = devs.map { ($0 - meanDev) * ($0 - meanDev) }.reduce(0, +) / Double(devs.count)
                                        let stddev = sqrt(variance)
                                        // Consistent if stddev < 30% of |mean| and mean is significant (>2ms)
                                        if abs(meanDev) > 2.0 && stddev < abs(meanDev) * 0.3 {
                                            let ringSR = actualSampleRate / Double(ringSubsampleTarget)
                                            let actualPairSamples = expectedTickInterval * 2.0 - (meanDev * ringSR / 1000.0)
                                            let actualTickHz = ringSR / (actualPairSamples / 2.0)
                                            let impliedBph = Int(round(actualTickHz * 3600.0))
                                            // Find nearest standard BPH candidate
                                            var bestCandidate: Int? = nil
                                            var bestDist = Int.max
                                            for candidate in TimegrapherEngine.bphCandidates {
                                                let dist = abs(candidate - impliedBph)
                                                if dist < bestDist && !bphCorrectionAttempted.contains(candidate) && candidate != targetBph {
                                                    bestDist = dist
                                                    bestCandidate = candidate
                                                }
                                            }
                                            // Switch if nearest candidate is within 15% of implied BPH
                                            if let newBph = bestCandidate, Double(bestDist) / Double(impliedBph) < 0.15 {
                                                debugLog("[TGBPH CORRECT] consistent pairDev=\(String(format: "%.1f", meanDev))ms (stddev=\(String(format: "%.1f", stddev))ms) implies \(impliedBph) BPH → switching to \(newBph)")
                                                bphCorrectionAttempted.insert(targetBph)
                                                bphCorrectionAttempted.insert(newBph)
                                                bphCorrectionCount += 1
                                                targetBph = newBph
                                                detectedBph = newBph
                                                // Restart tick detection with new BPH
                                                tickDetectionActive = false
                                                activateTickDetection(ringSampleRate: ringSR)
                                                lastTickRingPos = energyRingWritePos
                                                ringPosSinceLastTick = 0
                                                continue
                                            } else {
                                                // No standard BPH matches — likely a calibration issue
                                                // (threshold too high, only detecting every Nth tick)
                                                // Force softer recalibration if not already exhausted
                                                debugLog("[TGBPH REJECT] implied \(impliedBph) BPH — no standard candidate. Forcing soft recalibration.")
                                                bphCorrectionRejects = []
                                                if recalibrationsDone < maxRecalibrations && !tgHasRecentLock() {
                                                    recalibrationsDone += 1
                                                    tickCalibrating = true
                                                    plHaveCand = false; plBestDist = Int.max; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
                                                    calibrationSamples = 0
                                                    calibrationEnergies.removeAll(keepingCapacity: true)
                                                    tickThreshold = 0
                                                    tickCount = 0
                                                    pairIntervalAccum = 0; pairTickPhase = 0
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
                                bphCorrectionRejects = []

                                // Update tick count
                                tickCount += 2
                                totalPairsAccepted += 1

                                // Skip first N pairs entirely (threshold still adapting,
                                // early pairs can have huge deviations that corrupt cumulative tracking)
                                if totalPairsAccepted <= regressionSkipPairs {
                                    debugLog("[TGTICK SKIP-EARLY #\(tickCount) @ \(String(format: "%.2f", elapsedSec))s] pairDev=\(String(format: "%.3f", pairDevThisPair))ms (skipped, pair \(totalPairsAccepted)/\(regressionSkipPairs))")
                                    lastTickRingPos = energyRingWritePos
                                    ringPosSinceLastTick = 0
                                    continue
                                }

                                // Accumulate cumulative deviation only after skip period
                                pairDeviationMs += pairDevThisPair
                                regPoints.append((x: elapsedSec, y: pairDeviationMs))
                                regN = regPoints.count

                                // Plot single dot at pair midpoint using cumulative pairDev
                                let pairMidTime = (pendingFirstTickTime + elapsedSec) / 2.0
                                pendingTicks.append(TickDot(timeSec: pairMidTime, deviationMs: pairDeviationMs))
                                debugLog("[TGTICK #\(tickCount) @ \(String(format: "%.2f", pairMidTime))s] pairDev=\(String(format: "%.3f", pairDevThisPair))ms cumPairDev=\(String(format: "%.3f", pairDeviationMs))ms thresh=\(String(format: "%.2f", pairThresh))ms beatErr=\(String(format: "%.1f", knownBeatError))ms ticks=\(String(format: "%.1f", pendingFirstTickDev)),\(String(format: "%.1f", deviationThisTick))ms psBE=\(phaseSepBeatError.map { String(format: "%.2f", $0) } ?? "-")ms foldedBE=\(currentBeatError.map { String(format: "%.2f", $0) } ?? "-")ms energy=\(String(format: "%.6f", energy))")

                                // Debug: log regression rate every 25 pairs (~50 ticks)
                                if regN % 25 == 0 && regN >= 20 {
                                    if let slope = theilSenSlope() {
                                        let regRate = slope * 86.4
                                        debugLog("[TGRATE @ tick \(tickCount)] regN=\(regN) slope=\(String(format: "%.6f", slope))ms/s rate=\(String(format: "%.1f", regRate))s/day pairDev=\(String(format: "%.3f", pairDeviationMs))ms")
                                    }
                                }

                                // Sanity check every 100 ticks
                                if tickCount - lastTickCountCheck >= 100 && lastTickCountCheck > 0 {
                                    let dtCheck = max(1.0, elapsedSec)
                                    let deviationRate = abs(pairDeviationMs) / dtCheck
                                    if deviationRate > 50.0 {
                                        debugLog("[TGSANITY RESET] devRate=\(String(format: "%.1f", deviationRate))ms/s pairDev=\(String(format: "%.1f", pairDeviationMs))ms")
                                        tickDetectionActive = false
                                        pendingTicks = []
                                        tickCount = 0
                                        tickDeviationMs = 0
                                        pairDeviationMs = 0; pairIntervalAccum = 0.0; pairTickPhase = 0; lastTickFracOffset = 0
                                        pendingTickCross = false; pendingTickPeakEnergy = 0; plHaveCand = false; plBestDist = Int.max; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
                                        consecutivePairRejects = 0; rejectDevSum = 0; knownBeatError = 0; recentTickDevs = []; tickPhaseIndex = 0; beDevsByParity = [[], []]; phaseSepBeatError = nil
                                        regPoints = []; regN = 0; recentPairDevs = []; totalPairsAccepted = 0
                                        smoothedRate = nil; lastUpdateLogRegN = 0; rateHistory = []; wasStable = false
                                        if autoBph { detectedBph = nil; consecutiveFailures = 0 }
                                    }
                                    lastTickCountCheck = tickCount
                                    lastTickDeviationCheck = pairDeviationMs
                                }
                            }
                        } else {
                            // First tick — reference point, no plot (will be part of first pair)
                            debugLog("[TGTICK FIRST @ \(String(format: "%.2f", elapsedSec))s] energy=\(String(format: "%.6f", energy)) threshold=\(String(format: "%.6f", threshold))")
                        }
                        lastTickRingPos = energyRingWritePos
                        ringPosSinceLastTick = 0
                    }
                }
            }
        }

        // Analyze every ~1 second, after at least 5 seconds of data
        // Run on background queue to avoid blocking audio thread
        let now = CACurrentMediaTime() * 1000
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let elapsedSec = Double(energyRingCount) / ringSampleRate
        if now - lastAnalysisTime > 1000 && elapsedSec >= 5 && !isAnalyzing {
            lastAnalysisTime = now
            isAnalyzing = true
            // Snapshot ring data for background analysis
            let count = energyRingCount
            var signals = [[Float]]()
            for f in 0..<3 { signals.append(linearize(ringIndex: f, count: count)) }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.analyze(signals: signals, count: count, ringSampleRate: ringSampleRate)
                self?.isAnalyzing = false
            }
        }

        // Drain pending ticks
        var ticks = pendingTicks
        if useTgAlgo { ticks = tgPendingDots; tgPendingDots = [] }   // tg path: dots come from the tg grid, not the detector
        pendingTicks = []

        // Compute rate from Theil-Sen median regression on ALL accepted pairs
        var rateForUpdate: Double? = nil
        let wallElapsed = Double(sampleCounter - tickStartSample) / actualSampleRate
        // tg rate is expensive (FFT over up to 16s of ring) — refresh at most ~2x/sec and cache.
        if wallElapsed - lastTgComputeSec > 0.5 {
            lastTgComputeSec = wallElapsed
            tgRateCached = computeTgRate()
            // Fold + amplitude compute even when the toggle is off, so silent/shadow
            // sessions log amplitude in [TGALGO] too. Display stays gated on useTgAlgo.
            let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
            let nominal = 7200.0 / Double(targetBph) * ringSampleRate
            let env8 = recentEnvelope(Int(ringSampleRate * 8))
            if let period = tgPeriod(env8, nominal: nominal, ringSampleRate: ringSampleRate) {
                if let fold = tgFoldedBeat(period: period) {
                    tgFoldCached = fold
                    tgAmpCached = tgAmplitude(fold: fold, period: period)
                    tgBeCached = tgBeatError(fold: fold, period: period, ringSampleRate: ringSampleRate)
                }
                if useTgAlgo { tgTrackDots(period: period, ringSampleRate: ringSampleRate, wallElapsed: wallElapsed) }
            }
        }
        // Pick the rate source: tg autocorrelation-period (when toggled) or Theil-Sen regression.
        let regRateLog: Double? = (regN >= regNMinimum) ? theilSenSlope().map { $0 * 86.4 } : nil
        var candidate: Double? = nil
        if useTgAlgo {
            candidate = tgRateCached
        } else if let rr = regRateLog, abs(rr) <= 200.0 {
            candidate = rr
        }
        if let r = candidate {
            smoothedRate = r
            rateForUpdate = (r * 10).rounded() / 10
            // Track rate history for stability detection
            rateHistory.append((time: wallElapsed, rate: r))
            // Prune old entries beyond stability window
            rateHistory.removeAll { wallElapsed - $0.time > stabilityWindow + 5 }
        }
        // Log BOTH rates every ~2s so we get a free offline A/B even when the toggle is off.
        if wallElapsed - lastTgLogSec > 2.0 {
            lastTgLogSec = wallElapsed
            // win= is the analysis window the headline rate came from and gate= the running
            // sigma-gate rejection count: without them a bad reading could not be attributed
            // to a short window after the fact (audit 2026-07-31).
            debugLog("[TGALGO @ \(String(format: "%.0f", wallElapsed))s] useTg=\(useTgAlgo) reg=\(regRateLog.map { String(format: "%+.1f", $0) } ?? "nil") tg=\(tgRateCached.map { String(format: "%+.1f", $0) } ?? "nil") amp=\(tgAmpCached.map { String(format: "%.0f", $0) } ?? "nil") be=\(tgBeCached.map { String(format: "%.2f", $0) } ?? "nil") beOn=\(tgBeOnsetCached.map { String(format: "%.2f", $0) } ?? "nil") win=\(String(format: "%.0f", tgLastWindowSec))s gate=\(tgGateRejects) ga=\(tgGateAttempts) fit=\(tgPeriodFit) lc=\(tgLockConfirmed ? 1 : 0) lr=\(tgLockRejects) ppm=\(clkPpm.map { String(format: "%+.2f", $0) } ?? "nil")")
        }

        // Stability: rate has stayed within ±threshold for the full stability window
        // Uses hysteresis: easier to gain stability (3 s/day), harder to lose it (5 s/day)
        var isStable = wasStable
        if smoothedRate != nil {
            // tg's rate is a precise per-window period measurement that settles fast, so it can
            // converge on a much shorter window/wall-min than the regression's slow slope.
            let effWindow = useTgAlgo ? tgStabWindowSec : stabilityWindow
            let effWallMin = useTgAlgo ? tgWallMinSec : wallElapsedMinimum
            let effThresh = useTgAlgo ? tgStabThresh : stabilityThreshold
            let recentRates = rateHistory.filter { wallElapsed - $0.time <= effWindow }
            if recentRates.count >= 5 && wallElapsed >= effWallMin {
                let rateMin = recentRates.map(\.rate).min()!
                let rateMax = recentRates.map(\.rate).max()!
                let spread = rateMax - rateMin
                if wasStable {
                    isStable = spread <= (useTgAlgo ? tgStabThresh * 1.7 : stabilityLoseThreshold)
                } else {
                    isStable = spread <= effThresh
                }
            }
        }
        // T1/T3 (dark at ship defaults): a tg session cannot GAIN stability on an
        // unconfirmed lock, nor while the σ-gate is rejecting most windows. The rate
        // series is built from overlapping reads of one ring, so its "stability" cannot
        // distinguish a right lock from a confident wrong one — the disjoint-segment
        // confirmation can. Losing stability is unaffected.
        if useTgAlgo && isStable && !wasStable {
            if tgConfirmBand < 900 && !tgLockConfirmed { isStable = false }
            if tgGateMaxRej < 1.0, let rf = tgGateRejFraction(), rf > tgGateMaxRej { isStable = false }
        }
        wasStable = isStable

        // Confidence based on pair count
        let tickConfidence = regN >= 5 ? min(0.99, Double(regN) / 250.0 + 0.3) : 0.0

        // Debug: log rate update every 8 new pairs
        if regN > 0 && regN - lastUpdateLogRegN >= 8 {
            lastUpdateLogRegN = regN
            debugLog("[TGUPDATE] elapsed=\(String(format: "%.1f", wallElapsed))s rate=\(rateForUpdate != nil ? String(format: "%.1f", rateForUpdate!) : "nil") stable=\(isStable) conf=\(String(format: "%.2f", tickConfidence)) regN=\(regN) tickCount=\(tickCount) cumDev=\(String(format: "%.2f", pairDeviationMs))ms")
        }

        // Drain debug messages
        let dbgMsgs = debugMessages
        debugMessages = []

        // T3/T4 surface state (inert until the knobs are flipped; JS ignores unknown keys)
        var sigQuality: String? = nil
        if useTgAlgo {
            if let rf = tgGateRejFraction() {
                sigQuality = rf > 0.5 ? "poor" : (rf > 0.2 ? "fair" : "good")
            } else if tgRateCached != nil {
                sigQuality = "good"
            }
        }
        let acquiring = useTgAlgo && tgRateCached == nil
            && wallElapsed < tgAcquireMaxSec && tgActivelyEvaluating()

        let update = Update(
            rate: rateForUpdate, beatError: useTgAlgo ? tgBeCached : currentBeatError,   // tg path: fold-based BE; legacy folded estimate: stable in the field. phaseSepBeatError rides per-tick devs that phase-walk (climb+flip) when watch rate != nominal BPH — kept for logging only (psBE= in TGTICK).
            tickCount: tickCount,
            confidence: tickConfidence, noiseLevel: currentNoiseLevel,
            detectedIntervalMs: expectedTickInterval > 0 ? 1000.0 / (actualSampleRate / Double(ringSubsampleTarget) / expectedTickInterval) : 0,
            detectedBph: detectedBph,
            debug: lastDebugInfo,
            beatWaveform: useTgAlgo ? (tgFoldCached ?? lastBeatWaveform) : lastBeatWaveform,
            amplitude: useTgAlgo ? tgAmpCached : nil,
            tickPositions: lastTickPositions,
            cumulativeOffset: pairDeviationMs,
            elapsedSec: wallElapsed,
            method: regN >= regNMinimum ? "Ticks" : "",
            rateStable: isStable,
            tgSignalQuality: sigQuality,
            tgAcquiring: acquiring,
            newTicks: ticks,
            debugMessages: dbgMsgs)
        DispatchQueue.main.async { [weak self] in self?.onUpdate?(update) }
    }

    // MARK: - Combined analysis: Goertzel primary + autocorrelation fallback

    private func analyze(signals: [[Float]], count: Int, ringSampleRate: Double) {
        // Phase 1: Auto BPH detection (only if BPH not yet locked)
        if autoBph && detectedBph == nil {
            // Try all 3 HP cutoffs for better discrimination
            var bestCandidate: (bph: Int, ratio: Double) = (0, 0)
            var secondBestRatio: Double = 0
            for f in 0..<3 {
                var ratios: [(bph: Int, ratio: Double)] = []
                for candidate in TimegrapherEngine.bphCandidates {
                    let tf = Double(candidate) / 3600.0
                    let ratio = goertzelRatio(signals[f], count: count, tickFreq: tf, sampleRate: ringSampleRate)
                    ratios.append((bph: candidate, ratio: ratio))
                }
                ratios.sort { $0.ratio > $1.ratio }
                if ratios[0].ratio > bestCandidate.ratio {
                    bestCandidate = ratios[0]
                    secondBestRatio = ratios.count > 1 ? ratios[1].ratio : 0
                }
            }

            // Require: (1) above threshold, (2) decisively better than runner-up (1.5x)
            let elSec = Double(count) / ringSampleRate
            debugLog("[TGAUTO BPH @ \(String(format: "%.1f", elSec))s] best=\(bestCandidate.bph) ratio=\(String(format: "%.2f", bestCandidate.ratio)) 2nd=\(String(format: "%.2f", secondBestRatio)) threshold=\(peakRatioThreshold) decisive=\(bestCandidate.ratio >= secondBestRatio * 1.5)")
            if bestCandidate.ratio > Double(peakRatioThreshold) && (secondBestRatio < 1.0 || bestCandidate.ratio >= secondBestRatio * 1.5) {
                targetBph = bestCandidate.bph
                detectedBph = bestCandidate.bph
                debugLog("[TGAUTO BPH LOCKED] \(bestCandidate.bph)")
                activateTickDetection(ringSampleRate: ringSampleRate)
            }
            // If not locked yet, just return — ticks will start once BPH locks
            if detectedBph == nil {
                recentPeakEnergy *= 0.95
                return
            }
        }

        // Phase 2: BPH is locked — only compute beat error via epoch folding
        // Rate comes from tick regression (computed in processAudioBuffer), not Goertzel
        if !tickDetectionActive {
            activateTickDetection(ringSampleRate: ringSampleRate)
        }
        // Epoch fold for beat error on the lowest HP cutoff signal
        detectTickEvents(signal: signals[0], count: count, ringSampleRate: ringSampleRate)
        recentPeakEnergy *= 0.95
    }

    /// Lightweight ratio-only Goertzel — no sweep, just target vs baselines.
    private func goertzelRatio(_ signal: [Float], count: Int, tickFreq: Double, sampleRate: Double) -> Double {
        let tp = goertzelPower(signal, count: count, targetFreq: tickFreq, sampleRate: sampleRate)
        let mults = [0.73, 0.81, 1.19, 1.37, 1.61]
        var blSum = 0.0
        for m in mults { blSum += goertzelPower(signal, count: count, targetFreq: tickFreq * m, sampleRate: sampleRate) }
        let bl = blSum / Double(mults.count)
        return bl > 0 ? tp / bl : (tp > 0 ? 10.0 : 0)
    }

    private func updateCumulativeOffset(rate: Double, elapsedSec: Double) {
        if lastAnalysisElapsed > 0 {
            let dt = elapsedSec - lastAnalysisElapsed
            cumulativeOffsetMs += (rate / 86400.0) * dt * 1000.0
        }
        lastAnalysisElapsed = elapsedSec
    }

    private func activateTickDetection(ringSampleRate: Double) {
        guard !tickDetectionActive else { return }
        tickDetectionActive = true
        expectedTickInterval = ringSampleRate / (Double(targetBph) / 3600.0)
        tickDeviationMs = 0
        lastTickRingPos = -1
        ringPosSinceLastTick = 0
        tickCount = 0
        pendingTicks = []
        tickDebugInterval = 0
        pairIntervalAccum = 0.0; pairTickPhase = 0; pairDeviationMs = 0
        lastTickFracOffset = 0
        recentPairDevs = []
        pendingTickCross = false; pendingTickPeakEnergy = 0; plHaveCand = false; plBestDist = Int.max; plMissCount = 0; plApplyCarry = false; plPendingCarry = 0
        consecutivePairRejects = 0; rejectDevSum = 0; knownBeatError = 0; recentTickDevs = []; tickPhaseIndex = 0; beDevsByParity = [[], []]; phaseSepBeatError = nil
        bphCorrectionOutliers = []
        // Note: bphCorrectionRejects intentionally NOT cleared — accumulates across recalibrations
        smoothedRate = nil; lastUpdateLogRegN = 0; rateHistory = []; wasStable = false
        regPoints = []; regN = 0; totalPairsAccepted = 0
        // Start calibration: observe energy for 2s to learn tick amplitude before accepting ticks
        // Always calibrate for 2 seconds regardless of ring rate or JS-supplied value
        let calibSamples = Int(ringSampleRate * 2.0)
        calibrationDuration = calibSamples
        tickThreshold = 0
        tickCalibrating = true
        calibrationSamples = 0
        calibrationEnergies.removeAll(keepingCapacity: true)
        recalibrationsDone = 0
        tickStartSample = sampleCounter
        debugLog("[TGACTIVATE] bph=\(targetBph) autoBph=\(autoBph) expectedInterval=\(String(format: "%.1f", expectedTickInterval)) ringSR=\(String(format: "%.0f", ringSampleRate)) CALIBRATING for \(calibrationDuration) samples")
    }

    private func applyResult(rate: Double, ratio: Double, detectedFreq: Double,
                             ringSampleRate: Double, count: Int) {
        currentRate = (rate * 10).rounded() / 10
        currentDetectedInterval = (1.0 / detectedFreq) * 1000.0
        detectedBph = targetBph

        // Activate tick detection on first successful detection
        consecutiveFailures = 0
        if !tickDetectionActive { activateTickDetection(ringSampleRate: ringSampleRate) }

        let elapsedSec = Double(count) / ringSampleRate
        let durationFactor = min(1.0, elapsedSec / 60.0)
        let peakFactor = min(1.0, max(0, (ratio - 1.0) / 9.0))
        currentConfidence = min(0.99, ((peakFactor * (0.3 + 0.7 * durationFactor)) * 100).rounded() / 100)
        peakCount = tickCount > 0 ? tickCount : Int(elapsedSec * Double(targetBph) / 3600.0)

        lastDebugInfo = DebugInfo(
            sampleRate: actualSampleRate, fftSize: energyRingCount, bufferSamples: count,
            hpCutoff: Double(hpCutoffs[activeHpIndex]), bestLag: targetBph,
            bestCorrelation: ratio, refinedLag: detectedFreq, noiseFloor: 0,
            threshold: ratio, peakEnergy: Double(recentPeakEnergy),
            allBphCorrelations: [
                (bph: targetBph, correlation: Float(ratio), lag: Int(detectedFreq * 1000))
            ])
        recentPeakEnergy *= 0.95
    }

    // MARK: - Linearize ring buffer

    private func linearize(ringIndex f: Int, count: Int) -> [Float] {
        var signal = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let idx = (energyRingWritePos - count + i + energyRingCapacity) % energyRingCapacity
            signal[i] = energyRings[f][idx]
        }
        return signal
    }

    // MARK: - Goertzel detection + rate sweep

    private func goertzelPower(_ signal: [Float], count: Int, targetFreq: Double, sampleRate: Double) -> Double {
        let k = targetFreq * Double(count) / sampleRate
        let w = 2.0 * Double.pi * k / Double(count)
        let coeff = Float(2.0 * cos(w))
        var s1: Float = 0, s2: Float = 0
        for i in 0..<count {
            let s0 = signal[i] + coeff * s1 - s2
            s2 = s1
            s1 = s0
        }
        let power = Double(s1 * s1 + s2 * s2 - coeff * s1 * s2)
        return power / Double(count * count)
    }

    /// Returns (ratio, rate, detectedFreq). rate is nil if ratio below threshold.
    private func tryGoertzel(_ signal: [Float], count: Int, tickFreq: Double, ringSampleRate: Double) -> (Double, Double?, Double) {
        let targetPower = goertzelPower(signal, count: count, targetFreq: tickFreq, sampleRate: ringSampleRate)

        let baselineMultipliers = [0.73, 0.81, 1.19, 1.37, 1.61]
        var baselineSum = 0.0
        for mult in baselineMultipliers {
            baselineSum += goertzelPower(signal, count: count, targetFreq: tickFreq * mult, sampleRate: ringSampleRate)
        }
        let baseline = baselineSum / Double(baselineMultipliers.count)
        let ratio = baseline > 0 ? targetPower / baseline : (targetPower > 0 ? 10.0 : 0)

        guard ratio > Double(peakRatioThreshold) else {
            return (ratio, nil, tickFreq)
        }

        // Fine frequency sweep ±0.5%
        let sweepRange = tickFreq * 0.005
        let steps = 201
        var bestPower = 0.0
        var bestIdx = steps / 2
        var sweepPowers = [Double](repeating: 0, count: steps)

        for i in 0..<steps {
            let f = tickFreq - sweepRange + (2.0 * sweepRange * Double(i) / Double(steps - 1))
            let p = goertzelPower(signal, count: count, targetFreq: f, sampleRate: ringSampleRate)
            sweepPowers[i] = p
            if p > bestPower { bestPower = p; bestIdx = i }
        }

        let df = 2.0 * sweepRange / Double(steps - 1)
        var detectedFreq = tickFreq - sweepRange + df * Double(bestIdx)
        if bestIdx > 0 && bestIdx < steps - 1 {
            let a = sweepPowers[bestIdx - 1]
            let b = sweepPowers[bestIdx]
            let c = sweepPowers[bestIdx + 1]
            let denom = 2.0 * (2.0 * b - a - c)
            if abs(denom) > 1e-30 {
                detectedFreq += (a - c) / denom * df
            }
        }

        let rate = ((detectedFreq - tickFreq) / tickFreq) * 86400.0
        return (ratio, abs(rate) <= 120.0 ? rate : nil, detectedFreq)
    }

    // MARK: - FFT Autocorrelation fallback

    /// Returns (confidence, rate, detectedFreq). rate is nil if not confident.
    private func tryAutocorrelation(_ signal: [Float], count: Int, tickFreq: Double, ringSampleRate: Double) -> (Double, Double?, Double) {
        // Rectify and remove mean
        var rect = [Float](repeating: 0, count: count)
        for i in 0..<count { rect[i] = abs(signal[i]) }
        var mean: Float = 0
        vDSP_meanv(rect, 1, &mean, vDSP_Length(count))
        var negMean = -mean
        vDSP_vsadd(rect, 1, &negMean, &rect, 1, vDSP_Length(count))

        // Cosine taper (10% each end)
        let tl = Int(Double(count) * 0.1)
        for i in 0..<tl {
            let w = Float(0.5 * (1.0 - cos(Double.pi * Double(i) / Double(tl))))
            rect[i] *= w
            rect[count - 1 - i] *= w
        }

        // FFT autocorrelation via Accelerate
        let acorr = fftAutocorrelation(rect, count: count)
        guard acorr.count >= count else { return (0, nil, tickFreq) }

        // Search for peak near expected period
        let expectedPeriod = ringSampleRate / tickFreq
        let lo = max(1, Int(expectedPeriod * 0.95))
        let hi = min(count - 2, Int(expectedPeriod * 1.05))
        guard lo < hi else { return (0, nil, tickFreq) }

        var peakIdx = lo
        var peakVal = acorr[lo]
        for i in (lo + 1)...hi {
            if acorr[i] > peakVal { peakVal = acorr[i]; peakIdx = i }
        }

        // Confidence: peak vs mean in search range
        var segMean: Float = 0
        var segAbs = [Float](repeating: 0, count: hi - lo + 1)
        for i in lo...hi { segAbs[i - lo] = abs(acorr[i]) }
        vDSP_meanv(segAbs, 1, &segMean, vDSP_Length(segAbs.count))
        let conf = segMean > 0 ? Double(peakVal / segMean) : 0

        guard conf > 1.5 else { return (conf, nil, tickFreq) }

        // Parabolic interpolation for sub-sample precision
        var refined: Double
        if peakIdx > 0 && peakIdx < count - 1 {
            let a = Double(acorr[peakIdx - 1])
            let b = Double(acorr[peakIdx])
            let c = Double(acorr[peakIdx + 1])
            let d = 2.0 * (2.0 * b - a - c)
            refined = abs(d) > 1e-30 ? Double(peakIdx) + (a - c) / d : Double(peakIdx)
        } else {
            refined = Double(peakIdx)
        }

        // Harmonic refinement: check 2nd–5th harmonics
        var periods = [refined]
        for mult in 2...5 {
            let expM = refined * Double(mult)
            let loM = Int(expM - refined * 0.01)
            let hiM = Int(expM + refined * 0.01)
            guard hiM < count - 1 && loM > 0 else { break }

            var pkIdx = loM
            var pkVal = acorr[loM]
            for i in (loM + 1)...hiM {
                if acorr[i] > pkVal { pkVal = acorr[i]; pkIdx = i }
            }

            var pkR: Double
            if pkIdx > 0 && pkIdx < count - 1 {
                let a = Double(acorr[pkIdx - 1])
                let b = Double(acorr[pkIdx])
                let c = Double(acorr[pkIdx + 1])
                let d = 2.0 * (2.0 * b - a - c)
                pkR = abs(d) > 1e-30 ? Double(pkIdx) + (a - c) / d : Double(pkIdx)
            } else {
                pkR = Double(pkIdx)
            }
            periods.append(pkR / Double(mult))
        }

        // Median of all period estimates
        periods.sort()
        let finalPeriod = periods[periods.count / 2]
        let detFreq = ringSampleRate / finalPeriod
        let rate = ((detFreq - tickFreq) / tickFreq) * 86400.0

        return (conf, abs(rate) <= 120.0 ? rate : nil, detFreq)
    }

    // MARK: - tg-style detection core (rate via autocorrelation period, not beat regression)
    // Reference: docs/research/2026-07-03-tg-algorithm-learnings.md. Toggled by useTgAlgo.

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
    private var tgBeOnsetCached: Double? = nil  // shadow onset-based beat error (logged, not displayed)
    private var tgRecalSuppressed = false // logged once per session when tgHoldOnLock first blocks a recalibration

    // Lock-validation knobs (docs/spec-tg-lock-validation.md, 2026-08-15). ALL ship defaults
    // reproduce 2.4 behaviour exactly — the bundle rides DARK in the 2.5 binary and each knob
    // is flipped server-side, one per weekly cycle. Evidence for the defaults being inert:
    // confirmBand >= 900 marks every lock confirmed; guardMode 0 is the 2.4 median fallback
    // bit for bit; gateMaxRej 1.0 can never exceed a fraction; acquireMax 15 matches the
    // teardown timing the recal loop already produces.
    private var tgConfirmBand = 999.0   // T1: disjoint-segment confirm band (s/day); >= 900 = off. Staged target: 6.0
    private var tgGuardMode = 0         // T2: harmonic-guard disagreement: 0 = median fallback (2.4), 1 = refuse (nil)
    private var tgGateMaxRej = 1.0      // T3: block convergence-GAIN while σ-gate reject fraction (last 10 s) exceeds this; >= 1 = off. Staged target: 0.5
    private var tgAcquireMaxSec = 15.0  // T4: pre-lock runway — zero-tick recals don't consume teardown attempts while tg is evaluating, until this wall time; 15 = off. Staged target: 45

    // T1 state: a lock is CONFIRMED only when a rate measured over audio that shares zero
    // samples with the locking segment agrees within tgConfirmBand. Overlapping windows
    // self-confirm (field: within-session movement 0.3 s/d even on wild locks, while the
    // same watch re-measured minutes later moves 8-50 s/d), so this is the only in-session
    // signal that separates a right lock from a confident wrong one.
    private var tgPendingLockRate: Double? = nil
    private var tgPendingLockAbs = -1     // energyRingAbs when the pending lock was taken
    private var tgLockConfirmed = false
    private var tgLockRejects = 0         // logged as lr= in TGALGO
    // T3/T4 state: rolling σ-gate window attempts (ring-abs stamped, pruned past 10 s)
    private var tgGateEvents: [(abs: Int, rejected: Bool)] = []
    private var tgGateAttempts = 0        // cumulative, logged as ga= in TGALGO

    private func tgRecordGateEvent(_ rejected: Bool) {
        tgGateAttempts += 1
        tgGateEvents.append((energyRingAbs, rejected))
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let cutoff = energyRingAbs - Int(ringSampleRate * 10)
        while let f = tgGateEvents.first, f.abs < cutoff { tgGateEvents.removeFirst() }
    }

    /// σ-gate reject fraction over the last 10 s; nil until there are enough attempts to mean anything.
    private func tgGateRejFraction() -> Double? {
        guard tgGateEvents.count >= 3 else { return nil }
        return Double(tgGateEvents.filter { $0.rejected }.count) / Double(tgGateEvents.count)
    }

    /// True while the tg core evaluated at least one window in the last 5 s (passed OR
    /// σ-rejected) — i.e. the envelope has candidate periodicity worth waiting on.
    private func tgActivelyEvaluating() -> Bool {
        guard let last = tgGateEvents.last else { return false }
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        return Double(energyRingAbs - last.abs) < ringSampleRate * 5.0
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
    private func tgUpdateLockConfirmation(chosen: Double, rates: [(secs: Double, rate: Double)],
                                          ringSampleRate: Double) {
        if tgLockConfirmed { return }
        let shadowBand = min(tgConfirmBand, 6.0)   // staged target; a LOWERED knob tightens the shadow too
        let confirmWin = 8.0
        guard tgPendingLockRate != nil, tgPendingLockAbs >= 0 else {
            tgPendingLockRate = chosen; tgPendingLockAbs = energyRingAbs
            return
        }
        guard Double(energyRingAbs - tgPendingLockAbs) >= confirmWin * ringSampleRate else { return }
        // The 8 s window may have σ-gate-failed this pass — then just try again next pass.
        guard let r1 = rates.first(where: { $0.secs == confirmWin })?.rate else { return }
        let r0 = tgPendingLockRate!
        if abs(r1 - r0) <= shadowBand {
            tgLockConfirmed = true
            debugLog(String(format: "[TGALGO lock-confirm] r0=%+.1f r1=%+.1f band=%.0f", r0, r1, shadowBand))
        } else {
            tgLockRejects += 1
            debugLog(String(format: "[TGALGO lock-reject] r0=%+.1f r1=%+.1f band=%.0f n=%d", r0, r1, shadowBand, tgLockRejects))
            tgPendingLockRate = r1; tgPendingLockAbs = energyRingAbs
        }
    }

    /// Most-recent `n` samples of the active envelope ring, linearized oldest→newest.
    private func recentEnvelope(_ n: Int) -> [Float] {
        let count = min(n, energyRingCount)
        guard count > 0 else { return [] }
        let ring = energyRings[activeHpIndex]
        var out = [Float](repeating: 0, count: count)
        var idx = (energyRingWritePos - count + energyRingCapacity) % energyRingCapacity
        for i in 0..<count { out[i] = ring[idx]; idx = (idx + 1) % energyRingCapacity }
        return out
    }

    /// Full (tic-to-tic) period in ring samples via FFT-autocorrelation, refined across
    /// lag-cycles (tg algo.c:427-450). Returns nil if the σ-gate fails.
    ///
    /// The refinement is a straight line through the origin: the ACF peak near
    /// `cyc * nominal` sits at `cyc * period`, so every cycle measures the same period —
    /// but not equally well. A half-sample peak-location error is a half-sample of period
    /// at cyc=1 and a 40th of one at cyc=40. Averaging `lag/cyc` with EQUAL weight (what
    /// shipped through 2.3) therefore lets the worst estimates set the answer: error falls
    /// off as ln(K)/K instead of 1/K. Weighted least squares through the origin with
    /// w = cyc² is the right estimator for constant per-lag noise, and measured ~2x tighter
    /// in Monte-Carlo at every window >= 4s (audit 2026-07-31, scripts in that audit).
    /// tgPeriodFit keeps the old behaviour reachable from JS so the change can be A/B'd.
    private func tgPeriod(_ env: [Float], nominal: Double, ringSampleRate: Double) -> Double? {
        let n = env.count
        guard n > Int(nominal * 2.5) else { return nil }
        var e = env
        var mean: Float = 0; vDSP_meanv(e, 1, &mean, vDSP_Length(n))
        var negMean = -mean; vDSP_vsadd(e, 1, &negMean, &e, 1, vDSP_Length(n))
        let tap = min(n/2, Int(ringSampleRate * 0.1))
        if tap > 1 {
            for i in 0..<tap {
                let w = Float(0.5 * (1 - cos(Double(i) / Double(tap) * .pi)))
                e[i] *= w; e[n - 1 - i] *= w
            }
        }
        let ac = fftAutocorrelation(e, count: n)
        let tol = ringSampleRate * 0.02
        var lags: [(cyc: Double, lag: Double)] = []; var cyc = 1.0
        while nominal * cyc < Double(n) * 0.66 {
            let lo = Int(nominal * cyc - tol), hi = Int(nominal * cyc + tol)
            if hi >= ac.count - 1 || lo < 1 { break }
            var best = lo; var bv = ac[lo]
            for k in lo...hi where ac[k] > bv { bv = ac[k]; best = k }
            let a0 = Double(ac[best-1]), b0 = Double(ac[best]), c0 = Double(ac[best+1])
            let d = a0 - 2*b0 + c0
            let frac = abs(d) > 1e-9 ? 0.5*(a0 - c0)/d : 0
            lags.append((cyc, Double(best) + frac)); cyc += 1
        }
        guard !lags.isEmpty else { return nil }
        let period = tgFitPeriod(lags)
        guard period > 1 else { return nil }
        // σ-gate, measured around the unweighted MEAN on purpose — not around the fitted
        // period. The gate asks "do the per-cycle estimates agree with each other", and
        // tgSigmaGate was tuned against the spread about their mean, which by construction
        // is the smallest such spread. Measuring it about the weighted fit instead leaves
        // the threshold nominally identical while making it 1-7% stricter in practice, and
        // that silently drops marginal windows — worst at the 4s window and low SNR, i.e.
        // precisely the weak signals that already fail most. The gate keeps its own
        // reference point; only the returned period changes.
        if lags.count > 1 {
            let ests = lags.map { $0.lag / $0.cyc }
            let mean = ests.reduce(0, +) / Double(ests.count)
            let varr = ests.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(ests.count)
            if mean > 0, sqrt(varr) / mean > tgSigmaGate {
                tgGateRejects += 1
                tgRecordGateEvent(true)     // T3/T4: an attempt that σ-rejected
                return nil
            }
        }
        tgRecordGateEvent(false)            // T3/T4: an attempt that produced a period
        return period
    }

    /// Period (ring samples) from the per-cycle ACF peak lags. See tgPeriod for why the
    /// weighting is the whole point; mode 0 reproduces the pre-2.4 estimator bit for bit.
    private func tgFitPeriod(_ lags: [(cyc: Double, lag: Double)]) -> Double {
        switch tgPeriodFit {
        case 0:
            return lags.reduce(0) { $0 + $1.lag / $1.cyc } / Double(lags.count)
        case 1:
            let s = lags.map { $0.lag / $0.cyc }.sorted()
            return s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2
        default:
            // Weighted LS through the origin: period = Σ(w·cyc·lag) / Σ(w·cyc²), w = cyc².
            var num = 0.0, den = 0.0
            for (c, l) in lags { let w = c * c; num += w * c * l; den += w * c * c }
            guard den > 0 else { return lags[lags.count - 1].lag / lags[lags.count - 1].cyc }
            return num / den
        }
    }

    /// tg-style rate: measure period over 2/4/8/16s windows of the envelope ring;
    /// use the longest window that passes the σ-gate and yields an in-range rate.
    private func computeTgRate() -> Double? {
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let nominal = 7200.0 / Double(targetBph) * ringSampleRate
        var rates: [(secs: Double, rate: Double)] = []
        for secs in [2.0, 4.0, 8.0, 16.0, 32.0] where secs <= tgMaxWindowSec {
            let want = Int(secs * ringSampleRate)
            let env = recentEnvelope(want)
            if env.count < Int(Double(want) * 0.9) { continue }
            guard let period = tgPeriod(env, nominal: nominal, ringSampleRate: ringSampleRate) else { continue }
            let rate = (nominal / period - 1) * 86400
            if abs(rate) <= 200 { rates.append((secs, rate)) }
        }
        guard !rates.isEmpty else { return nil }
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
        let sorted = rates.map { $0.rate }.sorted()
        let median = sorted.count % 2 == 1
            ? sorted[sorted.count / 2]
            : (sorted[sorted.count / 2 - 1] + sorted[sorted.count / 2]) / 2
        let longestEntry = rates.max { $0.secs < $1.secs }!
        let longest = longestEntry.rate
        // A rate means the envelope is periodic at the expected BPH — that is a lock, and
        // it is what tgHoldOnLock keys off. Recorded on the absolute ring counter because
        // a recalibration rewinds wallElapsed.
        tgLastLockAbs = energyRingAbs
        tgLastWindowSec = longestEntry.secs
        let disagree = abs(longest - median) > tgAgreeBand
        // T2 (guardMode 1): windows that disagree beyond the band mean NO number is
        // trustworthy — refuse and keep acquiring, instead of shipping the median
        // (2.4 once shipped median=109.5 over longest=41.4). n==2 also refuses: with two
        // windows "median" is just max(), a coin flip documented below. A refusal clears
        // an UNCONFIRMED pending T1 lock; a confirmed lock survives one noisy pass
        // (starvation-hold semantics unchanged).
        if tgGuardMode >= 1, rates.count >= 2, disagree {
            debugLog(String(format: "[TGALGO harmonic-guard] longest=%.1f median=%.1f band=%.0f n=%d -> nil", longest, median, tgAgreeBand, rates.count))
            if !tgLockConfirmed { tgPendingLockRate = nil; tgPendingLockAbs = -1 }
            return nil
        }
        var chosen = longest
        if rates.count >= 3 && disagree {
            debugLog(String(format: "[TGALGO harmonic-guard] longest=%.1f median=%.1f band=%.0f n=%d -> median", longest, median, tgAgreeBand, rates.count))
            chosen = median
        }
        tgUpdateLockConfirmation(chosen: chosen, rates: rates, ringSampleRate: ringSampleRate)
        return chosen
    }

    /// True when the tg period core produced a rate in the last ~3 s. The tg path reads the
    /// energy envelope straight out of the ring and needs no *accepted ticks* at all, so a
    /// starving tick detector is not a reason to recalibrate — or tear down — a session that
    /// is measuring perfectly well. 26% of Pro V2 sessions hit at least one recalibration and
    /// their convergence rate collapsed from 86% to 26% (audit 2026-07-31).
    private func tgHasRecentLock() -> Bool {
        guard tgHoldOnLock, useTgAlgo, tgLastLockAbs >= 0 else { return false }
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        return Double(energyRingAbs - tgLastLockAbs) < ringSampleRate * 3.0
    }

    /// Envelope sample at an absolute ring index (0 if it has scrolled out of the ring).
    private func envAtAbs(_ a: Int) -> Float {
        let back = energyRingAbs - a
        guard back >= 1, back <= min(energyRingCount, energyRingCapacity) else { return 0 }
        let idx = ((energyRingWritePos - back) % energyRingCapacity + energyRingCapacity) % energyRingCapacity
        return energyRings[activeHpIndex][idx]
    }

    /// Locate beats on the tg-period grid and emit per-pair cumulative-deviation dots
    /// (same convention as the detector's dots: pairing cancels beat error).
    private func tgTrackDots(period: Double, ringSampleRate: Double, wallElapsed: Double) {
        let halfP = period / 2
        let nominalFull = 7200.0 / Double(targetBph) * ringSampleRate
        let win = max(2.0, halfP * 0.12)
        let absNow = Double(energyRingAbs)
        if tgDotNext < 0 {
            let span = Int(halfP * 1.5)
            guard energyRingCount > span + 4 else { return }
            var best: Float = -1; var bi = energyRingAbs - span
            var a = energyRingAbs - span
            while a < energyRingAbs { let v = envAtAbs(a); if v > best { best = v; bi = a }; a += 1 }
            tgDotPrevAbs = Double(bi); tgDotNext = Double(bi) + halfP
            tgDotPairAccum = 0; tgDotPairPhase = 0; tgDotSkipPairs = 1
            return
        }
        var guardCount = 0
        while tgDotNext + win < absNow, guardCount < 64 {
            guardCount += 1
            let lo = Int(tgDotNext - win), hi = Int(tgDotNext + win)
            if energyRingAbs - lo > min(energyRingCount, energyRingCapacity) { tgDotNext = -1; return }  // fell behind — resync
            var best: Float = -1; var bi = lo
            var a = lo
            while a <= hi { let v = envAtAbs(a); if v > best { best = v; bi = a }; a += 1 }
            let p = Double(bi)
            let interval = p - tgDotPrevAbs
            tgDotPrevAbs = p
            tgDotNext = p + halfP
            if abs(interval - halfP) > halfP * 0.2 { tgDotPairAccum = 0; tgDotPairPhase = 0; continue }  // outlier — drop this pair
            tgDotPairAccum += interval; tgDotPairPhase += 1
            if tgDotPairPhase == 2 {
                let devMs = (nominalFull - tgDotPairAccum) / ringSampleRate * 1000.0
                tgDotPairAccum = 0; tgDotPairPhase = 0
                if tgDotSkipPairs > 0 { tgDotSkipPairs -= 1; continue }
                tgDotCumMs += devMs
                let tSec = wallElapsed - (absNow - p) / ringSampleRate
                tgPendingDots.append(TickDot(timeSec: max(0, tSec), deviationMs: tgDotCumMs))
            }
        }
    }

    /// Beat error (ms) from the folded beat: the toc's offset from exactly half a period.
    /// (tg derives B.E. the same way — tic→toc spacing vs period/2.)
    private func tgBeatError(fold: [Float], period: Double, ringSampleRate: Double) -> Double? {
        let P = fold.count; guard P > 8 else { return nil }
        var tic = 0; var tv = fold[0]
        for i in 1..<P where fold[i] > tv { tv = fold[i]; tic = i }
        // strongest point in the window [tic + 0.4P, tic + 0.6P] (circular) = toc
        var best: Float = -1; var toc = tic
        for off in Int(Double(P) * 0.4)...Int(Double(P) * 0.6) {
            let i = (tic + off) % P
            if fold[i] > best { best = fold[i]; toc = i }
        }
        // Sub-sample refinement. Integer bins quantise B.E. at one ring sample — 0.083 ms at
        // the default 12 kHz ring — on a quantity whose entire useful range is 0-0.5 ms, so
        // the reading moved in visible steps. Same parabolic fit the ACF peak search uses.
        let d = tgCircularSpan(from: tgRefinePeak(fold, tic), to: tgRefinePeak(fold, toc), period: Double(P))
        let be = abs(d - period / 2) / ringSampleRate * 1000.0
        // Shadow estimator: the same spacing measured from each pulse's leading EDGE instead
        // of its peak. Peak position walks with pulse amplitude, so a tic/toc amplitude
        // imbalance biases the peak-based figure; onsets do not. Logged only (beOn= in
        // TGALGO) until there is field data to compare the two — do not wire it to the
        // display before that comparison exists.
        if let onTic = tgPulseOnset(fold, marker: tic), let onToc = tgPulseOnset(fold, marker: toc) {
            let od = tgCircularSpan(from: onTic, to: onToc, period: Double(P))
            let obe = abs(od - period / 2) / ringSampleRate * 1000.0
            tgBeOnsetCached = obe < 10 ? obe : nil
        } else { tgBeOnsetCached = nil }
        return be < 10 ? be : nil                          // >10ms = fold not clean, don't report
    }

    /// Forward distance from `a` to `b` on a circle of length `p`.
    private func tgCircularSpan(from a: Double, to b: Double, period p: Double) -> Double {
        var d = (b - a).truncatingRemainder(dividingBy: p)
        if d < 0 { d += p }
        return d
    }

    /// Sub-sample peak position around an integer argmax, by parabolic fit on the three
    /// surrounding fold bins (circular). Clamped to ±1 bin so a flat top can't run away.
    private func tgRefinePeak(_ fold: [Float], _ i: Int) -> Double {
        let P = fold.count
        let a = Double(fold[(i - 1 + P) % P]), b = Double(fold[i]), c = Double(fold[(i + 1) % P])
        let d = a - 2 * b + c
        guard abs(d) > 1e-12 else { return Double(i) }
        return Double(i) + max(-1, min(1, 0.5 * (a - c) / d))
    }

    /// Leading-edge position of the pulse peaking at `marker`, as a fractional fold index
    /// (may be negative — callers wrap it). Threshold sits halfway between the quiet region
    /// (the same P/6..P/4 window tgAmplitude uses for its noise floor) and the peak, and the
    /// crossing is linearly interpolated. nil when the pulse never clears the noise.
    private func tgPulseOnset(_ fold: [Float], marker: Int) -> Double? {
        let P = fold.count; guard P > 8 else { return nil }
        func at(_ d: Int) -> Float { fold[((marker - d) % P + P) % P] }
        var noise: Float = 0
        var q = P / 6
        while q <= P / 4 { if at(q) > noise { noise = at(q) }; q += 1 }
        let peak = fold[marker]
        guard peak > noise else { return nil }
        let thr = noise + 0.5 * (peak - noise)
        var d = 1
        while d < P / 8, at(d) > thr { d += 1 }
        // d == 1 is a legitimate crossing (between the peak bin and the one before it) —
        // unlike tgAmplitude's pulseBefore, which needs room to walk on to a second peak.
        // Bailing out only when no crossing was found inside P/8.
        guard d < P / 8 else { return nil }
        let hi = at(d - 1), lo = at(d)                     // hi > thr >= lo
        let frac = hi > lo ? Double(thr - lo) / Double(hi - lo) : 0.0
        return Double(marker) - Double(d) + frac
    }

    /// tg-style averaged beat: fold the recent envelope at the measured period (trimmed mean per bin).
    private func tgFoldedBeat(period: Double) -> [Float]? {
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let P = Int(period.rounded()); guard P > 8 else { return nil }
        let env = recentEnvelope(Int(ringSampleRate * 8))     // up to 8s of beats
        let nBeats = env.count / P; guard nBeats >= 4 else { return nil }
        var fold = [Float](repeating: 0, count: P)
        var col = [Float](repeating: 0, count: nBeats)
        let keep = max(1, Int(Double(nBeats) * 0.8))          // trimmed mean: drop loudest 20%
        for p in 0..<P {
            for b in 0..<nBeats { col[b] = env[b*P + p] }
            col.sort()
            var s: Float = 0; for b in 0..<keep { s += col[b] }
            fold[p] = s / Float(keep)
        }
        var mean: Float = 0; vDSP_meanv(fold, 1, &mean, vDSP_Length(P))
        var neg = -mean; vDSP_vsadd(fold, 1, &neg, &fold, 1, vDSP_Length(P))
        return fold
    }

    /// Amplitude (degrees) from the escapement pulse-pair + lift angle. nil if not plausible.
    /// tg's full recipe: 1ms leaky-max smoothing (noise bumps stopped the peak-walk early →
    /// short Δt → amplitude read high), quiet-region noise floor, and a ×1.4 threshold
    /// iteration that only accepts a mutually-consistent, plausible tic/toc pair.
    private func tgAmplitude(fold rawFold: [Float], period: Double) -> Double? {
        let P = rawFold.count; guard P > 8 else { return nil }
        // 1ms leaky-max (peak-hold) smoothing, two passes for circular wrap (tg algo.c:611)
        let ringSampleRate = actualSampleRate / Double(ringSubsampleTarget)
        let w = max(2, Int(ringSampleRate / 1000.0))
        let k = 1.0 - 1.0 / Float(w)
        var fold = rawFold
        var hold: Float = 0
        for pass in 0..<2 {
            for i in 0..<P {
                hold *= k
                if rawFold[i] > hold { hold = rawFold[i] }
                if pass == 1 || i > w { fold[i] = hold }
            }
        }
        let glob = fold.max() ?? 0; guard glob > 0 else { return nil }
        // tic/toc markers from the smoothed fold
        var tic = 0; var tv = fold[0]
        for i in 1..<P where fold[i] > tv { tv = fold[i]; tic = i }
        let lo = (tic + Int(Double(P)*0.4)) % P, hi = (tic + Int(Double(P)*0.6)) % P
        var toc = lo; var bv = fold[lo]; var j = lo
        while j != hi { if fold[j] > bv { bv = fold[j]; toc = j }; j = (j + 1) % P }
        // Noise floor from the quiet region between the pulse clusters (d in [P/6, P/4]
        // before each marker), not the whole-fold mean (which the pulses inflate).
        var noise: Float = 0
        for mk in [tic, toc] {
            var d = P/6
            while d <= P/4 { let v = fold[((mk - d) % P + P) % P]; if v > noise { noise = v }; d += 1 }
        }
        // Threshold iteration (tg algo.c:770/809): accept the first level that yields a
        // plausible, consistent pulse pair; a faint pulse that never qualifies → nil.
        var thr = max(0.01 * glob, 1.4 * noise)
        var iters = 0
        while thr < glob, iters < 12 {
            func pulseBefore(_ marker: Int) -> Int? {
                func at(_ d: Int) -> Float { fold[((marker - d) % P + P) % P] }
                var d = P/8
                while d > 2, at(d) <= thr { d -= 1 }     // threshold crossing
                guard d > 2 else { return nil }
                while d > 3, at(d - 1) > at(d) { d -= 1 } // walk to the pulse peak
                return d
            }
            var amps: [Double] = []
            var ok = true
            for mk in [tic, toc] {
                guard let dt = pulseBefore(mk) else { ok = false; break }
                let s = sin(Double.pi * Double(dt) / period)
                guard s > 0 else { ok = false; break }
                amps.append(liftAngleDeg / (2 * s))
            }
            // Plausibility gate. The floor used to be a hardcoded 135°, which inverted the
            // feature: a watch genuinely running at 120° — exactly the one whose owner needs
            // telling — reported nothing at all, while a healthy one reported fine. 21% of
            // tg-locked sessions produced no amplitude (audit 2026-07-31). tgAmpMinDeg drops
            // the floor to 90° so a low reading comes through and the UI can colour it red.
            if ok, amps.count == 2, amps.allSatisfy({ tgAmpMinDeg <= $0 && $0 <= 360 }), abs(amps[0] - amps[1]) <= 60 {
                return (amps[0] + amps[1]) / 2
            }
            thr *= 1.4; iters += 1
        }
        return nil
    }

    /// FFT-based autocorrelation using Accelerate's vDSP.
    private func fftAutocorrelation(_ signal: [Float], count: Int) -> [Float] {
        // Next power of 2 for FFT (>= 2*count for linear autocorrelation)
        var fftSize = 1
        while fftSize < 2 * count { fftSize *= 2 }
        let log2n = vDSP_Length(log2(Double(fftSize)))

        guard let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
            return [Float](repeating: 0, count: count)
        }
        defer { vDSP_destroy_fftsetup(fftSetup) }

        // Zero-pad signal
        var padded = [Float](repeating: 0, count: fftSize)
        for i in 0..<count { padded[i] = signal[i] }

        // FFT via split complex
        let halfN = fftSize / 2
        var realp = [Float](repeating: 0, count: halfN)
        var imagp = [Float](repeating: 0, count: halfN)
        var result = [Float](repeating: 0, count: fftSize)

        realp.withUnsafeMutableBufferPointer { rBuf in
            imagp.withUnsafeMutableBufferPointer { iBuf in
                var split = DSPSplitComplex(realp: rBuf.baseAddress!, imagp: iBuf.baseAddress!)

                // Interleaved real → split complex
                padded.withUnsafeBufferPointer { pBuf in
                    pBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                        vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(halfN))
                    }
                }

                // Forward FFT
                vDSP_fft_zrip(fftSetup, &split, 1, log2n, FFTDirection(kFFTDirection_Forward))

                // Power spectrum: |FFT|^2
                for i in 0..<halfN {
                    let r = rBuf[i]
                    let im = iBuf[i]
                    rBuf[i] = r * r + im * im
                    iBuf[i] = 0
                }

                // Inverse FFT
                vDSP_fft_zrip(fftSetup, &split, 1, log2n, FFTDirection(kFFTDirection_Inverse))

                // Split complex → interleaved real
                result.withUnsafeMutableBufferPointer { resBuf in
                    resBuf.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                        vDSP_ztoc(&split, 1, complexPtr, 2, vDSP_Length(halfN))
                    }
                }
            }
        }

        // Scale
        var scale = 1.0 / Float(fftSize)
        vDSP_vsmul(result, 1, &scale, &result, 1, vDSP_Length(fftSize))

        return Array(result.prefix(count))
    }

    // MARK: - Beat error via epoch folding

    private func detectTickEvents(signal: [Float], count: Int, ringSampleRate: Double) {
        let tickFreq = Double(targetBph) / 3600.0
        let beatFreq = tickFreq / 2.0
        let beatPeriod = ringSampleRate / beatFreq
        let periodSamples = Int(round(beatPeriod))

        guard count >= periodSamples * 8 else { return }

        // Epoch fold at beat period
        var folded = [Double](repeating: 0, count: periodSamples)
        var foldCount = [Int](repeating: 0, count: periodSamples)
        for i in 0..<count {
            let idx = i % periodSamples
            folded[idx] += Double(signal[i])
            foldCount[idx] += 1
        }
        for i in 0..<periodSamples {
            if foldCount[i] > 0 { folded[i] /= Double(foldCount[i]) }
        }

        // Smooth the folded profile
        let smoothW = max(1, periodSamples / 50)
        var smoothed = [Double](repeating: 0, count: periodSamples)
        for i in 0..<periodSamples {
            var s = 0.0; var c = 0
            for j in -smoothW...smoothW {
                let idx = (i + j + periodSamples) % periodSamples
                s += folded[idx]; c += 1
            }
            smoothed[i] = s / Double(c)
        }

        // Find peak 1 (global max)
        var peak1Idx = 0
        var peak1Val = smoothed[0]
        for i in 1..<periodSamples {
            if smoothed[i] > peak1Val { peak1Val = smoothed[i]; peak1Idx = i }
        }

        // Find peak 2 (max outside ±25% exclusion zone)
        let exclusion = periodSamples / 4
        var peak2Idx = -1
        var peak2Val = -1.0
        for i in 0..<periodSamples {
            let dist = min(abs(i - peak1Idx), periodSamples - abs(i - peak1Idx))
            if dist > exclusion && smoothed[i] > peak2Val {
                peak2Val = smoothed[i]; peak2Idx = i
            }
        }
        guard peak2Idx >= 0 else {
            currentBeatError = nil; return
        }

        // Quality gate: both peaks must have good prominence
        let floor = smoothed.min() ?? 0
        let prom1 = peak1Val - floor
        let prom2 = peak2Val - floor
        let promRatio = prom1 > 0 ? prom2 / prom1 : 0
        guard promRatio > 0.25 else {
            currentBeatError = nil; return
        }

        // Compute beat error
        let gap1 = (peak2Idx - peak1Idx + periodSamples) % periodSamples
        let gap2 = periodSamples - gap1
        let gap1Ms = Double(gap1) / ringSampleRate * 1000.0
        let gap2Ms = Double(gap2) / ringSampleRate * 1000.0
        let be = abs(gap1Ms - gap2Ms)

        let halfPeriodMs = Double(periodSamples) / ringSampleRate * 1000.0 / 2.0
        let minGapFraction = 0.35
        guard be < 5.0
            && gap1Ms > halfPeriodMs * minGapFraction
            && gap2Ms > halfPeriodMs * minGapFraction else {
            currentBeatError = nil; return
        }

        currentBeatError = (be * 100).rounded() / 100

        // Waveform: downsample the active ring's last 500ms for visualization
        let vizRingSamples = min(count, Int(ringSampleRate * 0.5))
        let vizStart = count - vizRingSamples
        let targetPoints = 200
        let step = max(1, vizRingSamples / targetPoints)
        var waveform = [Float]()
        waveform.reserveCapacity(targetPoints)
        for i in stride(from: 0, to: vizRingSamples, by: step) {
            var maxVal: Float = 0
            let end = min(i + step, vizRingSamples)
            for j in i..<end {
                if signal[vizStart + j] > maxVal { maxVal = signal[vizStart + j] }
            }
            waveform.append(maxVal)
        }
        lastBeatWaveform = waveform

        // Tick positions in waveform
        let ticksInViz = Int(Double(vizRingSamples) / beatPeriod * 2)
        var tickPos: [Int] = []
        for t in 0..<ticksInViz {
            let sampleInViz = Int(Double(t) * beatPeriod / 2.0) % vizRingSamples
            let wfIdx = sampleInViz / step
            if wfIdx >= 0 && wfIdx < waveform.count { tickPos.append(wfIdx) }
        }
        lastTickPositions = tickPos
    }

    /// Trimmed mean: removes top/bottom fraction of values, averages the rest.
    private func trimmedMean(_ values: [Double], fraction: Double) -> Double {
        let sorted = values.sorted()
        let trimCount = max(0, Int(Double(sorted.count) * fraction))
        let trimmed = Array(sorted[trimCount..<(sorted.count - trimCount)])
        guard !trimmed.isEmpty else { return sorted[sorted.count / 2] }
        return trimmed.reduce(0, +) / Double(trimmed.count)
    }
}
