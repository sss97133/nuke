// LiveBoard.swift — the open board, read from the same door as the web Market tab.
//
// nuke.ag's Market tab stands on `market_pulse_live()` for open lots: one call, the whole board,
// with the clock it was read at (`synced_at`) and the sentence naming its source. The rows are
// compact positional arrays (supabase/migrations/20260927193000_market_pulse_live_board.sql);
// nuke_frontend/src/pages/market/useMarketPulse.ts is the web's decoder and this file keeps the
// same positions. The phone shows the board as a list that ends soonest first, with the count,
// the source and the clock above it, so "one spot for listings" (owner anchor O15) is one spot
// on the phone too: the same population, the same clock, nothing invented in between.

import SwiftUI
import Supabase

/// One open lot, as the board returns it.
struct LiveAuction: Decodable, Identifiable {
    let id: String
    let year: Int?
    let make: String?
    let model: String?
    let currentBid: Double?
    let endsAt: String?
    let updatedAt: String?
    let listedAt: String?
    let imageUrl: String?
    let noReserve: Bool
    let listingUrl: String?
    let title: String?
    /// Expected-price band from comparable sales on the lot's model page; nil when the lot is not priced.
    /// Parsed once at decode time: the list sorts on it, and parsing an ISO string per
    /// comparison cost about 100 ms of main thread per evaluation over 1,100 lots.
    let endsAtDate: Date?
    let listedAtDate: Date?
    /// The expected-price band (positions 12 to 16) from comparable BaT sales on the lot's model
    /// page (scripts/market/live-bands.mjs), present only when p10, p50 and p90 all came, as
    /// useMarketPulse.ts maps it. The web renders it inside the heat reading, not as a graded
    /// band on the row; the phone does the same.
    struct Band { let p10: Double; let p50: Double; let p90: Double; let tier: String; let comps: Int }
    let band: Band?

    /// One row is a positional array; a value whose type drifted is read as missing, never
    /// as a reason to drop the whole board (the web coerces with Number()).
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        // Each helper consumes exactly one position. A null is consumed by decodeNil; a value of
        // the wrong type is consumed by AnyValue. (The first version used decodeIfPresent under
        // `try?`, whose flattened nil could not tell "null" from "threw", so a null was consumed
        // twice and every field after it shifted one place: a lot with no image URL read its
        // listing URL as its title and its band one position off. Caught by the band test, 2026-10-13.)
        // A value of the wrong shape, scalar or not, is consumed by a reader that reads nothing
        // (AnyValue), so the next helper always sees the next position (review round two, 2026-10-13:
        // an object in a slot had emptied the rest of the row).
        func skip() { _ = try? c.decode(AnyValue.self) }
        func str() -> String? {
            if (try? c.decodeNil()) == true { return nil }
            if let s = try? c.decode(String.self) { return s }
            skip(); return nil
        }
        /// A finite number, from a number or a numeric string; "nan", "inf" and 1e400 read as missing.
        func num() -> Double? {
            if (try? c.decodeNil()) == true { return nil }
            if let d = try? c.decode(Double.self) { return d.isFinite ? d : nil }
            if let s = try? c.decode(String.self) { return Double(s).flatMap { $0.isFinite ? $0 : nil } }
            skip(); return nil
        }
        /// An integer only when in range, so a huge value never traps in Int(_:).
        func int() -> Int? { num().flatMap { abs($0) < 1e15 ? Int($0) : nil } }
        func bool() -> Bool {
            if (try? c.decodeNil()) == true { return false }
            if let b = try? c.decode(Bool.self) { return b }
            skip(); return false
        }
        id = try c.decode(String.self)
        year = int()
        make = str()
        model = str()
        currentBid = num()
        endsAt = str()
        updatedAt = str()
        listedAt = str()
        imageUrl = str()
        noReserve = bool()
        listingUrl = str()
        title = str()
        let p10 = num(), p50 = num(), p90 = num(), tier = str(), comps = int()
        if let p10, let p50, let p90 { band = Band(p10: p10, p50: p50, p90: p90, tier: tier ?? "", comps: comps ?? 0) } else { band = nil }
        endsAtDate = ProfileClock.date(endsAt)
        listedAtDate = ProfileClock.date(listedAt)
    }

    // ─── Hot / cold: the bid against where comparable sales usually sit at this point in the
    // auction, exactly MarketPulse.tsx heatOf (#1064): the curve gives, per price tier, the median
    // share of the final price that sold cars had been bid to with this many hours left; typical
    // now = band p50 × that share; hot at 1.25× typical or more, cold at 0.8× or less; past 120 h
    // the curve rests on thin early data, so no verdict. The track record of lots tagged this way
    // is typed into the web page today, not carried by any read; the phone shows the tag and the
    // reading and leaves that sentence until a read carries it (market lane, 2026-10-13).
    struct Heat {
        enum State { case hot, cold, inLine }
        let ratio: Double, state: State, typicalNow: Double, share: Double, hoursLeft: Double
    }
    static let heatMaxHours = 120.0, hotAt = 1.25, coldAt = 0.8

    func heat(curve: BidCurve?, at now: Date) -> Heat? {
        guard let curve, let band, let bid = currentBid, bid.isFinite, bid > 0, let ends = endsAtDate else { return nil }
        let hoursLeft = ends.timeIntervalSince(now) / 3600
        guard hoursLeft > 0, hoursLeft <= Self.heatMaxHours else { return nil }
        guard let share = curve.share(tier: band.tier, hours: hoursLeft), share > 0, band.p50 > 0 else { return nil }
        let typical = band.p50 * share
        let ratio = bid / typical
        return Heat(ratio: ratio, state: ratio >= Self.hotAt ? .hot : ratio <= Self.coldAt ? .cold : .inLine,
                    typicalNow: typical, share: share, hoursLeft: hoursLeft)
    }

    /// Only a row with a real vehicle id can navigate; a malformed id is skipped, never replaced by a random one.
    var vehicleUUID: UUID? { UUID(uuidString: id) }

    /// The listing's own title, else the identity the board carries. BaT publishes titles
    /// with HTML entities ("Chairs &#038; Flares"); the few that occur are decoded here.
    var headline: String {
        if let t = title, !t.isEmpty { return Self.decodeEntities(t) }
        return [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ")
    }

    static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = s
        for (code, ch) in [("&#038;", "&"), ("&amp;", "&"), ("&#8217;", "\u{2019}"), ("&#8216;", "\u{2018}"),
                           ("&#8220;", "\u{201C}"), ("&#8221;", "\u{201D}"), ("&quot;", "\""), ("&#039;", "'"),
                           ("&lt;", "<"), ("&gt;", ">"), ("&#8211;", "\u{2013}"), ("&#8212;", "\u{2014}")] {
            out = out.replacingOccurrences(of: code, with: ch)
        }
        return out
    }
}

/// A value of any JSON shape, consumed and discarded when a position is not what the row promised.
struct AnyValue: Decodable { init(from decoder: Decoder) throws {} }

/// An array whose undecodable elements are skipped and counted instead of failing the whole array.
struct LossyArray<Element: Decodable>: Decodable {
    let elements: [Element]
    let skipped: Int
    private struct Any_: Decodable { init(from decoder: Decoder) throws {} }
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [Element] = []
        var bad = 0
        while !c.isAtEnd {
            if let e = try? c.decode(Element.self) { out.append(e) } else { _ = try? c.decode(Any_.self); bad += 1 }
        }
        elements = out; skipped = bad
    }
}

/// The board: its clock, its source sentence and its lots.
/// Per price tier, [hours left, median share of the final price bid by then], hours descending.
/// Measured on 36,700 BaT sales (migration 20260927230000). A malformed curve reads as absent.
struct BidCurve: Decodable {
    let tiers: [String: [[Double]]]
    init(from decoder: Decoder) throws {
        tiers = (try? decoder.singleValueContainer().decode([String: [[Double]]].self)) ?? [:]
    }
    /// The web's curveAt: clamp to the measured hours, interpolate between the two marks around it.
    func share(tier: String, hours: Double) -> Double? {
        guard let pts = tiers[tier], !pts.isEmpty, pts.allSatisfy({ $0.count >= 2 }) else { return nil }
        let h = max(pts[pts.count - 1][0], min(pts[0][0], hours))
        for i in 0..<(pts.count - 1) {
            let (h1, v1, h2, v2) = (pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
            if h <= h1, h >= h2, h1 != h2 { return v1 + ((v2 - v1) * (h1 - h)) / (h1 - h2) }
        }
        return pts[pts.count - 1][1]
    }
}

/// The board a week ago (BAT-LIVE-BIDS index reading): bids across the board and the lot count
/// at that hour, from the live reading or rebuilt from BaT bid history ("archive").
struct WeekAgo: Decodable {
    let at: String?, bids: Double?, n: Int?, source: String?
    private enum K: String, CodingKey { case at, bids, n, source }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        at = try? c.decodeIfPresent(String.self, forKey: .at)
        bids = (try? c.decodeIfPresent(Double.self, forKey: .bids)) ?? nil
        n = (try? c.decodeIfPresent(Int.self, forKey: .n)) ?? nil
        source = try? c.decodeIfPresent(String.self, forKey: .source)
    }
}
struct Baseline: Decodable {
    let week_ago: WeekAgo?
    private enum K: String, CodingKey { case week_ago }
    init(from decoder: Decoder) throws {
        week_ago = (try? decoder.container(keyedBy: K.self).decodeIfPresent(WeekAgo.self, forKey: .week_ago)) ?? nil
    }
}

struct LiveBoard: Decodable {
    let synced_at: String?
    let source: String?
    private let rows: LossyArray<LiveAuction>
    let curve: BidCurve?
    let baseline: Baseline?
    var auctions: [LiveAuction] { rows.elements }
    var skippedRows: Int { rows.skipped }
    var weekAgo: WeekAgo? { baseline?.week_ago.flatMap { $0.bids == nil ? nil : $0 } }

    private enum CodingKeys: String, CodingKey { case synced_at, source, rows = "auctions", curve, baseline }

