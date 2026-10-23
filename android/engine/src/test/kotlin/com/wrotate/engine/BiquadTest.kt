package com.wrotate.engine

import kotlin.math.PI
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.test.Test
import kotlin.test.assertTrue

class BiquadTest {
    private val sampleRate = 48000.0

    /** RMS(out)/RMS(in) in dB over 4800 samples after 500 samples of settling. */
    private fun gainDb(cutoff: Float, freq: Double): Double {
        val state = makeBiquadHP(cutoff, sampleRate)
        var inSq = 0.0
        var outSq = 0.0
        for (n in 0 until 500 + 4800) {
            val x = sin(2.0 * PI * freq * n / sampleRate).toFloat()
            val y = applyBiquad(state, x)
            if (n >= 500) {
                inSq += x.toDouble() * x
                outSq += y.toDouble() * y
            }
        }
        return 20.0 * log10(sqrt(outSq / 4800) / sqrt(inSq / 4800))
    }

    @Test
    fun highPassAttenuatesLowFrequency() {
        val db = gainDb(4000f, 100.0)
        assertTrue(db < -40.0, "100 Hz through 4 kHz HP should be < -40 dB, was $db")
    }

    @Test
    fun highPassPassesHighFrequency() {
        val db = gainDb(4000f, 8000.0)
        assertTrue(db > -3.0 && db < 3.0, "8 kHz through 4 kHz HP should be within 3 dB, was $db")
    }
}
