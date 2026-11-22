// ExploreFairRange.swift — an ask's fair range from close comparable sales, read from the database.
//
// The rule that decides which sales are close (same make and family, the model year, every distinguishing
// word of the listing's model such as "SS 396", sold in the last 36 months, at least five, not too spread)
// lives in the reader `ask_close_comps(p_vehicle_ids)`, never here. The phone only draws what the reader
// says: a "range" verdict becomes the rail's band; anything else, a missing reader or a failed read, reads
// "No opinion yet". The family's whole sold spread is never shown in its place.

import Foundation

struct AskFairRange: Equatable {
    struct Match: Equatable {
        var yearFrom: Int?
        var yearTo: Int?
        var make: String?
        var family: String?
        var tokens: [String] = []
        var windowFrom: String?
        var windowTo: String?
    }

    struct Comp: Equatable, Identifiable {
        let vehicleId: String?
        let title: String
        let soldOn: String?
        let price: Double?
        let venue: String?
        let url: URL?
        var id: String { [vehicleId ?? "", soldOn ?? "", title].joined(separator: "|") }
    }

    let vehicleId: String
    /// True only when the reader's verdict is "range".
    let hasRange: Bool
    /// The reader's plain sentence when it holds no opinion.
    let reason: String?
    let match: Match
    let n: Int
    let low: Double?
    let mid: Double?
    let high: Double?
    /// Close sales by venue, largest first.
    let venues: [(name: String, n: Int)]
    let conditionKnown: Int?
    let comps: [Comp]

    static func == (a: AskFairRange, b: AskFairRange) -> Bool {
        a.vehicleId == b.vehicleId && a.hasRange == b.hasRange && a.reason == b.reason && a.match == b.match
            && a.n == b.n && a.low == b.low && a.mid == b.mid && a.high == b.high
            && a.venues.map(\.name) == b.venues.map(\.name) && a.venues.map(\.n) == b.venues.map(\.n)
            && a.conditionKnown == b.conditionKnown && a.comps == b.comps
    }

    /// A band the rail may draw: a range verdict with a positive, ordered low..high.
    var band: (low: Double, high: Double)? {
        guard hasRange, let low, let high, low.isFinite, high.isFinite, low > 0, high >= low else { return nil }
        return (low, high)
    }

    /// "1967 Chevrolet Chevelle · SS 396".
    var matchText: String {
        let years: String? = {
            guard let a = match.yearFrom else { return nil }
            guard let b = match.yearTo, b != a else { return String(a) }
            return "\(a)–\(b)"
        }()
        let name = [years, match.make, match.family].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " ")
        let tokens = match.tokens.joined(separator: " ")
        return tokens.isEmpty ? name : name + " · " + tokens
    }

    /// How many close sales were at or under the ask, said plainly.
    func askPlacement(_ ask: Double?) -> String? {
        guard let ask, ask.isFinite, ask > 0 else { return nil }
        let prices = comps.compactMap(\.price).filter { $0.isFinite && $0 > 0 }
        guard !prices.isEmpty else { return nil }
        let under = prices.filter { $0 <= ask }.count
        let word = prices.count == 1 ? "close sale" : "close sales"
        if under == 0 { return "Below all \(prices.count) \(word)" }
        if under == prices.count { return "At or above all \(prices.count) \(word)" }
        return "\(under) of \(prices.count) \(word) sold at or under this ask"
    }
}

/// One read of `ask_close_comps` for the asks on the feed, keyed by vehicle id (lowercased).
struct AskFairBoard: Equatable {
    let asOf: Date?
    let byId: [String: AskFairRange]

    func range(for vehicleId: UUID?) -> AskFairRange? {
        vehicleId.flatMap { byId[$0.uuidString.lowercased()] }
    }

    /// The reader takes at most 60 ids a call, but a cold read of 40 has taken over 15 s (anon's statement timeout),
    /// so the phone sends 20 at a time, side by side (draft validation, PR #3717, 2026-11-22).
    static let chunk = 20

    private struct Params: Encodable { let p_vehicle_ids: [String] }

