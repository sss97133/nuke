// ExploreFeed.swift — Explore's passive landing: one scrolling full-bleed feed of real
// records, no scores. Two existing reads, fetched together:
//   • market_pulse_live      → open auction lots (current bid, time left)
//   • classified_ask_board   → classified listings seen in the last 72 h (asking price)
// Every card is facts the record carries: photo, identity, the recorded amount and what
// kind of amount it is, the clock, the source. A read that fails or comes back empty
// hides its cards; a failed source is named and can be retried.
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
    /// A live lot's last record write (the board's updated_at): the bid on the card is no newer than this.
    var recordUpdatedAt: Date? = nil

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
                        // No listedAt: the board's listed_at is vehicles.created_at (when Nuke first wrote the row), not
                        // when bidding opened, so no "listed" date or auction length is derived from it.
                        link: lot.listingUrl.flatMap { URL(string: $0) },
                        recordUpdatedAt: ProfileClock.date(lot.updatedAt))
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
        tuned ? "End of these results matching your tuning: open auction lots and asks from the last 72 hours. Pull down to refresh."
              : "End of these results: open auction lots and asks from the last 72 hours. Pull down to refresh."
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
    @State private var liveFailure: String?
    @State private var askFailure: String?
    /// The open lots behind live cards, by card id: the bid door hands the lot to the bid reading.
    @State private var lots: [String: LiveAuction] = [:]
    @State private var drill: ExploreCardDrill?
    /// A tap on a photo or title opens the vehicle profile.
    @State private var openVehicle: VehicleHeaderRow?
    @State private var discussion: ExploreFeedItem?
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
    @State private var reloading = false
    @State private var loadingMore = false
    @State private var moreFailure: String?
    @State private var morePaused = false
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
        .sheet(item: $discussion) { item in
            if let vehicleId = item.vehicleId {
                VehicleDiscussionSheet(vehicleId: vehicleId.uuidString.lowercased(),
                                       listingURL: item.link, listingSource: item.source)
            }
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
                if loadingMore {
                    ProgressView("Looking for more cars…")
                } else if liveFailed && askFailed {
                    NukeEmptyState(icon: "wifi.exclamationmark", title: "We couldn't load cars",
                                   message: "Auctions: \(liveFailure ?? "Read failed.") Classifieds: \(askFailure ?? "Read failed.")",
                                   actionTitle: "Try again") { Task { await load() } }
                } else if let missingSource {
                    NukeEmptyState(icon: "wifi.exclamationmark", title: "Some cars couldn't load",
                                   message: "\(missingSource.title) \(missingSource.reason)",
                                   actionTitle: "Try again") { Task { await load() } }
                } else if let moreFailure {
                    if morePaused && liveShown < liveAll.count {
                        NukeEmptyState(icon: "magnifyingglass", title: "More auctions to check",
                                       message: "Classified listings couldn't load. \(moreFailure)",
                                       actionTitle: "Search more auctions") { Task { await loadMore() } }
                    } else {
                        NukeEmptyState(icon: "wifi.exclamationmark", title: "Couldn't load more cars",
                                       message: moreFailure,
                                       actionTitle: "Try again") {
                            self.moreFailure = nil
                            Task { await loadMore() }
                        }
                    }
                } else if hasMore {
                    NukeEmptyState(icon: "magnifyingglass", title: "More listings to check",
                                   message: "No cars to show in the pages checked so far.",
                                   actionTitle: "Search more") { Task { await loadMore() } }
                } else if tuning.isActive {
                    NukeEmptyState(icon: "slider.horizontal.3", title: "Nothing matches your tuning",
                                   message: "Widen the place, era or price, or clear them.",
                                   actionTitle: "Clear tuning") { applyTuning(ExploreTuning()) }
                } else {
                    NukeEmptyState(icon: "photo.on.rectangle.angled", title: "No cars to show yet",
                                   message: "New cars with photos appear here as they're listed. Check back soon.",
                                   actionTitle: "Refresh") { Task { await load() } }
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: NukeSpace.xl) {
                        if let missingSource {
                            HStack(spacing: NukeSpace.sm) {
                                Image(systemName: "wifi.exclamationmark")
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(missingSource.title).font(.subheadline)
                                    Text(missingSource.reason).font(.caption).foregroundStyle(.secondary)
                                        .accessibilityIdentifier("browse-source-failure-detail")
                                }
                                Spacer(minLength: 0)
                                Button("Retry") { Task { await load() } }
                                    .accessibilityLabel("Retry Browse")
                            }
                            .padding(NukeSpace.md)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: NukeRadius.card))
                            .padding(.horizontal, NukeSpace.lg)
                        }
                        ForEach(Array(feed.enumerated()), id: \.element.id) { idx, item in
                            ExplorePagerCard(item: item, position: idx, hasBidReading: lots[item.id] != nil,
                                             finish: item.lotId.flatMap { finish?.byId[$0] },
                                             finishFresh: finish?.fresh == true,
                                             onDrill: openDrill, onOpenProfile: openProfile,
                                             onOpenDiscussion: { discussion = $0 }, onChoice: choose,
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
        .task(id: generation) { await watchClosing() }
    }

    /// While a card's lot is in its last minutes or just past its recorded end, re-read the board every 20 s so a
    /// soft-close extension (the house resets the clock when a late bid lands) or a new bid reaches the card. The
    /// board itself is rebuilt every 2 minutes, so the card also says how old the bid on record is.
    private func watchClosing() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard !Task.isCancelled, loaded else { continue }
            guard ExploreClock.needsRefresh(feed, now: ServerClock.now()) else { continue }
            guard let board = try? await LiveBoard.fetch(maxAge: 15), !Task.isCancelled else { continue }
            let byId = Dictionary(board.auctions.map { ("live:" + $0.id, $0) }, uniquingKeysWith: { first, _ in first })
            feed = feed.map { item in
                guard item.kind == .live, let lot = byId[item.id] else { return item }
                return ExploreFeedItem.from(lot)
            }
            for (key, lot) in byId where lots[key] != nil { lots[key] = lot }
        }
    }

    private var hasMore: Bool { liveShown < liveAll.count || !askExhausted }
    private var liveFailed: Bool { liveFailure != nil }
    private var askFailed: Bool { askFailure != nil }
    private var moreFailed: Bool { moreFailure != nil }
    private var missingSource: (title: String, reason: String)? {
        if let liveFailure, !askFailed { return ("Auction listings couldn't load.", liveFailure) }
        if let askFailure, !liveFailed { return ("Classified listings couldn't load.", askFailure) }
        return nil
    }

    /// The end of the cards: loading the next page, a retry when it failed, or a plain end.
    @ViewBuilder private var pagingFooter: some View {
        if loadingMore {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, NukeSpace.lg)
        } else if let moreFailure {
            VStack(spacing: NukeSpace.xs) {
                Text(moreFailure).font(.caption).foregroundStyle(.secondary)
                Button {
                    self.moreFailure = nil
                    Task { await loadMore() }
                } label: {
                    Label("Couldn't load more classified listings. Try again", systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: NukeSize.minTap)
                }
                .buttonStyle(.bordered)
                if morePaused && liveShown < liveAll.count {
                    Button("Search more auctions") { Task { await loadMore() } }
                        .frame(maxWidth: .infinity, minHeight: NukeSize.minTap)
                        .buttonStyle(.bordered)
                }
            }
            .padding(.horizontal, NukeSpace.lg)
        } else if morePaused && hasMore {
            Button("Search more") { Task { await loadMore() } }
                .frame(maxWidth: .infinity, minHeight: NukeSize.minTap)
                .buttonStyle(.bordered)
                .padding(.horizontal, NukeSpace.lg)
        } else if !hasMore && !liveFailed && !askFailed {
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
        reloading = true
        loadingMore = false
        defer { if gen == generation { reloading = false } }
        let tune = tuning
        async let l = Self.readLive()
        async let a = Self.readClassified(tune, offset: 0)
        let (lr, ar) = await (l, a)
        guard !Task.isCancelled, gen == generation else { return }
        let liveRows: [(item: ExploreFeedItem, lot: LiveAuction)]
        switch lr {
        case .success(let rows): liveRows = rows; liveFailure = nil
        case .failure(let error): liveRows = []; liveFailure = ReadFailure.text(error)
        }
        let askPage: (items: [ExploreFeedItem], read: Int, asked: Int)?
        switch ar {
        case .success(let page): askPage = page; askFailure = nil
        case .failure(let error): askPage = nil; askFailure = ReadFailure.text(error)
        }
        lots = Dictionary(liveRows.map { ($0.item.id, $0.lot) }, uniquingKeysWith: { first, _ in first })
        liveAll = tune.apply(liveRows.map { $0.item })
        live = Array(liveAll.prefix(ExploreFeedPaging.livePage))
        liveShown = live.count
        classified = tune.apply(askPage?.items ?? [])
        askOffset = askPage?.read ?? 0
        askExhausted = askPage.map { ExploreFeedPaging.exhausted(read: $0.read, asked: $0.asked) } ?? true
        moreFailure = nil
        morePaused = false
        feed = ExplorePreferences.apply(ExploreFeedItem.interleave(live: live, classified: classified), prefs)
        loaded = true
        reloading = false
        // With no visible first-page cards, no card can trigger prefetch. Continue
        // through the same bounded empty-page search used while scrolling.
        if feed.isEmpty && hasMore { await loadMore() }
        guard !Task.isCancelled, gen == generation else { return }
        // The projection board only fills in the lots' rails (about 220 KB); the cards don't wait for it.
        let board = await FinishBoard.fetch()
        guard gen == generation else { return }
        finish = board
    }

    /// The next page: the next slice of open lots and the next page of asks, interleaved, with the saved choices
    /// applied and no card already in the feed. A page the tuning or the choices empty out reads on, a few pages
    /// at most, so the feed never stalls on a filtered-out page.
    private func loadMore() async {
        guard loaded, !reloading, !loadingMore, hasMore,
              !moreFailed || liveShown < liveAll.count else { return }
        let gen = generation
        loadingMore = true
        morePaused = false
        defer { if gen == generation { loadingMore = false } }
        let tune = tuning
        for _ in 0..<ExploreFeedPaging.maxEmptyPages {
            let nextLive = Array(liveAll.dropFirst(liveShown).prefix(ExploreFeedPaging.livePage))
            var nextAsks: [ExploreFeedItem] = []
            var read = 0, asked = 0
            if !askExhausted && !moreFailed {
                switch await Self.readClassified(tune, offset: askOffset) {
                case .failure(let error):
                    guard !Task.isCancelled, gen == generation else { return }
                    moreFailure = ReadFailure.text(error)
                case .success(let page):
                    nextAsks = tune.apply(page.items)
                    read = page.read
                    asked = page.asked
                }
            }
            guard !Task.isCancelled, gen == generation else { return }
            liveShown += nextLive.count
            if !askExhausted && !moreFailed {
                askOffset += read
                askExhausted = ExploreFeedPaging.exhausted(read: read, asked: asked)
            }
            live += nextLive
            classified += nextAsks
            let fresh = ExploreFeedPaging.nextCards(live: nextLive, classified: nextAsks,
                                                    existing: Set(feed.map(\.id)), prefs: prefs)
            feed += fresh
            if !fresh.isEmpty || !hasMore || (moreFailed && liveShown >= liveAll.count) { return }
        }
        if !Task.isCancelled, gen == generation, hasMore,
           !moreFailed || liveShown < liveAll.count { morePaused = true }
    }

    /// Every open lot, soonest to end first. The feed reveals them a page at a time (ExploreFeedPaging.livePage).
    private static func readLive() async -> Result<[(item: ExploreFeedItem, lot: LiveAuction)], Error> {
        do {
            let board = try await LiveBoard.fetch()
            return .success(board.open(at: Date())
                .sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
                .map { (ExploreFeedItem.from($0), $0) })
        } catch { return .failure(error) }
    }

    /// One page of asks from `offset`: the cards, how many rows the board returned and how many were asked for
    /// (fewer returned than asked means the board has no more).
    private static func readClassified(_ tune: ExploreTuning, offset: Int) async
        -> Result<(items: [ExploreFeedItem], read: Int, asked: Int), Error> {
        let place = tune.place
        // A filter applied here to rows already read needs more rows to land on.
        let limit = tune.hasLocalFilters ? ExploreFeedPaging.tunedAskPage : ExploreFeedPaging.askPage
        do {
            let board = try await AskBoard.fetch(hours: 72, sort: .newest, limit: limit, offset: offset,
                                                 lat: place?.lat, lng: place?.lng, radiusMiles: place?.radius)
            let asOf = ProfileClock.date(board.as_of)
            let items = board.rows.map { row -> ExploreFeedItem in
                var card = ExploreFeedItem.from(row)
                card.asOf = asOf
                return card
            }
            return .success((items, board.rows.count, limit))
        } catch { return .failure(error) }
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
                priceButton(amt)
            }
            Spacer(minLength: NukeSpace.sm)
            if let ends = item.endsAt {
                // Ticks against the server's clock (ServerClock): every second in the last hour, where it reads m:ss,
                // and every 30 s before that, where it shows hours and minutes.
                TimelineView(.periodic(from: .now, by: ExploreClock.tick(ends: ends, now: ServerClock.now()))) { ctx in
                    let now = ServerClock.now(ctx.date)
                    let text = ExploreClock.text(ends: ends, now: now)
                    if let onDrill {
                        ExploreDoor(kind: .clock, item: item, alignment: .bottomTrailing, open: onDrill) { clock(text) }
                    } else {
                        clock(text)
                    }
                }
            }
        }
    }

    /// The price is a button: a tap opens the evidence behind it ("Why this range"; a live lot without that
    /// stack opens its bid reading). It looks like one: a chip with a chevron, not a number painted on a photo.
    @ViewBuilder private func priceButton(_ amt: Double) -> some View {
        let action: (() -> Void)? = onWhy ?? {
            guard let onDrill, hasBidReading, item.kind == .live else { return nil }
            return { onDrill(ExploreCardDrill(kind: .bid, item: item)) }
        }()
        if let action {
            Button {
                Haptics.drill(depth: 1)
                action()
            } label: {
                priceChip(amt, tappable: true)
            }
            .buttonStyle(ExplorePriceButtonStyle())
            .accessibilityHint(Text("Shows the evidence behind this price."))
        } else {
            priceChip(amt, tappable: false)
        }
    }

    private func priceChip(_ amt: Double, tappable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(priceLabel)
                    .font(.system(.caption, design: .rounded).weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
                if tappable {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.white.opacity(0.85))
                }
            }
            if let rail {
                ExplorePriceRailView(item: item, rail: rail, showsLabel: false)
            } else {
                Text(LiveBoardView.bidNumber(amt))
                    .font(.nukeBigNumber)
                    .foregroundStyle(.white)
            }
        }
        .padding(.horizontal, tappable ? 10 : 0)
        .padding(.vertical, tappable ? 8 : 0)
        .background {
            if tappable {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.black.opacity(0.35))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.white.opacity(0.25), lineWidth: 0.5))
            }
        }
        .frame(minHeight: NukeSize.minTap)
        .contentShape(Rectangle())
    }

    /// In a lot's last hour the label says how old the bid on record is, since the board is rebuilt every
    /// 2 minutes and the house's bid can move faster than that.
    private var priceLabel: String {
        guard item.kind == .live, let ends = item.endsAt else { return item.amountLabel }
        let now = ServerClock.now()
        guard ends.timeIntervalSince(now) < 3600, let at = item.recordUpdatedAt else { return item.amountLabel }
        return "Bid on record · " + ExploreAnalytics.ago(at, now: now)
    }

    private func clock(_ text: String) -> some View {
        NukePill(text: text, icon: "clock", onPhoto: true, textColor: Color.red)
            .monospacedDigit()
    }
}