    /// `synced_at` is max(vehicles.updated_at) over live rows: the last record write by any
    /// writer, not the source read time (which the board does not carry). The web says both;
    /// so does the phone, and warns when that write clock is more than 45 minutes behind.
    var syncedAtDate: Date? { ProfileClock.date(synced_at) }
    static let staleAfter: TimeInterval = 45 * 60

    /// Lots still open at `now`, the web's count (`endsAt > now`): a lot that closed since the
    /// last poll is not an open lot, and neither is one with no recorded end time (the web's
    /// `Date.parse(null) > now` is false).
    func open(at now: Date) -> [LiveAuction] {
        auctions.filter { lot in
            guard let end = lot.endsAtDate else { return false }
            return end > now
        }
    }

    /// The population line (fleet-relative reporting): how many open lots, the record clock
    /// and what it is, the source read time's absence, and a lag warning when it applies.
    func coverageSentence(at now: Date) -> String {
        let clock = syncedAtDate.map { d -> String in
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "MMM d, HH:mm"
            return f.string(from: d) + "Z"
        } ?? "clock missing"
        var parts = ["\(open(at: now).count.formatted()) open lots",
                     "record updated \(clock) by a writer · source read time unavailable"]
        if let d = syncedAtDate, now.timeIntervalSince(d) > Self.staleAfter { parts.append("recent record writes are behind") }
        if skippedRows > 0 { parts.append("\(skippedRows) rows unreadable, skipped") }
        return parts.joined(separator: " · ")
    }

    // One read per 30 seconds across lens switches, as the web caches it (useMarketPulse staleTime).
    private static var cached: (board: LiveBoard, at: Date)?
    static func fetch(maxAge: TimeInterval = 30) async throws -> LiveBoard {
        if let c = cached, Date().timeIntervalSince(c.at) < maxAge { return c.board }
        let res = try await SupabaseService.client.rpc("market_pulse_live").execute()
        try BoardContract.check(res.data)       // a renamed or moved slot stops the read (BoardContract.swift)
        let board = try JSONDecoder().decode(LiveBoard.self, from: res.data)
        cached = (board, Date())
        return board
    }
}

// MARK: - Model 32/33 Live Finish Estimates (useFinishEstimates.ts twin)

struct FinishEstimate: Equatable {
    let vehicleId: String
    let estimate: Double
    let low: Double
    let high: Double
    let grade: String? // "A", "B", "C"
    let coverage: Double?
    let sentence: String?
    let estimatedAt: Date
    let bidAtEstimate: Double?
    let compsThrough: String?
}

struct FinishAnalog: Equatable, Identifiable {
    let url: String?
    let title: String
    let closed: String?
    let bid: Double?
    let finalPrice: Double?
    let outcome: String?
    var id: String { "\(title)|\(closed ?? "")|\(url ?? "")" }
}

struct FinishBoard: Equatable {
    let fresh: Bool
    let writerAt: Date?
    let byId: [String: FinishEstimate]

    static func decode(_ data: Data) -> FinishBoard {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return FinishBoard(fresh: false, writerAt: nil, byId: [:])
        }
        let fresh = (obj["fresh"] as? Bool) == true
        let writerAt = (obj["writer_at"] as? String).flatMap(ProfileClock.date)
        let cols = (obj["columns"] as? [Any])?.map { String(describing: $0) } ?? []
        func at(_ name: String) -> Int? { cols.firstIndex(of: name) }
        func num(_ x: Any?) -> Double? {
            if let d = x as? Double, d.isFinite { return d }
            if let i = x as? Int { return Double(i) }
            if let s = x as? String, !s.trimmingCharacters(in: .whitespaces).isEmpty, let d = Double(s), d.isFinite { return d }
            return nil
        }
        func str(_ x: Any?) -> String? {
            guard let s = x as? String else { return nil }
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        var byId: [String: FinishEstimate] = [:]
        if fresh, let rows = obj["rows"] as? [[Any]] {
            for row in rows {
                func get(_ name: String) -> Any? {
                    guard let idx = at(name), idx < row.count else { return nil }
                    return row[idx]
                }
                guard let id = str(get("vehicle_id")),
                      let est = num(get("estimate")),
                      let lo = num(get("low")),
                      let hi = num(get("high")),
                      let estAtStr = str(get("estimated_at")),
                      let estAt = ProfileClock.date(estAtStr),
                      lo <= est, est <= hi else { continue }
                let gRaw = str(get("grade"))
                let grade = (gRaw == "A" || gRaw == "B" || gRaw == "C") ? gRaw : nil
                byId[id] = FinishEstimate(
                    vehicleId: id,
                    estimate: est,
                    low: lo,
                    high: hi,
                    grade: grade,
                    coverage: num(get("coverage")),
                    sentence: str(get("sentence")),
                    estimatedAt: estAt,
                    bidAtEstimate: num(get("bid_at_estimate")),
                    compsThrough: str(get("comps_through"))
                )
            }
        }
        return FinishBoard(fresh: fresh, writerAt: writerAt, byId: byId)
    }

    static func decodeAnalogs(_ data: Data, vehicleId: String) -> [FinishAnalog] {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let analogsMap = obj["analogs"] as? [String: Any],
              let list = analogsMap[vehicleId] as? [[String: Any]] else { return [] }
        func num(_ x: Any?) -> Double? {
            if let d = x as? Double, d.isFinite { return d }
            if let i = x as? Int { return Double(i) }
            if let s = x as? String, !s.trimmingCharacters(in: .whitespaces).isEmpty, let d = Double(s), d.isFinite { return d }
            return nil
        }
        func str(_ x: Any?) -> String? {
            guard let s = x as? String else { return nil }
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        return list.compactMap { o in
            guard let title = str(o["title"]) else { return nil }
            let rawUrl = str(o["url"])
            let validUrl = (rawUrl?.hasPrefix("https://bringatrailer.com/listing/") == true) ? rawUrl : nil
            return FinishAnalog(
                url: validUrl,
                title: title,
                closed: str(o["closed"]),
                bid: num(o["bid"]),
                finalPrice: num(o["final"]),
                outcome: str(o["outcome"])
            )
        }
    }

    static func fetch() async -> FinishBoard? {
        guard let res = try? await SupabaseService.client.rpc("live_finish_estimates").execute() else { return nil }
        return decode(res.data)
    }

    private struct AnalogParams: Encodable { let p_vehicle_ids: [String] }
    static func fetchAnalogs(vehicleId: String) async -> [FinishAnalog] {
        guard let res = try? await SupabaseService.client
            .rpc("live_finish_estimates", params: AnalogParams(p_vehicle_ids: [vehicleId]))
            .execute() else { return [] }
        return decodeAnalogs(res.data, vehicleId: vehicleId)
    }
}

// MARK: - Auction Calendar (useAuctionCalendar.ts twin)

struct AuctionCalendar: Decodable, Equatable {
    struct RunDay: Decodable, Equatable, Identifiable {
        let day: String
        let lots: Int
        var id: String { day }
    }
    struct PriorSale: Decodable, Equatable {
        let sale_key: String
        let lots: Int
        let vehicle_lots: Int?
        let sold: Int?
        let bid_goes_on: Int?
        let median_price: Double?
        let ends_on: String?
    }
    struct CalendarSale: Decodable, Equatable, Identifiable {
        let house: String
        let sale_key: String
        let sale_name: String
        let location: String?
        let starts_on: String
        let ends_on: String
        let lots: Int
        let seen_before: Int
        let no_reserve: Int
        let first_seen_at: String?
        let first_seen_7d: Int
        let updated_at: String?
        let run_days: [RunDay]
        let lots_listed: Int?
        let listed_at: String?
        let prior_sale: PriorSale?

        var id: String { "\(house)|\(sale_key)" }
    }
    struct UnplacedSale: Decodable, Equatable, Identifiable {
        let house: String
        let sale_key: String
        let sale_name: String
        let lots_listed: Int
        let listed_at: String?
        var id: String { "\(house)|\(sale_key)" }
    }
    struct PriorResult: Decodable, Equatable, Identifiable {
        let house: String
        let on: String?
        let outcome: String
        let amount: Double?
        let currency: String?
        let basis: String?
        let url: String?
        var id: String { "\(house)|\(on ?? "")|\(outcome)|\(amount ?? 0)" }
    }
    struct RosterLot: Decodable, Equatable, Identifiable {
        let event_id: String
        let vehicle_id: String
        let source_url: String?
        let lot_number: String?
        let run_on: String
        let year: Int?
        let make: String?
        let model: String?
        let image: String?
        let vin_present: Bool?
        let has_reserve: Bool?
        let estimate_low: Double?
        let estimate_high: Double?
        let currency: String?
        let first_seen_at: String?
        let prior: [PriorResult]?

        var id: String { event_id }
        var vehicleUUID: UUID? { UUID(uuidString: vehicle_id) }
        var title: String {
            let ym = [year.map(String.init), make, model].compactMap { $0 }.joined(separator: " ")
            return ym.isEmpty ? "Consigned lot" : ym
        }
    }
    struct Roster: Decodable, Equatable {
        let house: String
        let sale_key: String
        let lots: Int
        let offset: Int
        let rows: [RosterLot]
    }
    struct Population: Decodable, Equatable {
        let lots: Int
        let sales: Int
        let houses: Int
        let seen_before: Int
        let no_reserve: Int
        let first_seen_7d: Int
        let updated_at: String?
        let listed: Int?
        /// Snapshot of the lot read model, distinct from the source-write and request clocks.
        let lots_built_at: String?
    }

    let as_of: String
    let horizon_days: Int
    let population: Population
    let sales: [CalendarSale]
    let unplaced: [UnplacedSale]?
    let roster: Roster?

    static let houseNames: [String: String] = [
        "mecum": "Mecum",
        "gooding": "Gooding & Co",
        "barrett-jackson": "Barrett-Jackson",
        "barrettjackson": "Barrett-Jackson",
        "rm-sothebys": "RM Sotheby's",
        "bonhams": "Bonhams",
        "broad_arrow": "Broad Arrow",
        "broad-arrow": "Broad Arrow",
        "bat": "Bring a Trailer",
        "cars_and_bids": "Cars & Bids",
        "pcarmarket": "PCarMarket",
        "collecting_cars": "Collecting Cars"
    ]

