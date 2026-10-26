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
        for ((result, expectCleared) in listOf("\"true\"" to true, "\"false\"" to false, null to false, "null" to false)) {
            var cleared = 0
            val pending = PendingShare(load = { "AAAA" }, clear = { cleared++ })
            pending.drain { _, onResult -> onResult(result) }
            assertEquals(if (expectCleared) 1 else 0, cleared, "evaluator result $result")
        }
    }

    @Test
    fun drainWithNothingPendingEvaluatesNothing() {
        var evaluated = 0
        val pending = PendingShare(load = { null }, clear = { })
        pending.drain { _, _ -> evaluated++ }
        assertEquals(0, evaluated)
    }
}
