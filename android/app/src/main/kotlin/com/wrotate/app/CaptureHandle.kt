package com.wrotate.app

/**
 * The slice of [AudioCapture] the measurement bridge depends on, extracted so
 * [MeasurementController] is unit-testable on the JVM with a fake capture.
 */
interface CaptureHandle {
    /** Build the recorder on the caller's thread so [sampleRate] is known on return. */
    fun open(): Boolean
    val sampleRate: Double
    val sourceTag: String
    /** Start the capture thread; [onBuffer] is invoked with mono floats [0, n) on that thread. */
    fun start(onBuffer: (FloatArray, Int) -> Unit)
    fun stop(): Boolean
}
