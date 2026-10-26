package com.wrotate.app

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** RFC 7636 code verifier/challenge (S256). Pure JVM so it is unit-testable. */
object Pkce {
    private val b64 = Base64.getUrlEncoder().withoutPadding()

    fun generateVerifier(): String {
        val bytes = ByteArray(48) // 48 bytes -> 64 base64url chars, within the 43..128 spec
        SecureRandom().nextBytes(bytes)
        return b64.encodeToString(bytes)
    }

    fun challenge(verifier: String): String =
        b64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
}
