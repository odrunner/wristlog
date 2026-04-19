import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        handleSharedImage()
    }

    private func handleSharedImage() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            close()
            return
        }

        for item in items {
            guard let attachments = item.attachments else { continue }
            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.image.identifier) { [weak self] data, error in
                        guard error == nil else {
                            self?.close()
                            return
                        }

                        var imageData: Data?
                        if let url = data as? URL {
                            imageData = try? Data(contentsOf: url)
                        } else if let d = data as? Data {
                            imageData = d
                        } else if let img = data as? UIImage {
                            imageData = img.jpegData(compressionQuality: 0.85)
                        }

                        guard let imgData = imageData else {
                            self?.close()
                            return
                        }

                        self?.saveAndOpenApp(imageData: imgData)
                    }
                    return
                }
            }
        }
        close()
    }

    private func saveAndOpenApp(imageData: Data) {
        guard let defaults = UserDefaults(suiteName: "group.com.wrotate.Wrotate") else {
            close()
            return
        }

        let fileName = "shared-image-\(Int(Date().timeIntervalSince1970)).jpg"
        let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.wrotate.Wrotate"
        )
        guard let fileURL = containerURL?.appendingPathComponent(fileName) else {
            close()
            return
        }

        do {
            try imageData.write(to: fileURL)
            defaults.set(fileURL.path, forKey: "sharedImagePath")
            defaults.synchronize()
        } catch {
            close()
            return
        }

        // Open main app via custom URL scheme
        let url = URL(string: "wrotate://share-image")!
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                break
            }
            responder = r.next
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.close()
        }
    }

    private func close() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
