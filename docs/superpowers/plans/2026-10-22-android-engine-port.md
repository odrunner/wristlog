# Android Engine Port (Plan 1 of the Android Port) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Kotlin port of the iOS 2.0 timegrapher engine, proven against synthetic fixtures on the JVM, wrapped in a minimal Android harness app ready to validate on the Pixel 7 the day it arrives (Saturday 2026-10-25).

**Architecture:** A pure-JVM `engine` Gradle module holds `TimegrapherCore`, a 1:1 port of `ios/Wrotate/Wrotate/TimegrapherEngine.swift` with audio capture factored out (the Swift class couples capture via AVAudioEngine; the Kotlin class consumes `FloatArray` buffers so every test runs without a device). An `app` module adds `AudioCapture` (AudioRecord, unprocessed source) and a one-screen harness UI. The WebView shell, push, and store work are later plans.

**Tech Stack:** Kotlin, Gradle (headless on the Mac Mini), JUnit for engine tests, plain Android Views (no Compose), no third-party libraries (FFT is written in-repo).

**Spec:** `docs/superpowers/specs/2026-10-22-android-port-design.md`

## Global Constraints

- `applicationId` is `com.wrotate.app`; Kotlin packages `com.wrotate.engine` (engine module) and `com.wrotate.app` (app module). minSdk 26, targetSdk 35.
- The `engine` module is pure JVM: it may not import anything from `android.*`.
- The port is **1:1 against `ios/Wrotate/Wrotate/TimegrapherEngine.swift`**: same member names, same constants, same defaults, same log-line formats (`[TGSTART]`, `[TGTUNE]`, `[TGCALIBRATED]`, `[TGDEBUG]`, `[TGTICK …]`, `[TGALGO …]`, `[TGRATE]`, `[TGUPDATE]`, `[TGAUTO BPH]`, `[TGRECALIBRATE]`, `[TGSANITY RESET]`, `[TGCLOCK]`, `[TGACTIVATE]`, `[TGPHASE …]`, `[TGBPH …]`). The `psBE=` token in `[TGTICK]` lines is load-bearing (the rollout tracker greps it). Where this plan is silent on behavior, the Swift source is the spec — port it, including comments that explain tuned values.
- The legacy ("Standard") rate path is ported as part of the class (it is interleaved with the tick detector and feeds tickCount, psBE, and the reg-vs-tg shadow log) but Android always starts the engine with `useTgAlgo = true` and no fixture asserts legacy-path rate output (owner decision: Pro V2 only).
- iOS files: the ONLY permitted edit under `ios/` is adding the `TG_ENGINE_REV` comment line (Task 8). No web page, `sw.js`, or `SITE_FILES` change happens in this plan.
- No emoji anywhere, including the harness UI and log output.
- Commits: run the module's tests before each commit (`./gradlew :engine:test` / `:app:assembleDebug`; `npm test` additionally when anything under `tests/` or `scripts/` changed). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Android work lives under `android/`; nothing in it is served by the site build.

## Review Focus

Failure modes the spec implies that need pinned tests (each added to the owning task below):

1. A phone without the unprocessed audio source must still measure: source selection falls back to `VOICE_RECOGNITION` and the choice is visible in telemetry. (Task 9: `selectAudioSource` unit test.)
2. AGC-squashed or pure-noise audio must end in "no reading," never a confident wrong rate. (Task 7: noise fixture asserts `rateStable` never true.)
3. A 44.1 kHz capture device (common on cheap Androids / BT mics) must measure as accurately as 48 kHz — every internal rate derives from `actualSampleRate`. (Task 7: 44 100 Hz fixture.)
4. Arbitrary capture buffer sizes must not change results: `process()` must be chunk-size invariant. (Task 7: chunking-invariance test.)
5. A capture restart mid-session (audio focus loss, route change) must discard pre-gap audio and keep a confirmed lock, exactly like the Swift rebuild path. (Task 6: `onCaptureRestart` test.)

---

