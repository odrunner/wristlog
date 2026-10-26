package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals

class PushPayloadTest {

    @Test
    fun tapExtrasPassRouteFieldsThrough() {
        val e = PushPayload.tapExtras(mapOf("route" to "post", "id" to "abc-1", "uid" to "u1", "n" to "n1", "t" to "like"))
        assertEquals(mapOf("route" to "post", "id" to "abc-1", "uid" to "u1", "n" to "n1", "t" to "like"), e)
    }

    @Test
    fun tapExtrasDropUnknownKeysAndEmptyValues() {
        val e = PushPayload.tapExtras(mapOf("route" to "bell", "evil" to "x", "id" to ""))
        assertEquals(mapOf("route" to "bell"), e)
    }

    @Test
    fun tapExtrasWithoutRouteAreEmpty() {
        assertEquals(emptyMap(), PushPayload.tapExtras(mapOf("id" to "abc")))
    }

    // Review I1: a background/killed-app tap launches the activity with the RAW data keys
    // (route/id) — only the foreground path prefixes push_. Both shapes must route.
    @Test
    fun tapRouteReadsForegroundAndBackgroundExtraShapes() {
        val fg = PushPayload.tapRoute { k -> mapOf("push_route" to "post", "push_id" to "a1")[k] }
        assertEquals("post" to "a1", fg)
        val bg = PushPayload.tapRoute { k -> mapOf("route" to "measure", "id" to "w1")[k] }
        assertEquals("measure" to "w1", bg)
        assertEquals(null, PushPayload.tapRoute { null })
    }
}
