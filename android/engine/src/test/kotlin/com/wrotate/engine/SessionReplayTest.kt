package com.wrotate.engine

import kotlin.math.abs
import kotlin.math.tanh
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Acceptance suite for the whole core (plan Task 7): full synthetic sessions replayed through
 * process() exactly as the capture layer feeds them, analyze running synchronously
 * (analysisExecutor == null).
 *
 * "Swift golden" values below are the output of the REAL Swift TimegrapherEngine (macOS
 * harness, same WAV bytes, analyze run synchronously on audio time like this port's null
 * executor). Every one of those runs is byte-identical to the port across the whole log, and
 * its per-Update stream (rate, beatError, tickCount, detectedBph, rateStable, ...) matches
 * field for field, except beatError/amplitude, which agree to ~1e-5 ms / ~1e-8 deg: the tg
 * fold's mean is vDSP_meanv in Swift (vectorised Float summation) and a Double sum here.
 * Hence the 1e-4 tolerance on beatError pins.
 */
class SessionReplayTest {

    private class Session(val updates: List<Update>, val log: List<String>, val result: Result)

    private data class RunKey(val spec: SynthSpec, val bph: Int, val chunk: Int)

    companion object {
        // Each 90 s replay costs ~10 s; tests that replay the same spec share one session.
        private val fixtures = HashMap<SynthSpec, FloatArray>()
        private val sessions = HashMap<RunKey, Session>()

        @Synchronized
        private fun fixture(spec: SynthSpec): FloatArray = fixtures.getOrPut(spec) { synthesize(spec) }

        private val CLEAN_12 = SynthSpec(rateSecPerDay = 12.0)
    }

    private fun replaySession(spec: SynthSpec, bph: Int, samples: FloatArray, chunk: Int): Session {
        val core = TimegrapherCore()
        val log = ArrayList<String>()
        core.logSink = { log.add(it) }
        core.start(bph, true, spec.sampleRate)
        core.setTuning(Tuning())
        val updates = replay(core, samples, chunk)
        val result = core.stop()
        return Session(updates, log, result)
    }

    private fun run(spec: SynthSpec, bph: Int = spec.bph, chunk: Int = 4096): Session =
        synchronized(sessions) {
            sessions.getOrPut(RunKey(spec, bph, chunk)) { replaySession(spec, bph, fixture(spec), chunk) }
        }

    private fun finalStableRate(s: Session): Double? = s.updates.lastOrNull { it.rateStable }?.rate

    private fun assertConverges(s: Session, injected: Double) {
        assertTrue(s.updates.any { it.rateStable }, "never stable")
        val stable = finalStableRate(s)
        assertNotNull(stable, "final stable Update carries no rate")
        assertTrue(abs(stable - injected) <= 1.0, "final stable rate=$stable, injected $injected")
    }

    @Test
    fun convergesOnCleanWatch() {
        val s = run(CLEAN_12)
        assertConverges(s, 12.0)
        val last = s.updates.last()
        assertTrue(last.tickCount >= 40, "tickCount=${last.tickCount}")
        assertNotNull(last.beatError, "beatError null")
        // Swift golden (clean12-tg1): final Update el=88.0 rate=12.0 tc=694 stable=true.
        assertEquals(12.0, last.rate)
        assertEquals(694, last.tickCount)
        assertTrue(last.rateStable)
    }

    // PLAN DEFECT (same class as Task 5's psBE ruling): the plan expects 1.5 +- 0.3 for an
    // injected 1.5 ms, but Update.beatError on the tg path (Android always runs tg) is the tg
    // fold estimate, |toc offset - P/2|, which is HALF the tick/tock gap difference — the tg
    // convention. TickSynth injects a gap difference of exactly beatErrorMs (Task 4 ruling),
    // so the tg engine reports 0.75. The REAL Swift engine reports 0.7501651 on this exact
    // fixture (golden be15-tg1; [TGALGO] be=0.75 beOn=0.75). No engine constant changed: the
    // test asserts the plan's tolerance on the tg convention (1.5/2 +- 0.3/2) and pins Swift.
    @Test
    fun beatErrorAccuracy() {
        val s = run(SynthSpec(beatErrorMs = 1.5))
        val be = s.updates.last().beatError
        assertNotNull(be, "beatError null")
        assertTrue(abs(be - 1.5 / 2) <= 0.3 / 2, "beatError=$be (tg convention: half the gap difference)")
        // Swift golden regenerated at TG_ENGINE_REV 2 (2026-10-25): the blank-rate restart fix
        // lets tg computes resume immediately after a recalibration rewind, shifting the update
        // timeline. Harness: build2.sh + main.swift beside the archive; logs byte-identical.
        assertEquals(0.7511057895755661, be, 1e-4)
        assertTrue(s.log.last { it.startsWith("[TGALGO @") }.contains(" be=0.75 beOn=0.75 "))
    }