### Task 1: Toolchain and project scaffold

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, Gradle wrapper files
- Create: `android/engine/build.gradle.kts` (Kotlin JVM library, JUnit)
- Create: `android/app/build.gradle.kts` (Android application, `com.wrotate.app`, minSdk 26, targetSdk 35, depends on `:engine`), `android/app/src/main/AndroidManifest.xml` (RECORD_AUDIO permission, one activity)
- Create: `android/engine/src/main/kotlin/com/wrotate/engine/Placeholder.kt`, matching trivial test
- Create: `android/README.md` (how to build/install: `./gradlew :app:assembleDebug`, `adb install`)

**Interfaces:**
- Produces: a repo-committed Gradle project where `./gradlew :engine:test` and `./gradlew :app:assembleDebug` pass on the Mac Mini.

- [ ] **Step 1: Install the toolchain** — Homebrew `openjdk@17` and Android commandline-tools; `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"` with licenses accepted; `ANDROID_HOME` recorded in `android/local.properties` (gitignored).
- [ ] **Step 2: Scaffold the two modules** with the files above; `Placeholder.kt` exports `fun engineReady() = true` and the test asserts it.
- [ ] **Step 3: Verify** — Run: `cd android && ./gradlew :engine:test :app:assembleDebug`. Expected: BUILD SUCCESSFUL, 1 test passed, `app-debug.apk` produced.
- [ ] **Step 4: Commit** (`android/.gitignore` covers `local.properties`, `build/`, `.gradle/`).

### Task 2: DSP primitives — biquad and Goertzel

**Files:**
- Create: `android/engine/src/main/kotlin/com/wrotate/engine/Biquad.kt`
- Create: `android/engine/src/main/kotlin/com/wrotate/engine/Goertzel.kt`
- Test: `android/engine/src/test/kotlin/com/wrotate/engine/BiquadTest.kt`, `GoertzelTest.kt`

**Interfaces:**
- Produces:
  - `class BiquadState` with `fun makeBiquadHP(cutoff: Float, sampleRate: Double): BiquadState` and `fun applyBiquad(state: BiquadState, x: Float): Float` — port of Swift lines 275–459 (Butterworth Q = 0.7071, same coefficient math; state mutates in place).
  - `fun goertzelPower(signal: FloatArray, count: Int, targetFreq: Double, sampleRate: Double): Double` — port of Swift lines 1535–1547.
  - `fun goertzelRatio(signal: FloatArray, count: Int, tickFreq: Double, sampleRate: Double): Double` — port of Swift lines 1446–1453 (baseline multipliers `0.73, 0.81, 1.19, 1.37, 1.61`).

- [ ] **Step 1: Write failing tests** — `BiquadTest`: a 4 kHz HP at 48 kHz attenuates a 100 Hz sine by > 40 dB and passes an 8 kHz sine within 3 dB (measure RMS out/in over 4 800 samples after 500 samples of settling). `GoertzelTest`: `goertzelPower` at the exact frequency of a synthetic 8 Hz pulse train sampled at 12 kHz exceeds the power at 1.37× that frequency by > 10×; `goertzelRatio` on the same train > 3.0.
- [ ] **Step 2: Run tests, verify failure** (`./gradlew :engine:test`).
- [ ] **Step 3: Implement** the three functions per the Swift source.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit.**

### Task 3: FFT autocorrelation

**Files:**
- Create: `android/engine/src/main/kotlin/com/wrotate/engine/Fft.kt`
- Test: `android/engine/src/test/kotlin/com/wrotate/engine/FftTest.kt`

**Interfaces:**
- Produces: `fun fftAutocorrelation(signal: FloatArray, count: Int): FloatArray` — same contract as Swift lines 2158–2218: zero-pad to the next power of two ≥ 2×count, autocorrelation = IFFT(|FFT|²), return the first `count` lags. Internally a plain iterative radix-2 complex FFT (written here, no library). **Absolute scale may differ from the vDSP version by a constant factor — every consumer (peak argmax, peak/mean confidence, parabolic interpolation) is scale-invariant, so fixtures assert derived quantities, never raw ACF values.**

- [ ] **Step 1: Write failing tests** — (a) ACF of a 120-sample-period pulse train (4 800 samples) has its largest lag-≥ 2 peak at lag 120 ± 0; (b) parabolic refinement recovers a 119.6-sample period within ±0.05 (generate with fractional spacing); (c) result matches a direct O(n²) autocorrelation (computed in the test) within 1e-3 relative error at lags 1–300 after normalizing both by lag-0.
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement** radix-2 complex FFT + the autocorrelation wrapper.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 4: Synthetic fixtures and WAV I/O

