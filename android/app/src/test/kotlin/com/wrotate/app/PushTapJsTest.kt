package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PushTapJsTest {

    @Test
    fun routesMapToTheIosContentViewSwitch() {
        assertTrue(PushTapJs.dispatchJs("post", "abc-1")!!.contains("scrollToFeedPost('abc-1')"))
        assertTrue(PushTapJs.dispatchJs("profile", "u-1")!!.contains("viewUserProfile('u-1')"))
        assertTrue(PushTapJs.dispatchJs("club", "c-1")!!.contains("openClubDetail('c-1')"))
        assertTrue(PushTapJs.dispatchJs("badges", null)!!.contains("openBadgeWall()"))
        assertTrue(PushTapJs.dispatchJs("measure", "w-1")!!.contains("openPushRoute('measure', 'w-1')"))
        assertTrue(PushTapJs.dispatchJs("bell", null)!!.contains("openPushRoute('bell', null)"))
    }

    @Test
    fun everyDispatchSetsOpenedFromPushAndGuardsWithTypeof() {
        for (js in listOf(PushTapJs.dispatchJs("post", "a"), PushTapJs.dispatchJs("badges", null))) {
            assertTrue(js!!.contains("window._openedFromPush=true"), js)
            assertTrue(js.contains("typeof"), js)
        }
    }

    // Ids are uuids/slugs; anything that could break out of the JS literal is refused.
    @Test
    fun unsafeIdsOrRoutesAreRefused() {
        assertNull(PushTapJs.dispatchJs("post", "x'});evil()//"))
        assertNull(PushTapJs.dispatchJs("post'", "abc"))
        assertNull(PushTapJs.dispatchJs(null, "abc"))
    }
}