    static func houseName(_ house: String) -> String {
        houseNames[house] ?? house
    }

    static func daysUntil(_ day: String, now: Date = Date()) -> Int {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return 0 }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let compsNow = Calendar.current.dateComponents([.year, .month, .day], from: now)
        guard let targetUTC = cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
              let todayUTC = cal.date(from: DateComponents(year: compsNow.year, month: compsNow.month, day: compsNow.day)) else {
            return 0
        }
        return Int((targetUTC.timeIntervalSince(todayUTC) / 86_400.0).rounded())
    }

    static func saleTimer(startsOn: String, endsOn: String, now: Date = Date()) -> String {
        let toStart = daysUntil(startsOn, now: now)
        let toEnd = daysUntil(endsOn, now: now)
        if toEnd < 0 { return "ended" }
        if toStart <= 0 {
            let total = toEnd - toStart + 1
            let today = 1 - toStart
            return total > 1 ? "running · day \(today) of \(total)" : "running today"
        }
        return toStart == 1 ? "tomorrow" : "in \(toStart) days"
    }

    static func priorSaleLine(house: String, prior: PriorSale?) -> String? {
        guard let prior, prior.lots > 0 else { return nil }
        let name = prior.sale_key.split(separator: "-").map { w -> String in
            let s = String(w)
            if Int(s) != nil { return s }
            return s.prefix(1).uppercased() + s.dropFirst()
        }.joined(separator: " ")
        let base = "\(houseName(house)) ran \(prior.lots.formatted()) lots at \(name)"
        if let vLots = prior.vehicle_lots, vLots > 0, let sold = prior.sold {
            let pct = Int((Double(sold) * 100.0 / Double(vLots)).rounded())
            return "\(base) · \(pct)% of its vehicles sold"
        }
        return base
    }

    static let rosterPageSize = 100
    private struct Params: Encodable {
        let p_days: Int
        let p_house: String?
        let p_sale_key: String?
        let p_limit: Int
        let p_offset: Int
    }

    static func fetch(house: String? = nil, saleKey: String? = nil, offset: Int = 0) async throws -> AuctionCalendar {
        try await SupabaseService.client
            .rpc("auction_calendar_read", params: Params(p_days: 200, p_house: house, p_sale_key: saleKey, p_limit: rosterPageSize, p_offset: offset))
            .execute()
            .value
    }
}

// MARK: - Sources Board (SourcesBoard.tsx twin)

enum LandingHorizon: String, CaseIterable, Identifiable {
    case d14 = "14d"
    case h24 = "24h"
    case h1 = "1h"
    var id: String { rawValue }
}

struct SourcesBoardData: Equatable {
    struct BoardLandingMeta: Equatable {
        let hour: String?
        let bucket5m: String?
        let landed15m: Int
        let landed1h: Int
        let landed24: Int
        let landed7: Int
        let hours24: [Int]
        let mins60: [Int]
    }

    /// An earlier labelled reference graded by the exact census that followed it; error is (reference − census) / census.
    struct PopulationGrade: Equatable {
        let reference: Int
        let referenceMethod: String
        let referenceAt: String?
        let census: Int
        let censusAt: String?
        let error: Double
    }

    /// What share of the source's own total we hold, in words that keep the total's method (SourcesBoard.tsx heldShare).
    struct HeldShare: Equatable {
        /// nil when the source's total is unknown: the bar is drawn hatched, never filled from a guess.
        let share: Double?
        let text: String
        /// A labelled reference's kind and as-of day ("owner reference · Oct 17"); nil for a census.
        var reference: String? = nil
    }

    struct SourceRow: Equatable, Identifiable {
        let source: String
        let name: String
        let category: String?
        let house: String?
        let held: Int?
        let heldAt: String?
        let population: Int?
        let populationMethod: String?
        let populationConfidence: Double?
        var populationAt: String? = nil
        var populationGrade: PopulationGrade? = nil
        let mapSales: Int?
        let mapUsd: Double?
        let sales12: Int?
        let usd12: Double?
        let salesPrior12: Int?
        let usdPrior12: Double?
        let live: Int
        var landed15m: Int = 0
        var landed1h: Int = 0
        let landed24: Int
        let landed7: Int
        let lastLanded: String?
        var days14: [Int] = []
        var hours24: [Int] = []
        var mins60: [Int] = []
        let logoUrl: String?
        let businessType: String?
        var species: String? = nil
        var speciesLabel: String? = nil
        var countsAsHeld: Bool? = nil

        var id: String { source }

        /// Use the reader's evidenced source kind; a source's name cannot establish its type.
        var typeLabel: String? {
            if let label = speciesLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty { return label }
            switch species ?? category ?? businessType {
            case "timed_auction": return "Timed auction"
            case "block_house": return "Auction house"
            case "online_auction": return "Online auction"
            case "auction", "auction_house": return "Auction house"
            case "dealer": return "Dealer / consignor"
            case "classifieds": return "Classifieds"
            case "marketplace", "auth_walled_marketplace": return "Marketplace"
            case "aggregator": return "Aggregator"
            default: return nil
            }
        }

        /// Labelled references in source_census: a figure someone supplied or a catalogue estimated, never a count of
        /// the source (data-machine.md, fleet-relative reporting). They print as estimates with their kind and as-of day.
        static let referenceKinds: [String: String] = [
            "owner_reference": "owner reference",
            "catalogue_estimate": "catalogue estimate",
            "estimate": "earlier estimate",
        ]
        static let methodNotes: [String: String] = [
            "owner_reference": "owner reference, an estimate, not a count",
            "catalogue_estimate": "catalogue estimate, not a count",
            "estimate": "earlier estimate, not a count",
            "enumerated": "counted from their own listings",
            "bounded": "estimated within a range",
            "search_index": "from their search index",
            "api_count": "from their API total",
            "sitemap": "from their sitemap index",
            "docket_and_broadcast_census": "from docket & broadcast census",
            "window_extrapolated": "extrapolated from cohort window & gap density",
            "turnover_model": "modeled from active inventory & daily turnover",
            "capture_model": "modeled from capture velocity & unseen-mass prior",
        ]

        var shortName: String {
            guard let range = name.range(of: #"\s*\([^)]*\)\s*$"#, options: .regularExpression) else { return name }
            let trimmed = String(name[..<range.lowerBound])
            return trimmed.isEmpty ? name : trimmed
        }

        /// The share comes only from the total the read carries; an unknown total stays unknown.
        var heldShare: HeldShare {
            guard let held else { return HeldShare(share: nil, text: "") }
            guard let pop = population, pop > 0 else { return HeldShare(share: nil, text: "their total unknown") }
            let share = Double(held) / Double(pop)
            let pct = share >= 0.995 ? "100%" : (share < 0.01 ? "<1%" : "\(Int((share * 100.0).rounded()))%")
            if let kind = Self.referenceKinds[populationMethod ?? ""] {
                let day = Self.shortDay(populationAt)
                return HeldShare(share: min(1, share), text: "\(pct) of ≈ \(Self.count(pop))",
                                 reference: day.map { "\(kind) · \($0)" } ?? kind)
            }
            let ofWord = populationMethod == "enumerated" ? "of" : "of about"
            return HeldShare(share: min(1, share), text: "\(pct) \(ofWord) \(Self.count(pop))")
        }

        /// The web row's title: the total with its method, clock and confidence, and an earlier reference's grade.
        var totalSentence: String {
            guard let pop = population else { return "their total is not counted yet" }
            let conf = populationConfidence.map { String(format: "%.2f", $0) }
            if let ref = heldShare.reference {
                return "≈ \(Self.count(pop)) · \(ref)" + (conf.map { " · confidence \($0)" } ?? "")
                    + " · an estimate, not a count of their listings"
            }
            let graded = Self.gradeText(populationGrade)
            return "\(Self.count(pop)) \(Self.methodNotes[populationMethod ?? ""] ?? "(\(populationMethod ?? "method unrecorded"))")"
                + (Self.shortDay(populationAt).map { ", \($0)" } ?? "")
                + (conf.map { ", confidence \($0)" } ?? "")
                + (graded.isEmpty ? "" : "; \(graded)")
        }

        /// An earlier reference against the census that followed it, e.g. "earlier estimate 95,000 (Jan 28) was 65% low".
        static func gradeText(_ g: PopulationGrade?) -> String {
            guard let g, g.census > 0 else { return "" }
            let off = Int((abs(g.error) * 100).rounded())
            let kind = referenceKinds[g.referenceMethod] ?? g.referenceMethod
            let day = shortDay(g.referenceAt).map { " (\($0))" } ?? ""
            return "\(kind) \(count(g.reference))\(day) was \(off == 0 ? "within 1%" : "\(off)% \(g.error < 0 ? "low" : "high")")"
        }

        static func count(_ n: Int) -> String {
            let f = NumberFormatter()
            f.locale = Locale(identifier: "en_US")
            f.numberStyle = .decimal
            return f.string(from: NSNumber(value: n)) ?? String(n)
        }

        /// "Oct 17", in UTC, from a timestamp or a bare day; nil when missing or unparseable.
        static func shortDay(_ iso: String?) -> String? {
            guard let iso, !iso.isEmpty else { return nil }
            guard let d = ProfileClock.date(iso.count <= 10 ? "\(iso)T00:00:00Z" : iso) else { return nil }
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(identifier: "UTC")
            f.dateFormat = "MMM d"
            return f.string(from: d)
        }

        func bins(for horizon: LandingHorizon) -> [Int] {
            switch horizon {
            case .d14: return days14
            case .h24: return hours24
            case .h1: return mins60
            }
        }

        func landingText(horizon: LandingHorizon = .d14, now: Date = Date()) -> (active: Bool, text: String) {
            switch horizon {
            case .h1:
                if landed1h > 0 {
                    let sub = landed15m > 0 ? " (+\(landed15m.formatted()) in 15m)" : ""
                    return (true, "+\(landed1h.formatted()) in 1h\(sub)")
                }
            case .h24:
                if landed24 > 0 {
                    let sub = landed1h > 0 ? " (+\(landed1h.formatted()) in 1h)" : ""
                    return (true, "+\(landed24.formatted()) in 24h\(sub)")
                }
            case .d14:
                if landed24 > 0 {
                    return (true, "+\(landed24.formatted()) today")
                }
            }
            guard let lastLanded else { return (false, "idle 14+ days") }
            guard let d = ProfileClock.date(lastLanded) else { return (false, "idle") }
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(secondsFromGMT: 0)
            f.dateFormat = "MMM d"
            return (false, "idle since \(f.string(from: d))")
        }
    }

