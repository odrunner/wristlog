package com.wrotate.app

/**
 * The document-start JavaScript the shell injects into every page load. It makes the Android
 * WebView look exactly like the iOS WKWebView bridge so wrotate.com's existing JS runs unchanged:
 * it sets the native flags and recreates `window.webkit.messageHandlers` with the handlers the
 * page posts to (timegrapher, haptic, auth, appAction), each forwarding to the native
 * `AndroidBridge` interface. appAction's mere existence is the page's gate for the in-app
 * review prompt (index.html maybeShowReviewPrompt).
 * Native returns results by calling `window._tgNativeCallback(<json>)` (see [ShellActivity]).
 *
 * Pure function so it is unit-testable without the Android framework.
 */
fun buildBridgeScript(capabilityVersion: String, versionName: String = ""): String = """
(function() {
  if (window._wrotateNativeBridgeInstalled) return;
  window._wrotateNativeBridgeInstalled = true;
  window._wrotateNativeTimegrapher = true;
  window._nativePlatform = 'android';
  window._nativeAppVersion = '$capabilityVersion';
  window._nativeVersionName = '$versionName';
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  ['timegrapher', 'haptic', 'auth', 'appAction'].forEach(function(h) {
    window.webkit.messageHandlers[h] = {
      postMessage: function(o) {
        try { AndroidBridge.post(h, JSON.stringify(o)); } catch (e) {}
      }
    };
  });
  // Auth watcher (iOS WebView.swift parity): the shell needs the session to register push
  // tokens. The page's client is a top-level `const db` in a classic script — it never becomes
  // a window property, so the check MUST be `typeof db` (a window-scoped lookup polls forever).
  // And supabase-js may emit its startup SIGNED_IN before this hook attaches, so an
  // already-live session is fetched once and posted as SIGNED_IN.
  (function hookAuth() {
    try {
      if (typeof db !== 'undefined' && db.auth && typeof db.auth.onAuthStateChange === 'function') {
        var post = function(event, session) {
          try {
            window.webkit.messageHandlers.auth.postMessage({
              event: event,
              userId: session && session.user ? session.user.id : null,
              accessToken: session ? session.access_token : null
            });
          } catch (e) {}
        };
        db.auth.onAuthStateChange(function(event, session) {
          post(event === 'INITIAL_SESSION' && session ? 'SIGNED_IN' : event, session);
        });
        db.auth.getSession().then(function(r) {
          if (r && r.data && r.data.session) post('SIGNED_IN', r.data.session);
        }).catch(function() {});
        return;
      }
    } catch (e) {}
    setTimeout(hookAuth, 100);
  })();
})();
""".trimIndent()
