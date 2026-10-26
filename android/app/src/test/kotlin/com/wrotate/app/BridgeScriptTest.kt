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

    // Push: the shell must learn the session (userId + access token) to register FCM tokens —
    // iOS gets this from WebView.swift's injected onAuthStateChange watcher; Android mirrors it.
    @Test
    fun watchesAuthStateAndExposesPlayVersionName() {
        val js = buildBridgeScript("2.10", "1.2")
        assertTrue(js.contains("onAuthStateChange"), "auth watcher installed")
        assertTrue(js.contains("access_token"), "posts the access token")
        assertTrue(js.contains("window._nativeVersionName = '1.2'"), "Play versionName exposed")
        // The page's supabase client is a top-level `const db` in a classic script — it NEVER
        // becomes window.db. Waiting on window.db polls forever and push never starts (review C1).
        assertTrue(js.contains("typeof db !== 'undefined'"), "detects the const, not window.db")
        assertTrue(!js.contains("window.db"), "window.db never exists")
        // supabase-js can emit its startup SIGNED_IN before the hook attaches; the session must
        // still reach native (getSession catch-up / INITIAL_SESSION).
        assertTrue(js.contains("getSession"), "catches up on an already-live session")
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
