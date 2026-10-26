package com.wrotate.app

/**
 * Static app shortcuts (long-press launcher icon), mirroring iOS QuickActionManager: same three
 * actions, same page entry points. Dispatch is held until the page has loaded (drainPending).
 */
object QuickActions {
    private val VALID = setOf("logwear", "measure", "post")

    /** "wrotate://quick/<action>" -> the action, for the three known actions only. */
    fun parse(dataUri: String?): String? {
        val u = dataUri ?: return null
        if (!u.startsWith("wrotate://quick/")) return null
        return u.removePrefix("wrotate://quick/").takeIf { it in VALID }
    }

    /** The page-side dispatch, guarded so firing before the page is ready is a silent no-op. */
    fun dispatchJs(action: String): String? = when (action) {
        "logwear" -> navJs("track")
        "measure" -> navJs("measure")
        "post" -> "if(typeof openNewPost==='function') openNewPost();"
        else -> null
    }

    private fun navJs(page: String): String =
        "(function(){ var b=document.querySelector('nav button[data-page=\"$page\"]'); " +
            "if(b && typeof nav==='function') nav(b); })();"
}
