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

        // Try to open the main app via the custom URL scheme. On modern iOS a share
        // extension usually CANNOT launch its app (Apple closed the workarounds), so
        // regardless of the outcome we show a "Saved" confirmation — the image is
        // waiting in the app group and imports on the next WRotate open.
        let url = URL(string: "wrotate://share-image")!
        DispatchQueue.main.async {
            self.extensionContext?.open(url) { [weak self] success in
                if !success { self?.openViaResponderChain(url) }
                self?.showSavedConfirmation()
            }
        }
    }

    private func showSavedConfirmation() {
        DispatchQueue.main.async {
            let card = UIView()
            card.backgroundColor = UIColor(red: 0.07, green: 0.09, blue: 0.08, alpha: 0.96)
            card.layer.cornerRadius = 14
            card.translatesAutoresizingMaskIntoConstraints = false

            let label = UILabel()
            label.text = "✓ Sent to WRotate — open WRotate for next steps"
            label.numberOfLines = 0
            label.textAlignment = .center
            label.textColor = .white
            label.font = .systemFont(ofSize: 14, weight: .medium)
            label.translatesAutoresizingMaskIntoConstraints = false

            card.addSubview(label)
            self.view.addSubview(card)
            NSLayoutConstraint.activate([
                card.centerXAnchor.constraint(equalTo: self.view.centerXAnchor),
                card.centerYAnchor.constraint(equalTo: self.view.centerYAnchor),
                card.widthAnchor.constraint(lessThanOrEqualToConstant: 300),
                label.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
                label.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
                label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
                label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            ])
            card.alpha = 0
            UIView.animate(withDuration: 0.18) { card.alpha = 1 }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                self.close()
            }
        }
    }

    @objc private func openURL(_ url: URL) {}   // selector anchor for the responder walk

    private func openViaResponderChain(_ url: URL) {
        let selector = #selector(openURL(_:))
        var responder: UIResponder? = self
        while let r = responder {
            if r !== self, r.responds(to: selector) {
                r.perform(selector, with: url)
                return
            }
            responder = r.next
        }
    }

    private func close() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
