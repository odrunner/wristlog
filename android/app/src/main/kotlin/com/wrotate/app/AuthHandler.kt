package com.wrotate.app

import java.net.URLEncoder

data class SessionTokens(val accessToken: String, val refreshToken: String)

/**
 * Pure helpers for the OAuth hand-off, mirroring `ios/Wrotate/Wrotate/WebView.swift` handleOAuth +
 * OAuthManager. No Android types, so they are unit-testable on the JVM.
 */
object AuthCallback {
    const val REDIRECT = "wrotate://auth-callback"

    /** Rewrite the Supabase authorize URL's `redirect_to` to the custom scheme (iOS parity). */
    fun rewriteRedirect(authorizeUrl: String): String {
        val enc = URLEncoder.encode(REDIRECT, "UTF-8")
        return if (authorizeUrl.contains("redirect_to=")) {
            authorizeUrl.replace(Regex("redirect_to=[^&]*"), "redirect_to=$enc")
        } else {
            authorizeUrl + (if (authorizeUrl.contains("?")) "&" else "?") + "redirect_to=$enc"
        }
    }

    /** Pull access_token/refresh_token from the callback URL's fragment (or query); null if absent. */
    fun parse(callbackUrl: String): SessionTokens? {
        val frag = callbackUrl.substringAfter('#', "").ifEmpty { callbackUrl.substringAfter('?', "") }
        if (frag.isEmpty()) return null
        val m = frag.split("&").mapNotNull {
            val kv = it.split("=", limit = 2); if (kv.size == 2) kv[0] to kv[1] else null
        }.toMap()
        val a = m["access_token"] ?: return null
        val r = m["refresh_token"] ?: return null
        return SessionTokens(a, r)
    }

    /** JS that hands the session to the page's Supabase client, mirroring the iOS injection. */
    fun sessionInjectionJs(t: SessionTokens): String = """
(function() {
  if (typeof db !== 'undefined' && db.auth) {
    db.auth.setSession({ access_token: '${t.accessToken}', refresh_token: '${t.refreshToken}' })
      .then(function(result) { if (!result.error) window.location.reload(); });
  }
  return true;
})();
""".trimIndent()
}

/**
 * Orchestrates the Custom Tab OAuth hand-off: opens the rewritten authorize URL in a Chrome Custom
 * Tab, and on the `wrotate://auth-callback` return injects the session into the WebView exactly
 * once. [openCustomTab] and [inject] are injected so this is testable without Android.
 */
class AuthHandler(
    private val openCustomTab: (String) -> Unit,
    private val inject: (String) -> Unit,
) {
    private val delivered = HashSet<String>()

    fun startOAuth(authorizeUrl: String) {
        openCustomTab(AuthCallback.rewriteRedirect(authorizeUrl))
    }

    fun onCallback(callbackUrl: String) {
        val t = AuthCallback.parse(callbackUrl) ?: return
        if (!delivered.add(t.accessToken)) return
        inject(AuthCallback.sessionInjectionJs(t))
    }
}
