// GarageTimeline.swift — the garage cards' readers and the pure rules behind them, ported from the web's
// garage (nuke_frontend/src/components/vehicles/GarageVehicleCard.tsx, components/garage/GarageTab.tsx,
// hooks/useVehiclesDashboard.ts). Same readers, same words, same order:
//
// - get_vehicle_contribution_days_batch(p_vehicle_ids): one row per car with the profile timeline's
//   sources by day ([date, photos, work, events, documents]); 500 ids per call, as the web pages it.
// - vehicle_profile_read(p_vehicle_id): the card's price (masthead.price, a Claim) and configuration
//   (strip.facets minus body_style), read once per card when it appears; never current_value.
// - vehicle_images through VehicleGalleryImage.eligible, not sensitive, the web's order, 12 rows: the reel.
//
// The order is the newest dated activity (get_user_garage.last_activity_at, else the timeline's last day),
// undated cars last, under year headings. The day grid shares one window and one scale across the garage.

import Foundation
import Supabase

// MARK: The day reader

/// One day of recorded activity: photos, work sessions, events and document pages.
struct GarageTimelineDay: Equatable {
    let day: String
    let photos: Int
    let work: Int
    let events: Int
    let documents: Int
    var total: Int { photos + work + events + documents }
}

/// One car's row of get_vehicle_contribution_days_batch.
struct GarageTimeline: Decodable, Equatable {
    let vehicle_id: String
    let first_day: String
    let last_day: String
    let active_days: Int
    let photos: Int
    let work_days: Int
    let events: Int
    let documents: Int
    let days: [GarageTimelineDay]

    private enum CodingKeys: String, CodingKey {
        case vehicle_id, first_day, last_day, active_days, photos, work_days, events, documents, days
    }

    init(vehicle_id: String, first_day: String, last_day: String, active_days: Int = 0, photos: Int = 0,
         work_days: Int = 0, events: Int = 0, documents: Int = 0, days: [GarageTimelineDay]) {
        self.vehicle_id = vehicle_id; self.first_day = first_day; self.last_day = last_day
        self.active_days = active_days; self.photos = photos; self.work_days = work_days
        self.events = events; self.documents = documents; self.days = days
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        vehicle_id = try c.decode(String.self, forKey: .vehicle_id).lowercased()
        first_day = try c.decode(String.self, forKey: .first_day)
        last_day = try c.decode(String.self, forKey: .last_day)
        guard GarageOrder.isDay(first_day), GarageOrder.isDay(last_day) else {
            throw DecodingError.dataCorruptedError(forKey: .first_day, in: c, debugDescription: "not a day")
        }
        func count(_ key: CodingKeys) -> Int {
            (try? c.decodeIfPresent(Int.self, forKey: key)).flatMap { $0 }
                ?? (try? c.decodeIfPresent(Double.self, forKey: key)).flatMap { $0 }.map { Int($0) } ?? 0
        }
        active_days = count(.active_days); photos = count(.photos); work_days = count(.work_days)
        events = count(.events); documents = count(.documents)
        var rows: [GarageTimelineDay] = []
        if var list = try? c.nestedUnkeyedContainer(forKey: .days) {
            while !list.isAtEnd {
                guard var cell = try? list.nestedUnkeyedContainer() else { _ = try? list.decode(Skip.self); continue }
                guard let day = try? cell.decode(String.self), GarageOrder.isDay(day) else { continue }
                var n: [Int] = []
                while !cell.isAtEnd && n.count < 4 {
                    if let i = try? cell.decode(Int.self) { n.append(i) }
                    else if let d = try? cell.decode(Double.self) { n.append(Int(d)) }
                    else { _ = try? cell.decode(Skip.self); n.append(0) }
                }
                while n.count < 4 { n.append(0) }
                rows.append(GarageTimelineDay(day: day, photos: n[0], work: n[1], events: n[2], documents: n[3]))
            }
        }
        days = rows
    }

    /// Swallows one JSON value of any shape.
    private struct Skip: Decodable { init(from decoder: Decoder) throws {} }
}

