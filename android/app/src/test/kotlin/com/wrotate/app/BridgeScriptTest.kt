package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertTrue

class BridgeScriptTest {

    @Test
    fun installsNativeFlags() {
        val js = buildBridgeScript("2.10")
        assertTrue(js.contains("window._wrotateNativeTimegrapher = true"), "timegrapher flag")
        assertTrue(js.contains("window._nativePlatform = 'android'"), "platform flag")
        assertTrue(js.contains("window._nativeAppVersion = '2.10'"), "version flag")
    }

    @Test
    fun installsTheHandlersForwardingToNative() {
        val js = buildBridgeScript("2.10")
        assertTrue(js.contains("messageHandlers"), "messageHandlers object")
        // appAction is the page's ONLY gate for the in-app review prompt (index.html
        // maybeShowReviewPrompt checks the handler exists) — registering it turns reviews on.
        for (h in listOf("timegrapher", "haptic", "auth", "appAction")) {
            assertTrue(js.contains("'$h'"), "handler $h listed")
        }
        assertTrue(js.contains("postMessage"), "exposes postMessage")
        assertTrue(js.contains("AndroidBridge.post"), "forwards to the native interface")
    }

    @Test
    fun doesNotClobberExistingWebkit() {
        val js = buildBridgeScript("2.10")
        assertTrue(js.contains("window.webkit = window.webkit ||"), "guards window.webkit")
        assertTrue(
            js.contains("window.webkit.messageHandlers = window.webkit.messageHandlers ||"),
            "guards messageHandlers",
        )
    }
}
