import SwiftUI
import WebKit

struct ContentView: View {
    @Environment(NetworkMonitor.self) var networkMonitor

    @State private var isLoading = true
    @State private var hasError = false
    @State private var webViewRef: WKWebView?
    @State private var lastBackgrounded: Date?
    // Reload the WebView on foreground after this much idle, so shipped web updates
    // reach the app. The WebView loads wrotate.com once and keeps that JS otherwise,
    // so a resident app can run code from many deploys ago until manually refreshed.
    private static let staleReloadThreshold: TimeInterval = 30 * 60

    var body: some View {
        ZStack {
            WebView(
                url: URL(string: "https://wrotate.com")!,
                isLoading: $isLoading,
                hasError: $hasError,
                onReload: { webView in
                    self.webViewRef = webView
                }
            )
            .ignoresSafeArea()

            // Loading overlay
            if isLoading && !hasError {
                LoadingView()
                    .transition(.opacity)
            }

            // Offline / error overlay
            if hasError || (!networkMonitor.isConnected && isLoading) {
                OfflineView {
                    hasError = false
                    isLoading = true
                    webViewRef?.reload()
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: isLoading)
        .animation(.easeInOut(duration: 0.25), value: hasError)
        // Universal Links — open wrotate.com links in the app's WebView
        .onOpenURL { url in
            // Share extension: shared image for identification
            if url.scheme == "wrotate" && url.host == "share-image" {
                handleSharedImage()
                return
            }
            // Email click tracking wraps the real destination, so unwrap before
            // routing — otherwise a tracked deep link to /p/123 falls through to a
            // plain WebView load instead of scrolling to the post.
            let target = unwrapTrackedLink(url) ?? url
            guard let host = target.host, host.hasSuffix("wrotate.com") else { return }
            // /open — app is already open, nothing to do
            if target.path == "/open" || target.path == "/open.html" { return }
            // Deep link to specific post or collection
            let components = URLComponents(url: target, resolvingAgainstBaseURL: false)
            if let postId = components?.queryItems?.first(where: { $0.name == "id" })?.value,
               (target.path.contains("share-post") || target.path.hasPrefix("/p/")) {
                webViewRef?.evaluateJavaScript("if(typeof scrollToPost==='function') scrollToPost('\(postId)');", completionHandler: nil)
                return
            }
            if let username = components?.queryItems?.first(where: { $0.name == "u" })?.value,
               target.path.contains("share-collection") {
                webViewRef?.evaluateJavaScript("if(typeof viewUserByUsername==='function') viewUserByUsername('\(username)');", completionHandler: nil)
                return
            }
            webViewRef?.load(URLRequest(url: target))
        }
        .onChange(of: isLoading) {
            if !isLoading { dispatchPendingQuickAction(); dispatchPendingNotification(); handleSharedImage() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            lastBackgrounded = Date()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            // Refresh the WebView after a long idle so shipped web updates reach the app.
            // !isLoading avoids interrupting an in-progress load; the threshold avoids
            // disrupting an active session (e.g. a half-written post). The service worker
            // is network-first for HTML, so reload() pulls the latest code seamlessly.
            if !isLoading, let bg = lastBackgrounded,
               Date().timeIntervalSince(bg) > Self.staleReloadThreshold {
                webViewRef?.reload()
            }
            lastBackgrounded = nil
            if !isLoading { dispatchPendingQuickAction(); dispatchPendingNotification(); handleSharedImage() }
        }
    }

    /// Unwrap an email click-tracking link back to its real destination.
    ///
    /// SES rewrites every href in outgoing mail as
    /// `https://<redirect-host>/L0/<percent-encoded destination>/<n>/<message id>/<hash>`.
    /// iOS hands us that WRAPPER, not the destination, so routing must unwrap it
    /// first or every tracked link degrades to a plain WebView load.
    ///
    /// Reads the *percent-encoded* path deliberately: `url.pathComponents` decodes
    /// each segment, and the destination's own `%2F` separators would then be
    /// indistinguishable from real path separators.
    ///
    /// Returns nil when the URL is not a tracking wrapper, so callers can fall
    /// back to the URL as-is.
    private func unwrapTrackedLink(_ url: URL) -> URL? {
        guard let encodedPath = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath
        else { return nil }
        let segments = encodedPath.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard segments.count >= 2, segments[0] == "L0",
              let decoded = segments[1].removingPercentEncoding,
              let destination = URL(string: decoded),
              destination.scheme == "https" || destination.scheme == "http"
        else { return nil }
        return destination
    }

    private func handleSharedImage() {
        // Leave the pending key in place until the WebView can actually run the JS —
        // a cold-start onOpenURL fires before the page loads and would lose the image.
        guard !isLoading else { return }
        guard let defaults = UserDefaults(suiteName: "group.com.wrotate.Wrotate"),
              let path = defaults.string(forKey: "sharedImagePath") else { return }
        defaults.removeObject(forKey: "sharedImagePath")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return }
        let base64 = data.base64EncodedString()
        let js = "if(typeof handleSharedImage==='function') handleSharedImage('data:image/jpeg;base64,\(base64)');"
        webViewRef?.evaluateJavaScript(js, completionHandler: nil)
        // Clean up shared file
        try? FileManager.default.removeItem(atPath: path)
    }

    /// Drain a notification tap into the WebView. Mirrors the quick-action
    /// dispatch: the tap can arrive long before the page is ready, so it is held
    /// on PushManager and dispatched once `isLoading` clears.
    private func dispatchPendingNotification() {
        guard let pending = PushManager.shared.pendingRoute else { return }
        PushManager.shared.pendingRoute = nil
        let id = pending.id
        let js: String
        switch pending.route {
        case "post" where !id.isEmpty:
            js = "if(typeof scrollToFeedPost==='function') scrollToFeedPost('\(id)');"
        case "profile" where !id.isEmpty:
            js = "if(typeof viewUserProfile==='function') viewUserProfile('\(id)');"
        case "club" where !id.isEmpty:
            js = "if(typeof openClubDetail==='function') openClubDetail('\(id)');"
        case "badges":
            js = "if(typeof openBadgeWall==='function') openBadgeWall();"
        default:
            // "bell", or a route whose target didn't survive — open the panel so
            // the tap always lands somewhere the notification is visible.
            js = "if(typeof openNotifPanel==='function') openNotifPanel();"
        }
        webViewRef?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func dispatchPendingQuickAction() {
        guard let action = QuickActionManager.shared.pendingAction else { return }
        QuickActionManager.shared.pendingAction = nil
        let js: String
        switch action {
        case "logwear":
            js = "nav(document.querySelector('nav button[data-page=\"track\"]'));"
        case "measure":
            js = "nav(document.querySelector('nav button[data-page=\"measure\"]'));"
        case "post":
            js = "if(typeof openNewPost==='function') openNewPost();"
        default:
            return
        }
        webViewRef?.evaluateJavaScript(js, completionHandler: nil)
    }
}

// MARK: - Loading View

struct LoadingView: View {
    var body: some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97) // #f5f5f8 light bg
                .ignoresSafeArea()

            VStack(spacing: 20) {
                // WRotate logo — watch icon
                Image(systemName: "clock.fill")
                    .font(.system(size: 48))
                    .foregroundColor(Color(red: 0.79, green: 0.66, blue: 0.30)) // gold #c9a84c

                Text("WRotate")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(Color(red: 0.09, green: 0.09, blue: 0.12)) // #16161e

                ProgressView()
                    .tint(Color(red: 0.79, green: 0.66, blue: 0.30))
            }
        }
    }
}

// MARK: - Offline View

struct OfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 48))
                    .foregroundColor(Color(red: 0.44, green: 0.44, blue: 0.54)) // muted

                Text("No Connection")
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(Color(red: 0.09, green: 0.09, blue: 0.12))

                Text("Check your internet connection and try again.")
                    .font(.subheadline)
                    .foregroundColor(Color(red: 0.44, green: 0.44, blue: 0.54))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)

                Button(action: onRetry) {
                    Text("Try Again")
                        .fontWeight(.semibold)
                        .foregroundColor(.black)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.79, green: 0.66, blue: 0.30))
                        .cornerRadius(10)
                }
                .padding(.top, 8)
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(NetworkMonitor())
}
