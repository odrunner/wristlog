import SwiftUI
import WebKit
import UIKit
import StoreKit

struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var hasError: Bool
    var onReload: ((WKWebView) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = WKWebsiteDataStore.default()

        // JS → Native bridge for auth state changes + timegrapher + app actions + haptics
        let contentController = config.userContentController
        contentController.add(context.coordinator, name: "auth")
        contentController.add(context.coordinator, name: "timegrapher")
        contentController.add(context.coordinator, name: "appAction")
        contentController.add(context.coordinator, name: "haptic")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.bounces = true

        // Pull-to-refresh
        let refreshControl = UIRefreshControl()
        refreshControl.addTarget(
            context.coordinator,
            action: #selector(Coordinator.handleRefresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.addSubview(refreshControl)
        context.coordinator.refreshControl = refreshControl
        context.coordinator.webView = webView
        context.coordinator.timegrapherBridge.attach(to: webView)

        // Expose webView to parent for reload from offline screen
        DispatchQueue.main.async {
            self.onReload?(webView)
        }

        // Load the page once
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Intentionally empty — do NOT reload on SwiftUI re-render
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let parent: WebView
        weak var webView: WKWebView?
        var refreshControl: UIRefreshControl?
        private let oauthManager = OAuthManager.shared
        let timegrapherBridge = TimegrapherBridge()

        init(parent: WebView) {
            self.parent = parent
        }

        // MARK: Pull-to-refresh

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        // MARK: Navigation delegate

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            let host = url.host ?? ""

            // Intercept Supabase OAuth — hand off to ASWebAuthenticationSession
            if host == "api.wrotate.com" && url.path.contains("/auth/v1/authorize") {
                decisionHandler(.cancel)
                handleOAuth(url: url)
                return
            }

            // Allow wrotate.com and its API
            let allowed = ["wrotate.com", "www.wrotate.com", "api.wrotate.com"]
            if allowed.contains(host) {
                decisionHandler(.allow)
                return
            }

            // Allow Google OAuth intermediate pages (account chooser, consent)
            if host.hasSuffix("google.com") || host.hasSuffix("googleapis.com") {
                decisionHandler(.allow)
                return
            }

            // Everything else → open in Safari
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            parent.hasError = false
            refreshControl?.endRefreshing()

            // Inject JS bridge for auth state → native push registration
            let js = """
            (function() {
                if (window._wrotateNativeBridgeInstalled) return;
                window._wrotateNativeBridgeInstalled = true;
                window._wrotateNativeTimegrapher = true;
                window._iosAppVersion = '2.3';   // 2.3 = fold-based beat error on the tg path. 2.1+ gates the Pro V2 beta toggle; 2.3+ gates Pro V2 BE display.

                // Wait for Supabase client to be ready
                var checkInterval = setInterval(function() {
                    if (typeof db !== 'undefined' && db.auth) {
                        clearInterval(checkInterval);
                        db.auth.onAuthStateChange(function(event, session) {
                            if (event === 'SIGNED_IN' && session && session.user) {
                                window.webkit.messageHandlers.auth.postMessage({
                                    event: 'SIGNED_IN',
                                    userId: session.user.id,
                                    accessToken: session.access_token
                                });
                            } else if (event === 'SIGNED_OUT') {
                                window.webkit.messageHandlers.auth.postMessage({
                                    event: 'SIGNED_OUT'
                                });
                            }
                        });
                        // Check current session
                        db.auth.getSession().then(function(result) {
                            if (result.data.session && result.data.session.user) {
                                window.webkit.messageHandlers.auth.postMessage({
                                    event: 'SIGNED_IN',
                                    userId: result.data.session.user.id,
                                    accessToken: result.data.session.access_token
                                });
                            }
                        });
                    }
                }, 500);
            })();
            """
            webView.evaluateJavaScript(js, completionHandler: nil)

            // Report the current OS push-notification status so the web primer only
            // shows when it's still notDetermined, and the settings row reflects reality.
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                DispatchQueue.main.async {
                    self.reportPushStatus(PushManager.statusString(settings.authorizationStatus), to: webView)
                }
            }
        }

        // Push the OS push-auth status into the web layer.
        func reportPushStatus(_ status: String, to webView: WKWebView?) {
            let js = "window._pushAuthStatus='\(status)';if(window.onPushAuthStatus){window.onPushAuthStatus('\(status)');}"
            (webView ?? self.webView)?.evaluateJavaScript(js, completionHandler: nil)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
            let nsError = error as NSError
            // Ignore cancelled navigations (e.g. OAuth interception)
            if nsError.code == NSURLErrorCancelled { return }
            parent.hasError = true
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
            let nsError = error as NSError
            if nsError.code == NSURLErrorCancelled { return }
            parent.hasError = true
            parent.isLoading = false
        }

        // MARK: UI delegate — handle target="_blank" links

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // Open target="_blank" links in the same webview
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }

        // MARK: OAuth

        private func handleOAuth(url: URL) {
            // Rewrite the redirect_to parameter to use our custom URL scheme
            guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
            var queryItems = components.queryItems ?? []

            // Replace redirect_to with our custom scheme
            queryItems = queryItems.map { item in
                if item.name == "redirect_to" {
                    return URLQueryItem(name: "redirect_to", value: "wrotate://auth-callback")
                }
                return item
            }
            components.queryItems = queryItems

            guard let modifiedURL = components.url else { return }

            oauthManager.startOAuthFlow(authURL: modifiedURL) { [weak self] callbackURL in
                guard let callbackURL = callbackURL else {
                    print("[WRotate] OAuth: no callback URL received")
                    return
                }

                print("[WRotate] OAuth callback: \(callbackURL.absoluteString.prefix(80))...")

                // Extract the fragment (access_token, refresh_token, etc.)
                // The callback URL looks like: wrotate://auth-callback#access_token=...&refresh_token=...
                let fragment = callbackURL.fragment ?? ""
                print("[WRotate] OAuth fragment length: \(fragment.count)")

                if !fragment.isEmpty {
                    // Parse the fragment to extract access_token and refresh_token
                    var params: [String: String] = [:]
                    for pair in fragment.split(separator: "&") {
                        let kv = pair.split(separator: "=", maxSplits: 1)
                        if kv.count == 2 {
                            params[String(kv[0])] = String(kv[1])
                        }
                    }

                    guard let accessToken = params["access_token"],
                          let refreshToken = params["refresh_token"] else {
                        print("[WRotate] OAuth: missing tokens in fragment")
                        return
                    }

                    // Inject JS to set the session directly — much more reliable than URL reload
                    let js = """
                    (function() {
                        if (typeof db !== 'undefined' && db.auth) {
                            db.auth.setSession({
                                access_token: '\(accessToken)',
                                refresh_token: '\(refreshToken)'
                            }).then(function(result) {
                                if (result.error) {
                                    console.error('[WRotate] setSession error:', result.error.message);
                                } else {
                                    console.log('[WRotate] Session set successfully');
                                    window.location.reload();
                                }
                            });
                        } else {
                            window.location.hash = '\(fragment)';
                            window.location.reload();
                        }
                        return true;
                    })();
                    """
                    print("[WRotate] OAuth: injecting session via JS")
                    DispatchQueue.main.async {
                        self?.webView?.evaluateJavaScript(js) { _, error in
                            if let error = error {
                                print("[WRotate] OAuth JS error: \(error.localizedDescription)")
                            }
                        }
                    }
                } else {
                    print("[WRotate] OAuth: empty fragment!")
                }
            }
        }

        // MARK: JS → Native message handler

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            // Route timegrapher messages to its bridge
            if message.name == "timegrapher" {
                if let body = message.body as? [String: Any] {
                    timegrapherBridge.handleMessage(body)
                }
                return
            }

            // Haptic feedback from JS
            if message.name == "haptic" {
                if let body = message.body as? [String: Any],
                   let type = body["type"] as? String {
                    switch type {
                    case "success":
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                    case "warning":
                        UINotificationFeedbackGenerator().notificationOccurred(.warning)
                    case "error":
                        UINotificationFeedbackGenerator().notificationOccurred(.error)
                    case "light":
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    case "medium":
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    case "heavy":
                        UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                    default:
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                    }
                }
                return
            }

            // App actions (review prompt, etc.)
            if message.name == "appAction" {
                if let body = message.body as? [String: Any],
                   let action = body["action"] as? String {
                    if action == "requestReview" {
                        DispatchQueue.main.async {
                            if let scene = UIApplication.shared.connectedScenes
                                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                                SKStoreReviewController.requestReview(in: scene)
                            }
                        }
                    } else if action == "requestPushPermission" {
                        // Warm ask, driven by the in-app primer — report the result back to JS.
                        let wv = message.webView ?? self.webView
                        PushManager.shared.requestPermissionAndRegister { status in
                            DispatchQueue.main.async { self.reportPushStatus(status, to: wv) }
                        }
                    } else if action == "openAppSettings" {
                        DispatchQueue.main.async {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                    }
                }
                return
            }

            guard let body = message.body as? [String: Any],
                  let event = body["event"] as? String else { return }

            if event == "SIGNED_IN", let userId = body["userId"] as? String {
                let accessToken = body["accessToken"] as? String
                PushManager.shared.handleSignIn(userId: userId, accessToken: accessToken)
            } else if event == "SIGNED_OUT" {
                PushManager.shared.handleSignOut()
            } else if event == "BADGE_UPDATE" {
                let count = body["count"] as? Int ?? 0
                UNUserNotificationCenter.current().setBadgeCount(count)
            }
        }
    }
}