    @Test
    fun autoBphDetects() {
        val s = run(SynthSpec(bph = 21600, durationSec = 30.0), bph = 0)
        assertEquals(21600, s.updates.last().detectedBph)
        assertTrue(s.log.contains("[TGAUTO BPH LOCKED] 21600"), s.log.filter { it.startsWith("[TGAUTO") }.joinToString("\n"))
        // Swift golden (bph21600-auto): the first analysis (5 s of ring) locks decisively,
        // then activates tick detection at the detected BPH.
        val i = s.log.indexOf("[TGAUTO BPH @ 5.0s] best=21600 ratio=31.13 2nd=0.39 threshold=3.0 decisive=true")
        assertTrue(i >= 0, s.log.filter { it.startsWith("[TGAUTO") }.joinToString("\n"))
        assertEquals("[TGAUTO BPH LOCKED] 21600", s.log[i + 1])
        assertEquals("[TGACTIVATE] bph=21600 autoBph=true expectedInterval=2000.0 ringSR=12000 CALIBRATING for 24000 samples", s.log[i + 2])
        assertEquals(2, s.log.count { it.startsWith("[TGAUTO") })
        assertTrue(s.updates.takeWhile { it.detectedBph == null }.all { it.tickCount == 0 && it.rate == null })
        assertConverges(s, 0.0)
    }

    // The app path: analyze is handed to analysisExecutor instead of running inline. An
    // executor that runs the task immediately must give the same session as null.
    @Test
    fun analyzeRunsOnExecutor() {
        val spec = SynthSpec(bph = 21600, durationSec = 30.0)
        var jobs = 0
        val core = TimegrapherCore(analysisExecutor = { r -> jobs += 1; r.run() })
        val log = ArrayList<String>()
        core.logSink = { log.add(it) }
        core.start(0, true, spec.sampleRate)
        core.setTuning(Tuning())
        val updates = replay(core, fixture(spec))
        core.stop()
        assertTrue(jobs >= 20, "analyze dispatched $jobs times") // ~once per second after 5 s
        assertEquals(run(spec, bph = 0).log, log)
        assertEquals(21600, updates.last().detectedBph)
    }

    // Review Focus 2: pure noise has no period, so the engine must never claim convergence.
    @Test
    fun noiseNeverConverges() {
        val s = run(SynthSpec(tickAmp = 0f))
        assertTrue(s.updates.none { it.rateStable }, "noise reported a stable rate")
        assertNull(s.updates.last().rate, "final rate=${s.updates.last().rate}")
    }

    // Review Focus 2: a phone AGC/limiter (tanh soft compressor at 3x gain) over ticks buried
    // in loud noise (noiseRms 0.02 vs tickAmp 0.05).
    //
    // PLAN CRITERION NOT MET BY THE iOS ENGINE (reported, not fixed — no engine change): the
    // plan requires no stable rate more than 5.0 off the injected +12. The REAL Swift engine
    // on this exact fixture (golden agc-tg1, log byte-identical, Update stream identical)
    // reports rateStable=true with rates up to 26.8 and down to 3.5. Two Swift mechanisms:
    // the stability window counts one rateHistory entry per BUFFER, so ~6 buffers repeating
    // ONE cached tg reading (~0.5 s) satisfy "5 rates within 6 s, spread 0"; and while the
    // rate is nil (or fewer than 5 recent rates) isStable keeps wasStable, so the latch
    // survives a gap and the next, unrelated, reading inherits it. This test pins that Swift
    // truth so the port stays 1:1; the owner decides on an engine fix.
    @Test
    fun agcSquashedDegradesHonestly() {
        val spec = CLEAN_12.copy(noiseRms = 0.02f)
        val squashed = synthesize(spec).let { x -> FloatArray(x.size) { tanh(3f * x[it]) } }
        val s = replaySession(spec, spec.bph, squashed, 4096)
        val stableRates = s.updates.filter { it.rateStable }.mapNotNull { it.rate }
        val runs = stableRates.filterIndexed { i, r -> i == 0 || r != stableRates[i - 1] }
        // Swift golden regenerated at TG_ENGINE_REV 2 (2026-10-25, blank-rate restart fix).
        assertEquals(listOf(12.3, 16.3, 8.2, 17.9, -3.0), runs, "Swift golden agc-tg1 stable-rate sequence")
        // What does hold: the session ends with no reading and the sigma-gate flags the signal.
        val last = s.updates.last()
        assertNull(last.rate)
        assertEquals("poor", last.tgSignalQuality)
        assertTrue(last.rateStable) // the latched flag, as in Swift
    }

