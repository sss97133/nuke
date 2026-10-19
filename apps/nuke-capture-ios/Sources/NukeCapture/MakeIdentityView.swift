// Attributed make lettering from the same catalogue as the web's MakeIdentity.
// Regenerate assets/provenance with scripts/generate_make_wordmarks.py; no network or WebView.
import SwiftUI
import UIKit

struct MakeIdentityView: View {
    let make: String
    var height: CGFloat = 18
    var maxWidth: CGFloat = 140

    private var label: String {
        let trimmed = make.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Make unrecorded" : trimmed
    }

    var body: some View {
        Group {
            if let entry = MakeWordmarkCatalogue.entry(for: make), UIImage(named: entry.asset) != nil {
                Image(entry.asset)
                    .renderingMode(entry.rendering == "template" ? .template : .original)
                    .resizable()
                    .scaledToFit()
                    .frame(width: min(maxWidth, height * entry.aspectRatio), height: height, alignment: .leading)
            } else {
                Text(label)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

// One bundled registry for every consumer; additions need no view-specific brand list.
enum MakeWordmarkCatalogue {
    struct Entry: Decodable {
        let key: String
        let asset: String
        let rendering: String
        let aspectRatio: CGFloat
    }
    private struct Catalogue: Decodable {
        let aliases: [String: String]
        let makes: [Entry]
    }
    private static let catalogue: Catalogue? = {
        guard let url = Bundle.main.url(forResource: "make-wordmarks", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Catalogue.self, from: data)
    }()
    private static let entries = Dictionary((catalogue?.makes ?? []).map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })

    static func entry(for make: String) -> Entry? {
        let key = make.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: "-")
        return entries[catalogue?.aliases[key] ?? key]
    }
}
