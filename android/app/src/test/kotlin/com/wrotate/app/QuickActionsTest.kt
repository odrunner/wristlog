package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QuickActionsTest {

    @Test
    fun parseAcceptsTheThreeActions() {
        assertEquals("logwear", QuickActions.parse("wrotate://quick/logwear"))
        assertEquals("measure", QuickActions.parse("wrotate://quick/measure"))
        assertEquals("post", QuickActions.parse("wrotate://quick/post"))
    }

    @Test
    fun parseRejectsUnknownAndNull() {
        assertNull(QuickActions.parse(null))
        assertNull(QuickActions.parse("wrotate://quick/evil"))
        assertNull(QuickActions.parse("wrotate://auth-callback?code=x"))
        assertNull(QuickActions.parse("https://wrotate.com/quick/post"))
    }

    // iOS dispatch parity (ContentView.dispatchPendingQuickAction), with null/typeof guards so a
    // shortcut fired before the page defines nav/openNewPost is a silent no-op, never a JS throw.
    @Test
    fun dispatchJsTargetsTrackMeasurePost() {
        val wear = QuickActions.dispatchJs("logwear")!!
        assertTrue(wear.contains("nav button[data-page=\"track\"]"), wear)
        assertTrue(wear.contains("typeof nav==='function'"), wear)
        val measure = QuickActions.dispatchJs("measure")!!
        assertTrue(measure.contains("nav button[data-page=\"measure\"]"), measure)
        val post = QuickActions.dispatchJs("post")!!
        assertTrue(post.contains("typeof openNewPost==='function'"), post)
        assertNull(QuickActions.dispatchJs("evil"))
    }
}
