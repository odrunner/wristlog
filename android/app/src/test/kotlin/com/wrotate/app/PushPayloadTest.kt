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
}
