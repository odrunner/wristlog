package com.wrotate.app

/**
 * An email button that names the screen it is about: `https://wrotate.com/open?…&go=<key>`
 * (email_campaigns.cta_action, e.g. `open_measure`). The app link opens the shell; this picks
 * the key out so the page can open that screen instead of staying on the Feed. The page owns
 * the list of keys (PROMO_ACTIONS) and ignores one it does not know — here the key is only
 * pinned to a plain shape, because it is interpolated into a JS literal.
 */
object GoLink {
    private val KEY = Regex("^[a-z_]{1,40}$")
    private val HOSTS = setOf("wrotate.com", "www.wrotate.com")
    private val PATHS = setOf("/open", "/open.html")

    /** The key carried by an /open link on our own host, or null. */
    fun parse(dataUri: String?): String? {
        val uri = try { java.net.URI(dataUri ?: return null) } catch (e: Exception) { return null }
        if (uri.scheme != "https" || uri.host !in HOSTS || uri.path !in PATHS) return null
        val go = (uri.rawQuery ?: return null).split("&")
            .firstOrNull { it.startsWith("go=") }?.removePrefix("go=") ?: return null
        return go.takeIf { KEY.matches(it) }
    }

    /** The page-side dispatch, guarded so firing before the page is ready is a silent no-op. */
    fun dispatchJs(key: String): String? =
        if (KEY.matches(key)) "if(typeof runGoLink==='function') runGoLink('$key');" else null
}
