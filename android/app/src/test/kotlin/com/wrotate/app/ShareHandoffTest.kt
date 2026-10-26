package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ShareHandoffTest {

    @Test
    fun injectionJsWrapsBase64AsJpegDataUrl() {
        val js = ShareHandoff.injectionJs("AAAA")
        assertTrue(js.contains("typeof handleSharedImage !== 'function'"), js)
        assertTrue(js.contains("handleSharedImage('data:image/jpeg;base64,AAAA')"), js)
        assertTrue(js.contains("return true"), js)
    }

    // The page returns true only once it owns the image (even if it parks it for bootApp).
    // Anything else — page not ready ("false"), evaluation failure (null), page gone ("null") —
    // must keep the pending share so the next load or foreground retries. (iOS retry contract.)
    @Test
    fun drainClearsOnlyOnTrue() {
        // evaluateJavascript returns the JSON encoding of the IIFE's value: boolean true arrives
        // as the four characters true. A JSON STRING "true" is not ownership and must not clear.
        for ((result, expectCleared) in listOf("true" to true, "\"true\"" to false, "false" to false, null to false, "null" to false)) {
            var cleared = 0
            val pending = PendingShare(load = { "AAAA" }, clear = { cleared++ })
            pending.drain { _, onResult -> onResult(result) }
            assertEquals(if (expectCleared) 1 else 0, cleared, "evaluator result $result")
        }
    }

    // Caps catastrophic decodes (a 200 MP share would need ~800 MB of pixels and OOM-kill the
    // shared process) while leaving normal photos at full resolution.
    @Test
    fun sampleSizeCapsOnlyHugeImages() {
        assertEquals(1, ShareHandoff.sampleSize(2000))
        assertEquals(1, ShareHandoff.sampleSize(2560))
        assertEquals(1, ShareHandoff.sampleSize(4000))   // 12 MP-class: keep full res
        assertEquals(3, ShareHandoff.sampleSize(8160))   // 50 MP-class: ~2.7k long edge
        assertEquals(6, ShareHandoff.sampleSize(16320))  // 200 MP-class: ~2.7k long edge
    }

    @Test
    fun drainWithNothingPendingEvaluatesNothing() {
        var evaluated = 0
        val pending = PendingShare(load = { null }, clear = { })
        pending.drain { _, _ -> evaluated++ }
        assertEquals(0, evaluated)
    }
}
