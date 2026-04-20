import Foundation
import UIKit
import WidgetKit

enum SharedData {
    static let appGroup = "group.com.wrotate.Wrotate"

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    static var containerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    static func save(watches: [[String: Any]], todayWatch: [String: Any]?, collectionValue: Double) {
        guard let defaults = defaults else { return }
        defaults.set(watches.count, forKey: "watchCount")
        defaults.set(collectionValue, forKey: "collectionValue")
        if let tw = todayWatch {
            defaults.set(tw["brand"] as? String ?? "", forKey: "todayBrand")
            defaults.set(tw["name"] as? String ?? "", forKey: "todayName")
            defaults.set(tw["color"] as? String ?? "#c9a84c", forKey: "todayColor")
            if let imageURL = tw["image"] as? String, !imageURL.isEmpty {
                downloadWatchImage(from: imageURL)
            } else {
                removeWatchImage()
                WidgetCenter.shared.reloadAllTimelines()
            }
        } else {
            defaults.removeObject(forKey: "todayBrand")
            defaults.removeObject(forKey: "todayName")
            defaults.removeObject(forKey: "todayColor")
            removeWatchImage()
            WidgetCenter.shared.reloadAllTimelines()
        }
        defaults.set(Date().timeIntervalSince1970, forKey: "lastUpdated")
    }

    private static func downloadWatchImage(from urlString: String) {
        guard let url = URL(string: urlString) else {
            WidgetCenter.shared.reloadAllTimelines()
            return
        }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data = data,
               let image = UIImage(data: data),
               let jpeg = image.jpegData(compressionQuality: 0.7),
               let container = containerURL {
                let file = container.appendingPathComponent("todayWatch.jpg")
                try? jpeg.write(to: file)
            }
            DispatchQueue.main.async {
                WidgetCenter.shared.reloadAllTimelines()
            }
        }.resume()
    }

    private static func removeWatchImage() {
        guard let container = containerURL else { return }
        let file = container.appendingPathComponent("todayWatch.jpg")
        try? FileManager.default.removeItem(at: file)
    }
}
