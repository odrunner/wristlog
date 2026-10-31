import CryptoKit
import Foundation
import Security

/// RFC 7636 code verifier/challenge (S256). Pure logic, no UIKit —
/// mirrors android/app/src/main/kotlin/com/wrotate/app/Pkce.kt.
enum Pkce {
    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func generateVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 48) // 48 bytes -> 64 base64url chars, within the 43..128 spec
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            // SystemRandomNumberGenerator is cryptographically secure on Apple platforms.
            bytes = (0..<48).map { _ in UInt8.random(in: .min ... .max) }
        }
        return base64url(Data(bytes))
    }

    static func challenge(_ verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }
}
