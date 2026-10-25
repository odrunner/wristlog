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
    fun installsThreeHandlersForwardingToNative() {
        val js = buildBridgeScript("2.10")
        assertTrue(js.contains("messageHandlers"), "messageHandlers object")
        for (h in listOf("timegrapher", "haptic", "auth")) {
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