    let asOf: String
    let day: String?
    let rows: [SourceRow]
    let notRanked: [String: Int]
    var landing: BoardLandingMeta = BoardLandingMeta(hour: nil, bucket5m: nil, landed15m: 0, landed1h: 0, landed24: 0, landed7: 0, hours24: Array(repeating: 0, count: 24), mins60: Array(repeating: 0, count: 12))

    static func parse(_ data: Data) -> SourcesBoardData? {
        guard let v = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let asOf = v["as_of"] as? String,
              let cols = (v["columns"] as? [Any])?.map({ String(describing: $0) }),
              let rawRows = v["rows"] as? [[Any]] else { return nil }
        func at(_ name: String) -> Int? { cols.firstIndex(of: name) }
        guard at("source") != nil, at("name") != nil, at("held_lots") != nil else { return nil }
        func num(_ x: Any?) -> Double? {
            if let d = x as? Double, d.isFinite { return d }
            if let i = x as? Int { return Double(i) }
            if let s = x as? String, !s.trimmingCharacters(in: .whitespaces).isEmpty, let d = Double(s), d.isFinite { return d }
            return nil
        }
        func str(_ x: Any?) -> String? {
            guard let s = x as? String, !s.isEmpty else { return nil }
            return s
        }
        func intArray(_ x: Any?, len: Int? = nil) -> [Int] {
            guard let arr = x as? [Any] else {
                return len.map { Array(repeating: 0, count: $0) } ?? []
            }
            let parsed = arr.map { Int((num($0) ?? 0).rounded()) }
            if let len, parsed.count < len {
                return Array(repeating: 0, count: len - parsed.count) + parsed
            }
            return parsed
        }
        func grade(_ x: Any?) -> PopulationGrade? {
            guard let g = x as? [String: Any],
                  let reference = num(g["reference"]), let census = num(g["census"]), let error = num(g["error"]),
                  let referenceMethod = str(g["reference_method"]) else { return nil }
            return PopulationGrade(reference: Int(reference.rounded()), referenceMethod: referenceMethod,
                                   referenceAt: str(g["reference_at"]), census: Int(census.rounded()),
                                   censusAt: str(g["census_at"]), error: error)
        }

        let rawLanding = v["landing"] as? [String: Any]
        let rawSourcesLanding = (rawLanding?["sources"] as? [String: Any]) ?? [:]
        let rawTotals = (rawLanding?["totals"] as? [String: Any]) ?? [:]

        var out: [SourceRow] = []
        for r in rawRows {
            func get(_ c: String) -> Any? {
                guard let idx = at(c), idx < r.count else { return nil }
                return r[idx]
            }
            guard let source = str(get("source")), let name = str(get("name")) else { continue }
            let srcLand = rawSourcesLanding[source] as? [String: Any]
            let l24 = Int((num(srcLand?["landed_24h"]) ?? num(get("landed_24h")) ?? 0).rounded())
            let l7 = Int((num(srcLand?["landed_7d"]) ?? num(get("landed_7d")) ?? 0).rounded())
            let l15m = Int((num(srcLand?["landed_15m"]) ?? 0).rounded())
            let l1h = Int((num(srcLand?["landed_1h"]) ?? 0).rounded())
            let lastAt = str(srcLand?["last_at"]) ?? str(get("last_landed"))
            let d14 = intArray(get("days14"))
            let h24 = (srcLand?["hours24"] != nil) ? intArray(srcLand?["hours24"], len: 24) : (Array(repeating: 0, count: 23) + [l24])
            let m60 = (srcLand?["mins60"] != nil) ? intArray(srcLand?["mins60"], len: 12) : (Array(repeating: 0, count: 11) + [l1h])

            out.append(SourceRow(
                source: source,
                name: name,
                category: str(get("category")),
                house: str(get("house")),
                held: num(get("held_lots")).map { Int($0.rounded()) },
                heldAt: str(get("held_at")),
                population: num(get("population")).map { Int($0.rounded()) },
                populationMethod: str(get("population_method")),
                populationConfidence: num(get("population_confidence")),
                populationAt: str(get("population_at")),
                populationGrade: grade(get("population_grade")),
                mapSales: num(get("map_sales")).map { Int($0.rounded()) },
                mapUsd: num(get("map_usd")),
                sales12: num(get("sales_12m")).map { Int($0.rounded()) },
                usd12: num(get("usd_12m")),
                salesPrior12: num(get("sales_prior_12m")).map { Int($0.rounded()) },
                usdPrior12: num(get("usd_prior_12m")),
                live: Int((num(get("live_lots")) ?? 0).rounded()),
                landed15m: l15m,
                landed1h: l1h,
                landed24: l24,
                landed7: l7,
                lastLanded: lastAt,
                days14: d14,
                hours24: h24,
                mins60: m60,
                logoUrl: str(get("logo_url")),
                businessType: str(get("business_type")),
                species: str(get("species")),
                speciesLabel: str(get("species_label")),
                countsAsHeld: get("counts_as_held") as? Bool
            ))
        }
        var notRanked: [String: Int] = [:]
        if let nr = v["not_ranked"] as? [String: Any] {
            for (k, val) in nr {
                if let c = num(val), c > 0 { notRanked[k] = Int(c.rounded()) }
            }
        }
        let landingMeta = BoardLandingMeta(
            hour: str(rawLanding?["hour"]) ?? asOf,
            bucket5m: str(rawLanding?["bucket_5m"]) ?? asOf,
            landed15m: Int((num(rawTotals["landed_15m"]) ?? Double(out.reduce(0) { $0 + $1.landed15m })).rounded()),
            landed1h: Int((num(rawTotals["landed_1h"]) ?? Double(out.reduce(0) { $0 + $1.landed1h })).rounded()),
            landed24: Int((num(rawTotals["landed_24h"]) ?? Double(out.reduce(0) { $0 + $1.landed24 })).rounded()),
            landed7: Int((num(rawTotals["landed_7d"]) ?? Double(out.reduce(0) { $0 + $1.landed7 })).rounded()),
            hours24: intArray(rawTotals["hours24"], len: 24),
            mins60: intArray(rawTotals["mins60"], len: 12)
        )
        return SourcesBoardData(asOf: asOf, day: str(v["day"]), rows: out, notRanked: notRanked, landing: landingMeta)
    }

    static func fetch() async -> SourcesBoardData? {
        guard let res = try? await SupabaseService.client.rpc("market_sources_read").execute() else { return nil }
        return parse(res.data)
    }
}

/// Hourly & live landing drill-down for a source (`market_source_landing_read` #1825).
struct SourceLandingDetail: Equatable {
    struct RecentEvent: Equatable, Identifiable {
        let id: String
        let source: String
        let eventType: String?
        let eventStatus: String?
        let price: Double?
        let title: String?
        let lot: String?
        let vehicleId: String?
        let sourceUrl: String?
        let createdAt: String
        var year: Int? = nil
        var make: String? = nil
        var model: String? = nil
        var trim: String? = nil
        var recordDate: String? = nil

