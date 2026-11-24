// ExploreFeed.swift — Explore's passive landing: one scrolling full-bleed feed of real
// records, no scores. Two existing reads, fetched together:
//   • market_pulse_live      → open auction lots (current bid, time left)
//   • classified_ask_board   → classified listings seen in the last 72 h (asking price)
// Every card is facts the record carries: photo, identity, the recorded amount and what
// kind of amount it is, the clock, the source. A read that fails or comes back empty
// hides its cards; the feed only shows an error when both reads fail.
// The feed pages (ExploreFeedPaging): every open lot is read at once and revealed 40 at a time, asks are read
// 40 at a time by offset, and the next page starts six cards before the end. It ends with a plain line only
// when both are exhausted. The projection board fills in the rails after the cards are up.

import SwiftUI
import UIKit

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
    /// The listing's own clock for a classified: "posted" (posted_at) or "listed" (listed_at); nil when it has neither.
    var postedAt: Date? = nil
    var postedWord: String? = nil
    /// The listing's mileage; nil when the odometer is recorded as broken.
    var miles: Double? = nil
    /// Where the listing is, rounded to 0.01° by the read (classified rows only).
    var lat: Double? = nil
    var lng: Double? = nil
    /// The row's cohort placement (classified rows only); the buyer's page reads it through ExploreAnalytics.
    var position: AskPosition? = nil
    /// When the read that produced this classified card was made (the board's as_of), for the "why" stack.
    var asOf: Date? = nil

    /// The vehicle id a live lot's finish estimate is keyed by (the card id without its "live:" prefix).
    var lotId: String? {
        kind == .live && id.hasPrefix("live:") ? String(id.dropFirst(5)) : nil
    }

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
                        link: row.sourceLink,
                        postedAt: ProfileClock.date(row.posted_at) ?? ProfileClock.date(row.listed_at),
                        postedWord: ProfileClock.date(row.posted_at) != nil ? "posted"
                            : (ProfileClock.date(row.listed_at) != nil ? "listed" : nil),
                        miles: row.odometer == "broken" ? nil : row.miles,
                        lat: row.lat, lng: row.lng, position: row.position)
    }
}

/// How the feed pages. Pure, so the rules are unit-tested (ExploreFeedTests).
enum ExploreFeedPaging {
    static let livePage = 40
    static let askPage = 40
    static let tunedAskPage = 100
    /// The next page starts loading when a card this close to the end appears.
    static let lookahead = 6
    /// Pages read in a row that add no card (all tuned out, hidden or already shown) before the feed waits.
    static let maxEmptyPages = 5

    static func shouldLoadMore(appeared index: Int, count: Int) -> Bool {
        count > 0 && index >= count - lookahead
    }

    /// The ask board returned fewer rows than asked: it has no more.
    static func exhausted(read: Int, asked: Int) -> Bool { read < asked }

    static func nextCards(live: [ExploreFeedItem], classified: [ExploreFeedItem], existing: Set<String>,
                          prefs: ExplorePreferences) -> [ExploreFeedItem] {
        ExplorePreferences.apply(ExploreFeedItem.interleave(live: live, classified: classified), prefs)
            .filter { !existing.contains($0.id) }
    }

    static func endLine(tuned: Bool) -> String {
        tuned ? "That's every car with a photo that matches your tuning: open auction lots and asks from the last 72 hours. Pull down to refresh."
              : "That's every car with a photo: every open auction lot and every ask from the last 72 hours. Pull down to refresh."
    }
}

struct ExploreFeedView: View {
    @State private var live: [ExploreFeedItem] = []
    @State private var classified: [ExploreFeedItem] = []
    /// The cards as shown: the two reads interleaved, then the person's saved choices applied, then this
    /// session's more / less / hide moves.
    @State private var feed: [ExploreFeedItem] = []
    @State private var prefs = ExplorePreferences.load()
    @State private var loaded = false
    @State private var liveFailed = false
    @State private var askFailed = false
    /// The open lots behind live cards, by card id: the bid door hands the lot to the bid reading.
    @State private var lots: [String: LiveAuction] = [:]
    @State private var drill: ExploreCardDrill?
    /// A tap on a photo or the comments button; pushes the same profile the card has always opened.
    @State private var openVehicle: VehicleHeaderRow?
    /// Browse's explicit filters (kept on the phone) and the sheet that sets them.
    @State private var tuning = ExploreTuning.load()
    @State private var showTune = false
    /// The projected-hammer board, read once per feed load; each lot's reading is looked up in it.
    @State private var finish: FinishBoard?
    @State private var why: ExploreWhy?
    @State private var openCohort: CohortTarget?
    /// Paging. The live board is one read of every open lot, so its cards are revealed a page at a time; asks are
    /// read a page at a time with the board's offset. A new load (refresh, tuning) starts a new generation and
    /// any page still in flight from the old one is dropped.
    @State private var liveAll: [ExploreFeedItem] = []
    @State private var liveShown = 0
    @State private var askOffset = 0
    @State private var askExhausted = true
    @State private var loadingMore = false
    @State private var moreFailed = false
    @State private var generation = 0

