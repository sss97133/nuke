// WelcomePhotos.swift — the real vehicle photos behind the welcome pages.
//
// Nothing is bundled and nothing is invented: the same two public reads Explore uses (open
// auction lots and the last 72 hours of classified listings) are fetched at runtime, and the
// first few distinct photos become the page backgrounds. If the reads fail or are empty, the
// pages keep their gradients.

import Foundation

enum WelcomePhotos {
    /// Up to `count` items with distinct photos, spread across makes when the feed allows.
    static func pick(from items: [ExploreFeedItem], count: Int) -> [ExploreFeedItem] {
        guard count > 0 else { return [] }
        var seenImages = Set<String>()
        let withPhotos = items.filter { item in
            guard let image = item.image, !image.isEmpty else { return false }
            return seenImages.insert(image).inserted
        }
        var picked: [ExploreFeedItem] = []
        var makes = Set<String>()
        // First pass: one per make, so four pages do not show four of the same car.
        for item in withPhotos where picked.count < count {
            let make = (item.make ?? item.id).lowercased()
            if makes.insert(make).inserted { picked.append(item) }
        }
        // Second pass: top up from whatever is left.
        for item in withPhotos where picked.count < count && !picked.contains(where: { $0.id == item.id }) {
            picked.append(item)
        }
        return picked
    }

    /// The runtime read: same sources as ExploreFeedView, newest-ending lots first.
    static func fetch(count: Int) async -> [ExploreFeedItem] {
        async let lots = liveItems()
        async let asks = classifiedItems()
        let (live, classified) = await (lots, asks)
        return pick(from: ExploreFeedItem.interleave(live: live, classified: classified), count: count)
    }

    private static func liveItems() async -> [ExploreFeedItem] {
        guard let board = try? await LiveBoard.fetch() else { return [] }
        return board.open(at: Date())
            .sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
            .prefix(20).map(ExploreFeedItem.from)
    }

    private static func classifiedItems() async -> [ExploreFeedItem] {
        guard let board = try? await AskBoard.fetch(hours: 72, sort: .newest, limit: 20) else { return [] }
        return board.rows.map(ExploreFeedItem.from)
    }
}

@MainActor
final class WelcomePhotoModel: ObservableObject {
    /// One slot per page; nil keeps that page on its gradient.
    @Published private(set) var items: [ExploreFeedItem?]
    private var loaded = false

    init(pages: Int) {
        items = Array(repeating: nil, count: pages)
    }

    func load() async {
        guard !loaded else { return }
        loaded = true
        let picked = await WelcomePhotos.fetch(count: items.count)
        for (index, item) in picked.enumerated() where index < items.count { items[index] = item }
    }
}
