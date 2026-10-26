package com.wrotate.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Exchanges a PKCE auth code for session tokens at GoTrue's token endpoint. The publishable key is
 * the same public client key the page itself ships (index.html SUPABASE_KEY) — not a secret.
 */
object TokenExchange {
    private const val TOKEN_URL = "https://api.wrotate.com/auth/v1/token?grant_type=pkce"
    private const val PUBLISHABLE_KEY = "sb_publishable_pxXMl4LD0xTLEqNKCZyQ5Q_qQfhNYbz"

    fun buildBody(code: String, verifier: String): String =
        JSONObject().put("auth_code", code).put("code_verifier", verifier).toString()

    // Tokens get interpolated into the setSession JS literal, so they must pass the same charset
    // guard as the fragment path (AuthCallback.SAFE_TOKEN): base64url/JWT characters only.
    private val SAFE_TOKEN = Regex("^[A-Za-z0-9._-]+$")

    fun parseResponse(json: String): SessionTokens? = try {
        val o = JSONObject(json)
        val a = o.optString("access_token", "")
        val r = o.optString("refresh_token", "")
        if (SAFE_TOKEN.matches(a) && SAFE_TOKEN.matches(r)) SessionTokens(a, r) else null
    } catch (e: Exception) {
        null
    }

    /** Blocking POST; call off the main thread. Null on any failure — the user just retries sign-in. */
    fun exchange(code: String, verifier: String): SessionTokens? = try {
        val conn = URL(TOKEN_URL).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("apikey", PUBLISHABLE_KEY)
        conn.outputStream.use { it.write(buildBody(code, verifier).toByteArray(Charsets.UTF_8)) }
        val body = (if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() } ?: ""
        if (conn.responseCode in 200..299) parseResponse(body) else null
    } catch (e: Exception) {
        null
    }
}
