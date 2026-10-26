package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class FileChooserResultTest {

    // Regression: accept="image/*,video/*" pre-creates a .jpg AND a .mp4 temp file.
    // A photo capture must return the .jpg (written), never the empty .mp4 created after it.
    @Test
    fun photoCaptureReturnsTheWrittenJpgNotTheEmptyMp4() {
        val picked = pickWrittenCapture(listOf("photo.jpg" to 123_456L, "video.mp4" to 0L))
        assertEquals("photo.jpg", picked)
    }

    @Test
    fun videoCaptureReturnsTheWrittenMp4() {
        val picked = pickWrittenCapture(listOf("photo.jpg" to 0L, "video.mp4" to 9_999L))
        assertEquals("video.mp4", picked)
    }

    @Test
    fun nothingWrittenReturnsNull() {
        assertNull(pickWrittenCapture(listOf("photo.jpg" to 0L, "video.mp4" to 0L)))
        assertNull(pickWrittenCapture(emptyList<Pair<String, Long>>()))
    }
}
