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
    /// When the lot was listed (live lots only); the clock door uses it for the auction's length.
    var listedAt: Date? = nil

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

    /// The plain line under the title: where it is and what we know, only parts the record carries.
    var subtitle: String? {
        NukeDisplay.joined([location, facts, seen])
    }

    /// The source's mark as nuke.ag hosts it (the files the web's source board shows), or nil when
    /// none is known for this source, in which case the card keeps the text pill.
    /// One table for the app's source marks (VehicleFirstScreen.sourceMarkURL), shared with the vehicle page.
    var sourceLogoURL: URL? {
        VehicleFirstScreen.sourceMarkURL(label: source)
    }

    /// "Ends in 3d 4h" for a live lot, nil when there is no end time on record.
    func timeLeft(now: Date) -> String? {
        guard let endsAt else { return nil }
        return LiveBoardView.remaining(endsAt, now: now)
    }

    static func from(_ lot: LiveAuction) -> ExploreFeedItem {
        ExploreFeedItem(id: "live:" + lot.id, kind: .live, title: lot.headline, image: lot.imageUrl,
                        amount: lot.currentBid, amountLabel: "Current bid", endsAt: lot.endsAtDate,
                        source: "Bring a Trailer", location: nil, facts: lot.noReserve ? "No reserve" : nil,
                        seen: nil, vehicleId: lot.vehicleUUID, year: lot.year, make: lot.make, model: lot.model,
                        link: lot.listingUrl.flatMap { URL(string: $0) }, listedAt: lot.listedAtDate)
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
    /// The open lots behind live cards, by card id: the bid door hands the lot to the bid reading.
    @State private var lots: [String: LiveAuction] = [:]
    @State private var drill: ExploreCardDrill?

    private var items: [ExploreFeedItem] { ExploreFeedItem.interleave(live: live, classified: classified) }

    var body: some View {
        Group {
            if !loaded {
                // Shimmering cards in the shape of the real ones: the page looks alive while it loads.
                NukeFeedSkeleton(message: "Finding cars for you…")
            } else if items.isEmpty {
                if liveFailed && askFailed {
                    NukeEmptyState(icon: "wifi.exclamationmark", title: "We couldn't load cars",
                                   message: "Check your connection, then try again.",
                                   actionTitle: "Try again") { Task { await load() } }
                } else {
                    NukeEmptyState(icon: "photo.on.rectangle.angled", title: "No cars to show yet",
                                   message: "New cars with photos appear here as they're listed. Check back soon.",
                                   actionTitle: "Refresh") { Task { await load() } }
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: NukeSpace.xl) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                            card(item)
                                .onAppear { prefetch(after: idx) }
                        }
                        if !footer.isEmpty {
                            Text(footer)
                                .font(.caption).foregroundStyle(.tertiary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, NukeSpace.xl).padding(.bottom, NukeSpace.xl)
                        }
                    }
                    .padding(.top, NukeSpace.sm)
                }
                .refreshable { await load() }
                .sheet(item: $drill) { d in ExploreCardDrillSheet(drill: d, lot: lots[d.item.id]) }
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
                ExploreHeroCard(item: item, hasBidReading: lots[item.id] != nil, onDrill: openDrill)
            }
            .buttonStyle(.plain)
        } else if let link = item.link {
            Link(destination: link) { ExploreHeroCard(item: item, hasBidReading: lots[item.id] != nil, onDrill: openDrill) }
                .buttonStyle(.plain)
        } else {
            ExploreHeroCard(item: item, hasBidReading: lots[item.id] != nil, onDrill: openDrill)
        }
    }

    private func openDrill(_ d: ExploreCardDrill) { drill = d }

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
        lots = Dictionary((lr ?? []).map { ($0.item.id, $0.lot) }, uniquingKeysWith: { first, _ in first })
        live = lr?.map { $0.item } ?? []
        classified = ar ?? []
        loaded = true
    }

    private static func readLive() async -> [(item: ExploreFeedItem, lot: LiveAuction)]? {
        guard let board = try? await LiveBoard.fetch() else { return nil }
        return board.open(at: Date())
            .sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
            .prefix(40).map { (ExploreFeedItem.from($0), $0) }
    }

    private static func readClassified() async -> [ExploreFeedItem]? {
        guard let board = try? await AskBoard.fetch(hours: 72, sort: .newest, limit: 40) else { return nil }
        return board.rows.map(ExploreFeedItem.from)
    }
}

/// A large rounded photo with the price on it and the car's name beneath. No scores.
/// Three doors sit on it, each its own tap: the source's mark, the red countdown and the bid
/// (live lots with a bid reading). A tap anywhere else opens the car, as before.
struct ExploreHeroCard: View {
    let item: ExploreFeedItem
    var hasBidReading = false
    var onDrill: ((ExploreCardDrill) -> Void)? = nil

    var body: some View {
        NukeHeroCard(imageURL: NukeImage.thumb(item.image, width: 1080), title: item.title,
                     subtitle: item.subtitle, pills: item.sourceLogoURL == nil ? [item.source] : [],
                     sourceLogoURL: item.sourceLogoURL, sourceName: item.source,
                     sourceDoor: onDrill.map { AnyView(door(.source, onDrill: $0)) }) {
            HStack(alignment: .bottom) {
                if let amt = item.amount {
                    if let onDrill, hasBidReading, item.kind == .live {
                        ExploreDoor(kind: .bid, item: item, open: onDrill) { amount(amt) }
                    } else {
                        amount(amt)
                    }
                }
                Spacer(minLength: NukeSpace.sm)
                if item.endsAt != nil {
                    TimelineView(.periodic(from: .now, by: 60)) { ctx in
                        if let left = item.timeLeft(now: ctx.date) {
                            if let onDrill {
                                ExploreDoor(kind: .clock, item: item, alignment: .bottomTrailing, open: onDrill) { clock(left) }
                            } else {
                                clock(left)
                            }
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: onDrill == nil ? .combine : .contain)
    }

    private func amount(_ amt: Double) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(item.amountLabel)
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
            Text(LiveBoardView.bidNumber(amt))
                .font(.nukeBigNumber)
                .foregroundStyle(.white)
        }
    }

    private func clock(_ left: String) -> some View {
        NukePill(text: left, icon: "clock", onPhoto: true, textColor: Color.red)
    }

    /// The source door wraps the mark (or the source's text pill when no mark is known).
    private func door(_ kind: ExploreCardDrill.Kind, onDrill: @escaping (ExploreCardDrill) -> Void) -> some View {
        ExploreDoor(kind: kind, item: item, open: onDrill) {
            if let url = item.sourceLogoURL { NukeSourceLogo(url: url, name: item.source) } else { NukePill(text: item.source) }
        }
    }
}
