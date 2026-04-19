import WidgetKit
import SwiftUI

struct WRotateEntry: TimelineEntry {
    let date: Date
    let todayBrand: String?
    let todayName: String?
    let todayColor: Color
    let watchCount: Int
    let collectionValue: Double
}

struct WRotateProvider: TimelineProvider {
    func placeholder(in context: Context) -> WRotateEntry {
        WRotateEntry(date: .now, todayBrand: "Omega", todayName: "Speedmaster", todayColor: Color(hex: "#c9a84c"), watchCount: 5, collectionValue: 25000)
    }

    func getSnapshot(in context: Context, completion: @escaping (WRotateEntry) -> Void) {
        completion(readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WRotateEntry>) -> Void) {
        let entry = readEntry()
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: .now)!
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }

    private func readEntry() -> WRotateEntry {
        let defaults = UserDefaults(suiteName: "group.com.wrotate.Wrotate")
        let brand = defaults?.string(forKey: "todayBrand")
        let name = defaults?.string(forKey: "todayName")
        let colorHex = defaults?.string(forKey: "todayColor") ?? "#c9a84c"
        let count = defaults?.integer(forKey: "watchCount") ?? 0
        let value = defaults?.double(forKey: "collectionValue") ?? 0
        return WRotateEntry(
            date: .now,
            todayBrand: brand,
            todayName: name,
            todayColor: Color(hex: colorHex),
            watchCount: count,
            collectionValue: value
        )
    }
}

struct WRotateWidgetEntryView: View {
    var entry: WRotateEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            smallWidget
        case .systemMedium:
            mediumWidget
        default:
            smallWidget
        }
    }

    var smallWidget: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "clock.fill")
                    .font(.system(size: 12))
                    .foregroundColor(Color(hex: "#c9a84c"))
                Text("WRotate")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Color(hex: "#c9a84c"))
            }

            Spacer()

            if let brand = entry.todayBrand, let name = entry.todayName {
                Text("Wearing Today")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.secondary)
                Text(brand)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                Text(name)
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            } else {
                Text("No watch logged")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                Text("Tap to log today's wear")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary.opacity(0.6))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .containerBackground(for: .widget) {
            Color(hex: "#16161e")
        }
    }

    var mediumWidget: some View {
        HStack(spacing: 0) {
            // Left: Today's watch
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Image(systemName: "clock.fill")
                        .font(.system(size: 12))
                        .foregroundColor(Color(hex: "#c9a84c"))
                    Text("WRotate")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(Color(hex: "#c9a84c"))
                }

                Spacer()

                if let brand = entry.todayBrand, let name = entry.todayName {
                    Text("Wearing Today")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary)
                    Text(brand)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                    Text(name)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                } else {
                    Text("No watch logged")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                    Text("Tap to log today's wear")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary.opacity(0.6))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)

            // Right: Collection stats
            VStack(alignment: .trailing, spacing: 8) {
                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(entry.watchCount)")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.primary)
                    Text("watches")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }

                if entry.collectionValue > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(formatValue(entry.collectionValue))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Color(hex: "#c9a84c"))
                        Text("collection value")
                            .font(.system(size: 10))
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()
            }
            .padding(14)
        }
        .containerBackground(for: .widget) {
            Color(hex: "#16161e")
        }
    }

    func formatValue(_ v: Double) -> String {
        if v >= 1000 {
            let k = v / 1000
            return k.truncatingRemainder(dividingBy: 1) == 0
                ? "$\(Int(k))k"
                : String(format: "$%.1fk", k)
        }
        return "$\(Int(v))"
    }
}

@main
struct WRotateWidgetBundle: WidgetBundle {
    var body: some Widget {
        WRotateWidget()
    }
}

struct WRotateWidget: Widget {
    let kind = "WRotateWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WRotateProvider()) { entry in
            WRotateWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("WRotate")
        .description("Today's watch and collection stats")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Color extension for hex strings

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: Double
        switch hex.count {
        case 6:
            r = Double((int >> 16) & 0xFF) / 255
            g = Double((int >> 8) & 0xFF) / 255
            b = Double(int & 0xFF) / 255
        default:
            r = 0.79; g = 0.66; b = 0.30
        }
        self.init(red: r, green: g, blue: b)
    }
}
