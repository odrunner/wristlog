package com.wrotate.engine

import kotlin.math.PI
import kotlin.math.cos

fun goertzelPower(signal: FloatArray, count: Int, targetFreq: Double, sampleRate: Double): Double {
    val k = targetFreq * count.toDouble() / sampleRate
    val w = 2.0 * PI * k / count.toDouble()
    val coeff = (2.0 * cos(w)).toFloat()
    var s1 = 0f
    var s2 = 0f
    for (i in 0 until count) {
        val s0 = signal[i] + coeff * s1 - s2
        s2 = s1
        s1 = s0
    }
    val power = (s1 * s1 + s2 * s2 - coeff * s1 * s2).toDouble()
    return power / (count.toDouble() * count.toDouble())
}

/** Lightweight ratio-only Goertzel: no sweep, just target vs baselines. */
fun goertzelRatio(signal: FloatArray, count: Int, tickFreq: Double, sampleRate: Double): Double {
    val tp = goertzelPower(signal, count, tickFreq, sampleRate)
    val mults = doubleArrayOf(0.73, 0.81, 1.19, 1.37, 1.61)
    var blSum = 0.0
    for (m in mults) blSum += goertzelPower(signal, count, tickFreq * m, sampleRate)
    val bl = blSum / mults.size.toDouble()
    return if (bl > 0) tp / bl else (if (tp > 0) 10.0 else 0.0)
}
