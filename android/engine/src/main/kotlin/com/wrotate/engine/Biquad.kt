package com.wrotate.engine

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** 2nd-order Butterworth HP filter state (biquad). Mutated in place by [applyBiquad]. */
class BiquadState {
    var b0: Float = 0f
    var b1: Float = 0f
    var b2: Float = 0f
    var a1: Float = 0f
    var a2: Float = 0f
    var x1: Float = 0f
    var x2: Float = 0f
    var y1: Float = 0f
    var y2: Float = 0f
    var cutoffHz: Float = 4000f
}

fun makeBiquadHP(cutoff: Float, sampleRate: Double): BiquadState {
    val w0 = 2.0f * PI.toFloat() * cutoff / sampleRate.toFloat()
    val cosW0 = cos(w0)
    val sinW0 = sin(w0)
    val alpha = sinW0 / (2.0f * 0.7071f) // Q = 0.7071 (Butterworth)
    val a0 = 1.0f + alpha
    val state = BiquadState()
    state.b0 = (1.0f + cosW0) / 2.0f / a0
    state.b1 = -(1.0f + cosW0) / a0
    state.b2 = (1.0f + cosW0) / 2.0f / a0
    state.a1 = -2.0f * cosW0 / a0
    state.a2 = (1.0f - alpha) / a0
    state.cutoffHz = cutoff
    return state
}

fun applyBiquad(state: BiquadState, x: Float): Float {
    val y = state.b0 * x + state.b1 * state.x1 + state.b2 * state.x2 -
        state.a1 * state.y1 - state.a2 * state.y2
    state.x2 = state.x1; state.x1 = x
    state.y2 = state.y1; state.y1 = y
    return y
}
