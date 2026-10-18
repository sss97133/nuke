// The existing auction_calendar_read roster, continued on demand. No persisted cache,
// cohort calculation or inferred sale result: totals and contributors stay on that read.
import Foundation

struct AuctionCalendarRoster {
    enum ReceiptError: LocalizedError, Equatable {
        case wrongPage, changedRoster

        var errorDescription: String? {
            switch self {
            case .wrongPage: return "The reader did not return the requested roster page. Refresh the roster."
            case .changedRoster: return "The retained roster changed between pages. Refresh to read its current lots."
            }
        }
    }

    let house: String
    let saleKey: String
    private(set) var rows: [AuctionCalendar.RosterLot] = []
    private(set) var total: Int?
    private(set) var builtAt: String?
    private(set) var readAt: String?
    private(set) var nextOffset: Int?
    private(set) var continuationUnavailable = false

    /// Validates before mutation, preserving earlier pages on a failed refresh or continuation.
    /// Offset is the server's consumed row count, never a locally estimated population.
    mutating func accept(_ response: AuctionCalendar, requestedOffset: Int) throws {
        guard let page = response.roster, page.house == house, page.sale_key == saleKey,
              page.offset == requestedOffset, page.lots >= 0, requestedOffset >= 0,
              page.rows.count <= AuctionCalendar.rosterPageSize,
              Set(page.rows.map(\.event_id)).count == page.rows.count else {
            throw ReceiptError.wrongPage
        }
        if requestedOffset > 0 {
            guard nextOffset == requestedOffset, total == page.lots,
                  let builtAt, ProfileClock.date(builtAt) != nil,
                  builtAt == response.population.lots_built_at,
                  readAt?.prefix(10) == response.as_of.prefix(10),
                  Set(rows.map(\.event_id)).isDisjoint(with: page.rows.map(\.event_id)) else {
                throw ReceiptError.changedRoster
            }
        }
        guard requestedOffset + page.rows.count <= page.lots else { throw ReceiptError.wrongPage }
        rows = requestedOffset == 0 ? page.rows : rows + page.rows
        total = page.lots
        builtAt = response.population.lots_built_at
        readAt = response.as_of
        let consumed = requestedOffset + page.rows.count
        let remaining = consumed < page.lots
        // An empty page or unknown build clock cannot certify a complete/stable continuation.
        continuationUnavailable = remaining && (page.rows.isEmpty || ProfileClock.date(builtAt) == nil)
        nextOffset = remaining && !continuationUnavailable ? consumed : nil
    }
}

extension AuctionCalendar {
    private static let houseHosts: [String: String] = [
        "mecum": "mecum.com", "gooding": "goodingco.com",
        "barrett-jackson": "barrett-jackson.com", "barrettjackson": "barrett-jackson.com",
        "rm-sothebys": "rmsothebys.com", "bonhams": "bonhams.com",
        "broad_arrow": "broadarrowauctions.com", "broad-arrow": "broadarrowauctions.com",
        "bat": "bringatrailer.com", "cars_and_bids": "carsandbids.com",
        "pcarmarket": "pcarmarket.com", "collecting_cars": "collectingcars.com"
    ]
    private static let usHouses: Set<String> = [
        "mecum", "barrett-jackson", "barrettjackson", "bat", "cars_and_bids", "pcarmarket"
    ]

    /// The web's houseLink rule. A recorded URL is not automatically a source-house link.
    static func houseLink(house: String, value: String?) -> URL? {
        guard let value, let url = URL(string: value), let expected = houseHosts[house],
              url.scheme?.lowercased() == "https", url.user == nil, url.password == nil, url.port == nil,
              let host = url.host?.lowercased(), host == expected || host.hasSuffix("." + expected) else { return nil }
        return url
    }

    /// Same public nominal amounts as AuctionCalendar.tsx; an unknown currency stays explicit.
    /// Nil remains nil, including any amount withheld by the reader.
    static func money(_ amount: Double?, currency: String?, house: String) -> String? {
        guard let amount, amount.isFinite else { return nil }
        let code = currency ?? (usHouses.contains(house) ? "USD" : nil)
        let value = amount.rounded().formatted(.number.locale(Locale(identifier: "en_US")).precision(.fractionLength(0)))
        if code == "USD" { return "$" + value }
        return code.map { "\($0) \(value)" } ?? "\(value) (currency unrecorded)"
    }

    /// Calendar dates do not become midnight instants or minute-precision countdowns.
    static func dayLabel(_ day: String?) -> String {
        guard let day, !day.isEmpty else { return "undated" }
        return day
    }

    static func runTimer(_ day: String, now: Date = Date()) -> String {
        let days = daysUntil(day, now: now)
        return days < 0 ? "ran" : days == 0 ? "runs today" : days == 1 ? "runs tomorrow" : "runs in \(days) days"
    }

    /// Source-write clock, not the time the phone made its request (useAuctionCalendar.ts).
    static func updatedAgo(_ at: String?, now: Date = Date()) -> String {
        guard let at = ProfileClock.date(at) else { return "update time unrecorded" }
        let minutes = max(0, Int(now.timeIntervalSince(at) / 60))
        if minutes < 1 { return "updated just now" }
        if minutes < 60 { return "updated \(minutes) min ago" }
        let hours = minutes / 60
        return hours < 48 ? "updated \(hours) h ago" : "updated \(hours / 24) days ago"
    }
}

extension AuctionCalendar.RosterLot {
    func estimateText(house: String) -> String? {
        let low = AuctionCalendar.money(estimate_low, currency: currency, house: house)
        let high = AuctionCalendar.money(estimate_high, currency: currency, house: house)
        switch (low, high) {
        case let (low?, high?): return "\(low) to \(high)"
        case let (low?, nil): return "from \(low)"
        case let (nil, high?): return "up to \(high)"
        case (nil, nil): return nil
        }
    }
}

extension AuctionCalendar.PriorResult {
    var sourceLink: URL? { AuctionCalendar.houseLink(house: house, value: url) }

    var outcomeText: String {
        let price = AuctionCalendar.money(amount, currency: currency, house: house)
        switch outcome {
        case "sold" where basis != "source": return "\(price ?? "no amount") recorded, result unconfirmed"
        case "sold": return "sold" + (price.map { " \($0)" } ?? ", amount unrecorded")
        case "not_sold": return "not sold" + (price.map { ", high bid \($0)" } ?? "")
        case "listed": return "listed" + (price.map { " at \($0)" } ?? "")
        default: return outcome.replacingOccurrences(of: "_", with: " ") + (price.map { ", \($0) recorded" } ?? "")
        }
    }
}
