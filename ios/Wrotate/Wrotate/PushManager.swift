import UserNotifications
import UIKit

class PushManager {
    static let shared = PushManager()

    var deviceToken: String?
    private var currentUserId: String?
    private var userAccessToken: String?

    // Supabase config — same as web app
    private let supabaseURL = "https://api.wrotate.com"
    private let supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuendlZXZ6cm9qbW91emhwd3p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNjYwODAsImV4cCI6MjA4Nzc0MjA4MH0.5FR1m_kBNd1MlJGGmpXj30aLOFm8Xq3-34BCEmLH-vs"

    private init() {}

    // Called when user signs into the web app
    func handleSignIn(userId: String, accessToken: String? = nil) {
        currentUserId = userId
        userAccessToken = accessToken
        requestPermissionAndRegister()
    }

    // Called when user signs out
    func handleSignOut() {
        if let token = deviceToken, let userId = currentUserId {
            deleteToken(userId: userId, token: token)
        }
        currentUserId = nil
    }

    func requestPermissionAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            if let error = error {
                print("[WRotate] Push permission error: \(error.localizedDescription)")
                return
            }
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
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
