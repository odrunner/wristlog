package com.wrotate.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CorePartBTest {

    private class Session(val updates: List<Update>, val log: List<String>)

    private fun run(spec: SynthSpec, useTg: Boolean = true, tuning: Tuning = Tuning()): Session {
        val core = TimegrapherCore()
        val log = ArrayList<String>()
        core.logSink = { log.add(it) }
        core.start(spec.bph, useTg, spec.sampleRate)
        core.setTuning(tuning)
        val updates = replay(core, synthesize(spec))
        core.stop()
        return Session(updates, log)
    }

    private fun algoLines(log: List<String>) = log.filter { it.startsWith("[TGALGO @") }

    private fun tgValue(line: String): String = Regex(""" tg=(\S+)""").find(line)!!.groupValues[1]

    // (a) computeTgRate on a clean +15 s/day watch: the headline tg= reading recovers the rate.
    @Test
    fun tgRateRecoversInjectedRate() {
        val s = run(SynthSpec(rateSecPerDay = 15.0))
        val lines = algoLines(s.log)
        assertTrue(lines.isNotEmpty(), "no [TGALGO] line")
        val tg = tgValue(lines.last())
        assertTrue(tg != "nil", lines.last())
        assertTrue(kotlin.math.abs(tg.toDouble() - 15.0) <= 1.0, lines.last())
        // The rate reaches the Update too (rounded to 0.1 s/day), and the session converges.
        val rated = s.updates.mapNotNull { it.rate }
        assertTrue(rated.isNotEmpty(), "no Update carried a rate")
        assertTrue(kotlin.math.abs(rated.last() - 15.0) <= 1.0, "rate=${rated.last()}")
        assertTrue(s.updates.any { it.rateStable }, "never stable")
    }

    // (b) sigma-gate: pure noise has no stable period, so every window is gated out.
    @Test
    fun sigmaGateRejectsPureNoise() {
        val s = run(SynthSpec(tickAmp = 0f, noiseRms = 0.01f))
        val lines = algoLines(s.log)
        assertTrue(lines.isNotEmpty(), "no [TGALGO] line")
        assertTrue(lines.all { tgValue(it) == "nil" }, lines.joinToString("\n"))
        val gate = Regex(""" gate=(\d+)""").find(lines.last())!!.groupValues[1].toInt()
        assertTrue(gate > 0, lines.last())
        assertTrue(s.updates.all { it.rate == null })
    }

    // (c) T1 lock confirmation (shadow, always on): a clean replay confirms its lock.
    @Test
    fun cleanReplayConfirmsLock() {
        val s = run(SynthSpec())
        assertTrue(s.log.any { it.startsWith("[TGALGO lock-confirm]") }, "no lock-confirm")
        assertTrue(algoLines(s.log).last().contains(" lc=1 "), algoLines(s.log).last())
    }

    /**
     * Replays [samples] in 4096-sample chunks and calls onCaptureRestart once [restartAtSec]
     * of audio has been fed. Returns the log and, for each line, the audio second it was
     * logged at.
     */
    private class Stamped(val log: List<String>, val at: List<Double>)

    private fun replayWithRestart(spec: SynthSpec, restartAtSec: Double): Stamped {
        val core = TimegrapherCore()
        val log = ArrayList<String>()
        val at = ArrayList<Double>()
        var fed = 0
        core.logSink = { log.add(it); at.add(fed / spec.sampleRate) }
        core.start(spec.bph, true, spec.sampleRate)
        core.setTuning(Tuning())
        val samples = synthesize(spec)
        val chunk = 4096
        val buf = FloatArray(chunk)
        var restarted = false
        var i = 0
        while (i < samples.size) {
            if (!restarted && i >= restartAtSec * spec.sampleRate) {
                core.onCaptureRestart(48000.0)
                restarted = true
            }
            val n = minOf(chunk, samples.size - i)
            System.arraycopy(samples, i, buf, 0, n)
            fed = i + n
            core.process(buf, n)
            i += n
        }
        core.stop()
        return Stamped(log, at)
    }

    // (d1) a restart before the pending lock confirmed: the pending lock is dropped, so the
    // confirmation has to be earned again over >= 8 s of post-restart audio (a kept pending
    // lock would confirm as soon as an 8 s window refilled, ~7.2 s after the restart).
    @Test
    fun captureRestartClearsUnconfirmedLock() {
        val restartAt = 7.0
        val s = replayWithRestart(SynthSpec(), restartAt)
        val ri = s.log.indexOfFirst { it.startsWith("[TGAUDIO RESUME]") }
        assertTrue(ri >= 0, "no [TGAUDIO RESUME]")
        assertEquals("[TGAUDIO RESUME] capture-restart rate=48000 rateChanged=false", s.log[ri])
        val before = s.log.subList(0, ri).filter { it.startsWith("[TGALGO @") }
        assertTrue(before.isNotEmpty() && before.all { it.contains(" lc=0 ") }, before.joinToString("\n"))
        assertTrue(before.any { tgValue(it) != "nil" }, "no pending lock taken before the restart")
        val ci = s.log.indexOfFirst { it.startsWith("[TGALGO lock-confirm]") }
        assertTrue(ci > ri, "lock confirmed before the restart (or never)")
        val postRestartSec = s.at[ci] - restartAt
        assertTrue(postRestartSec >= 8.0, "confirmed ${"%.2f".format(postRestartSec)} s after the restart")
        // the restart forces a fresh calibration pass (Swift logs TGACTIVATE, then RESUME)
        assertTrue(s.log[ri - 1].startsWith("[TGACTIVATE]"), s.log[ri - 1])
        assertTrue(s.log.subList(ri, s.log.size).any { it.startsWith("[TGCALIBRATED]") })
    }

    // (d2) a CONFIRMED lock survives a restart: no second confirmation, lc stays 1.
    @Test
    fun captureRestartKeepsConfirmedLock() {
        val s = replayWithRestart(SynthSpec(), 25.0)
        val ri = s.log.indexOfFirst { it.startsWith("[TGAUDIO RESUME]") }
        assertTrue(ri >= 0, "no [TGAUDIO RESUME]")
        assertTrue(s.log.subList(0, ri).last { it.startsWith("[TGALGO @") }.contains(" lc=1 "))
        assertEquals(1, s.log.count { it.startsWith("[TGALGO lock-confirm]") })
        val after = s.log.subList(ri, s.log.size).filter { it.startsWith("[TGALGO @") }
        assertTrue(after.isNotEmpty(), "no [TGALGO] after the restart")
        assertTrue(after.all { it.contains(" lc=1 ") }, after.joinToString("\n"))
        assertTrue(tgValue(after.last()) != "nil", after.last())
    }

    // (e) tg dots come from the tg period grid; their cumulative deviation climbs for a fast
    // watch and falls for a slow one, at the injected rate (15 s/day = 0.174 ms/s).
    private fun dotSlope(rate: Double): Double {
        val s = run(SynthSpec(rateSecPerDay = rate))
        val dots = s.updates.flatMap { it.newTicks }
        assertTrue(dots.size >= 50, "only ${dots.size} dots")
        val mx = dots.sumOf { it.timeSec } / dots.size
        val my = dots.sumOf { it.deviationMs } / dots.size
        val sxy = dots.sumOf { (it.timeSec - mx) * (it.deviationMs - my) }
        val sxx = dots.sumOf { (it.timeSec - mx) * (it.timeSec - mx) }
        return sxy / sxx
    }

    @Test
    fun tgDotsFollowRateSign() {
        val expected = 15.0 / 86.4 // ms of deviation per second
        val fast = dotSlope(15.0)
        val slow = dotSlope(-15.0)
        assertTrue(fast > 0 && kotlin.math.abs(fast - expected) < 0.05, "fast slope=$fast")
        assertTrue(slow < 0 && kotlin.math.abs(slow + expected) < 0.05, "slow slope=$slow")
    }

    // Golden lines are the output of the REAL Swift TimegrapherEngine (macOS harness, same WAV
    // bytes as SynthSpec(), useTg=true, ship-default tuning). The whole log was byte-identical
    // across all 12 golden runs; these pin the tg-path lines so drift fails without the harness.
    @Test
    fun tgLinesMatchSwiftGolden() {
        // Pins regenerated at TG_ENGINE_REV 2 (2026-10-25): the blank-rate restart fix lets tg
        // computes resume immediately after a recalibration rewind, shifting the compute/log
        // timeline (one more TGALGO line, different lock-confirm snapshot). Swift harness run
        // (build2.sh + main.swift beside the archive) was byte-identical to the Kotlin log.
        val s = run(SynthSpec())
        assertEquals("[TGALGO lock-confirm] r0=-0.2 r1=-0.0 band=6", s.log.single { it.startsWith("[TGALGO lock-confirm]") })
        assertEquals(44, algoLines(s.log).size)
        assertEquals(
            "[TGALGO @ 87s] useTg=true reg=-0.1 tg=-0.0 amp=nil be=0.01 beOn=0.00 win=16s gate=0 ga=817 fit=2 lc=1 lr=0 ppm=nil",
            algoLines(s.log).last(),
        )
        assertEquals(
            "[TGUPDATE] elapsed=86.1s rate=-0.0 stable=true conf=0.99 regN=336 tickCount=682 cumDev=-0.08ms",
            s.log.last { it.startsWith("[TGUPDATE]") },
        )
        assertEquals(
            "[TGDEBUG 88.0s] energy=0.001050 thresh=0.009587 tickThresh=0.031957 tickCount=696 regN=343 pairDev=0.01 rate=-0.0",
            s.log.last { it.startsWith("[TGDEBUG") },
        )
    }

    // [TGUPDATE] emission is restored and [TGDEBUG] carries the smoothed rate.
    @Test
    fun updateAndDebugLinesCarryRate() {
        val s = run(SynthSpec(rateSecPerDay = 15.0))
        assertNotNull(s.log.firstOrNull { it.startsWith("[TGUPDATE]") }, "no [TGUPDATE]")
        assertTrue(s.log.any { it.startsWith("[TGDEBUG") && !it.endsWith(" rate=nil") }, "TGDEBUG never carried a rate")
    }
}