        var vehicleUUID: UUID? { vehicleId.flatMap(UUID.init(uuidString:)) }
        var headline: String {
            let identity = [year.map(String.init), make, model, trim].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " ")
            return identity.isEmpty ? (title ?? lot.map { "Lot \($0)" } ?? "Retained record") : identity
        }
        /// The reader's date may be a year, a listing date or an auction date. Keep its precision;
        /// the dealer reader's intake-clock fallback does not establish a source event date.
        var recordDateLabel: String {
            guard let raw = recordDate?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
                  raw.range(of: #"^\d{4}(-\d{2}(-\d{2})?)?([ T].*)?$"#, options: .regularExpression) != nil else { return "Undated" }
            func clock(_ s: String) -> Date? {
                let iso = s.replacingOccurrences(of: " ", with: "T")
                    .replacingOccurrences(of: #"([+-]\d{2})$"#, with: "$1:00", options: .regularExpression)
                return ProfileClock.date(iso)
            }
            if raw == createdAt || (clock(raw) != nil && clock(raw) == clock(createdAt)) { return "Undated" }
            return "Record date " + String(raw.prefix(10))
        }
        var openableURL: URL? {
            guard let sourceUrl, let url = URL(string: sourceUrl),
                  ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
            return url
        }
    }

    let asOf: String
    let source: String?
    let hour: String?
    let selectedHour: String?
    let bucket5m: String?
    let landed15m: Int
    let landed1h: Int
    let landed24: Int
    let landed7: Int
    let lastLanded: String?
    let hours24: [Int]
    let mins60: [Int]
    let days14: [Int]
    let recent: [RecentEvent]

    static func parse(_ data: Data) -> SourceLandingDetail? {
        guard let v = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let asOf = v["as_of"] as? String else { return nil }
        func num(_ x: Any?) -> Double? {
            if let d = x as? Double, d.isFinite { return d }
            if let i = x as? Int { return Double(i) }
            if let s = x as? String, !s.trimmingCharacters(in: .whitespaces).isEmpty, let d = Double(s), d.isFinite { return d }
            return nil
        }
        func str(_ x: Any?) -> String? {
            guard let s = x as? String, !s.isEmpty else { return nil }
            return s
        }
        func intArray(_ x: Any?, len: Int) -> [Int] {
            guard let arr = x as? [Any] else { return Array(repeating: 0, count: len) }
            let parsed = arr.map { Int((num($0) ?? 0).rounded()) }
            if parsed.count < len { return Array(repeating: 0, count: len - parsed.count) + parsed }
            return parsed
        }
        var recent: [RecentEvent] = []
        if let rawRecent = v["recent"] as? [[String: Any]] {
            for ev in rawRecent {
                guard let id = str(ev["id"]),
                      let source = str(ev["source"]),
                      let createdAt = str(ev["created_at"]) else { continue }
                recent.append(RecentEvent(
                    id: id,
                    source: source,
                    eventType: str(ev["event_type"]),
                    eventStatus: str(ev["event_status"]),
                    price: num(ev["price"]),
                    title: str(ev["title"]),
                    lot: str(ev["lot"]),
                    vehicleId: str(ev["vehicle_id"]),
                    sourceUrl: str(ev["source_url"]),
                    createdAt: createdAt,
                    year: num(ev["year"]).flatMap { abs($0) < 1e5 ? Int($0) : nil },
                    make: str(ev["make"]),
                    model: str(ev["model"]),
                    trim: str(ev["trim"]),
                    recordDate: str(ev["record_date"])
                ))
            }
        }
        return SourceLandingDetail(
            asOf: asOf,
            source: str(v["source"]),
            hour: str(v["hour"]),
            selectedHour: str(v["selected_hour"]),
            bucket5m: str(v["bucket_5m"]),
            landed15m: Int((num(v["landed_15m"]) ?? 0).rounded()),
            landed1h: Int((num(v["landed_1h"]) ?? 0).rounded()),
            landed24: Int((num(v["landed_24h"]) ?? 0).rounded()),
            landed7: Int((num(v["landed_7d"]) ?? 0).rounded()),
            lastLanded: str(v["last_landed"]),
            hours24: intArray(v["hours24"], len: 24),
            mins60: intArray(v["mins60"], len: 12),
            days14: intArray(v["days14"], len: 14),
            recent: recent
        )
    }

    private struct Params: Encodable {
        let p_source: String?
        let p_hour: String?
    }

    static func fetch(source: String, hour: String? = nil) async -> SourceLandingDetail? {
        guard let res = try? await SupabaseService.client
            .rpc("market_source_landing_read", params: Params(p_source: source, p_hour: hour))
            .execute() else { return nil }
        return parse(res.data)
    }
}

/// The web Market's windows and ordering, evaluated against the same open-lot population.
enum LiveAuctionWindow: String, CaseIterable, Identifiable {
    case all = "Live lots", noReserve = "No reserve", hour = "Ending in 1 h"
    case day = "Ending in 24 h", new = "New in 24 h"
    var id: String { rawValue }

    func includes(_ lot: LiveAuction, at now: Date) -> Bool {
        switch self {
        case .all: return true
        case .noReserve: return lot.noReserve
        case .hour: return lot.endsAtDate.map { $0.timeIntervalSince(now) < 3600 } ?? false
        case .day: return lot.endsAtDate.map { $0.timeIntervalSince(now) < 86400 } ?? false
        case .new: return lot.listedAtDate.map { now.timeIntervalSince($0) < 86400 } ?? false
        }
    }
}

/// The web's BID_BUCKETS/bidBucket: current USD bids, never sale prices or estimates.
/// A recorded zero belongs under $10,000; absent, negative and nonfinite bids stay unrecorded.
enum LiveBidRange: String, CaseIterable, Identifiable {
    case all, under10k, from10kTo25k, from25kTo50k, from50kTo100k, over100k, unrecorded
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return "Any current bid"
        case .under10k: return "Under $10,000"
        case .from10kTo25k: return "$10,000–24,999"
        case .from25kTo50k: return "$25,000–49,999"
        case .from50kTo100k: return "$50,000–99,999"
        case .over100k: return "$100,000+"
        case .unrecorded: return "Unrecorded"
        }
    }
    static func bucket(_ bid: Double?) -> Self {
        guard let bid, bid.isFinite, bid >= 0 else { return .unrecorded }
        if bid < 10_000 { return .under10k }
        if bid < 25_000 { return .from10kTo25k }
        if bid < 50_000 { return .from25kTo50k }
        if bid < 100_000 { return .from50kTo100k }
        return .over100k
    }
    func includes(_ lot: LiveAuction) -> Bool { self == .all || Self.bucket(lot.currentBid) == self }
}

enum LiveAuctionOrder: String, CaseIterable, Identifiable {
    case ending = "Ending first", bid = "Highest bid", newest = "Newest"
    var id: String { rawValue }

    func sorted(_ lots: [LiveAuction]) -> [LiveAuction] {
        switch self {
        case .ending: return lots.sorted { ($0.endsAtDate ?? .distantFuture) < ($1.endsAtDate ?? .distantFuture) }
        case .bid: return lots.sorted { ($0.currentBid ?? 0) > ($1.currentBid ?? 0) }
        case .newest: return lots.sorted { ($0.listedAtDate ?? .distantPast) > ($1.listedAtDate ?? .distantPast) }
        }
    }
}

/// The board as a list ending soonest first, refetched every minute as on the web.
struct LiveBoardView: View {
    enum SubLens: String, CaseIterable, Identifiable {
        case live = "Live Auctions"
        case calendar = "Calendar"
        case sources = "Sources"
        var id: String { rawValue }
    }

    @State private var subLens: SubLens = .live
    @State private var board: LiveBoard?
    @State private var finishBoard: FinishBoard?
    @State private var calendar: AuctionCalendar?
    @State private var calendarLoading = false
    @State private var calendarFailure: String?
    @State private var sourcesBoard: SourcesBoardData?
    @State private var selectedSale: AuctionCalendar.CalendarSale?
    @State private var selectedSource: SourcesBoardData.SourceRow?
    @State private var loadError = false
    @State private var loadErrorDetail: String?
    // The map's selection narrows the list to one brand, then one decade: one population, one
    // filter, never a second read. The web Market tab's mapFocus/mapChild do the same.
    @State private var filterMake: String? = {
        #if DEBUG
        if let m = ProcessInfo.processInfo.environment["NUKE_DEBUG_LIVE_MAKE"], !m.isEmpty { return m }
        #endif
        return nil
    }()
    @State private var filterDecade: String? = nil
    @State private var auctionWindow: LiveAuctionWindow = .all
    @State private var auctionOrder: LiveAuctionOrder = .ending
    @State private var bidRange: LiveBidRange = .all

    /// The clock the board is read against; set when a read lands so one evaluation shares it.
    @State private var now = Date()

    /// The web's population: lots still open now (`endsAt > now`), ending soonest first.
    private var openLots: [LiveAuction] { board?.open(at: now) ?? [] }

    private var scopedLots: [LiveAuction] {
        openLots
            .filter { filterMake == nil || LiveInventory.make($0) == filterMake }
            .filter { filterDecade == nil || LiveInventory.decade($0) == filterDecade }
    }

    private var windowedLots: [LiveAuction] { scopedLots.filter { auctionWindow.includes($0, at: now) } }
    private var lots: [LiveAuction] { auctionOrder.sorted(windowedLots.filter(bidRange.includes)) }
    // Map and supporting rows share the same window and bid range. Make/decade
    // selection narrows the rows; the map keeps the other makes available to select.
    private var mappedLots: [LiveAuction] {
        openLots.filter { auctionWindow.includes($0, at: now) && bidRange.includes($0) }
    }

    private var filterLine: String? {
        guard let m = filterMake else { return nil }
        return [m, filterDecade].compactMap { $0 }.joined(separator: " · ")
    }

    /// The web's head line: the board's current bids against the same hour a week ago, only on
    /// the whole board (the baseline is board-wide), "≈" when the week-ago reading was rebuilt.
    private var weekAgoLine: String? {
        guard filterMake == nil, let board, let wk = board.weekAgo, let before = wk.bids, before > 0 else { return nil }
        let nowBids = openLots.reduce(0.0) { $0 + ($1.currentBid ?? 0) }
        let pct = (nowBids - before) / before * 100
        let signed = (pct >= 0 ? "+" : "") + LedgerMap.oneDecimal(pct) + "%"
        return "vs same time last week \(wk.source == "archive" ? "≈" : "")\(signed) from \(Self.bidNumber(before, compact: true))"
    }

    /// The web's bidNumber: BaT runs every auction in US dollars and reports the bid as one (#1061).
    static func bidNumber(_ n: Double?, compact: Bool = false) -> String {
        guard let n, n.isFinite else { return "—" }
        if compact, abs(n) >= 1_000_000 { return "$" + LedgerMap.oneDecimal(n / 1_000_000) + "M" }
        if compact, abs(n) >= 10_000 { return "$\(Int((n / 1_000).rounded()))K" }
        return "$" + Int(n.rounded()).formatted()
    }
    /// Three significant figures: about $166,000, not $166,323.
    static func about(_ n: Double) -> Double {
        let step = pow(10.0, max(0, floor(log10(max(n, 1))) - 2))
        return (n / step).rounded() * step
    }
    /// Past 3× the comps mostly do not describe the car, so it reads as 3×+ rather than a precise number.
    static func multiple(_ ratio: Double) -> String {
        ratio >= 3 ? "3×+" : ratio < 0.1 ? "<0.1×" : LedgerMap.oneDecimal(ratio) + "×"
    }

    @State private var reading: LiveAuction?

    var body: some View {
        Group {
            if let board {
                List {
                    // The Market tab's first section on the web: the ledger as a map (every record
                    // with a recorded price), the open board below it.
                    Section {
                        LedgerMapView()
                            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 4, trailing: 12))
                            .listRowBackground(Color.clear)
                    }
                    Section {
                        Text("Live auctions, calendar and sources across all makes.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Picker("Board", selection: $subLens) {
                            ForEach(SubLens.allCases) { lens in
                                Text(lens.rawValue).tag(lens)
                            }
                        }
                        .pickerStyle(.segmented)
                        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 6, trailing: 12))
                        .listRowBackground(Color.clear)
                    } header: {
                        Text("ALL MAKES · MARKET")
                            .font(.headline).textCase(nil)
                    }

