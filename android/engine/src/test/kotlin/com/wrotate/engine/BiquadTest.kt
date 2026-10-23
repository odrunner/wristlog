package com.wrotate.engine

import kotlin.math.PI
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.test.Test
import kotlin.test.assertEquals
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

    /**
     * Coefficient bit patterns printed by /usr/bin/swift running the Swift makeBiquadHP
     * arithmetic (TimegrapherEngine.swift 437-451). Bit-exact filters are what make the
     * Kotlin tick-detector log byte-identical to the Swift engine's.
     */
    @Test
    fun coefficientsMatchSwiftBitForBit() {
        val golden = mapOf(
            Pair(48000.0, 4000f) to listOf(0x3F307642, 0xBFB07642.toInt(), 0xBFA3CAE5.toInt(), 0x3EF4867E),
            Pair(48000.0, 6000f) to listOf(0x3F11AC33, 0xBF91AC33.toInt(), 0xBF715BBE.toInt(), 0x3EAAAA1B),
            Pair(48000.0, 8000f) to listOf(0x3EEE2852, 0xBF6E2852.toInt(), 0xBF1EC58D.toInt(), 0x3E762C62),
            Pair(44100.0, 4000f) to listOf(0x3F2AA8CE, 0xBFAAA8CE.toInt(), 0xBF9C0422.toInt(), 0x3EE535ED),
            Pair(44100.0, 6000f) to listOf(0x3F0A4099, 0xBF8A4099.toInt(), 0xBF5B21F2.toInt(), 0x3E9BC0E4),
            Pair(44100.0, 8000f) to listOf(0x3EDCFAF5, 0xBF5CFAF5.toInt(), 0xBF023B30.toInt(), 0x3E5EEAED),
        )
        for ((key, bits) in golden) {
            val s = makeBiquadHP(key.second, key.first)
            val got = listOf(s.b0, s.b1, s.a1, s.a2).map { it.toRawBits() }
            assertEquals(bits, got, "coefficients for ${key.second} Hz @ ${key.first}")
            assertEquals(s.b0.toRawBits(), s.b2.toRawBits())
        }
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
