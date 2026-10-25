package com.wrotate.app

import com.wrotate.engine.Result
import com.wrotate.engine.TickDot
import com.wrotate.engine.Update
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BridgeMessagesTest {

    private fun sampleUpdate(
        newTicks: List<TickDot> = emptyList(),
        debug: List<String> = emptyList(),
    ) = Update(
        rate = -1.9, beatError = 0.1, tickCount = 42, confidence = 0.7, noiseLevel = 0.01,
        detectedIntervalMs = 1667.0, detectedBph = 21600, debug = null, beatWaveform = null,
        amplitude = 250.0, tickPositions = null, cumulativeOffset = -0.5, elapsedSec = 20.0,
        method = "tg", rateStable = true, tgSignalQuality = "good", tgAcquiring = false,
        newTicks = newTicks, debugMessages = debug,
    )

    @Test
    fun updateEventCarriesTheContractFields() {
        val js = BridgeMessages.updateEvent(sampleUpdate())
        assertTrue(js.contains("\"event\":\"update\""))
        assertTrue(js.contains("\"rate\":-1.9"))
        assertTrue(js.contains("\"beatError\":0.1"))
        assertTrue(js.contains("\"amplitude\":250.0"))
        assertTrue(js.contains("\"tickCount\":42"))
        assertTrue(js.contains("\"detectedBph\":21600"))
        assertTrue(js.contains("\"rateStable\":true"))
        assertTrue(js.contains("\"tgSignalQuality\":\"good\""))
        assertTrue(js.contains("\"tgAcquiring\":false"))
        assertTrue(js.contains("\"method\":\"tg\""))
    }

    @Test
    fun nullRateAndQualityRenderAsJsonNull() {
        val u = sampleUpdate().copy(rate = null, tgSignalQuality = null, amplitude = null)
        val js = BridgeMessages.updateEvent(u)
        assertTrue(js.contains("\"rate\":null"))
        assertTrue(js.contains("\"tgSignalQuality\":null"))
        assertTrue(js.contains("\"amplitude\":null"))
    }

    @Test
    fun newTicksIncludedOnlyWhenPresent() {
        assertTrue(!BridgeMessages.updateEvent(sampleUpdate()).contains("newTicks"))
        val js = BridgeMessages.updateEvent(sampleUpdate(newTicks = listOf(TickDot(1.0, 0.5))))
        assertTrue(js.contains("\"newTicks\":[{\"t\":1.0,\"d\":0.5}]"))
    }

    @Test
    fun debugMessagesIncludedOnlyWhenPresent() {
        assertTrue(!BridgeMessages.updateEvent(sampleUpdate()).contains("debugMessages"))
        assertTrue(BridgeMessages.updateEvent(sampleUpdate(debug = listOf("[X] y"))).contains("\"debugMessages\":[\"[X] y\"]"))
    }

    @Test
    fun controlCharsAreEscapedSoTheEventStaysValidJson() {
        val js = BridgeMessages.updateEvent(sampleUpdate(debug = listOf("a\u0001b\tc")))
        assertTrue(!js.contains("\u0001"), "raw control char must not leak into the JS")
        assertTrue(js.contains("\\u0001"), "control char escaped as \\u00XX")
    }

    @Test
    fun stoppedIsExactlyTheIosShape() {
        assertEquals(
            "{\"event\":\"stopped\",\"rate\":-1.9,\"beatError\":0.1,\"tickCount\":42}",
            BridgeMessages.stopped(Result(-1.9, 0.1, 42)),
        )
    }

    @Test
    fun errorInterruptionPongShapes() {
        assertTrue(BridgeMessages.error("no mic").contains("\"event\":\"error\""))
        assertTrue(BridgeMessages.error("no mic").contains("\"message\":\"no mic\""))
        assertEquals("{\"event\":\"audioInterruption\",\"state\":\"began\"}", BridgeMessages.interruption("began"))
        assertEquals("{\"event\":\"pong\"}", BridgeMessages.pong())
        assertEquals("{\"event\":\"started\"}", BridgeMessages.started())
    }
}