/// The batch timeline read: every car's row, or a refusal the cards say in words ("Timeline unavailable").
enum GarageTimelineReader {
    static let name = "get_vehicle_contribution_days_batch"
    /// The reader's bound on ids per call.
    static let pageSize = 500

    static func read(ids: [String]) async -> JobLoad<[String: GarageTimeline]> {
        var all: [String: GarageTimeline] = [:]
        let unique = Array(Set(ids.map { $0.lowercased() })).sorted()
        do {
            for start in stride(from: 0, to: unique.count, by: pageSize) {
                let page = Array(unique[start..<min(unique.count, start + pageSize)])
                let data = try await SupabaseService.client.rpc(name, params: ["p_vehicle_ids": page]).execute().data
                all.merge(try decode(data), uniquingKeysWith: { first, _ in first })
            }
            return .loaded(all)
        } catch {
            NSLog("NukeCapture %@ failed: %@", name, String(describing: error))
            return .refused(JobReaders.refusal(name, error))
        }
    }

    /// Rows keyed by vehicle; a malformed row is dropped, a non-array answer throws.
    static func decode(_ data: Data) throws -> [String: GarageTimeline] {
        let rows = try JSONDecoder().decode([LossyRow].self, from: data)
        var out: [String: GarageTimeline] = [:]
        for case let row? in rows.map(\.value) { out[row.vehicle_id] = row }
        return out
    }

    private struct LossyRow: Decodable {
        let value: GarageTimeline?
        init(from decoder: Decoder) throws { value = try? GarageTimeline(from: decoder) }
    }
}

// MARK: Order and grouping

enum GarageOrder {
    static func isDay(_ s: String) -> Bool {
        s.count == 10 && s.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil
    }

    /// The day of the car's newest dated activity: the server's activity clock first, then the timeline's last day.
    static func lastDay(_ v: GarageVehicle, timeline: GarageTimeline?) -> String? {
        if let at = v.last_activity_at, at.count >= 10 {
            let day = String(at.prefix(10))
            if isDay(day) { return day }
        }
        return timeline?.last_day
    }

    /// Newest activity first, undated cars after the dated ones; ties keep the server's order.
    static func ordered(_ vehicles: [GarageVehicle], timelines: [String: GarageTimeline]) -> [GarageVehicle] {
        vehicles.enumerated()
            .map { (index: $0.offset, vehicle: $0.element, day: lastDay($0.element, timeline: timelines[$0.element.id.lowercased()])) }
            .sorted { a, b in
                switch (a.day, b.day) {
                case let (x?, y?) where x != y: return x > y
                case (.some, nil): return true
                case (nil, .some): return false
                default: return a.index < b.index
                }
            }
            .map(\.vehicle)
    }

    struct Group: Identifiable, Equatable {
        /// "2026", or "undated".
        let key: String
        let label: String
        let vehicles: [GarageVehicle]
        var id: String { key }
    }

    /// The ordered list cut where the year changes; "No dated activity" for undated cars.
    static func grouped(_ vehicles: [GarageVehicle], timelines: [String: GarageTimeline]) -> [Group] {
        var groups: [(key: String, vehicles: [GarageVehicle])] = []
        for v in ordered(vehicles, timelines: timelines) {
            let key = lastDay(v, timeline: timelines[v.id.lowercased()]).map { String($0.prefix(4)) } ?? "undated"
            if groups.last?.key == key { groups[groups.count - 1].vehicles.append(v) }
            else { groups.append((key, [v])) }
        }
        return groups.map { Group(key: $0.key, label: $0.key == "undated" ? "No dated activity" : $0.key, vehicles: $0.vehicles) }
    }
}

// MARK: The shared window and scale

/// A year of week columns ending this week (UTC days, Monday-first rows) and three steps at the quartiles of
/// the garage's active days in that window, so two cards' squares compare. The web's `garageAxis`.
struct GarageAxis: Equatable {
    static let weeks = 53
    /// Epoch day of the window's first Monday.
    let start: Int
    /// Epoch day of today (UTC); days after it are not drawn.
    let end: Int
    let steps: [Int]