**Files:**
- Create: `android/engine/src/main/kotlin/com/wrotate/engine/WavIo.kt` (main source set — the harness app replays WAVs too)
- Create: `android/engine/src/test/kotlin/com/wrotate/engine/TickSynth.kt`
- Test: `android/engine/src/test/kotlin/com/wrotate/engine/TickSynthTest.kt`

**Interfaces:**
- Produces:
  - `data class SynthSpec(val sampleRate: Double = 48000.0, val bph: Int = 28800, val rateSecPerDay: Double = 0.0, val beatErrorMs: Double = 0.0, val durationSec: Double = 90.0, val burstHz: Double = 6500.0, val burstMs: Double = 2.0, val tickAmp: Float = 0.05f, val tockAmpRatio: Float = 0.8f, val noiseRms: Float = 0.002f, val seed: Long = 1L)`
  - `fun synthesize(spec: SynthSpec): FloatArray` — alternating tick/tock as exponentially decaying `burstHz` sine bursts over white noise; tick spacing = nominal interval scaled by `(1 - rateSecPerDay/86400)`; beat error shifts every second beat by `beatErrorMs/2` each way.
  - `object WavIo`: `fun read(path: java.io.File): Pair<FloatArray, Double>` (16-bit PCM and 32-bit float, mono or first channel), `fun write(path: java.io.File, samples: FloatArray, sampleRate: Double)` (32-bit float).

- [ ] **Step 1: Write failing tests** — synthesized 28 800 bph train at 48 kHz has 8 bursts/sec (count threshold crossings of the envelope); a `rateSecPerDay = +20.0` spec yields mean burst spacing `(7200.0/28800) * 48000 * (1 - 20/86400)` samples within ±0.02%; WAV write→read round-trips samples within 1e-6 and preserves the sample rate.
- [ ] **Step 2: Run, verify failure.** 
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 5: TimegrapherCore part A — state, tuning, tick-detection pipeline

**Files:**
- Create: `android/engine/src/main/kotlin/com/wrotate/engine/TimegrapherCore.kt`
- Test: `android/engine/src/test/kotlin/com/wrotate/engine/CorePartATest.kt`

**Interfaces:**
- Consumes: Task 2 and 3 functions; Task 4 synth.
- Produces (the full public API — later tasks fill internals in):
  ```kotlin
  class TimegrapherCore(
      private val analysisExecutor: java.util.concurrent.Executor? = null  // null = synchronous (tests); app passes a single-thread executor
  ) {
      var onUpdate: ((Update) -> Unit)? = null        // invoked on the processing/analysis thread; callers marshal to UI
      fun start(bph: Int, useTgAlgo: Boolean, sampleRate: Double)
      fun setTuning(t: Tuning)
      fun process(samples: FloatArray, count: Int = samples.size)
      fun noteAudioClock(hostTimeNs: Long, frames: Int)
      fun onCaptureRestart(newSampleRate: Double)     // Task 6
      fun stop(): Result
  }
  data class TickDot(val timeSec: Double, val deviationMs: Double)
  data class Update( /* exactly the Swift Update fields, lines 20–40, same names and types (Swift Float array -> FloatArray, optionals -> nullable) */ )
  data class Result(val rate: Double?, val beatError: Double?, val tickCount: Int)
  class Tuning  // one nullable val per setTuning parameter, Swift lines 347–384, identical names and validation ranges
  ```
  Design deltas from Swift, fixed here: (1) capture is external — `start` takes `sampleRate` and does none of the AVAudioSession work (Swift lines 528–556 collapse to deriving `ringSubsampleTarget`, ring capacity, filters, and activating tick detection); (2) the once-per-second analysis throttle (Swift line 1252, wall clock) runs on **audio time** `sampleCounter / actualSampleRate` so replays are deterministic; (3) `debugLog` appends to `debugMessages` and a settable `logSink: ((String) -> Unit)?` instead of `print`; (4) `noteAudioClock` uses the host-time nanos the capture layer provides (`AVAudioTime` seconds → `hostTimeNs / 1e9`).