/// A pressed price chip sinks a little; the tap lands as a button, not as decoration.
struct ExplorePriceButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// The card's countdown. Pure, so it is unit-tested (ExploreFeedTests).
enum ExploreClock {
    /// "2d 4h", "3h 12m", then "12:07" in the last hour. At or past the recorded end it reads "Closing": the
    /// house may have extended the close for a late bid, and the card waits for the board to say.
    static func text(ends: Date, now: Date) -> String {
        let s = Int(ends.timeIntervalSince(now).rounded(.down))
        if s <= 0 { return "Closing" }
        if s < 3600 { return String(format: "%d:%02d", s / 60, s % 60) }
        if s < 86_400 { return "\(s / 3600)h \((s % 3600) / 60)m" }
        return "\(s / 86_400)d \((s % 86_400) / 3600)h"
    }

    /// How often the card's clock redraws.
    static func tick(ends: Date, now: Date) -> TimeInterval { ends.timeIntervalSince(now) < 3600 ? 1 : 30 }

    /// A lot within 3 minutes of its recorded end, or up to 15 minutes past it, needs a fresh board read.
    static func needsRefresh(_ items: [ExploreFeedItem], now: Date) -> Bool {
        items.contains { item in
            guard item.kind == .live, let ends = item.endsAt else { return false }
            let left = ends.timeIntervalSince(now)
            return left < 180 && left > -900
        }
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