    static func epochDay(_ date: Date) -> Int { Int((date.timeIntervalSince1970 / 86_400).rounded(.down)) }
    /// 0 = Monday … 6 = Sunday. 1970-01-01 (epoch day 0) was a Thursday.
    static func weekday(_ epochDay: Int) -> Int { ((epochDay + 3) % 7 + 7) % 7 }

    static func make(_ timelines: [GarageTimeline], now: Date = Date()) -> GarageAxis {
        let today = epochDay(now)
        let start = today - weekday(today) - (weeks - 1) * 7
        var totals: [Int] = []
        for t in timelines {
            for d in t.days {
                guard d.total > 0, let at = BuildBarcode.epochDay(d.day), at >= start, at <= today else { continue }
                totals.append(d.total)
            }
        }
        totals.sort()
        func at(_ q: Double) -> Int {
            totals.isEmpty ? 1 : totals[min(totals.count - 1, Int((q * Double(totals.count)).rounded(.down)))]
        }
        return GarageAxis(start: start, end: today, steps: [at(0.25), at(0.5), at(0.75)])
    }

    /// Days drawn: every day from the first Monday to today.
    var dayCount: Int { end - start + 1 }

    /// The square for an epoch day: column (week) and row (Monday = 0), or nil outside the window.
    func cell(_ epochDay: Int) -> (column: Int, row: Int)? {
        guard epochDay >= start, epochDay <= end else { return nil }
        let i = epochDay - start
        return (i / 7, i % 7)
    }

    /// Heat 3 … 6: one step up above each quartile of the garage's active days.
    func heat(_ total: Int) -> Int { 3 + steps.filter { total > $0 }.count }
}

// MARK: Words on the card

enum GarageCardText {
    private static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    static func month(_ day: String) -> String? {
        guard day.count >= 7, let m = Int(day.dropFirst(5).prefix(2)), (1...12).contains(m) else { return nil }
        return "\(months[m - 1]) \(day.prefix(4))"
    }

    /// "Active 19d ago": today, under 60 days in days, under two years in months, else years (the web's thresholds).
    static func activeAgo(_ day: String?, now: Date) -> String? {
        guard let day, isDayString(day),
              let at = ISO8601DateFormatter().date(from: "\(day)T12:00:00Z") else { return nil }
        let days = max(0, Int((now.timeIntervalSince(at) / 86_400).rounded()))
        if days == 0 { return "Active today" }
        if days < 60 { return "Active \(days)d ago" }
        if days < 730 { return "Active \(Int((Double(days) / 30).rounded()))mo ago" }
        return "Active \(Int((Double(days) / 365).rounded()))y ago"
    }

    private static func isDayString(_ s: String) -> Bool { GarageOrder.isDay(s) }

    /// What the record says the car is to the account, in the card's words.
    static func relationship(_ v: GarageVehicle) -> String {
        let head: String
        switch v.relationship {
        case "profile_record": head = "Profile you added"
        default: head = v.relationshipLabel
        }
        return [head, v.relationshipDetail].compactMap { $0 }.joined(separator: " · ")
    }

    /// The lane's items, most important first: relationship, activity, then the profile strip's facets.
    static func laneItems(relationship: String, active: String?, facets: [String]) -> [String] {
        [relationship] + [active].compactMap { $0 } + facets.filter { !$0.isEmpty }
    }

    /// Every prefix of the lane, longest first: the card shows the longest one its width holds.
    static func lanePrefixes(_ items: [String]) -> [[String]] {
        guard !items.isEmpty else { return [] }
        return stride(from: items.count, through: 1, by: -1).map { Array(items.prefix($0)) }
    }

    /// "Mar 2021 – Nov 2026", or one month when the record sits inside it.
    static func span(_ t: GarageTimeline?) -> String? {
        guard let t, let from = month(t.first_day), let to = month(t.last_day) else { return nil }
        return from == to ? from : "\(from) – \(to)"
    }