                    switch subLens {
                    case .live:
                        Section {
                            HStack {
                                Picker("Auction window", selection: $auctionWindow) {
                                    ForEach(LiveAuctionWindow.allCases.filter { window in
                                        window == .all || window == auctionWindow || scopedLots.contains(where: { window.includes($0, at: now) })
                                    }) { window in
                                        Text("\(window.rawValue) (\(scopedLots.filter { window.includes($0, at: now) }.count))").tag(window)
                                    }
                                }
                                .pickerStyle(.menu)
                                .onChange(of: auctionWindow) { _, _ in bidRange = .all }
                                Spacer(minLength: 4)
                                Picker("Sort auctions", selection: $auctionOrder) {
                                    ForEach(LiveAuctionOrder.allCases) { order in
                                        Text(order.rawValue).tag(order)
                                    }
                                }
                                .pickerStyle(.menu)
                            }
                            .font(.caption)
                            Picker("Current bid (USD)", selection: $bidRange) {
                                ForEach(LiveBidRange.allCases) { range in
                                    Text(range.label).tag(range)
                                        .disabled(range != .all && range != bidRange && !windowedLots.contains(where: range.includes))
                                }
                            }
                            .pickerStyle(.menu)
                            RootedValueView(label: "Open lots in selection",
                                value: "\(lots.count.formatted()) of \(windowedLots.count.formatted())",
                                status: .recorded,
                                decay: "Selection checked " + now.formatted(date: .abbreviated, time: .shortened))
                            Text("Current bids in US dollars, not sold prices or valuations. Unrecorded bids stay separate from recorded zero.")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        // The board drawn as the web draws it: brands as boxes, decades inside.
                        Section {
                            LiveInventoryMapView(lots: mappedLots) { make, decade in
                                if filterMake != make { bidRange = .all } // the web clears the bid lens on a make change
                                filterMake = make; filterDecade = decade
                            }
                            .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
                            .listRowBackground(Color.clear)
                            if let f = filterLine {
                                HStack(spacing: 8) {
                                    Text(f).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                                    Spacer(minLength: 0)
                                    Button("All makes") { filterMake = nil; filterDecade = nil; bidRange = .all }.font(.caption2)
                                }
                                .listRowBackground(Color.clear)
                            }
                            if let w = weekAgoLine {
                                Text(w).font(.caption2.monospaced()).foregroundStyle(.secondary)
                                    .listRowBackground(Color.clear)
                            }
                        } header: {
                            Text(board.coverageSentence(at: now))
                                .font(.caption2.monospaced())
                                .textCase(nil)
                        }
                        Section {
                            if lots.isEmpty {
                                Text("No open lots in this selection. Choose another current bid range or auction window.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            ForEach(lots) { lot in
                                if let uuid = lot.vehicleUUID {
                                    NavigationLink(value: VehicleHeaderRow(id: uuid, year: lot.year, make: lot.make,
                                                                           model: lot.model, trim: nil, primary_image_url: lot.imageUrl,
                                                                           city: nil, state: nil)) {
                                        row(lot)
                                    }
                                } else {
                                    row(lot)   // a row without a readable vehicle id opens nothing, never a random record
                                }
                            }
                        } header: {
                            HStack {
                                Text(auctionOrder.rawValue)
                                    .font(.caption2.monospaced())
                                    .textCase(nil)
                                Spacer(minLength: 4)
                                if let fb = finishBoard, fb.fresh, !fb.byId.isEmpty {
                                    Text("\(fb.byId.count.formatted()) finish est.")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.secondary)
                                        .textCase(nil)
                                }
                            }
                        } footer: {
                            Text("Bring a Trailer runs every auction in US dollars; bids are as the board recorded them. Running hot or cold compares the bid with the typical bid at this point in the auction for cars priced like its comparable sales; Est. is the Model 33 live finish estimate with its 80% interval (low–high). Tap the tag for the reading and comparable sales.")
                        }

                    case .calendar:
                        calendarSection

                    case .sources:
                        sourcesSection
                    }
                }
                .listStyle(.plain)
                .sheet(item: $reading) { lot in
                    HeatReadingSheet(
                        lot: lot,
                        heat: lot.heat(curve: board.curve, at: now),
                        finishEstimate: finishBoard?.byId[lot.id],
                        now: now
                    )
                }
                .sheet(item: $selectedSale) { sale in
                    SaleRosterSheet(sale: sale)
                }
                .sheet(item: $selectedSource) { src in
                    SourceLandingSheet(sourceRow: src, readAt: sourcesBoard?.asOf)
                }
            } else if loadError {
                ContentUnavailableView {
                    Label("Couldn't read the board", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadErrorDetail ?? "The read failed.")
                } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
            } else {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Reading the open board…")
                        .font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            while !Task.isCancelled {
                if board == nil || UIApplication.shared.applicationState == .active { await load() }
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .onChange(of: subLens) {
            Task { await loadSubLensIfNeeded() }
        }
    }

    @ViewBuilder private var calendarSection: some View {
        Section {
            Button(calendarLoading ? "Reading calendar…" : "Refresh calendar") { Task { await loadCalendar() } }
                .disabled(calendarLoading)
            if let calendarFailure { Text(calendarFailure).font(.footnote).foregroundStyle(.secondary) }
        }
        if let cal = calendar {
            Section {
                if cal.sales.isEmpty { Text("No scheduled sale has a lot landed for the next \(cal.horizon_days) days.") }
                ForEach(cal.sales) { sale in
                    Button {
                        selectedSale = sale
                    } label: {
                        calendarSaleRow(sale)
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(cal.population.lots.formatted())\(cal.population.listed.flatMap { $0 > cal.population.lots ? " of \($0.formatted())" : nil } ?? "") lots · \(cal.population.sales) sale rosters · \(cal.population.houses) houses · \(cal.horizon_days)-day lot window")
                        .font(.caption2.monospaced())
                        .textCase(nil)
                    Text("\(cal.population.seen_before.formatted()) with an earlier record · \(cal.population.no_reserve.formatted()) no reserve · \(cal.population.first_seen_7d.formatted()) first seen in 7d · \(AuctionCalendar.updatedAgo(cal.population.updated_at, now: now))")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textCase(nil)
                }
            } footer: {
                Text("Retained lots for the next \(cal.horizon_days) days, against house-listed counts where recorded. Listed counts can include undated rosters below. Whole-market coverage is unknown.")
                if let unplaced = cal.unplaced, !unplaced.isEmpty {
                    let line = unplaced.map { "\(AuctionCalendar.houseName($0.house)) \($0.sale_name) (\($0.lots_listed.formatted()) listed on site)" }.joined(separator: " · ")
                    Text("Listed on house site without run dates yet: \(line)")
                        .font(.caption2)
                }
            }
        } else if calendarLoading {
            Section {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Reading auction calendar…")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private func calendarSaleRow(_ sale: AuctionCalendar.CalendarSale) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(AuctionCalendar.houseName(sale.house)) · \(sale.sale_name)")
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 4)
                Text(AuctionCalendar.saleTimer(startsOn: sale.starts_on, endsOn: sale.ends_on, now: now))
                    .font(.caption2.monospaced().weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Text("\(sale.starts_on) → \(sale.ends_on)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                if let loc = sale.location, !loc.isEmpty {
                    Text("· \(loc)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            HStack(spacing: 8) {
                Text("\(sale.lots.formatted()) lots in Nuke")
                    .font(.caption2.monospaced().weight(.semibold))
                if let listed = sale.lots_listed {
                    Text("of \(listed.formatted()) on site")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
                if sale.no_reserve > 0 {
                    Text("· \(sale.no_reserve.formatted()) NR")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
                if sale.seen_before > 0 {
                    Text("· \(sale.seen_before.formatted()) with an earlier record")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
            if let priorLine = AuctionCalendar.priorSaleLine(house: sale.house, prior: sale.prior_sale) {
                Text(priorLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(AuctionCalendar.updatedAgo(sale.updated_at, now: now))
                .font(.caption2).foregroundStyle(.secondary)
            if sale.lots_listed != nil {
                Text("House roster \(AuctionCalendar.updatedAgo(sale.listed_at, now: now).replacingOccurrences(of: "updated", with: "read"))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var sourcesSection: some View {
        if let sb = sourcesBoard {
            Section {
                ForEach(sb.rows) { src in
                    Button {
                        selectedSource = src
                    } label: {
                        sourceRow(src)
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sources · all makes")
                        .font(.caption2.monospaced())
                        .textCase(nil)
                    Text("Open a source to explore its retained vehicle records and results.")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textCase(nil)
                }
            }
            if !sb.notRanked.isEmpty {
                Section {
                    DisclosureGroup("Data coverage") {
                        let nr = sb.notRanked.sorted { $0.value > $1.value }.map { "\($0.key): \($0.value.formatted())" }.joined(separator: " · ")
                        Text("Additional sources not ranked: \(nr)")
                            .font(.caption2)
                    }
                }
            }
        } else {
            Section {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Reading sources board…")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private func sourceRow(_ src: SourcesBoardData.SourceRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                MarketSourceIdentity(source: src)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }
            if let held = src.held, src.countsAsHeld != false {
                Text("\(held.formatted()) retained records · counted \(ProfileClock.Absolute(src.heldAt))")
                    .font(.caption.monospaced()).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }

    private func loadSubLensIfNeeded() async {
        switch subLens {
        case .live:
            break
        case .calendar:
            if calendar == nil {
                await loadCalendar()
            }
        case .sources:
            if sourcesBoard == nil {
                sourcesBoard = await SourcesBoardData.fetch()
            }
        }
    }

    private func loadCalendar() async {
        guard !calendarLoading else { return }
        calendarLoading = true
        defer { calendarLoading = false }
        do {
            let read = try await AuctionCalendar.fetch()
            try Task.checkCancellation()
            calendar = read
            calendarFailure = nil
            now = Date()
        } catch is CancellationError {
        } catch {
            calendarFailure = ReadFailure.text(error)
            NSLog("NukeCapture auction calendar read failed: %@", String(describing: error))
        }
    }

    /// One read of the board. A failed refresh never wipes a board already on screen.
    private func load() async {
        do {
            async let bTask = LiveBoard.fetch()
            async let fTask = FinishBoard.fetch()
            let (b, fb) = try await (bTask, fTask)
            board = b
            if let fb { finishBoard = fb }
            now = Date()
            loadError = false
            #if DEBUG
            // Screenshot loop: NUKE_DEBUG_LIVE_READING=1 opens the reading of the first lot running
            // hot or cold once the board lands (DEBUG only, never ships).
            if ProcessInfo.processInfo.environment["NUKE_DEBUG_LIVE_READING"] == "1", reading == nil,
               let first = lots.first(where: { ($0.heat(curve: board?.curve, at: now)?.state ?? .inLine) != .inLine }) {
                reading = first
            }
            #endif
        } catch {
            if board == nil { loadError = true; loadErrorDetail = (error as? BoardContract.Mismatch)?.errorDescription ?? ReadFailure.text(error) }
            NSLog("NukeCapture live board read failed: %@", String(describing: error))
        }
    }

    @ViewBuilder private func row(_ lot: LiveAuction) -> some View {
        let est = finishBoard?.byId[lot.id]
        let heat = lot.heat(curve: board?.curve, at: now)
        HStack(alignment: .top, spacing: 12) {
            Color(.secondarySystemFill)
                .frame(width: 64, height: 48)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(lot.imageUrl, width: 200)) { i in
                        i.resizable().scaledToFill()
                    } placeholder: { Image(systemName: "car.side").foregroundStyle(.secondary) }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(lot.headline).font(.subheadline.weight(.semibold)).lineLimit(2)
                HStack(spacing: 8) {
                    // The web's bidNumber: dollars, as BaT reports every bid (#1061).
                    if let bid = lot.currentBid, bid.isFinite {
                        Text(Self.bidNumber(bid))
                            .font(.system(.footnote, design: .monospaced).weight(.semibold)).monospacedDigit()
                        Text("bid").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    } else {
                        Text("no bid recorded").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    }
                    if lot.noReserve {
                        Text("NO RESERVE").font(.caption2.monospaced().weight(.semibold)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    if let ends = lot.endsAtDate {
                        TimelineView(.periodic(from: .now, by: 30)) { ctx in
                            Text(Self.remaining(ends, now: ctx.date))
                                .font(.caption2.monospaced()).monospacedDigit()
                                .foregroundStyle(ends.timeIntervalSince(ctx.date) < 3600 ? .red : .secondary)
                        }
                    }
                }
                // Model 33 live finish estimate + HeatTag reading, one tap away.
                if est != nil || (heat != nil && heat?.state != .inLine) {
                    HStack(spacing: 8) {
                        if let heat, heat.state != .inLine {
                            Button {
                                reading = lot
                            } label: {
                                Text((heat.state == .hot ? "Running hot" : "Running cold") + " · " + Self.multiple(heat.ratio))
                                    .font(.caption2.monospaced().weight(.semibold))
                                    .foregroundStyle(heat.state == .hot ? Color.orange : Color.teal)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Why \(lot.headline) is running \(heat.state == .hot ? "hot" : "cold")")
                        }
                        if let est {
                            Button {
                                reading = lot
                            } label: {
                                HStack(spacing: 4) {
                                    Text("Est. \(Self.bidNumber(est.estimate, compact: true))")
                                        .font(.caption2.monospaced().weight(.semibold))
                                    Text("(\(Self.bidNumber(est.low, compact: true))–\(Self.bidNumber(est.high, compact: true))\(est.grade.map { " · \($0)" } ?? ""))")
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Model 33 finish estimate for \(lot.headline)")
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    static func remaining(_ ends: Date, now: Date) -> String {
        let s = Int(ends.timeIntervalSince(now))
        if s <= 0 { return "closing" }
        if s < 3600 { return "\(s / 60)m left" }
        if s < 86_400 { return "\(s / 3600)h \((s % 3600) / 60)m left" }
        return "\(s / 86_400)d \((s % 86_400) / 3600)h left"
    }
}

/// The reasoning behind a heat tag and/or Model 33 live finish estimate, plus comparable finish analogs.
struct HeatReadingSheet: View {
    let lot: LiveAuction
    let heat: LiveAuction.Heat?
    var finishEstimate: FinishEstimate? = nil
    let now: Date
    @State private var analogs: [FinishAnalog] = []
    @State private var loadedAnalogs = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("The reading") {
                    line("Current bid", "\(LiveBoardView.bidNumber(lot.currentBid)) · \(lot.endsAtDate.map { LiveBoardView.remaining($0, now: now) } ?? "close unknown")")
                    if let est = finishEstimate {
                        line("Expected finish (Model 33)", "\(LiveBoardView.bidNumber(est.estimate)) (80% interval \(LiveBoardView.bidNumber(est.low))–\(LiveBoardView.bidNumber(est.high))\(est.grade.map { " · grade \($0)" } ?? ""))")
                        if let sentence = est.sentence {
                            line("Calibration", sentence)
                        }
                        if let through = est.compsThrough {
                            line("Comps through", through)
                        }
                    }
                    if let b = lot.band {
                        line("Comparable sales", "\(b.comps.formatted()) on its BaT model page, weighted toward the same version, year, mileage and gearbox")
                        line("Their middle", "\(LiveBoardView.bidNumber(b.p50)) (80% range \(LiveBoardView.bidNumber(b.p10))–\(LiveBoardView.bidNumber(b.p90)))")
                    }
                    if let heat {
                        line("Typical bid now", "about \(LiveBoardView.bidNumber(LiveBoardView.about(heat.typicalNow))): with this much time left, cars at this price are usually bid to about \(Int((heat.share * 100).rounded()))% of their final")
                        line("This bid", "\(LiveBoardView.multiple(heat.ratio)) typical")
                    }
                }
                if !analogs.isEmpty {
                    Section("Comparable finish analogs") {
                        ForEach(analogs) { a in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a.title)
                                    .font(.footnote.weight(.medium))
                                HStack(spacing: 8) {
                                    if let bid = a.bid {
                                        Text("Bid at same mark: \(LiveBoardView.bidNumber(bid))")
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.secondary)
                                    }
                                    if let fin = a.finalPrice {
                                        Text("Final: \(LiveBoardView.bidNumber(fin))")
                                            .font(.caption2.monospaced().weight(.semibold))
                                    }
                                    if let closed = a.closed {
                                        Text(closed)
                                            .font(.caption2.monospaced())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
                if let b = lot.band, let bid = lot.currentBid, bid > b.p90 {
                    Section {
                        Text("The bid already tops 90% of those sales: this car is bringing more than its model page usually does (a rarer version, very low miles, or prices that have risen since).")
                            .font(.footnote)
                    }
                }
                Section {
                    Text("Hot is \(LiveBoardView.multiple(LiveAuction.hotAt)) the typical bid or more; cold is \(LiveBoardView.multiple(LiveAuction.coldAt)) or less. The curve is the median share of the final price bid at each hours-left mark, per price tier, from sold BaT lots; past \(Int(LiveAuction.heatMaxHours)) hours left there is no verdict.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle(lot.headline)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                guard !loadedAnalogs else { return }
                loadedAnalogs = true
                analogs = await FinishBoard.fetchAnalogs(vehicleId: lot.id)
            }
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.caption2.monospaced()).foregroundStyle(.secondary)
            Text(value).font(.footnote)
        }
        .padding(.vertical, 2)
    }
}

/// Scheduled auction sale roster sheet (`auction_calendar_read` with `p_house` and `p_sale_key`).
struct SaleRosterSheet: View {
    let sale: AuctionCalendar.CalendarSale
    @State private var roster: AuctionCalendarRoster
    @State private var loading = false
    @State private var failure: String?
    @State private var refreshRequired = false
    @State private var failedOffset = 0
    @Environment(\.dismiss) private var dismiss

    init(sale: AuctionCalendar.CalendarSale) {
        self.sale = sale
        _roster = State(initialValue: AuctionCalendarRoster(house: sale.house, saleKey: sale.sale_key))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("\(sale.starts_on) → \(sale.ends_on)").font(.caption.monospaced())
                    Text("\(AuctionCalendar.saleTimer(startsOn: sale.starts_on, endsOn: sale.ends_on)) · \(AuctionCalendar.updatedAgo(sale.updated_at))")
                        .font(.caption).foregroundStyle(.secondary)
                    if let location = sale.location { Text(location).font(.caption) }
                    if !sale.run_days.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(sale.run_days) { rd in
                                    Text("\(rd.day): \(rd.lots)")
                                        .font(.caption2.monospaced())
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(Color(.secondarySystemFill), in: Capsule())
                                }
                            }
                        }
                    }
                } footer: {
                    Text("The house publishes run days, not a time of day. Lots here are retained vehicle lots; the house's full roster may be larger.")
                }
                if let total = roster.total {
                    Section {
                        if roster.rows.isEmpty {
                            Text("No lot of this sale has landed in this read.").font(.footnote)
                        }
                        ForEach(roster.rows) { lot in
                            SaleRosterLotRow(lot: lot, house: sale.house)
                        }
                    } header: {
                        Text("\(roster.rows.count.formatted()) of \(total.formatted()) retained lots read")
                            .textCase(nil)
                    } footer: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Lot read model built \(ProfileClock.day(roster.builtAt) ?? "at an unrecorded time"). Earlier records are live reads for each page, up to five per lot; they are not price comparables.")
                            if roster.continuationUnavailable {
                                Text("The reader could not establish the remaining page. The roster above is incomplete; refresh to try again.")
                            }
                        }
                    }
                }
                if let failure {
                    Section {
                        Text(failure).font(.footnote).foregroundStyle(.secondary)
                        Button(refreshRequired ? "Refresh roster" : "Retry roster page") {
                            Task { await load(offset: refreshRequired ? 0 : failedOffset) }
                        }.disabled(loading)
                    }
                }
                if loading {
                    Section {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text(roster.total == nil ? "Reading sale roster…" : "Reading roster page…")
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                } else if let offset = roster.nextOffset, failure == nil {
                    Section {
                        Button("More lots") { Task { await load(offset: offset) } }
                    }
                }
            }
            .navigationTitle("\(AuctionCalendar.houseName(sale.house)) · \(sale.sale_name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Refresh") { Task { await load(offset: 0) } }.disabled(loading)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .refreshable { await load(offset: 0) }
            .task { if roster.total == nil { await load(offset: 0) } }
        }
    }

    private func load(offset: Int) async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        do {
            let response = try await AuctionCalendar.fetch(house: sale.house, saleKey: sale.sale_key, offset: offset)
            try Task.checkCancellation()
            try roster.accept(response, requestedOffset: offset)
            failure = nil
            refreshRequired = false
        } catch is CancellationError {
            // Dismissing the sheet cancels its read; it does not establish an empty roster.
        } catch {
            refreshRequired = error is AuctionCalendarRoster.ReceiptError
            failedOffset = offset
            failure = (error as? AuctionCalendarRoster.ReceiptError)?.errorDescription ?? ReadFailure.text(error)
            NSLog("NukeCapture auction roster read failed: %@", String(describing: error))
        }
    }
}

private struct SaleRosterLotRow: View {
    let lot: AuctionCalendar.RosterLot
    let house: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let uuid = lot.vehicleUUID {
                NavigationLink {
                    VehicleDetailView(vehicleId: uuid.uuidString.lowercased(), embedInNavigationStack: false)
                } label: { identity }
                .buttonStyle(.plain)
            } else { identity }
            Text("\(lot.run_on) · \(AuctionCalendar.runTimer(lot.run_on))")
                .font(.caption.monospaced()).foregroundStyle(.secondary)
            Text([lot.lot_number.map { "Lot \($0)" },
                  lot.has_reserve.map { $0 ? "reserve" : "no reserve" },
                  lot.vin_present.map { $0 ? "VIN or chassis recorded" : "no VIN recorded" } ?? "VIN status unrecorded"]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
            if let estimate = lot.estimateText(house: house) {
                RootedValueView(label: "House estimate", value: estimate, status: .attributed,
                                decay: "Scheduled lot · \(lot.run_on)",
                                onDrill: sourceAction(AuctionCalendar.houseLink(house: house, value: lot.source_url)))
            }
            if let source = AuctionCalendar.houseLink(house: house, value: lot.source_url) {
                Link("\(AuctionCalendar.houseName(house)) lot page", destination: source).font(.caption)
            }
            if let prior = lot.prior, !prior.isEmpty {
                ForEach(Array(prior.enumerated()), id: \.offset) { _, result in
                    VStack(alignment: .leading, spacing: 2) {
                        RootedValueView(label: AuctionCalendar.houseName(result.house), value: result.outcomeText,
                                        status: result.basis == "source" ? .attributed : .recorded,
                                        decay: AuctionCalendar.dayLabel(result.on), onDrill: sourceAction(result.sourceLink))
                        if let url = result.sourceLink { Link("Earlier source record", destination: url).font(.caption2) }
                    }
                }
            } else if lot.prior != nil {
                Text("No earlier record of this vehicle on Nuke").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Earlier records were not returned by this read").font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 4)
    }

    private var identity: some View {
        HStack(alignment: .top, spacing: 10) {
            if let raw = lot.image, let url = URL(string: raw), url.scheme == "https", url.user == nil, url.password == nil {
                CachedAsyncImage(url: NukeImage.thumb(raw, width: 200)) { image in
                    image.resizable().scaledToFill()
                } placeholder: { Color(.secondarySystemFill) }
                .frame(width: 64, height: 48).clipped()
            }
            Text(lot.title).font(.subheadline.weight(.semibold))
            Spacer(minLength: 0)
            if lot.vehicleUUID != nil { Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func sourceAction(_ url: URL?) -> (() -> Void)? {
        guard let url else { return nil }
        return { openURL(url) }
    }
}

/// The web row's share track: filled for a census, lighter for a labelled reference, hatched when the total is unknown.
struct SourceShareBar: View {
    let share: SourcesBoardData.HeldShare

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.secondary.opacity(0.15))
                if let s = share.share {
                    Rectangle()
                        .fill(share.reference == nil ? Color.primary : Color.secondary.opacity(0.72))
                        .frame(width: max(1, geo.size.width * s))
                } else {
                    Canvas { ctx, size in
                        var p = Path()
                        var x = -size.height
                        while x < size.width {
                            p.move(to: CGPoint(x: x, y: size.height))
                            p.addLine(to: CGPoint(x: x + size.height, y: 0))
                            x += 4
                        }
                        ctx.stroke(p, with: .color(.secondary.opacity(0.5)), lineWidth: 1)
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 1))
    }
}

/// The source's recorded identity, retaining readable text if its existing artwork is absent or unreadable.
private struct MarketSourceIdentity: View {
    let source: SourcesBoardData.SourceRow

    var body: some View {
        HStack(spacing: 10) {
            if let logo = source.logoUrl, let url = URL(string: logo) {
                CachedAsyncImage(url: url, maxPixel: 160) { image in
                    image.resizable().scaledToFit()
                } placeholder: { Color.clear }
                .frame(width: 64, height: 30)
                .background(Color.white)
                .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(source.shortName).font(.subheadline.weight(.semibold))
                if let type = source.typeLabel {
                    Text(type).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

/// Retained source records; technical census and record-intake details are an explicit disclosure.
struct SourceLandingSheet: View {
    let sourceRow: SourcesBoardData.SourceRow
    var readAt: String? = nil
    @State private var detail: SourceLandingDetail?
    @State private var detailFailed = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    MarketSourceIdentity(source: sourceRow)
                    if let held = sourceRow.held, sourceRow.countsAsHeld != false {
                        RootedValueView(label: "Retained records", value: held.formatted(), status: .recorded,
                                        decay: "Counted " + ProfileClock.Absolute(sourceRow.heldAt))
                    }
                    if let sales = sourceRow.sales12, sales > 0 {
                        RootedValueView(label: "Measured sales · last 12 months", value: sales.formatted(), status: .recorded,
                                        decay: "Read " + ProfileClock.Absolute(readAt))
                    }
                } footer: {
                    Text("All makes represented by this source. Open a linked record to explore its vehicle on Nuke.")
                }
                if let detail {
                    Section {
                        if detail.recent.isEmpty {
                            Text("No retained records returned in this read.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(detail.recent) { event in
                            VStack(alignment: .leading, spacing: 6) {
                                if let id = event.vehicleUUID {
                                    NavigationLink {
                                        VehicleDetailView(vehicleId: id.uuidString, embedInNavigationStack: false)
                                    } label: {
                                        recordIdentity(event)
                                    }
                                } else {
                                    recordIdentity(event)
                                    Text("Vehicle profile not linked")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                if let url = event.openableURL {
                                    DisclosureGroup("Source") {
                                        Link("Original source record", destination: url).font(.caption)
                                    }
                                    .font(.caption)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    } header: {
                        Text("Vehicles and results")
                    } footer: {
                        Text("A sample of \(detail.recent.count) retained records across all makes. Record dates retain the source's precision; undated records have no established event date.")
                    }
                } else {
                    Section {
                        if detailFailed {
                            Text("Source records could not be read.").font(.footnote)
                            Button("Retry source records") { Task { await loadDetail() } }
                        } else {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Reading source records…").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section {
                    DisclosureGroup("Data coverage") {
                        coverageInfo
                    }
                }
            }
            .navigationTitle(sourceRow.shortName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await loadDetail() }
        }
    }

    private func loadDetail() async {
        detailFailed = false
        detail = await SourceLandingDetail.fetch(source: sourceRow.source)
        detailFailed = detail == nil
    }

    private func recordIdentity(_ event: SourceLandingDetail.RecentEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(event.headline).font(.subheadline.weight(.semibold))
            Text(event.recordDateLabel).font(.caption).foregroundStyle(.secondary)
            let kind = [event.eventType, event.eventStatus].compactMap { $0?.replacingOccurrences(of: "_", with: " ") }.joined(separator: " · ")
            if !kind.isEmpty { Text(kind).font(.caption2).foregroundStyle(.secondary) }
            if let lot = event.lot { Text("Lot \(lot)").font(.caption2.monospaced()).foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder private var coverageInfo: some View {
        let share = sourceRow.heldShare
        VStack(alignment: .leading, spacing: 6) {
            Text("Retained population").font(.subheadline.weight(.semibold))
            if let held = sourceRow.held {
                Text("\(SourcesBoardData.SourceRow.count(held)) records held · counted \(ProfileClock.Absolute(sourceRow.heldAt))")
                    .font(.caption)
            }
            if !share.text.isEmpty {
                HStack {
                    SourceShareBar(share: share).frame(width: 56, height: 6)
                    Text(share.text).font(.caption.monospaced())
                }
            }
            if let ref = share.reference { Text(ref).font(.caption2).foregroundStyle(.secondary) }
            Text(sourceRow.totalSentence).font(.caption2).foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 6) {
            Text("Records added to Nuke").font(.subheadline.weight(.semibold))
            Text("Intake counts and clocks describe when records reached Nuke, including older auctions and listings.")
                .font(.caption).foregroundStyle(.secondary)
            Text("The record sample is ordered by arrival in Nuke.").font(.caption).foregroundStyle(.secondary)
            HStack {
                metricCell(label: "15m", value: (detail?.landed15m ?? sourceRow.landed15m).formatted())
                Spacer()
                metricCell(label: "1h", value: (detail?.landed1h ?? sourceRow.landed1h).formatted())
                Spacer()
                metricCell(label: "24h", value: (detail?.landed24 ?? sourceRow.landed24).formatted())
                Spacer()
                metricCell(label: "7d", value: (detail?.landed7 ?? sourceRow.landed7).formatted())
            }
            Text("Read \(ProfileClock.Absolute(detail?.asOf))").font(.caption2).foregroundStyle(.secondary)
            if let detail {
                ForEach(detail.recent) { event in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.headline).font(.caption)
                        Text("Added to Nuke \(ProfileClock.Absolute(event.createdAt))")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func metricCell(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.subheadline, design: .monospaced).weight(.semibold))
        }
    }

}
