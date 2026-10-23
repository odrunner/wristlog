package com.wrotate.engine

import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TickSynthTest {
    /** Onset sample index of every burst: first |x| > threshold after a quiet refractory gap. */
    private fun onsets(x: FloatArray, sr: Double, threshold: Float = 0.02f): List<Int> {
        val refractory = (0.03 * sr).toInt()
        val out = ArrayList<Int>()
        var last = -refractory
        for (i in x.indices) {
            if (abs(x[i]) > threshold && i - last >= refractory) {
                out.add(i)
                last = i
            }
        }
        return out
    }

    @Test
    fun burstsPerSecondMatchesBph() {
        val spec = SynthSpec(durationSec = 10.0)
        val x = synthesize(spec)
        assertEquals((spec.durationSec * spec.sampleRate).toInt(), x.size)
        val n = onsets(x, spec.sampleRate).size
        assertTrue(n in 79..80, "expected ~80 bursts in 10 s (8/s), got $n")
    }

    @Test
    fun tickSpacingFollowsRate() {
        val spec = SynthSpec(rateSecPerDay = 20.0, durationSec = 60.0)
        val on = onsets(synthesize(spec), spec.sampleRate)
        // Same-parity (tick to tick) spacing is the brief's (7200/bph) * sr * (1 - rate/86400).
        val ticks = on.filterIndexed { i, _ -> i % 2 == 0 }
        val mean = (ticks.last() - ticks.first()).toDouble() / (ticks.size - 1)
        val expected = (7200.0 / 28800) * 48000 * (1 - 20.0 / 86400)
        assertEquals(expected, mean, expected * 0.0002)
    }

    @Test
    fun beatErrorAlternatesGaps() {
        val spec = SynthSpec(beatErrorMs = 2.0, durationSec = 10.0)
        val on = onsets(synthesize(spec), spec.sampleRate)
        val gaps = on.zipWithNext { a, b -> (b - a) * 1000.0 / spec.sampleRate }
        val even = gaps.filterIndexed { i, _ -> i % 2 == 0 }.average()
        val odd = gaps.filterIndexed { i, _ -> i % 2 == 1 }.average()
        assertEquals(2.0, abs(even - odd), 0.1)
    }

    @Test
    fun deterministicForSeed() {
        val a = synthesize(SynthSpec(durationSec = 1.0))
        val b = synthesize(SynthSpec(durationSec = 1.0))
        assertTrue(a.contentEquals(b))
    }

    @Test
    fun wavRoundTrip() {
        val x = synthesize(SynthSpec(sampleRate = 44100.0, durationSec = 1.0))
        val f = File.createTempFile("tick", ".wav")
        try {
            WavIo.write(f, x, 44100.0)
            val (y, sr) = WavIo.read(f)
            assertEquals(44100.0, sr)
            assertEquals(x.size, y.size)
            for (i in x.indices) assertEquals(x[i], y[i], 1e-6f)
        } finally {
            f.delete()
        }
    }
}
