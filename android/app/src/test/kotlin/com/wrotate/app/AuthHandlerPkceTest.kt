package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AuthHandlerPkceTest {

    private class Rig(
        val exchangeResult: SessionTokens? = SessionTokens("AAA", "BBB"),
    ) {
        var opened: String? = null
        var injected: String? = null
        var exchangedCode: String? = null
        var exchangedVerifier: String? = null
        var exchangeCalls = 0
        val handler = AuthHandler(
            openCustomTab = { opened = it },
            inject = { injected = it },
            exchange = { code, verifier ->
                exchangeCalls++; exchangedCode = code; exchangedVerifier = verifier; exchangeResult
            },
        )
    }

    @Test
    fun startOAuthOpensUrlWithChallengeOfItsVerifier() {
        val rig = Rig()
        rig.handler.startOAuth("https://api.wrotate.com/auth/v1/authorize?provider=google")
        val url = rig.opened ?: error("nothing opened")
        assertTrue(url.contains("code_challenge="), url)
        assertTrue(url.contains("code_challenge_method=s256"), url)
        assertTrue(url.contains("redirect_to=wrotate%3A%2F%2Fauth-callback"), url)
    }

    @Test
    fun callbackCodeIsExchangedWithTheFlowVerifierAndSessionInjected() {
        val rig = Rig()
        rig.handler.startOAuth("https://api.wrotate.com/auth/v1/authorize?provider=google")
        val challenge = Regex("code_challenge=([^&]+)").find(rig.opened!!)!!.groupValues[1]
        rig.handler.onCallback("wrotate://auth-callback?code=code-123")
        assertEquals("code-123", rig.exchangedCode)
        // The verifier handed to exchange must be the one whose challenge we sent out.
        assertEquals(challenge, Pkce.challenge(rig.exchangedVerifier!!))
        assertTrue(rig.injected!!.contains("access_token: 'AAA'"), "session injected")
    }

    @Test
    fun callbackIsSingleUse() {
        val rig = Rig()
        rig.handler.startOAuth("https://x/authorize")
        rig.handler.onCallback("wrotate://auth-callback?code=code-123")
        rig.injected = null
        rig.handler.onCallback("wrotate://auth-callback?code=code-456")
        assertNull(rig.injected)
        assertEquals(1, rig.exchangeCalls)
    }

    @Test
    fun forgedCallbackWithoutFlowInProgressIsDropped() {
        val rig = Rig()
        rig.handler.onCallback("wrotate://auth-callback?code=code-123")
        assertNull(rig.injected)
        assertEquals(0, rig.exchangeCalls)
    }

    @Test
    fun failedExchangeInjectsNothing() {
        val rig = Rig(exchangeResult = null)
        rig.handler.startOAuth("https://x/authorize")
        rig.handler.onCallback("wrotate://auth-callback?code=code-123")
        assertNull(rig.injected)
    }

    // Transitional safety net: if the server ever returns implicit-flow tokens in the
    // fragment (e.g. the challenge params were dropped), the session still lands.
    @Test
    fun legacyFragmentTokensStillInject() {
        val rig = Rig()
        rig.handler.startOAuth("https://x/authorize")
        rig.handler.onCallback("wrotate://auth-callback#access_token=LEG&refresh_token=ACY&expires_in=3600")
        assertEquals(0, rig.exchangeCalls)
        assertTrue(rig.injected!!.contains("access_token: 'LEG'"))
    }
}
