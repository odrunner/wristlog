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
            guard let host = url.host, host.hasSuffix("wrotate.com") else { return }
            webViewRef?.load(URLRequest(url: url))
        }
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
