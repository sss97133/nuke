// ExplorePages.swift — the pure rules behind Explore's swipe pager and its "more / less like this" choices.
//
// A card is a row of pages: the car's photos, then (when the record has them) a map, a buyer's reading
// and the original listing. Which pages exist, what the reading says and how a choice reorders the feed
// are decided here, with no views and no network, so each rule is unit-tested.
//
// The buyer's reading places an ask only with a cohort of real sales behind it: `AskPlacement` (the
// Captured listings' own wording) when the row's `position` has at least five sales and is not marked
// thin. Anything thinner says so in words and shows no figure.

import Foundation

enum ExplorePageKind: String, Equatable {
    case photos, location, analytics, listing
}

// MARK: Which pages a card has

enum ExplorePagePlan {
    /// A point the map can honestly be centred on: finite, in range and not the (0, 0) placeholder.
    static func hasCoordinates(_ item: ExploreFeedItem) -> Bool {
        guard let lat = item.lat, let lng = item.lng, lat.isFinite, lng.isFinite else { return false }
        guard (-90.0...90.0).contains(lat), (-180.0...180.0).contains(lng) else { return false }
        return !(lat == 0 && lng == 0)
    }

    /// The kinds of page for a card, in order. Photos always lead (the cover is on every card).
    /// - location: only with coordinates (classified rows carry them rounded to 0.01°; a live lot has none).
    /// - analytics: a classified always has one (it places the ask or says it cannot); a live lot only when
    ///   the record has something the photo page does not say (its listed date).
    /// - listing: only with a link.
    static func kinds(for item: ExploreFeedItem, now: Date = Date()) -> [ExplorePageKind] {
        var out: [ExplorePageKind] = [.photos]
        if hasCoordinates(item) { out.append(.location) }
        switch item.kind {
        case .classified: out.append(.analytics)
        case .live: if ExploreAnalytics.reading(for: item, now: now).listed != nil { out.append(.analytics) }
        }
        if item.link != nil { out.append(.listing) }
        return out
    }
}

// MARK: The buyer's reading

struct ExploreAnalyticsReading: Equatable {
    /// The ask's place among the cohort's sales (classified, enough sales only).
    var placement: AskPlacement?
    /// Said instead of a figure when the ask cannot be placed.
    var placementNote: String?
    /// "posted 3h ago" (classified, when the listing carries its own clock).
    var age: String?
    /// "Mileage 27% below the sold median (85,000 mi)" (needs a cohort with enough sales).
    var mileage: String?
    /// "Listed Nov 3, 2026" and "7 days" (live lots).
    var listed: String?
    var length: String?

    var isEmpty: Bool {
        placement == nil && placementNote == nil && age == nil && mileage == nil && listed == nil && length == nil
    }
}

enum ExploreAnalytics {
    static let notEnoughSales = "Not enough sales to place this ask"
    static let minSales = 5

    /// The row's cohort when it can be shown as a number: at least five sales, the active slice not marked
    /// thin, and sales as its basis (the copy says "sales"; a cohort of other listings' asks is not placed).
    static func usableCohort(_ pos: AskPosition?) -> AskPosition? {
        guard let pos, pos.sales >= minSales else { return nil }
        let slices = [pos.sold, pos.asked].compactMap { $0 }
        switch pos.basis {
        case "asked": return nil
        case "sold":
            guard let sold = pos.sold else { return nil }
            return sold.thin != true && sold.n >= minSales ? pos : nil
        default:
            if slices.isEmpty { return pos }
            return slices.contains { $0.thin != true && $0.n >= minSales } ? pos : nil
        }
    }

    /// "just now", "12m ago", "3h ago", "4d ago". A clock in the future reads as "just now".
    static func ago(_ date: Date, now: Date) -> String {
        let s = Int(now.timeIntervalSince(date))
        if s < 60 { return "just now" }
        if s < 3600 { return "\(s / 60)m ago" }
        if s < 86_400 { return "\(s / 3600)h ago" }
        return "\(s / 86_400)d ago"
    }

    /// The car's mileage against the cohort's sold median, said once and without repeating the car's own
    /// mileage (the card's line under the title carries it).
    static func mileage(miles: Double?, cohort: AskPosition?) -> String? {
        guard let miles, miles.isFinite, miles > 0, let cohort else { return nil }
        let median: Double?
        if let m = cohort.sold?.miles, m.n >= minSales, let p = m.p50, p > 0 {
            median = p
        } else if cohort.sold == nil, cohort.asked == nil, let mm = cohort.median_miles, mm > 0 {
            median = mm
        } else {
            median = nil
        }
        guard let median, median.isFinite else { return nil }
        let diff = (miles - median) / median
        let pct = Int((abs(diff) * 100).rounded())
        let med = Int(median.rounded()).formatted()
        if pct < 3 { return "Mileage is near the sold median (\(med) mi)" }
        return "Mileage \(pct)% \(diff < 0 ? "below" : "above") the sold median (\(med) mi)"
    }

    static func reading(for item: ExploreFeedItem, now: Date) -> ExploreAnalyticsReading {
        var r = ExploreAnalyticsReading()
        switch item.kind {
        case .classified:
            let cohort = usableCohort(item.position)
            if let ask = item.amount {
                if let cohort, let place = AskPlacement.placement(pos: cohort, ask: ask) {
                    r.placement = place
                } else {
                    r.placementNote = notEnoughSales
                }
            } else {
                r.placementNote = "No asking price is recorded to place."
            }
            if let posted = item.postedAt {
                r.age = "\(item.postedWord ?? "posted") \(ago(posted, now: now))"
            }
            r.mileage = mileage(miles: item.miles, cohort: cohort)
        case .live:
            if let listed = item.listedAt {
                r.listed = "Listed " + listed.formatted(date: .abbreviated, time: .omitted)
                r.length = ExploreCardDrill.runLength(listed: listed, ends: item.endsAt)
            }
        }
        return r
    }
}

