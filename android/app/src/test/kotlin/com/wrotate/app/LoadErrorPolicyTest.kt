package com.wrotate.app

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LoadErrorPolicyTest {

    @Test
    fun mainFrameErrorShowsOverlay() {
        assertTrue(LoadErrorPolicy.showOverlay(isForMainFrame = true))
    }

    // Modern onReceivedError fires for EVERY failed subresource (an ad blocker, a dead image);
    // only a failed page load may take over the screen.
    @Test
    fun subresourceErrorDoesNot() {
        assertFalse(LoadErrorPolicy.showOverlay(isForMainFrame = false))
    }
}
