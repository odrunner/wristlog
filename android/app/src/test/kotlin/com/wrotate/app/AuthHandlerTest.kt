package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AuthHandlerTest {

    @Test
    fun parseExtractsTokensFromFragment() {
        val t = AuthCallback.parse("wrotate://auth-callback#access_token=AAA&refresh_token=BBB&expires_in=3600")
        assertEquals("AAA", t?.accessToken)
        assertEquals("BBB", t?.refreshToken)
    }

    @Test
    fun parseReturnsNullWhenTokensMissing() {
        assertNull(AuthCallback.parse("wrotate://auth-callback#error=access_denied"))
        assertNull(AuthCallback.parse("wrotate://auth-callback"))
    }

    @Test
    fun rewriteRedirectPointsAtTheCustomScheme() {
        val out = AuthCallback.rewriteRedirect(
            "https://api.wrotate.com/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fwrotate.com",
        )
        assertTrue(out.contains("redirect_to=wrotate%3A%2F%2Fauth-callback"), "redirect rewritten: $out")
        assertTrue(out.contains("provider=google"), "other params kept")
    }

    @Test
    fun sessionInjectionJsSetsTheSupabaseSession() {
        val js = AuthCallback.sessionInjectionJs(SessionTokens("AAA", "BBB"))
        assertTrue(js.contains("setSession"))
        assertTrue(js.contains("'AAA'"))
        assertTrue(js.contains("'BBB'"))
    }

    @Test
    fun ignoresCallbackWhenNoFlowStarted() {
        var injections = 0
        val h = AuthHandler(openCustomTab = {}, inject = { injections++ }, exchange = { _, _ -> null })
        // No startOAuth() → not expecting → a forged intent from any app is ignored.
        h.onCallback("wrotate://auth-callback#access_token=AAA&refresh_token=BBB")
        assertEquals(0, injections)
    }

    @Test
    fun deliversOnceForAFlowThisAppStarted() {
        var injections = 0
        val h = AuthHandler(openCustomTab = {}, inject = { injections++ }, exchange = { _, _ -> null })
        h.startOAuth("https://api.wrotate.com/auth/v1/authorize?provider=google&redirect_to=x")
        val url = "wrotate://auth-callback#access_token=AAA&refresh_token=BBB"
        h.onCallback(url)
        h.onCallback(url) // expecting already cleared → ignored
        assertEquals(1, injections)
    }

    @Test
    fun rejectsTokensWithUnsafeCharacters() {
        var injected: String? = null
        val h = AuthHandler(openCustomTab = {}, inject = { injected = it }, exchange = { _, _ -> null })
        h.startOAuth("https://api.wrotate.com/auth/v1/authorize?redirect_to=x")
        // A token carrying a JS-breakout payload must never be interpolated.
        h.onCallback("wrotate://auth-callback#access_token=x'});evil()//&refresh_token=BBB")
        assertNull(injected)
    }
}
