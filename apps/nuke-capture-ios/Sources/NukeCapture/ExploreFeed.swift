// ExploreFeed.swift — Explore's passive landing: one scrolling full-bleed feed of real
// records, no scores. Two existing reads, fetched together:
//   • market_pulse_live      → open auction lots (current bid, time left)
//   • classified_ask_board   → classified listings seen in the last 72 h (asking price)
// Every card is facts the record carries: photo, identity, the recorded amount and what
// kind of amount it is, the clock, the source. A read that fails or comes back empty
// hides its cards; the feed only shows an error when both reads fail.

import SwiftUI

/// One card in the feed: a live lot or a classified ask. Built only from fields the reads return.
struct ExploreFeedItem: Identifiable, Equatable {
    enum Kind: Equatable { case live, classified }
    let id: String
    let kind: Kind
    let title: String
    let image: String?
    let amount: Double?
    /// What the amount is, said plainly: "Current bid" / "Asking".
    let amountLabel: String
    let endsAt: Date?
    let source: String
    let location: String?
    let facts: String?
    let seen: String?
    let vehicleId: UUID?
    let year: Int?, make: String?, model: String?
    let link: URL?

    /// Round-robin merge so neither population buries the other; order inside each
    /// population is kept as its read returned it. Rows without a photo are dropped —
    /// this is the picture feed; the lenses still list them.
    static func interleave(live: [ExploreFeedItem], classified: [ExploreFeedItem]) -> [ExploreFeedItem] {
        let a = live.filter { ($0.image ?? "").isEmpty == false }
        let b = classified.filter { ($0.image ?? "").isEmpty == false }
        var out: [ExploreFeedItem] = []
        out.reserveCapacity(a.count + b.count)
        var seen = Set<String>()
        for i in 0..<max(a.count, b.count) {
            for item in [i < a.count ? a[i] : nil, i < b.count ? b[i] : nil].compactMap({ $0 })
            where seen.insert(item.id).inserted {
                out.append(item)
            }
        }
        return out
    }

    static func from(_ lot: LiveAuction) -> ExploreFeedItem {
        ExploreFeedItem(id: "live:" + lot.id, kind: .live, title: lot.headline, image: lot.imageUrl,
                        amount: lot.currentBid, amountLabel: "Current bid", endsAt: lot.endsAtDate,
                        source: "Bring a Trailer", location: nil, facts: lot.noReserve ? "No reserve" : nil,
                        seen: nil, vehicleId: lot.vehicleUUID, year: lot.year, make: lot.make, model: lot.model,
                        link: lot.listingUrl.flatMap { URL(string: $0) })
    }

    static func from(_ row: AskRow) -> ExploreFeedItem {
        ExploreFeedItem(id: "ask:" + row.event_id, kind: .classified, title: row.headline, image: row.image,
                        amount: row.ask > 0 ? row.ask : nil, amountLabel: "Asking", endsAt: nil,
                        source: CapturedListings.sourceName(row.source),
                        location: row.location.flatMap { $0.isEmpty ? nil : $0 },
                        facts: row.listingFacts.isEmpty ? nil : row.listingFacts,
                        seen: ProfileClock.day(row.seen_at).map { "seen \($0)" },
                        vehicleId: row.vehicleUUID, year: row.year, make: row.make, model: row.model,
                        link: row.sourceLink)
    }
}

struct ExploreFeedView: View {
    @State private var live: [ExploreFeedItem] = []
    @State private var classified: [ExploreFeedItem] = []
    @State private var loaded = false
    @State private var liveFailed = false
    @State private var askFailed = false

    private var items: [ExploreFeedItem] { ExploreFeedItem.interleave(live: live, classified: classified) }