    private static func plural(_ n: Int, _ one: String, _ many: String) -> String { "\(n.formatted()) \(n == 1 ? one : many)" }

    /// Counts that exist; a zero is left out. image_count also holds undated photos, so the larger is the photo total.
    static func counts(_ t: GarageTimeline?, imageCount: Int) -> [String] {
        guard let t else { return imageCount > 0 ? [plural(imageCount, "photo", "photos")] : [] }
        let photos = max(t.photos, imageCount)
        return [
            photos > 0 ? plural(photos, "photo", "photos") : nil,
            t.work_days > 0 ? plural(t.work_days, "work day", "work days") : nil,
            t.events > 0 ? plural(t.events, "event", "events") : nil,
            t.documents > 0 ? plural(t.documents, "paper", "papers") : nil,
        ].compactMap { $0 }
    }
}

// MARK: Per-card reads (header and reel)

/// The card's slice of the profile's own header read, so a card and its profile state the same price and
/// configuration.
struct GarageCardHeader {
    let price: Claim?
    let priceLabel: String?
    /// Strip facet labels in the read's order, body style left out (the web's card does the same).
    let facets: [String]

    init(_ read: ProfileRead) {
        let p = read.masthead?.price
        price = (p?.value.number ?? 0) > 0 ? p : nil
        priceLabel = read.masthead?.priceLabel
        facets = (read.strip?.facets ?? []).filter { $0.dimension != "body_style" && !$0.label.isEmpty }.map(\.label)
    }
}

/// One reel photo: its url and the day it was taken, when the row has one.
struct GarageReelPhoto: Decodable, Equatable {
    let image_url: String?
    let taken_at: String?
    let is_sensitive: Bool?

    var day: String? { taken_at.map { String($0.prefix(10)) }.flatMap { GarageOrder.isDay($0) ? $0 : nil } }
}

@MainActor
enum GarageCardReads {
    private static let headers = CoalescingCache<GarageCardHeader?>(ttl: 600, limit: 600)
    private static let reels = CoalescingCache<[GarageReelPhoto]>(ttl: 300, limit: 600)

    /// vehicle_profile_read, once per card per ten minutes; nil when the read fails (the card leaves the price off).
    static func header(_ vehicleId: String) async -> GarageCardHeader? {
        (try? await headers.value(vehicleId) {
            let read: ProfileRead? = try await SupabaseService.client
                .rpc("vehicle_profile_read", params: ["p_vehicle_id": vehicleId]).execute().value
            return read.map(GarageCardHeader.init)
        }) ?? nil
    }

    /// The first 12 gallery-eligible, non-sensitive photos in the web's order (primary first, then position, then upload).
    static func reel(_ vehicleId: String) async -> [GarageReelPhoto]? {
        try? await reels.value(vehicleId) {
            let rows: [GarageReelPhoto] = try await VehicleGalleryImage.eligible(SupabaseService.client
                .from(VehicleImageLoader.source)
                .select("image_url,taken_at,is_sensitive")
                .eq("vehicle_id", value: vehicleId))
                .not("is_sensitive", operator: .is, value: "true")
                .order("is_primary", ascending: false, nullsFirst: false)
                .order("position", ascending: true, nullsFirst: false)
                .order("created_at", ascending: true)
                .limit(12)
                .execute().value
            return rows
        }
    }

    /// The cover first, then the reel's other photos once each; the cover's day comes from its own row.
    nonisolated static func pages(cover: String?, reel: [GarageReelPhoto]) -> [(url: String, day: String?)] {
        var seen = Set<String>()
        let rows = reel.filter { $0.is_sensitive != true }.compactMap { r -> (url: String, day: String?)? in
            guard let url = r.image_url, !url.isEmpty, seen.insert(url).inserted else { return nil }
            return (url, r.day)
        }
        guard let cover, !cover.isEmpty else { return rows }
        return [(cover, rows.first { $0.url == cover }?.day)] + rows.filter { $0.url != cover }
    }
}