- [ ] **Step 1: Write failing tests** — (a) `start(28800, true, 48000.0)` then `setTuning(Tuning())` emits exactly one `[TGSTART]` and one `[TGTUNE]` line via `logSink`, the `[TGTUNE]` line listing the same `key=value` tokens in the same order as Swift line 432; (b) replaying a clean 90 s default-spec fixture (chunks of 4096) yields `tickCount ≥ 500` and at least one `[TGTICK #` log containing `psBE=`; (c) the psBE estimator on a `beatErrorMs = 2.0` fixture reports `phaseSepBeatError` within 2.0 ± 0.5 (read via the `psBE=` token); (d) a `[TGCALIBRATED]` line appears before the first `[TGTICK]`.
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Port Swift lines 13–520 and 745–1247** (structs, state, tunables, `currentPairThreshold`, `theilSenSlope`, start-state reset, `processAudioBuffer` → `process` including calibration, threshold decay, peak detection, phase lock, outlier/pair gates, phase recovery, BPH correction, psBE, regression accumulation, sanity reset) plus `activateTickDetection` (lines 1463–1493) and `noteAudioClock` (lines 713–743). Keep member names and every constant.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 6: TimegrapherCore part B — tg core, locks, capture restart

**Files:**
- Modify: `android/engine/src/main/kotlin/com/wrotate/engine/TimegrapherCore.kt`
- Test: `android/engine/src/test/kotlin/com/wrotate/engine/CorePartBTest.kt`

**Interfaces:**
- Produces: the tg path — `tgPeriod`, `tgFitPeriod`, `computeTgRate`, σ-gate event tracking, T1 lock confirmation, `tgHasRecentLock`, `recentEnvelope`, `envAtAbs`, `tgTrackDots`, `tgFoldedBeat`, `tgBeatError` (+ onset shadow), `tgAmplitude`, and `onCaptureRestart` (the non-AVAudio parts of Swift lines 648–694: optional re-derive on sample-rate change, `energyRingCount = 0`, cache clears, unconfirmed-lock clear, clock-estimator restart, forced recalibration, `[TGAUDIO RESUME]` log).

- [ ] **Step 1: Write failing tests** — (a) on a clean +15 s/day fixture, `computeTgRate` (driven via replay) produces rates; the last `[TGALGO` line's `tg=` value is within ±1.0 of +15.0; (b) σ-gate: a pure-noise signal produces `gate=` rejections and no `tg=` value other than `nil`; (c) lock confirmation: a clean replay reaches `lc=1` in the `[TGALGO]` line; (d) `onCaptureRestart(48000.0)` mid-replay logs `[TGAUDIO RESUME]`, clears an unconfirmed pending lock (`lc=0` before restart stays 0, `tgPendingLockAbs` reset — assert via a fresh lock-confirm taking ≥ 8 s of post-restart audio), and a *confirmed* lock survives; (e) tg dots: replay emits `Update.newTicks` dots whose cumulative deviation slope ≈ injected rate sign.
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Port Swift lines 1688–2155** (tg knobs and defaults verbatim, including the dark T1–T4 ship defaults 999.0 / 0 / 1.0 / 15.0) **and 2157 onward already exists (Task 3)**; wire the per-second tg compute/caching block (lines 1276–1317) and stability/convergence with tg thresholds (lines 1319–1349) into `process`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit.**

### Task 7: Analysis loop, auto-BPH, legacy BE, Update assembly, full-session fixtures

**Files:**
- Modify: `android/engine/src/main/kotlin/com/wrotate/engine/TimegrapherCore.kt`
- Test: `android/engine/src/test/kotlin/com/wrotate/engine/SessionReplayTest.kt`
- Create: `android/engine/src/test/kotlin/com/wrotate/engine/Replay.kt` — `fun replay(core: TimegrapherCore, samples: FloatArray, chunk: Int = 4096): List<Update>`