// MARK: More / less / hide

/// What the person told the feed, kept on the phone (UserDefaults) and applied to every later load.
/// A taste key is "make|model" in lower case; the model part is empty when the card has none.
struct ExplorePreferences: Codable, Equatable {
    var hidden: [String] = []
    var more: [String] = []
    var less: [String] = []

    static let hiddenCap = 500
    static let keyCap = 100
    static let defaultsKey = "explore.preferences.v1"

    static func key(make: String?, model: String?) -> String? {
        let mk = (make ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !mk.isEmpty else { return nil }
        let md = (model ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return mk + "|" + md
    }

    static func key(_ item: ExploreFeedItem) -> String? { key(make: item.make, model: item.model) }

    private static func parts(_ key: String) -> (make: String, model: String) {
        let p = key.split(separator: "|", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        return (p.first ?? "", p.count > 1 ? p[1] : "")
    }

    /// "More like this": the make, and the model too when the card has one.
    static func matchesMore(_ item: ExploreFeedItem, key: String) -> Bool {
        guard let k = Self.key(item) else { return false }
        let want = parts(key), have = parts(k)
        guard want.make == have.make else { return false }
        return want.model.isEmpty || want.model == have.model
    }

    /// "Less like this": exactly this make and model (a card with no model matches only model-less cards).
    static func matchesExactly(_ item: ExploreFeedItem, key: String) -> Bool {
        Self.key(item) == key
    }

    private static func capped(_ list: [String], _ cap: Int) -> [String] {
        list.count > cap ? Array(list.suffix(cap)) : list
    }

    /// The latest word on a taste wins: preferring a key drops it from `less` and the other way round.
    mutating func prefer(_ key: String) {
        less.removeAll { $0 == key }
        more.removeAll { $0 == key }
        more = Self.capped(more + [key], Self.keyCap)
    }

    mutating func avoid(_ key: String) {
        more.removeAll { $0 == key }
        less.removeAll { $0 == key }
        less = Self.capped(less + [key], Self.keyCap)
    }

    mutating func hide(_ id: String) {
        hidden.removeAll { $0 == id }
        hidden = Self.capped(hidden + [id], Self.hiddenCap)
    }

    /// The feed as a later load shows it: hidden cards and "less" tastes dropped, "more" tastes ahead of the
    /// rest. Order inside each group is kept. Uses only the rows already read.
    static func apply(_ items: [ExploreFeedItem], _ prefs: ExplorePreferences) -> [ExploreFeedItem] {
        let hidden = Set(prefs.hidden)
        let kept = items.filter { item in
            if hidden.contains(item.id) { return false }
            return !prefs.less.contains { matchesExactly(item, key: $0) }
        }
        guard !prefs.more.isEmpty else { return kept }
        let favoured = kept.filter { item in prefs.more.contains { matchesMore(item, key: $0) } }
        let favouredIds = Set(favoured.map(\.id))
        return favoured + kept.filter { !favouredIds.contains($0.id) }
    }

    /// Now: the cards after `id` that match the taste move up to sit right behind it. Cards at or before it
    /// are treated as seen and stay where they are.
    static func promote(_ items: [ExploreFeedItem], after id: String, key: String) -> [ExploreFeedItem] {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return items }
        let head = Array(items[...idx])
        let tail = Array(items[(idx + 1)...])
        let matching = tail.filter { matchesMore($0, key: key) }
        let rest = tail.filter { !matchesMore($0, key: key) }
        return head + matching + rest
    }

    /// Now: this card and the not-yet-seen cards of the same make and model leave the feed.
    static func demote(_ items: [ExploreFeedItem], removing id: String, key: String?) -> [ExploreFeedItem] {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return items }
        return items.enumerated().compactMap { i, item in
            if i == idx { return nil }
            if let key, i > idx, matchesExactly(item, key: key) { return nil }
            return item
        }
    }

    static func removing(_ items: [ExploreFeedItem], id: String) -> [ExploreFeedItem] {
        items.filter { $0.id != id }
    }

    static func load(defaults: UserDefaults = .standard) -> ExplorePreferences {
        guard let data = defaults.data(forKey: defaultsKey),
              let prefs = try? JSONDecoder().decode(ExplorePreferences.self, from: data) else { return ExplorePreferences() }
        return prefs
    }

    func save(defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.defaultsKey) }
    }
}

// MARK: Photos

enum ExplorePhotos {
    /// Every photo of a card is read, but never more than this.
    static let cap = 60

    /// The cover first, then the vehicle's other photos once each, at most `cap`.
    static func urls(cover: String?, reel: [GarageReelPhoto], cap: Int = ExplorePhotos.cap) -> [String] {
        Array(GarageCardReads.pages(cover: cover, reel: reel).map(\.url).prefix(cap))
    }

    /// "3 / 14", only once the whole reel is known and there is more than one photo.
    static func counter(index: Int, total: Int, reelKnown: Bool) -> String? {
        guard reelKnown, total > 1 else { return nil }
        return "\(min(max(index, 0), total - 1) + 1) / \(total)"
    }
}
