package com.wrotate.app

import android.media.MediaRecorder
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Pure JVM tests (android.jar stubs only — MediaRecorder.AudioSource values are compile-time
 * constants, so no framework method runs).
 */
class AudioSourceSelectionTest {

    @Test
    fun unprocessedWhenSupported() {
        val (source, tag) = selectAudioSource(supportsUnprocessed = true)
        assertEquals(MediaRecorder.AudioSource.UNPROCESSED, source)
        assertEquals(9, source) // pin the platform value too
        assertEquals("unproc", tag)
    }

    @Test
    fun voiceRecognitionOtherwise() {
        val (source, tag) = selectAudioSource(supportsUnprocessed = false)
        assertEquals(MediaRecorder.AudioSource.VOICE_RECOGNITION, source)
        assertEquals(6, source)
        assertEquals("vrec", tag)
    }

    @Test
    fun deviceModelIsOneWhitespaceFreeToken() {
        // [TGTUNE] is whitespace-tokenised; Build.MODEL is literally "Pixel 7".
        assertEquals("Pixel_7", tuneSafeModel("Pixel 7"))
        assertEquals("Pixel_7_Pro", tuneSafeModel(" Pixel  7\tPro "))
        assertEquals("SM-S918B", tuneSafeModel("SM-S918B"))
        assertEquals("unknown", tuneSafeModel("   "))
    }
}
