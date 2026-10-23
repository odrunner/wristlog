package com.wrotate.engine

import kotlin.math.abs
import kotlin.math.exp
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FftTest {
    private val count = 4800

    /** Gaussian pulses (sigma 3 samples) centred at fractional positions k*period, so sub-sample spacing is representable. */
    private fun pulseTrain(period: Double): FloatArray {
        val s = FloatArray(count)
        var c = 10.0
        while (c < count) {
            val lo = maxOf(0, (c - 15).toInt())
            val hi = minOf(count - 1, (c + 15).toInt())
            for (i in lo..hi) {
                val d = (i - c) / 3.0
                s[i] += exp(-0.5 * d * d).toFloat()
            }
            c += period
        }
        return s
    }

    private fun argmaxFrom2(acf: FloatArray): Int {
        var best = 2
        for (i in 2 until acf.size) if (acf[i] > acf[best]) best = i
        return best
    }

    @Test
    fun peakAtExactPeriodLag() {
        val acf = fftAutocorrelation(pulseTrain(120.0), count)
        assertEquals(count, acf.size)
        assertEquals(120, argmaxFrom2(acf))
    }

    @Test
    fun parabolicRefinementRecoversFractionalPeriod() {
        val acf = fftAutocorrelation(pulseTrain(119.6), count)
        // restrict to the first period neighbourhood so rounding jitter of later multiples cannot win
        var p = 100
        for (i in 100..140) if (acf[i] > acf[p]) p = i
        val y0 = acf[p - 1].toDouble()
        val y1 = acf[p].toDouble()
        val y2 = acf[p + 1].toDouble()
        val refined = p + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
        assertTrue(abs(refined - 119.6) <= 0.05, "refined=$refined")
    }

    @Test
    fun matchesDirectAutocorrelation() {
        // deterministic pseudo-random signal
        var seed = 12345L
        val s = FloatArray(count) {
            seed = (seed * 6364136223846793005L + 1442695040888963407L)
            (((seed ushr 33).toInt() and 0xFFFF) / 32768.0f - 1f)
        }
        val acf = fftAutocorrelation(s, count)
        fun direct(lag: Int): Double {
            var sum = 0.0
            for (i in 0 until count - lag) sum += s[i].toDouble() * s[i + lag].toDouble()
            return sum
        }
        val d0 = direct(0)
        val a0 = acf[0].toDouble()
        for (lag in 1..300) {
            val expected = direct(lag) / d0
            val actual = acf[lag] / a0
            val rel = abs(actual - expected) / maxOf(abs(expected), 1e-2)
            assertTrue(rel < 1e-3, "lag $lag expected=$expected actual=$actual")
        }
    }
}
