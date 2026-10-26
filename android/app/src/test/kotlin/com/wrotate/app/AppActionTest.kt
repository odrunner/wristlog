package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AppActionTest {

    @Test
    fun parsesRequestReview() {
        assertEquals("requestReview", BridgeMessages.parseAppAction("""{"action":"requestReview"}"""))
    }

    // iOS's appAction also carries requestPushPermission / openAppSettings; Android ignores
    // them (push is a later plan) — they must parse cleanly and route to a no-op, never throw.
    @Test
    fun unknownOrMalformedActionsAreNull() {
        assertEquals("requestPushPermission", BridgeMessages.parseAppAction("""{"action":"requestPushPermission"}"""))
        assertNull(BridgeMessages.parseAppAction("""{"noaction":1}"""))
        assertNull(BridgeMessages.parseAppAction("not json"))
        assertNull(BridgeMessages.parseAppAction(""))
    }
}

class AuthEventTest {
    @Test
    fun parsesSignedInWithSession() {
        val e = BridgeMessages.parseAuthEvent("""{"event":"SIGNED_IN","userId":"u-1","accessToken":"tok.a-b_c"}""")
        kotlin.test.assertEquals(Triple("SIGNED_IN", "u-1", "tok.a-b_c"), e)
    }

    @Test
    fun parsesSignedOutWithoutSession() {
        val e = BridgeMessages.parseAuthEvent("""{"event":"SIGNED_OUT"}""")
        kotlin.test.assertEquals(Triple("SIGNED_OUT", null, null), e)
    }

    @Test
    fun malformedAuthEventsAreNull() {
        assertNull(BridgeMessages.parseAuthEvent("not json"))
        assertNull(BridgeMessages.parseAuthEvent("""{"noevent":1}"""))
    }
}
