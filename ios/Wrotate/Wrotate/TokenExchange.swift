import Foundation

struct SessionTokens {
    let accessToken: String
    let refreshToken: String
}

/// Exchanges a PKCE auth code for session tokens at GoTrue's token endpoint. The publishable key is
/// the same public client key the page itself ships (index.html SUPABASE_KEY) — not a secret.
/// Mirrors android/app/src/main/kotlin/com/wrotate/app/TokenExchange.kt.
enum TokenExchange {
    static let tokenURL = "https://api.wrotate.com/auth/v1/token?grant_type=pkce"
    static let publishableKey = "sb_publishable_pxXMl4LD0xTLEqNKCZyQ5Q_qQfhNYbz"

    /// Async POST; completion fires on URLSession's queue with nil on any failure —
    /// the user just retries sign-in.
    static func exchange(code: String, verifier: String, completion: @escaping (SessionTokens?) -> Void) {
        guard let url = URL(string: tokenURL),
              let body = try? JSONSerialization.data(withJSONObject: ["auth_code": code, "code_verifier": verifier])
        else {
            completion(nil)
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(publishableKey, forHTTPHeaderField: "apikey")
        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let data,
                  let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode)
            else {
                completion(nil)
                return
            }
            completion(parseResponse(data))
        }.resume()
    }

    static func parseResponse(_ data: Data) -> SessionTokens? {
        guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let access = o["access_token"] as? String,
              let refresh = o["refresh_token"] as? String
        else { return nil }
        return SessionTokens(accessToken: access, refreshToken: refresh)
    }
}
