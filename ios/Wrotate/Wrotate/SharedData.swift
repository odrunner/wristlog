import Foundation

enum SharedData {
    static let appGroup = "group.com.wrotate.Wrotate"

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    static func save(watches: [[String: Any]], todayWatch: [String: Any]?, collectionValue: Double) {
        guard let defaults = defaults else { return }
        defaults.set(watches.count, forKey: "watchCount")
        defaults.set(collectionValue, forKey: "collectionValue")
        if let tw = todayWatch {
            defaults.set(tw["brand"] as? String ?? "", forKey: "todayBrand")
            defaults.set(tw["name"] as? String ?? "", forKey: "todayName")
            defaults.set(tw["color"] as? String ?? "#c9a84c", forKey: "todayColor")
        } else {
            defaults.removeObject(forKey: "todayBrand")
            defaults.removeObject(forKey: "todayName")
            defaults.removeObject(forKey: "todayColor")
        }
        defaults.set(Date().timeIntervalSince1970, forKey: "lastUpdated")
    }
}
