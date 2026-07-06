import SwiftUI
import WebKit

struct ContentView: View {
    @Environment(NetworkMonitor.self) var networkMonitor

    @State private var isLoading = true
    @State private var hasError = false
    @State private var webViewRef: WKWebView?

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
            guard let host = url.host, host.hasSuffix("wrotate.com") else { return }
            // /open — app is already open, nothing to do
            if url.path == "/open" || url.path == "/open.html" { return }
            // Deep link to specific post or collection
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            if let postId = components?.queryItems?.first(where: { $0.name == "id" })?.value,
               (url.path.contains("share-post") || url.path.hasPrefix("/p/")) {
                webViewRef?.evaluateJavaScript("if(typeof scrollToPost==='function') scrollToPost('\(postId)');", completionHandler: nil)
                return
            }
            if let username = components?.queryItems?.first(where: { $0.name == "u" })?.value,
               url.path.contains("share-collection") {
                webViewRef?.evaluateJavaScript("if(typeof viewUserByUsername==='function') viewUserByUsername('\(username)');", completionHandler: nil)
                return
            }
            webViewRef?.load(URLRequest(url: url))
        }
        .onChange(of: isLoading) {
            if !isLoading { dispatchPendingQuickAction(); handleSharedImage() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            if !isLoading { dispatchPendingQuickAction(); handleSharedImage() }
        }
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
