import UserNotifications
import UIKit

class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    var deviceToken: String?
    private var currentUserId: String?
    private var userAccessToken: String?

    /// Set when a notification is tapped; drained by ContentView once the WebView
    /// can actually run JS. A cold-start tap fires before the page has loaded, so
    /// the route has to wait rather than be dispatched into nothing.
    var pendingRoute: (route: String, id: String)?

    // Supabase config — same as web app
    private let supabaseURL = "https://api.wrotate.com"
    private let supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"

    private override init() { super.init() }

    // MARK: - UNUserNotificationCenterDelegate
    //
    // Before this existed the app set no delegate at all, which meant:
    //   • a tap did nothing but foreground the app on whatever page it was left on
    //   • a push arriving while the app was open was silently dropped by iOS —
    //     no banner — while the icon badge still went up
    // Together those are why notifications felt like they led nowhere.

    /// Show the banner even when the app is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .list, .sound, .badge]
    }

    /// Route the tap. The destination is decided server-side and shipped in the
    /// payload's `w` object, so new notification types can be routed without an
    /// App Store build.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let w = info["w"] as? [String: Any] else { return }

        // Ignore a push addressed to an account this device is no longer signed
        // into — opening someone else's post is worse than doing nothing. The
        // device_tokens_claim trigger should prevent these, but a push already in
        // flight when the account switched can still land.
        if let uid = w["uid"] as? String, let current = currentUserId, uid != current { return }

        // Route and id both reach JS inside quoted string literals — keep them to the
        // shape a route name / uuid / log id actually has so nothing can break out.
        let rawRoute = (w["route"] as? String) ?? "bell"
        let route = String(rawRoute.filter { $0.isLetter || $0.isNumber || $0 == "_" })
        let rawId = (w["id"] as? String) ?? ""
        let id = String(rawId.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        pendingRoute = (route: route.isEmpty ? "bell" : route, id: id)
    }

    // Called when user signs into the web app. Asks for PROVISIONAL authorization:
    // iOS grants it silently (no dialog), notifications are delivered quietly to
    // Notification Center, and iOS itself shows Keep / Turn Off on each one — that is
    // the ask, made with a real notification in hand.
    //
    // History, so nobody re-litigates it: 2.3 replaced the sign-in cold ask with a
    // warm in-app primer (52 shown / 2 tapped; new opt-ins fell to zero). 2.5 restored
    // the cold ask (~28% granted, everyone else unreachable forever). Provisional
    // (2.6) delivers to ~100% of installs; the one-shot full dialog is spent only after
    // the user has ACTED on a quiet notification — see requestPushPermission (bridge)
    // and shouldDeferredPushAsk in index.html.
    //
    // requestAuthorization returns the existing decision without re-prompting, so
    // signing in again is harmless and still re-registers an already-authorized device.
    func handleSignIn(userId: String, accessToken: String? = nil) {
        currentUserId = userId
        userAccessToken = accessToken
        requestPermissionAndRegister(full: false)
    }

    // Called when user signs out
    func handleSignOut() {
        if let token = deviceToken, let userId = currentUserId {
            deleteToken(userId: userId, token: token)
        }
        currentUserId = nil
    }

    // Maps an OS authorization status to the string the web layer expects.
    static func statusString(_ s: UNAuthorizationStatus) -> String {
        switch s {
        case .authorized, .ephemeral: return "authorized"
        case .provisional: return "provisional"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "notDetermined"
        }
    }

    // full=false: provisional — iOS grants silently, notifications deliver quietly with
    // its own Keep / Turn Off buttons (2.6 sign-in path).
    // full=true: the one-shot OS dialog — only ever from the "requestPushPermission"
    // bridge action, which JS fires after the user acted on a quiet notification.
    // Either way: registers on grant and reports the resulting status via completion.
    func requestPermissionAndRegister(full: Bool = true, completion: ((String) -> Void)? = nil) {
        let opts: UNAuthorizationOptions = full ? [.alert, .badge, .sound] : [.alert, .badge, .sound, .provisional]
        UNUserNotificationCenter.current().requestAuthorization(options: opts) { granted, error in
            if let error = error {
                print("[WRotate] Push permission error: \(error.localizedDescription)")
            }
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                completion?(PushManager.statusString(settings.authorizationStatus))
            }
        }
    }

    // Called from AppDelegate when APNs returns a device token
    func didRegisterForRemoteNotifications(deviceToken data: Data) {
        let token = data.map { String(format: "%02.2hhx", $0) }.joined()
        self.deviceToken = token
        print("[WRotate] APNs token: \(token)")

        if let userId = currentUserId {
            storeToken(userId: userId, token: token)
        }
    }

    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[WRotate] Failed to register for push: \(error.localizedDescription)")
    }

    // MARK: - Supabase token storage

    private func storeToken(userId: String, token: String) {
        guard let url = URL(string: "\(supabaseURL)/rest/v1/device_tokens") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal, resolution=merge-duplicates", forHTTPHeaderField: "Prefer")
        request.setValue(supabaseKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(userAccessToken ?? supabaseKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "user_id": userId,
            "token": token,
            "platform": "ios",
            // Lets the senders ship a `w.route` only to builds whose native switch can
            // route it (2.6+ falls back to JS openPushRoute; older builds open the bell).
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "updated_at": ISO8601DateFormatter().string(from: Date())
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("[WRotate] Failed to store push token: \(error.localizedDescription)")
                return
            }
            let httpResponse = response as? HTTPURLResponse
            let statusCode = httpResponse?.statusCode ?? 0
            if statusCode >= 200 && statusCode < 300 {
                print("[WRotate] Push token stored for user \(userId)")
            } else {
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? "no body"
                print("[WRotate] Failed to store push token: HTTP \(statusCode) — \(body)")
            }
        }.resume()
    }

    private func deleteToken(userId: String, token: String) {
        let encodedToken = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token
        guard let url = URL(string: "\(supabaseURL)/rest/v1/device_tokens?user_id=eq.\(userId)&token=eq.\(encodedToken)") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(supabaseKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(supabaseKey)", forHTTPHeaderField: "Authorization")

        URLSession.shared.dataTask(with: request) { _, _, error in
            if let error = error {
                print("[WRotate] Failed to delete push token: \(error.localizedDescription)")
            }
        }.resume()
    }
}
