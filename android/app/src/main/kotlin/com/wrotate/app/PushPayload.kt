package com.wrotate.app

/** Pure mapping from an FCM data map to the tap-routing extras ShellActivity dispatches.
 *  Only the server's `w` fields pass; anything else a hostile sender might stuff in is dropped. */
object PushPayload {
    private val KEYS = listOf("route", "id", "uid", "n", "t")

    fun tapExtras(data: Map<String, String>): Map<String, String> {
        if (data["route"].isNullOrEmpty()) return emptyMap()
        return KEYS.mapNotNull { k -> data[k]?.takeIf { it.isNotEmpty() }?.let { k to it } }.toMap()
    }

    /** Tap routing from launch-intent extras. Foreground deliveries prefix push_ (PushService);
     *  background/killed-app taps carry the FCM data map's RAW keys — both must route. */
    fun tapRoute(extra: (String) -> String?): Pair<String, String?>? {
        val route = extra("push_route") ?: extra("route") ?: return null
        return route to (extra("push_id") ?: extra("id"))
    }
}