    var body: some View {
        VStack(spacing: 0) {
            if loaded { tuneBar }
            content
        }
        .sheet(isPresented: $showTune) {
            ExploreTuningSheet(current: tuning, onApply: applyTuning)
        }
        .sheet(item: $why) { w in
            ExploreWhySheet(why: w, onCohort: showCohort)
        }
    }

    /// A slider icon above the cards; a dot says a filter is on.
    private var tuneBar: some View {
        HStack {
            Spacer()
            Button { showTune = true } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "slider.horizontal.3").font(.system(size: 18))
                    if tuning.isActive {
                        Circle().fill(Color.accentColor).frame(width: 8, height: 8).offset(x: 5, y: -3)
                    }
                }
                .frame(width: NukeSize.minTap, height: NukeSize.minTap)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Tune Browse"))
            .accessibilityValue(Text(tuning.isActive ? "Filters on" : "No filters"))
        }
        .padding(.horizontal, NukeSpace.lg)
    }

    @ViewBuilder private var content: some View {
        Group {
            if !loaded {
                // Shimmering cards in the shape of the real ones: the page looks alive while it loads.
                NukeFeedSkeleton(message: "Finding cars for you…")
            } else if feed.isEmpty {
                if tuning.isActive && !(liveFailed && askFailed) {
                    NukeEmptyState(icon: "slider.horizontal.3", title: "Nothing matches your tuning",
                                   message: "Widen the place, era or price, or clear them.",
                                   actionTitle: "Clear tuning") { applyTuning(ExploreTuning()) }
                } else if liveFailed && askFailed {
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
                        ForEach(Array(feed.enumerated()), id: \.element.id) { idx, item in
                            ExplorePagerCard(item: item, position: idx, hasBidReading: lots[item.id] != nil,
                                             finish: item.lotId.flatMap { finish?.byId[$0] },
                                             finishFresh: finish?.fresh == true,
                                             onDrill: openDrill, onOpenProfile: openProfile, onChoice: choose,
                                             onWhy: openWhy)
                                .onAppear { prefetch(after: idx) }
                        }
                        pagingFooter
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
                .navigationDestination(item: $openVehicle) { v in
                    // The same push Explore's other cards make (ExploreView's VehicleHeaderRow destination).
                    VehicleDetailView(vehicleId: v.id.uuidString.lowercased(),
                                      embedInNavigationStack: false).environment(\.vehicleListingContext, true)
                }
                .navigationDestination(item: $openCohort) { c in
                    // The existing cohort instrument, as ExploreView's CohortTarget destination builds it.
                    CohortTerminalView(make: c.make, model: c.model, year: c.year)
                }
                .onDisappear { Task { await ExploreSignalLog.shared.flushIfEnabled() } }
            }
        }
        .task { if !loaded { await load() } }
    }

    private var hasMore: Bool { liveShown < liveAll.count || !askExhausted }

    /// The end of the cards: loading the next page, a retry when it failed, or a plain end.
    @ViewBuilder private var pagingFooter: some View {
        if loadingMore {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, NukeSpace.lg)
        } else if moreFailed {
            Button {
                moreFailed = false
                Task { await loadMore() }
            } label: {
                Label("Couldn't load more cars. Try again", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: NukeSize.minTap)
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, NukeSpace.lg)
        } else if !hasMore {
            Text(ExploreFeedPaging.endLine(tuned: tuning.isActive))
                .font(.footnote).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, NukeSpace.xl).padding(.vertical, NukeSpace.lg)
        }
    }

    private var footer: String {
        var parts: [String] = []
        if !live.isEmpty { parts.append("Current bids are Bring a Trailer's, in US dollars — not sold prices.") }
        if !classified.isEmpty { parts.append("An asking price is what the seller listed when we saw it, not a sale.") }
        return parts.joined(separator: " ")
    }

    private func openDrill(_ d: ExploreCardDrill) { drill = d }

    private func openWhy(_ item: ExploreFeedItem) {
        why = ExploreWhy(item: item, estimate: item.lotId.flatMap { finish?.byId[$0] }, fresh: finish?.fresh == true)
    }

    /// The stack's cohort row: close the sheet, then push the cohort page.
    private func showCohort(_ target: CohortTarget) {
        why = nil
        Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            openCohort = target
        }
    }

    /// A changed filter is kept, reloads the reads and is logged by name (never by value).
    private func applyTuning(_ new: ExploreTuning) {
        let changed = new.changedFields(from: tuning)
        guard !changed.isEmpty else { return }
        tuning = new
        new.save()
        let event = ExploreSignalEvent.makeTune(changed)
        Task { await ExploreSignalLog.shared.append(event) }
        Task { await load() }
    }

    /// Opens the car's profile when the card has a vehicle; otherwise the card's own listing link (as before).
    private func openProfile(_ item: ExploreFeedItem) {
        if let uuid = item.vehicleId {
            openVehicle = VehicleHeaderRow(id: uuid, year: item.year, make: item.make, model: item.model, trim: nil,
                                           primary_image_url: item.image, city: item.location, state: nil)
        } else if let link = item.link {
            UIApplication.shared.open(link)
        }
    }

    /// More, less or hide: the feed changes now, and the choice is kept for every later load.
    private func choose(_ choice: ExploreSignalEvent.Choice, _ item: ExploreFeedItem) {
        let key = ExplorePreferences.key(item)
        withAnimation(.easeInOut(duration: 0.25)) {
            switch choice {
            case .more:
                if let key {
                    prefs.prefer(key)
                    feed = ExplorePreferences.promote(feed, after: item.id, key: key)
                }
            case .less:
                if let key { prefs.avoid(key) }
                prefs.hide(item.id)
                feed = ExplorePreferences.demote(feed, removing: item.id, key: key)
            case .hide:
                prefs.hide(item.id)
                feed = ExplorePreferences.removing(feed, id: item.id)
            }
        }
        prefs.save()
    }

    private func prefetch(after idx: Int) {
        let all = feed
        if ExploreFeedPaging.shouldLoadMore(appeared: idx, count: all.count) { Task { await loadMore() } }
        guard idx + 1 < all.count else { return }
        for j in (idx + 1)..<min(idx + 4, all.count) {
            if let u = NukeImage.thumb(all[j].image, width: 1080) {
                Task(priority: .utility) { _ = await RemoteImageCache.shared.image(u, maxPixel: 1280) }
            }
        }
    }

    private func load() async {
        generation += 1
        let gen = generation
        let tune = tuning
        async let l = Self.readLive()
        async let a = Self.readClassified(tune, offset: 0)
        let (lr, ar) = await (l, a)
        guard gen == generation else { return }
        liveFailed = lr == nil
        askFailed = ar == nil
        lots = Dictionary((lr ?? []).map { ($0.item.id, $0.lot) }, uniquingKeysWith: { first, _ in first })
        liveAll = tune.apply(lr?.map { $0.item } ?? [])
        live = Array(liveAll.prefix(ExploreFeedPaging.livePage))
        liveShown = live.count
        classified = tune.apply(ar?.items ?? [])
        askOffset = ar?.read ?? 0
        askExhausted = ar.map { ExploreFeedPaging.exhausted(read: $0.read, asked: $0.asked) } ?? true
        moreFailed = false
        feed = ExplorePreferences.apply(ExploreFeedItem.interleave(live: live, classified: classified), prefs)
        loaded = true
        // The projection board only fills in the lots' rails (about 220 KB); the cards don't wait for it.
        let board = await FinishBoard.fetch()
        guard gen == generation else { return }
        finish = board
    }

    /// The next page: the next slice of open lots and the next page of asks, interleaved, with the saved choices
    /// applied and no card already in the feed. A page the tuning or the choices empty out reads on, a few pages
    /// at most, so the feed never stalls on a filtered-out page.
    private func loadMore() async {
        guard loaded, !loadingMore, !moreFailed, hasMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        let gen = generation
        let tune = tuning
        for _ in 0..<ExploreFeedPaging.maxEmptyPages {
            let nextLive = Array(liveAll.dropFirst(liveShown).prefix(ExploreFeedPaging.livePage))
            var nextAsks: [ExploreFeedItem] = []
            var read = 0, asked = 0
            if !askExhausted {
                guard let page = await Self.readClassified(tune, offset: askOffset) else {
                    if gen == generation { moreFailed = true }
                    return
                }
                nextAsks = tune.apply(page.items)
                read = page.read
                asked = page.asked
            }
            guard gen == generation else { return }
            liveShown += nextLive.count
            if !askExhausted {
                askOffset += read
                askExhausted = ExploreFeedPaging.exhausted(read: read, asked: asked)
            }
            live += nextLive
            classified += nextAsks
            let fresh = ExploreFeedPaging.nextCards(live: nextLive, classified: nextAsks,
                                                    existing: Set(feed.map(\.id)), prefs: prefs)
            feed += fresh
            if !fresh.isEmpty || !hasMore { return }
        }
    }

    /// Every open lot, soonest to end first. The feed reveals them a page at a time (ExploreFeedPaging.livePage).
    private static func readLive() async -> [(item: ExploreFeedItem, lot: LiveAuction)]? {
        guard let board = try? await LiveBoard.fetch() else { return nil }
        return board.open(at: Date())
            .sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
            .map { (ExploreFeedItem.from($0), $0) }
    }

    /// One page of asks from `offset`: the cards, how many rows the board returned and how many were asked for
    /// (fewer returned than asked means the board has no more).
    private static func readClassified(_ tune: ExploreTuning, offset: Int) async
        -> (items: [ExploreFeedItem], read: Int, asked: Int)? {
        let place = tune.place
        // A filter applied here to rows already read needs more rows to land on.
        let limit = tune.hasLocalFilters ? ExploreFeedPaging.tunedAskPage : ExploreFeedPaging.askPage
        guard let board = try? await AskBoard.fetch(hours: 72, sort: .newest, limit: limit, offset: offset,
                                                    lat: place?.lat, lng: place?.lng, radiusMiles: place?.radius) else { return nil }
        let asOf = ProfileClock.date(board.as_of)
        let items = board.rows.map { row -> ExploreFeedItem in
            var card = ExploreFeedItem.from(row)
            card.asOf = asOf
            return card
        }
        return (items, board.rows.count, limit)
    }
}

