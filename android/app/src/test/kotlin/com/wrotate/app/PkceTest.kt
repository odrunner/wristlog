package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PkceTest {

    // RFC 7636 appendix B test vector.
    @Test
    fun challengeMatchesRfc7636Vector() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun verifierIsUrlSafeLongAndUnique() {
        val v = Pkce.generateVerifier()
        assertTrue(v.length in 43..128, "length ${v.length}")
        assertTrue(Regex("^[A-Za-z0-9._~-]+$").matches(v), "charset: $v")
        assertNotEquals(v, Pkce.generateVerifier())
    }

    @Test
    fun rewriteForPkceSetsRedirectAndChallenge() {
        val out = AuthCallback.rewriteForPkce(
            "https://api.wrotate.com/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fwrotate.com",
            "CHALLENGE123",
        )
        assertTrue(out.contains("redirect_to=wrotate%3A%2F%2Fauth-callback"), "redirect rewritten: $out")
        assertTrue(out.contains("code_challenge=CHALLENGE123"), "challenge added: $out")
        assertTrue(out.contains("code_challenge_method=s256"), "method added: $out")
        assertTrue(out.contains("provider=google"), "other params kept")
    }

    @Test
    fun parseCodeExtractsTheAuthCode() {
        assertEquals("3f2a1b00-aaaa-bbbb-cccc-123456789012",
            AuthCallback.parseCode("wrotate://auth-callback?code=3f2a1b00-aaaa-bbbb-cccc-123456789012"))
    }

    @Test
    fun parseCodeRejectsMissingOrUnsafe() {
        assertNull(AuthCallback.parseCode("wrotate://auth-callback"))
        assertNull(AuthCallback.parseCode("wrotate://auth-callback#access_token=AAA"))
        assertNull(AuthCallback.parseCode("wrotate://auth-callback?code=abc'};alert(1);//"))
    }
}