    var body: some View {
        Group {
            if !loaded {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Reading live auctions and new listings…")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if items.isEmpty {
                ContentUnavailableView {
                    Label(liveFailed && askFailed ? "Couldn't load the feed" : "Nothing to show yet",
                          systemImage: liveFailed && askFailed ? "exclamationmark.triangle" : "photo.on.rectangle")
                } description: {
                    Text(liveFailed && askFailed ? "Both reads failed." : "No open auctions or new listings with photos right now.")
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 18) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                            card(item)
                                .onAppear { prefetch(after: idx) }
                        }
                        Text(footer)
                            .font(.caption2).foregroundStyle(.secondary)
                            .padding(.horizontal, 16).padding(.bottom, 24)
                    }
                }
                .refreshable { await load() }
            }
        }
        .task { if !loaded { await load() } }
    }

    private var footer: String {
        var parts: [String] = []
        if !live.isEmpty { parts.append("Current bids are Bring a Trailer's, in US dollars — not sold prices.") }
        if !classified.isEmpty { parts.append("An asking price is what the seller listed when we saw it, not a sale.") }
        return parts.joined(separator: " ")
    }

    @ViewBuilder private func card(_ item: ExploreFeedItem) -> some View {
        if let uuid = item.vehicleId {
            NavigationLink(value: VehicleHeaderRow(id: uuid, year: item.year, make: item.make, model: item.model, trim: nil,
                                                   primary_image_url: item.image, city: item.location, state: nil)) {
                ExploreHeroCard(item: item)
            }
            .buttonStyle(.plain)
        } else if let link = item.link {
            Link(destination: link) { ExploreHeroCard(item: item) }.buttonStyle(.plain)
        } else {
            ExploreHeroCard(item: item)
        }
    }

    private func prefetch(after idx: Int) {
        let all = items
        for j in (idx + 1)..<min(idx + 4, all.count) {
            if let u = NukeImage.thumb(all[j].image, width: 1080) {
                Task(priority: .utility) { _ = try? await URLSession.shared.data(from: u) }
            }
        }
    }

    private func load() async {
        async let l = Self.readLive()
        async let a = Self.readClassified()
        let (lr, ar) = await (l, a)
        liveFailed = lr == nil
        askFailed = ar == nil
        live = lr ?? []
        classified = ar ?? []
        loaded = true
    }

    private static func readLive() async -> [ExploreFeedItem]? {
        guard let board = try? await LiveBoard.fetch() else { return nil }
        return board.open(at: Date())
            .sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
            .prefix(40).map(ExploreFeedItem.from)
    }

    private static func readClassified() async -> [ExploreFeedItem]? {
        guard let board = try? await AskBoard.fetch(hours: 72, sort: .newest, limit: 40) else { return nil }
        return board.rows.map(ExploreFeedItem.from)
    }
}

/// Edge-to-edge 4:3 photo with the record's facts over a gradient. No scores.
struct ExploreHeroCard: View {
    let item: ExploreFeedItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Color(.secondarySystemFill)
                .aspectRatio(4.0 / 3.0, contentMode: .fit)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(item.image, width: 1080), maxPixel: 1280) { i in
                        i.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "car.side").font(.largeTitle).foregroundStyle(.secondary)
                    }
                }
                .clipped()
                .overlay(alignment: .bottomLeading) {
                    LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
                        .allowsHitTesting(false)
                }
                .overlay(alignment: .bottomLeading) {
                    HStack(alignment: .lastTextBaseline) {
                        if let amt = item.amount {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(item.amountLabel.uppercased())
                                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                Text(LiveBoardView.bidNumber(amt))
                                    .font(.system(size: 26, weight: .bold, design: .rounded)).monospacedDigit()
                            }
                        }
                        Spacer(minLength: 8)
                        if let ends = item.endsAt {
                            TimelineView(.periodic(from: .now, by: 60)) { ctx in
                                Text(LiveBoardView.remaining(ends, now: ctx.date))
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .background(.ultraThinMaterial, in: Capsule())
                            }
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(12)
                }
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.headline).lineLimit(2)
                Text(meta).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            .padding(.horizontal, 14)
        }
        .accessibilityElement(children: .combine)
    }

    private var meta: String {
        [item.source.uppercased(), item.location, item.facts, item.seen].compactMap { $0 }.joined(separator: " · ")
    }
}
