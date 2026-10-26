package com.wrotate.app

/** Pure mapping from an FCM data map to the tap-routing extras ShellActivity dispatches.
 *  Only the server's `w` fields pass; anything else a hostile sender might stuff in is dropped. */
object PushPayload {
    private val KEYS = listOf("route", "id", "uid", "n", "t")

    fun tapExtras(data: Map<String, String>): Map<String, String> {
        if (data["route"].isNullOrEmpty()) return emptyMap()
        return KEYS.mapNotNull { k -> data[k]?.takeIf { it.isNotEmpty() }?.let { k to it } }.toMap()
    }
}
