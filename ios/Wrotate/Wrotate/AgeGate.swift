import SwiftUI
#if canImport(DeclaredAgeRange)
import DeclaredAgeRange
#endif

/// The age check (Apple's Declared Age Range). The app asks for an age range only where a law
/// makes sharing it mandatory (California AB 1043 from January 2027, Texas, Utah, Louisiana,
/// Brazil), and blocks the app for a range that ends below 13 — the age the privacy policy
/// already sets. Everyone else, and every failure, continues as before. Android does the same
/// through Play Age Signals (android/.../AgeGate.kt); keep the two rules identical.
///
/// The range is used for this and nothing else: it never reaches the page, analytics or the
/// server. The only thing kept is the on-device "blocked" flag.
enum AgeGate {
    static let minAge = 13
    static let blockedKey = "ageBlocked"

    enum Verdict { case block, allow, unknown }

    /// With one gate at 13 the system answers "under 13" (upper bound 12) or "13 and over"
    /// (lower bound 13, no upper bound). A range whose top end is under 13 blocks; any other
    /// range allows; no range at all says nothing, so a stored block is left as it was.
    static func verdict(lower: Int?, upper: Int?) -> Verdict {
        if lower == nil && upper == nil { return .unknown }
        if let upper, upper < minAge { return .block }
        return .allow
    }
}

/// Wraps the whole app: a device known to belong to an under-13 user gets the block screen and
/// the WebView is never created. The check runs on every launch, so an age corrected in the
/// Apple Account lifts the block next time.
struct AgeGated<Content: View>: View {
    @AppStorage(AgeGate.blockedKey) private var blocked = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            if blocked { AgeBlockView() } else { content() }
        }
        .background {
            #if canImport(DeclaredAgeRange)
            if #available(iOS 26.4, macOS 26.4, *) {
                AgeCheck { verdict in
                    switch verdict {
                    case .block: blocked = true
                    case .allow: blocked = false
                    case .unknown: break
                    }
                }
            }
            #endif
        }
    }
}

#if canImport(DeclaredAgeRange)
/// Invisible; exists because the request needs a view in the hierarchy to present from.
/// `declaredAgeRangeRequired` is reported only for users the regulations cover, so nobody else
/// is ever asked anything.
@available(iOS 26.4, macOS 26.4, *)
private struct AgeCheck: View {
    @Environment(\.requestAgeRange) private var requestAgeRange
    let onVerdict: (AgeGate.Verdict) -> Void

    var body: some View {
        Color.clear.task { onVerdict(await check()) }
    }

    private func check() async -> AgeGate.Verdict {
        do {
            let required = try await AgeRangeService.shared.requiredRegulatoryFeatures
            guard required.contains(.declaredAgeRangeRequired) else { return .unknown }
            switch try await requestAgeRange(ageGates: AgeGate.minAge) {
            case .sharing(let range):
                return AgeGate.verdict(lower: range.lowerBound, upper: range.upperBound)
            case .declinedSharing:
                return .unknown
            @unknown default:
                return .unknown
            }
        } catch {
            return .unknown
        }
    }
}
#endif

struct AgeBlockView: View {
    var body: some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Text("WRotate is not available")
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(Color(red: 0.09, green: 0.09, blue: 0.12))
                    .multilineTextAlignment(.center)

                Text("WRotate is not intended for children under 13.")
                    .font(.subheadline)
                    .foregroundColor(Color(red: 0.44, green: 0.44, blue: 0.54))
                    .multilineTextAlignment(.center)

                // An adult on a mis-dated account must not be left at a dead end: the check
                // runs on every launch, so a corrected date of birth lifts the block by itself.
                Text("If this is not right, correct the date of birth on your Apple Account, then open WRotate again.")
                    .font(.subheadline)
                    .foregroundColor(Color(red: 0.44, green: 0.44, blue: 0.54))
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 40)
        }
    }
}
