package com.wrotate.app

/**
 * JS dispatch for a notification tap, mirroring iOS ContentView.dispatchPendingNotification:
 * post/profile/club/badges get their direct entry points, everything else goes through
 * openPushRoute. Ids are uuids/slugs — anything outside that charset is refused rather than
 * interpolated into the JS literal.
 */
object PushTapJs {
    private val SAFE = Regex("^[A-Za-z0-9._-]+$")

    fun dispatchJs(route: String?, id: String?): String? {
        if (route == null || !SAFE.matches(route)) return null
        if (id != null && !SAFE.matches(id)) return null
        val idArg = if (id != null) "'$id'" else "null"
        val call = when (route) {
            "post" -> "if(typeof scrollToFeedPost==='function') scrollToFeedPost($idArg);"
            "profile" -> "if(typeof viewUserProfile==='function') viewUserProfile($idArg);"
            "club" -> "if(typeof openClubDetail==='function') openClubDetail($idArg);"
            "badges" -> "if(typeof openBadgeWall==='function') openBadgeWall();"
            else -> "if(typeof openPushRoute==='function') openPushRoute('$route', $idArg);"
        }
        return "window._openedFromPush=true; $call"
    }
}
