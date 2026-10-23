package com.wrotate.engine

import java.util.Random
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

data class SynthSpec(
    val sampleRate: Double = 48000.0,
    val bph: Int = 28800,
    val rateSecPerDay: Double = 0.0,
    val beatErrorMs: Double = 0.0,
    val durationSec: Double = 90.0,
    val burstHz: Double = 6500.0,
    val burstMs: Double = 2.0,
    val tickAmp: Float = 0.05f,
    val tockAmpRatio: Float = 0.8f,
    val noiseRms: Float = 0.002f,
    val seed: Long = 1L,
)

/**
 * Synthesizes watch-tick audio: alternating tick/tock bursts (exponentially decaying sine at
 * burstHz) over seeded white noise.
 *
 * Conventions:
 * - Beat interval = 3600/bph seconds. Same-parity (tick-to-tick) spacing = 7200/bph seconds,
 *   scaled by (1 - rateSecPerDay/86400) (so +rate gives shorter spacing, per the brief).
 * - Beat error: odd (tock) beats are displaced by +beatErrorMs/2, so the tick->tock and
 *   tock->tick gaps are interval +/- beatErrorMs/2 and differ by exactly beatErrorMs,
 *   matching wrotate_test.js (beatError = |avgOdd - avgEven| of alternating intervals).
 *   Tick (even) beats stay exactly on the rate-scaled grid.
 * - Burst positions are fractional; each burst is evaluated at its exact sub-sample offset.
 */
fun synthesize(spec: SynthSpec): FloatArray {
    val sr = spec.sampleRate
    val n = (spec.durationSec * sr).toInt()
    val out = FloatArray(n)

    val rng = Random(spec.seed)
    if (spec.noiseRms > 0f) {
        for (i in 0 until n) out[i] = (rng.nextGaussian() * spec.noiseRms).toFloat()
    }

    val scale = 1.0 - spec.rateSecPerDay / 86400.0
    val beatSamples = (3600.0 / spec.bph) * sr * scale
    val halfErrSamples = spec.beatErrorMs / 1000.0 * sr / 2.0
    val firstBeat = 0.1 * sr // lead-in so the displaced first beat stays in range
    val tau = spec.burstMs / 1000.0 / 3.0
    val lenSamples = ceil(spec.burstMs / 1000.0 * 3.0 * sr).toInt()

    var k = 0
    while (true) {
        val pos = firstBeat + k * beatSamples + if (k % 2 == 0) 0.0 else halfErrSamples
        if (pos >= n) break
        val amp = if (k % 2 == 0) spec.tickAmp else spec.tickAmp * spec.tockAmpRatio
        val start = max(0, floor(pos).toInt() + 1)
        val end = min(n - 1, floor(pos).toInt() + lenSamples)
        for (i in start..end) {
            val t = (i - pos) / sr
            out[i] += (amp * exp(-t / tau) * sin(2.0 * PI * spec.burstHz * t)).toFloat()
        }
        k++
    }
    return out
}
