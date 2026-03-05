import AuthenticationServices
import UIKit

class OAuthManager: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = OAuthManager()

    private override init() {
        super.init()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return ASPresentationAnchor()
        }
        return window
    }

    func startOAuthFlow(authURL: URL, completion: @escaping (URL?) -> Void) {
        let session = ASWebAuthenticationSession(
            url: authURL,
            callbackURLScheme: "wrotate"
        ) { callbackURL, error in
            if let error = error {
                let nsError = error as NSError
                // User cancelled — not a real error
                if nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                    completion(nil)
                    return
                }
                print("[WRotate] OAuth error: \(error.localizedDescription)")
                completion(nil)
                return
            }
            completion(callbackURL)
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false // share cookies with Safari
        session.start()
    }
}