    /// nil when no chunk could be read (the reader is missing or failed): every ask then reads "No opinion yet".
    static func fetch(vehicleIds: [UUID]) async -> AskFairBoard? {
        let ids = Array(Set(vehicleIds.map { $0.uuidString.lowercased() })).sorted()
        guard !ids.isEmpty else { return nil }
        let parts = stride(from: 0, to: ids.count, by: chunk).map { Array(ids[$0..<min($0 + chunk, ids.count)]) }
        let boards: [AskFairBoard] = await withTaskGroup(of: AskFairBoard?.self) { group in
            for part in parts {
                group.addTask {
                    guard let res = try? await SupabaseService.client
                        .rpc("ask_close_comps", params: Params(p_vehicle_ids: part)).execute() else { return nil }
                    return decode(res.data)
                }
            }
            var out: [AskFairBoard] = []
            for await b in group { if let b { out.append(b) } }
            return out
        }
        guard !boards.isEmpty else { return nil }
        var byId: [String: AskFairRange] = [:]
        for b in boards { byId.merge(b.byId) { a, _ in a } }
        return AskFairBoard(asOf: boards.compactMap(\.asOf).min(), byId: byId)
    }

    // MARK: Decoding (lossy: a malformed row is skipped, a malformed field is absent)

    static func decode(_ data: Data) -> AskFairBoard? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let rows = (root["rows"] as? [Any]) ?? []
        var byId: [String: AskFairRange] = [:]
        for case let o as [String: Any] in rows {
            if let r = row(o) { byId[r.vehicleId] = r }
        }
        return AskFairBoard(asOf: ProfileClock.date(str(root["as_of"])), byId: byId)
    }

    static func row(_ o: [String: Any]) -> AskFairRange? {
        guard let id = str(o["vehicle_id"])?.lowercased(), UUID(uuidString: id) != nil else { return nil }
        let m = o["match"] as? [String: Any] ?? [:]
        let match = AskFairRange.Match(
            yearFrom: int(m["year_from"]), yearTo: int(m["year_to"]),
            make: str(m["make"]), family: str(m["family"]),
            tokens: (m["tokens"] as? [Any])?.compactMap { str($0) } ?? [],
            windowFrom: str(m["window_from"]), windowTo: str(m["window_to"]))
        let venues: [(name: String, n: Int)] = ((o["venues"] as? [String: Any]) ?? [:])
            .compactMap { k, v in int(v).map { (name: k, n: $0) } }
            .filter { $0.n > 0 }
            .sorted { $0.n != $1.n ? $0.n > $1.n : $0.name < $1.name }
        let comps: [AskFairRange.Comp] = ((o["comps"] as? [Any]) ?? []).compactMap { any in
            guard let c = any as? [String: Any] else { return nil }
            let title = str(c["title"]) ?? ""
            let url = str(c["url"]).flatMap { URL(string: $0) }.flatMap { ["http", "https"].contains($0.scheme?.lowercased() ?? "") ? $0 : nil }
            guard !title.isEmpty || url != nil else { return nil }
            return AskFairRange.Comp(vehicleId: str(c["vehicle_id"]), title: title.isEmpty ? (url?.host ?? "Sale") : title,
                                     soldOn: str(c["sold_on"]), price: num(c["price"]), venue: str(c["venue"]), url: url)
        }
        return AskFairRange(vehicleId: id, hasRange: str(o["verdict"]) == "range", reason: str(o["reason"]),
                            match: match, n: int(o["n"]) ?? comps.count, low: num(o["low"]), mid: num(o["mid"]),
                            high: num(o["high"]), venues: venues, conditionKnown: int(o["condition_known"]), comps: comps)
    }

    private static func str(_ v: Any?) -> String? {
        if let s = v as? String { let t = s.trimmingCharacters(in: .whitespacesAndNewlines); return t.isEmpty ? nil : t }
        if let n = v as? NSNumber { return n.stringValue }
        return nil
    }
    private static func num(_ v: Any?) -> Double? {
        // A JSON 0 or 1 also bridges to Bool, so a real boolean is told apart by its CF type.
        if let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { let d = n.doubleValue; return d.isFinite ? d : nil }
        if let s = v as? String, let d = Double(s), d.isFinite { return d }
        return nil
    }
    private static func int(_ v: Any?) -> Int? { num(v).flatMap { abs($0) < 1e15 ? Int($0) : nil } }
}
