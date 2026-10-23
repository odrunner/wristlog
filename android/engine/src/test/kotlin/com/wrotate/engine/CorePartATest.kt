package com.wrotate.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CorePartATest {

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

    // (a) Token sequence of Swift TimegrapherEngine.swift:432 at ship defaults, formatted as
    // Swift prints them (e.g. tgSigmaGate 3e-4 -> "0.0003", Float 0.9999 -> "0.9999").
    // Asserted as an ordered PREFIX: Task 8 appends cap=/model= trailing tokens.
    @Test
    fun startAndTuneEchoSwiftTokens() {
        val core = TimegrapherCore()
        val log = ArrayList<String>()
        core.logSink = { log.add(it) }
        core.start(28800, true, 48000.0)
        core.setTuning(Tuning())

        assertEquals(1, log.count { it.startsWith("[TGSTART]") }, log.joinToString("\n"))
        assertEquals(
            "[TGSTART] bph=28800 autoBph=false targetBph=28800 detectedBph=Optional(28800) useTg=true",
            log.single { it.startsWith("[TGSTART]") },
        )
        val tune = log.filter { it.startsWith("[TGTUNE]") }
        assertEquals(1, tune.size, log.joinToString("\n"))

        val expected = listOf(
            "[TGTUNE]", "regSkip=5", "regMinN=10", "wallMin=20.0", "stabWin=15.0", "stabThresh=3.0",
            "stabLose=5.0", "maxPairTh=2.0", "minPairTh=1.0", "coldStart=2.0", "madMult=3.0",
            "maxTickDev=10.0", "calibDur=24000", "ringTarget=12000.0", "outlier=0.15/0.2",
            "calibP=0.98", "calibM=1.2/0.8", "maxRecal=4", "recalTrig=3.0", "decay=0.9999/0.995",
            "detectM=0.3", "minSpace=0.9", "maxBphCorr=2", "noiseFloor=2.0", "peakGate=3.0",
            "phaseLock=true/0.4", "tgKnobs=0.0003/6.0/8.0/3.0", "maxWin=16.0", "agreeBand=12.0",
            "lift=52.0", "periodFit=2", "holdOnLock=true", "ampMin=90.0", "confirmBand=999.0",
            "guardMode=0", "gateMaxRej=1.0", "acquireMax=15.0",
        )
        val tokens = tune.single().split(" ")
        assertTrue(tokens.size >= expected.size, "TGTUNE too short: ${tune.single()}")
        assertEquals(expected, tokens.subList(0, expected.size))
    }

    // (b) clean 90 s default fixture: the detector counts ticks and logs psBE.
    @Test
    fun cleanFixtureCountsTicksAndLogsPsBE() {
        val s = run(SynthSpec())
        assertTrue(s.updates.isNotEmpty())
        val last = s.updates.last()
        assertTrue(last.tickCount >= 500, "tickCount=${last.tickCount}")
        assertTrue(s.log.any { it.startsWith("[TGTICK #") && it.contains("psBE=") })
        // Design delta 3: every logSink line also reaches Update.debugMessages, in order.
        assertEquals(s.log, s.updates.flatMap { it.debugMessages })
    }

    private fun lastPsBE(s: Session): Double {
        val re = Regex("""psBE=([0-9.]+)ms""")
        val values = s.log.filter { it.startsWith("[TGTICK #") }
            .mapNotNull { re.find(it)?.groupValues?.get(1)?.toDouble() }
        assertTrue(values.isNotEmpty(), "no numeric psBE logged")
        return values.last()
    }

    // (c) the phase-separated beat error ESTIMATOR recovers the injected 2.0 ms. Phase-lock is
    // switched off (a setTuning knob, no engine constant touched) to isolate the estimator:
    // at ship defaults the phase-locked crest selection picks a decay-tail sample of the early
    // beat, which hides most of the displacement — see psBEAtShipDefaultsMatchesSwift.
    // The real Swift engine on this exact fixture with phaseLock=false logs psBE=1.94ms.
    // foldedBE= is the background analyze's epoch-fold estimate (Task 7); the golden harness
    // runs analyze synchronously on audio time, as this port does with a null executor.
    @Test
    fun psBERecoversInjectedBeatError() {
        val s = run(SynthSpec(beatErrorMs = 2.0), tuning = Tuning(phaseLock = false))
        val psBE = lastPsBE(s)
        assertTrue(psBE in 1.5..2.5, "psBE=$psBE")
        assertEquals(
            "[TGTICK #696 @ 87.79s] pairDev=0.000ms cumPairDev=0.152ms thresh=1.00ms beatErr=1.0ms" +
                " ticks=-1.0,1.0ms psBE=1.94ms foldedBE=3.00ms energy=0.025408",
            s.log.last { it.startsWith("[TGTICK #") },
        )
    }

    // Golden lines are the output of the REAL Swift TimegrapherEngine (macOS harness, same WAV
    // bytes, ship-default tuning). At ship defaults Swift itself reports psBE=0.14ms for an
    // injected 2.0 ms: phase-lock collects a candidate on every decay-tail sample above
    // threshold and keeps the one closest to the predicted beat, so an early beat is read
    // ~10 ring samples late. This pins that Swift behaviour; it is not a port defect.
    // (foldedBE=3.00ms: the legacy epoch fold, live since Task 7 — see the note above.)
    @Test
    fun psBEAtShipDefaultsMatchesSwift() {
        val s = run(SynthSpec(beatErrorMs = 2.0))
        assertEquals(
            "[TGCALIBRATED] tickThreshold=0.006749 (p98=0.005624 mult=1.2) after 24000 samples recal=0",
            s.log.single { it.startsWith("[TGCALIBRATED]") },
        )
        assertEquals(343, s.log.count { it.startsWith("[TGTICK #") })
        assertEquals(
            "[TGTICK #696 @ 87.71s] pairDev=-0.019ms cumPairDev=-0.008ms thresh=1.00ms beatErr=0.1ms" +
                " ticks=-0.0,0.0ms psBE=0.14ms foldedBE=3.00ms energy=0.002071",
            s.log.last { it.startsWith("[TGTICK #") },
        )
    }

    // (d) calibration completes before any tick is logged.
    @Test
    fun calibratedBeforeFirstTick() {
        val s = run(SynthSpec())
        val cal = s.log.indexOfFirst { it.startsWith("[TGCALIBRATED]") }
        val tick = s.log.indexOfFirst { it.startsWith("[TGTICK") }
        assertTrue(cal >= 0, "no [TGCALIBRATED]")
        assertTrue(tick >= 0, "no [TGTICK]")
        assertTrue(cal < tick, "calibrated at $cal, first tick at $tick")
    }

    // noteAudioClock (design delta 4): frames running 50 ppm fast against host nanos.
    @Test
    fun audioClockReportsPpm() {
        val core = TimegrapherCore()
        val log = ArrayList<String>()
        core.logSink = { log.add(it) }
        core.start(28800, true, 48000.0)
        val frames = 4096
        val buf = FloatArray(frames)
        val bufSec = frames / 48000.0
        for (k in 0 until 400) { // ~34 s
            val hostNs = 1_000_000_000L + Math.round(k * bufSec / (1.0 + 50e-6) * 1e9)
            core.noteAudioClock(hostNs, frames)
            core.process(buf, frames)
        }
        core.stop()
        val clock = log.lastOrNull { it.startsWith("[TGCLOCK]") }
        assertNotNull(clock, "no [TGCLOCK]")
        val ppm = Regex("""ppm=([+-][0-9.]+)""").find(clock)!!.groupValues[1].toDouble()
        assertTrue(kotlin.math.abs(ppm - 50.0) < 0.5, clock)
    }
}
