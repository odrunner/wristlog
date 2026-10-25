package com.wrotate.app

import com.wrotate.engine.TimegrapherCore
import com.wrotate.engine.Tuning
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MeasurementControllerTest {

    private class FakeCapture(var stopResult: Boolean = true) : CaptureHandle {
        override var sampleRate = 48000.0
        override val sourceTag = "unproc"
        private var cb: ((FloatArray, Int) -> Unit)? = null
        private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "cap-thread") }
        override fun open() = true
        override fun start(onBuffer: (FloatArray, Int) -> Unit) { cb = onBuffer }
        override fun stop() = stopResult
        /** Run one buffer on the capture thread (blocking), return that thread. */
        fun deliverOneBuffer(): Thread {
            val seen = AtomicReference<Thread>()
            exec.submit {
                seen.set(Thread.currentThread())
                cb?.invoke(FloatArray(4096), 4096)
            }.get()
            return seen.get()
        }
    }

    private fun controller(cap: FakeCapture, events: MutableList<String>, applyTuning: (Tuning) -> Unit): MeasurementController {
        val core = TimegrapherCore(analysisExecutor = null)
        return MeasurementController(
            core = core, capture = cap, emit = { events.add(it) },
            deviceModel = "Pixel_7", applyTuning = applyTuning,
        )
    }

    @Test
    fun startEmitsStartedAndStopEmitsStopped() {
        val cap = FakeCapture(); val events = mutableListOf<String>()
        val c = controller(cap, events) {}
        c.start(21600)
        assertTrue(events.any { it.contains("\"event\":\"started\"") }, "started emitted")
        cap.deliverOneBuffer()
        c.stop()
        assertTrue(events.any { it.contains("\"event\":\"stopped\"") }, "stopped emitted")
    }

    @Test
    fun midSessionTuningIsAppliedOnTheCaptureThread() {
        val cap = FakeCapture(); val events = mutableListOf<String>()
        val applied = AtomicReference<Thread>()
        val c = controller(cap, events) { applied.set(Thread.currentThread()) }
        c.start(21600)
        c.enqueueTuning(Tuning())                 // enqueued from the test (main) thread
        val capThread = cap.deliverOneBuffer()    // drained + applied on the capture thread
        assertTrue(applied.get() != null, "tuning was applied")
        assertEquals("cap-thread", applied.get().name)
        assertEquals(capThread.name, applied.get().name)
        assertTrue(applied.get() !== Thread.currentThread(), "not applied on the caller thread")
    }

    @Test
    fun stopWithAStuckCaptureThreadDoesNotTouchTheCore() {
        val cap = FakeCapture(stopResult = false); val events = mutableListOf<String>()
        val c = controller(cap, events) {}
        c.start(21600)
        c.stop()
        // Capture thread did not exit → core.stop() must be skipped (no second-thread race), so no
        // "stopped" is emitted; the user is told instead.
        assertTrue(events.none { it.contains("\"event\":\"stopped\"") }, "no stopped on stuck capture")
        assertTrue(events.any { it.contains("\"event\":\"error\"") }, "error surfaced")
    }

    @Test
    fun malformedMessageEmitsErrorNotCrash() {
        val cap = FakeCapture(); val events = mutableListOf<String>()
        val c = controller(cap, events) {}
        c.handleTimegrapherMessage("{not valid json")
        assertTrue(events.any { it.contains("\"event\":\"error\"") }, "error emitted, no throw")
    }
}
