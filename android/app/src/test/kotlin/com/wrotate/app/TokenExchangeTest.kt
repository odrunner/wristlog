package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TokenExchangeTest {

    @Test
    fun bodyCarriesCodeAndVerifier() {
        val body = TokenExchange.buildBody("code-1", "verif-1")
        val o = org.json.JSONObject(body)
        assertEquals("code-1", o.getString("auth_code"))
        assertEquals("verif-1", o.getString("code_verifier"))
    }

    @Test
    fun responseParsesTokens() {
        val t = TokenExchange.parseResponse("""{"access_token":"AAA.bbb-ccc","refresh_token":"DDD_eee","expires_in":3600}""")
        assertEquals("AAA.bbb-ccc", t?.accessToken)
        assertEquals("DDD_eee", t?.refreshToken)
    }

    @Test
    fun responseWithoutTokensOrInvalidJsonIsNull() {
        assertNull(TokenExchange.parseResponse("""{"error":"invalid_grant"}"""))
        assertNull(TokenExchange.parseResponse("not json"))
    }

    // Tokens are interpolated into a JS literal on injection; the same charset guard that
    // protects the fragment path must hold for exchanged tokens.
    @Test
    fun responseWithUnsafeTokenCharactersIsNull() {
        assertNull(TokenExchange.parseResponse("""{"access_token":"a'};alert(1);//","refresh_token":"BBB"}"""))
    }
}