**Interfaces:**
- Produces: the background `analyze` path (Swift lines 1250–1266 snapshot + 1399–1443: auto-BPH via `goertzelRatio` across the three rings, `detectTickEvents` epoch-fold legacy beat error, lines 2222–2327), `linearize`, `applyResult`/`tryGoertzel`/`tryAutocorrelation` (legacy, ported for 1:1 completeness), and the final `Update` assembly (the tick drain at lines 1268–1274 and the confidence/log/Update block at 1350–1394; the tg compute/stability block in between is Task 6's). When `analysisExecutor == null` the analyze step runs synchronously inside `process`.

- [ ] **Step 1: Write failing tests** (the acceptance suite for the whole core):
  - `convergesOnCleanWatch`: default spec, `rateSecPerDay = +12.0`, 90 s → some Update has `rateStable == true`; the final stable `rate` within ±1.0 of +12.0; `tickCount ≥ 40`; `beatError != null`.
  - `beatErrorAccuracy`: `beatErrorMs = 1.5` → final `beatError` within 1.5 ± 0.3.
  - `autoBphDetects`: `bph = 21600` fixture, `start(0, true, 48000.0)` → `detectedBph == 21600` and `[TGAUTO BPH LOCKED]` logged.
  - `noiseNeverConverges` (Review Focus 2): 90 s of pure noise (`tickAmp = 0`) → **no** Update ever has `rateStable == true` and final `rate == null`.
  - `agcSquashedDegradesHonestly` (Review Focus 2): fixture post-processed by a soft compressor (tanh at 3× gain) + `noiseRms = 0.02f` → either converges within ±3.0 or never sets `rateStable`; assert no stable rate more than 5.0 off the injected value.
  - `rate44100` (Review Focus 3): same clean spec at `sampleRate = 44100.0` → same ±1.0 acceptance.
  - `chunkSizeInvariance` (Review Focus 4): replay the same fixture at chunk 4096 vs chunk 997 → identical final `rate`, `beatError`, `tickCount`.
  - `negativeRate`: `rateSecPerDay = -25.0` → final stable rate within ±1.0 of −25.0.
- [ ] **Step 2: Run, verify failure.**
- [ ] **Step 3: Implement** the remaining pieces.
- [ ] **Step 4: Run the full engine suite, verify pass** (`./gradlew :engine:test`). Iterate here until all acceptance tests pass — this is the port-correctness gate.
- [ ] **Step 5: Commit.**

### Task 8: Engine-rev lockstep and telemetry compatibility

**Files:**
- Modify: `ios/Wrotate/Wrotate/TimegrapherEngine.swift:3` (insert comment line `// TG_ENGINE_REV: 1` above the class doc)
- Modify: `android/engine/src/main/kotlin/com/wrotate/engine/TimegrapherCore.kt` (same comment at top)
- Create: `tests/engine-rev.test.js`
- Modify: `android/engine/src/main/kotlin/com/wrotate/engine/TimegrapherCore.kt` — append ` cap=<src> model=<model>` to the `[TGTUNE]` line via two new `Tuning` fields (`captureSource: String?`, `deviceModel: String?`; engine-set, not knobs)
- Test: extend the scripts test suite covering `scripts/accuracy_loop.py` TGTUNE parsing

**Interfaces:**
- Consumes: both engine source files.
- Produces: `npm test` fails whenever the two `TG_ENGINE_REV:` values differ (design §5); a documented `WAIVERS` array in the test file for recorded, deliberate divergences. Android `[TGTUNE]` lines carry `cap=` and `model=` as trailing tokens.

- [ ] **Step 1: Write the failing node test** — `tests/engine-rev.test.js` reads both files, extracts `/TG_ENGINE_REV:\s*(\d+)/`, asserts both exist and are equal (fails now: neither file has the marker).
- [ ] **Step 2: Add the marker comment to both files**; run `npx vitest run tests/engine-rev.test.js` — PASS.
- [ ] **Step 3: TGTUNE compatibility** — add the trailing `cap=`/`model=` tokens in Kotlin; read how `scripts/accuracy_loop.py` extracts knob values from `[TGTUNE]` echoes and add a test case (in the existing `npm run test:scripts` suite) feeding an Android-style line with the trailing tokens, asserting knob extraction is unaffected.
- [ ] **Step 4: Run** `npm test && npm run test:scripts && cd android && ./gradlew :engine:test` — all pass.
- [ ] **Step 5: Commit** (this commit touches `ios/` and `tests/` — comment-only on iOS, no behavior).

### Task 9: Capture adapter and harness app

**Files:**
- Create: `android/app/src/main/kotlin/com/wrotate/app/AudioCapture.kt`
- Create: `android/app/src/main/kotlin/com/wrotate/app/HarnessActivity.kt` (+ layout XML)
- Test: `android/app/src/test/kotlin/com/wrotate/app/AudioSourceSelectionTest.kt`

**Interfaces:**
- Consumes: `TimegrapherCore`, `WavIo`.
- Produces:
  - `fun selectAudioSource(supportsUnprocessed: Boolean): Pair<Int, String>` — `(MediaRecorder.AudioSource.UNPROCESSED, "unproc")` when supported, else `(VOICE_RECOGNITION, "vrec")`; pure function so it is unit-testable (Review Focus 1). Caller determines support via `AudioManager.getProperty(PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"`.
  - `class AudioCapture(context)` — AudioRecord at 48 000 Hz mono `ENCODING_PCM_FLOAT`, 4096-frame reads on a dedicated thread; `start(onBuffer: (FloatArray, Int) -> Unit)`, `stop()`; feeds `core.noteAudioClock` from `AudioRecord.getTimestamp` when available (skip otherwise — the ppm estimator is log-only); audio focus loss/regain → restart capture and call `core.onCaptureRestart(actualRate)`. If 48 000 is rejected, fall back to `getSampleRate()` and pass the actual rate to `core.start`.
  - Harness screen: BPH selector (Auto, 18000, 21600, 25200, 28800, 36000), Start/Stop, live fields (rate, beat error, amplitude, tick count, stable, signal quality, elapsed, capture source + model), a "Record WAV" toggle (writes the raw capture via `WavIo` to app external-files), a "Replay WAV" button (SAF picker → `replay` through the core, same display path), and a "Share log" button (exports the session's `logSink` capture + every `debugMessages` batch as a text file).

- [ ] **Step 1: Write the failing source-selection test** (both branches of `selectAudioSource`).
- [ ] **Step 2: Run, verify failure; implement; run, verify pass.**
- [ ] **Step 3: Build and smoke the harness in the emulator** — Run: `./gradlew :app:assembleDebug`, install in an API 35 emulator, use **Replay WAV** on a generated fixture WAV (write one with a tiny `:engine:test` helper or adb-push one): Expected: rate/BE/tick fields populate and match the fixture's JVM-test values; live mic start/stop does not crash (emulator mic quality is irrelevant).
- [ ] **Step 4: Commit.**

### Task 10: Pixel 7 validation (Saturday, manual with the owner)

**Files:**
- Create: `android/VALIDATION.md` (protocol + results)
- Create: `android/engine/src/test/resources/recordings/` (regression WAVs, small ones only; large files stay in `~/Documents/WRotate-assets/android-recordings/`)
- Test: `android/engine/src/test/kotlin/com/wrotate/engine/RecordedReplayTest.kt`

**Interfaces:**
- Consumes: the harness app; the owner's watches and iPhone.

- [ ] **Step 1: Install** — `adb install app-debug.apk` on the Pixel 7; confirm the harness shows `cap=unproc`.
- [ ] **Step 2: Side-by-side protocol** (acceptance from design §1): for ≥ 3 watches, 3 runs each on Pixel 7 (harness, Record WAV on) and 3 on the iPhone (production app): record per-run rate, beat error, amplitude, tick count, time-to-stable. Acceptance: per watch, Android median rate within ±3.0 s/day of iPhone median; beat error within ±0.5 ms; Android runs meet the good proxy (|rate| ≤ 15, ≥ 40 accepted ticks). Record everything in `android/VALIDATION.md`.
- [ ] **Step 3: Regression fixtures** — pick one clean and one hard recording per watch; trim to ≤ 30 s, add `RecordedReplayTest` asserting each recording's rate stays within ±1.0 s/day of the value measured at acceptance time (expected values hardcoded in the test with the watch + date in a comment).
- [ ] **Step 4: Run** `./gradlew :engine:test` — all pass, including recordings.
- [ ] **Step 5: Commit.** If acceptance fails, STOP and investigate with the systematic-debugging skill before any tuning — per the design, nothing ships to testers until this gate passes, and knob defaults stay identical to iOS unless evidence demands otherwise (that divergence would be a recorded `TG_ENGINE_REV` waiver discussion with the owner).
