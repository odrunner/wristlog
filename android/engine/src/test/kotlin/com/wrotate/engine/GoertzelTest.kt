package com.wrotate.engine

import kotlin.test.Test
import kotlin.test.assertTrue

class GoertzelTest {
    private val sampleRate = 12000.0
    private val tickFreq = 8.0
    private val count = 12000 // 1 s: 8 whole pulse periods

    private fun pulseTrain(): FloatArray {
        val period = (sampleRate / tickFreq).toInt()
        return FloatArray(count) { if (it % period == 0) 1f else 0f }
    }

    @Test
    fun powerAtTargetExceedsOffTargetPower() {
        val s = pulseTrain()
        val on = goertzelPower(s, count, tickFreq, sampleRate)
        val off = goertzelPower(s, count, tickFreq * 1.37, sampleRate)
        assertTrue(on > 10.0 * off, "on=$on off=$off")
    }

    @Test
    fun ratioOnPulseTrainIsHigh() {
        val r = goertzelRatio(pulseTrain(), count, tickFreq, sampleRate)
        assertTrue(r > 3.0, "ratio=$r")
    }
}
