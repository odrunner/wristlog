package com.wrotate.app

/**
 * When a WebView load error takes over the screen (iOS OfflineView parity): only a failed
 * main-frame load — onReceivedError also fires for every failed subresource, which must never
 * blank a working page.
 */
object LoadErrorPolicy {
    fun showOverlay(isForMainFrame: Boolean): Boolean = isForMainFrame
}