/// What sits on a photo page: the amount and what kind it is (the bid is a door for a live lot with a
/// bid reading), and the red countdown (a door). Shared by the pager card and the plain hero card.
struct ExploreCardOverlay: View {
    let item: ExploreFeedItem
    var hasBidReading = false
    var onDrill: ((ExploreCardDrill) -> Void)? = nil
    /// The price rail for the amount (nil keeps the bare amount) and what a long press on it does.
    var rail: ExplorePriceRail? = nil
    var onWhy: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .bottom) {
            if let amt = item.amount {
                if let onDrill, hasBidReading, item.kind == .live {
                    ExploreDoor(kind: .bid, item: item, open: onDrill) { price(amt) }
                } else {
                    price(amt)
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

    @ViewBuilder private func price(_ amt: Double) -> some View {
        if let rail {
            if let onWhy {
                ExplorePriceRailView(item: item, rail: rail)
                    .highPriorityGesture(LongPressGesture(minimumDuration: 0.45).onEnded { _ in onWhy() })
            } else {
                ExplorePriceRailView(item: item, rail: rail)
            }
        } else {
            amount(amt)
        }
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
}

/// The source door: the mark (or the source's text pill when no mark is known) as one tap target.
struct ExploreSourceDoor: View {
    let item: ExploreFeedItem
    let onDrill: (ExploreCardDrill) -> Void

    var body: some View {
        ExploreDoor(kind: .source, item: item, open: onDrill) {
            if let url = item.sourceLogoURL { NukeSourceLogo(url: url, name: item.source) } else { NukePill(text: item.source) }
        }
    }
}

/// A large rounded photo with the price on it and the car's name beneath. No scores.
/// Three doors sit on it, each its own tap: the source's mark, the red countdown and the bid
/// (live lots with a bid reading). The feed now uses ExplorePagerCard; this single-photo card remains
/// for any caller that wants one photo.
struct ExploreHeroCard: View {
    let item: ExploreFeedItem
    var hasBidReading = false
    var onDrill: ((ExploreCardDrill) -> Void)? = nil

    var body: some View {
        NukeHeroCard(imageURL: NukeImage.thumb(item.image, width: 1080), title: item.title,
                     subtitle: item.subtitle, pills: item.sourceLogoURL == nil ? [item.source] : [],
                     sourceLogoURL: item.sourceLogoURL, sourceName: item.source,
                     sourceDoor: onDrill.map { AnyView(ExploreSourceDoor(item: item, onDrill: $0)) }) {
            ExploreCardOverlay(item: item, hasBidReading: hasBidReading, onDrill: onDrill)
        }
        .accessibilityElement(children: onDrill == nil ? .combine : .contain)
    }
}
