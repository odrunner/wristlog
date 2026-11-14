import UIKit

@Observable
class QuickActionManager {
    static let shared = QuickActionManager()
    var pendingAction: String?

    func registerShortcuts() {
        UIApplication.shared.shortcutItems = [
            UIApplicationShortcutItem(
                type: "com.wrotate.logwear",
                localizedTitle: String(localized: "Log Wear"),
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: "clock.badge.checkmark")
            ),
            UIApplicationShortcutItem(
                type: "com.wrotate.measure",
                localizedTitle: String(localized: "Measure"),
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: "waveform")
            ),
            UIApplicationShortcutItem(
                type: "com.wrotate.post",
                localizedTitle: String(localized: "New Post"),
                localizedSubtitle: nil,
                icon: UIApplicationShortcutIcon(systemImageName: "plus.circle")
            ),
        ]
    }

    func handle(_ shortcutItem: UIApplicationShortcutItem) {
        switch shortcutItem.type {
        case "com.wrotate.logwear":
            pendingAction = "logwear"
        case "com.wrotate.measure":
            pendingAction = "measure"
        case "com.wrotate.post":
            pendingAction = "post"
        default:
            break
        }
    }
}