    // Review Focus 3: 44.1 kHz devices (ring subsample 3 -> 14.7 kHz ring) meet the same bar.
    @Test
    fun rate44100() {
        val s = run(CLEAN_12.copy(sampleRate = 44100.0))
        assertConverges(s, 12.0)
        val last = s.updates.last()
        assertTrue(last.tickCount >= 40, "tickCount=${last.tickCount}")
        assertNotNull(last.beatError, "beatError null")
        // Swift golden (clean12-44k-tg1): final Update rate=12.0 tc=696.
        assertEquals(12.0, last.rate)
        assertEquals(696, last.tickCount)
    }

    // Review Focus 4: the capture layer's buffer size must not change the reading.
    //
    // rate and tickCount are invariant, as the plan requires. beatError is NOT, in Swift
    // either (goldens clean12-tg1 vs clean12-tg1-c997, logs byte-identical to the port):
    // the tg fold is recomputed at most every 0.5 s of wall time, checked once per buffer, so
    // the last fold ends at a different ring sample for 4096- vs 997-frame buffers. The
    // readings differ by 0.02 ms (0.028 vs 0.008) — both 0.0 at display precision. stop()'s
    // Result carries the legacy epoch-fold beat error, which the background analyze
    // snapshots once per second at buffer granularity: nil vs 2.83 in Swift too. Swift has
    // no "recompute over full state at stop" step, so the port does not invent one.
    @Test
    fun chunkSizeInvariance() {
        val a = run(CLEAN_12, chunk = 4096)
        val b = run(CLEAN_12, chunk = 997)
        val ua = a.updates.last()
        val ub = b.updates.last()
        assertEquals(ua.rate, ub.rate, "final Update rate")
        assertEquals(ua.tickCount, ub.tickCount, "final Update tickCount")
        assertEquals(12.0, ua.rate)
        assertEquals(694, ua.tickCount)
        assertNotNull(ua.beatError); assertNotNull(ub.beatError)
        assertTrue(abs(ua.beatError!! - ub.beatError!!) < 0.05, "beatError ${ua.beatError} vs ${ub.beatError}")
        assertEquals(0.02843377214607775, ua.beatError!!, 1e-4) // Swift golden clean12-tg1
        assertEquals(0.007821531649218134, ub.beatError!!, 1e-4) // Swift golden clean12-tg1-c997
        assertEquals(a.result.rate, b.result.rate, "stop() Result rate")
        assertEquals(a.result.tickCount, b.result.tickCount, "stop() Result tickCount")
        assertNull(a.result.beatError) // Swift golden: last [TGTICK] foldedBE=-ms
        assertEquals(2.83, b.result.beatError) // Swift golden: last [TGTICK] foldedBE=2.83ms
    }

    @Test
    fun negativeRate() {
        val s = run(SynthSpec(rateSecPerDay = -25.0))
        assertConverges(s, -25.0)
        assertEquals(-25.0, s.updates.last().rate) // Swift golden neg25-tg1
    }

    // Task 6 deferred minor: a capture restart onto a DIFFERENT sample rate (e.g. a 44.1 kHz
    // headset mic) re-derives filters and rings, and the tg rate comes back at the new rate.
    @Test
    fun captureRestartAt44100() {
        val restartAt = 20.0
        val before = fixture(CLEAN_12)
        val after = fixture(CLEAN_12.copy(sampleRate = 44100.0))
        val core = TimegrapherCore()
        val log = ArrayList<String>()
        core.logSink = { log.add(it) }
        core.start(28800, true, 48000.0)
        core.setTuning(Tuning())
        val pre = replay(core, before.copyOfRange(0, (restartAt * 48000).toInt()))
        assertTrue(pre.any { it.rate != null }, "no rate before the restart")
        core.onCaptureRestart(44100.0)
        val post = replay(core, after.copyOfRange((restartAt * 44100).toInt(), after.size))
        core.stop()
        val ri = log.indexOf("[TGAUDIO RESUME] capture-restart rate=44100 rateChanged=true")
        assertTrue(ri >= 0, log.filter { it.startsWith("[TGAUDIO") }.joinToString("\n"))
        assertTrue(log[ri - 1].startsWith("[TGACTIVATE] bph=28800 autoBph=false expectedInterval=1837.5 ringSR=14700 "), log[ri - 1])
        val rated = post.mapNotNull { it.rate }
        assertTrue(rated.isNotEmpty(), "no tg rate after the 44.1 kHz restart")
        assertTrue(abs(rated.last() - 12.0) <= 1.0, "post-restart rate=${rated.last()}")
    }
}
