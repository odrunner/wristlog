package com.wrotate.app

/**
 * The document-start JavaScript the shell injects into every page load. It makes the Android
 * WebView look exactly like the iOS WKWebView bridge so wrotate.com's existing JS runs unchanged:
 * it sets the native flags and recreates `window.webkit.messageHandlers` with the handlers v1
 * needs (timegrapher, haptic, auth), each forwarding to the native `AndroidBridge` interface.
 * Native returns results by calling `window._tgNativeCallback(<json>)` (see [ShellActivity]).
 *
 * Pure function so it is unit-testable without the Android framework.
 */
fun buildBridgeScript(capabilityVersion: String): String = """
(function() {
  if (window._wrotateNativeBridgeInstalled) return;
  window._wrotateNativeBridgeInstalled = true;
  window._wrotateNativeTimegrapher = true;
  window._nativePlatform = 'android';
  window._nativeAppVersion = '$capabilityVersion';
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  ['timegrapher', 'haptic', 'auth'].forEach(function(h) {
    window.webkit.messageHandlers[h] = {
      postMessage: function(o) {
        try { AndroidBridge.post(h, JSON.stringify(o)); } catch (e) {}
      }
    };
  });
})();
""".trimIndent()
