// GarageActivity.swift — what happened in the owner's garage, newest first.
//
// An activity is a real, timestamped event tied to one of the account's vehicles, read from tables and
// readers the app already uses (no new RPC, no write):
//
//   photos      vehicle_images, by taken_at (the camera clock). A photo with no taken_at, and a listing
//               import (whose taken_at is the import clock), is not placed on the timeline.
//   work        my_work_orders -> work_order_activity_read, each event at its own `at` clock.
//   timeline    vehicle_timeline_events, at event_date. Photo-derived types are left out (the photos
//               above already count them), so one photo is never two events.
//   comments    auction_comments, at posted_at.
//   listing     vehicle_events: a price or status change between two observations of the same listing,
//               at the source's observed time. The first observation alone is not a change, so it is
//               not an event. vehicle_timeline_events sale and listing rows land here too.
//
// capture_upload_status is deliberately not a source: its clocks are upload times, and the photo it
// tracks is already the vehicle_images row above, at its taken_at.
//
// Nothing here estimates: an event without a usable clock or without readable text is dropped, and an
// unknown value is hidden. The pure parts (grouping, ordering, wording) are unit-tested.

import Foundation

/// One thing that happened to one vehicle.
struct GarageActivityEvent: Equatable, Identifiable {
    enum Kind: String, Equatable {
        case photos, work, timeline, comments, listing

        var label: String {
            switch self {
            case .photos: return "Photos"
            case .work: return "Work"
            case .timeline: return "Timeline"
            case .comments: return "Comments"
            case .listing: return "Listing"
            }
        }

        var symbol: String {
            switch self {
            case .photos: return "camera.fill"
            case .work: return "wrench.and.screwdriver.fill"
            case .timeline: return "clock.fill"
            case .comments: return "text.bubble.fill"
            case .listing: return "tag.fill"
            }
        }
    }

    let id: String
    let vehicleId: String
    let kind: Kind
    /// When it happened (the event clock, never the upload clock).
    let at: Date
    let headline: String
    /// The vehicle's name, when the record has one.
    let vehicleTitle: String?
    let detail: String?
    /// The event's own photo, else the vehicle's cover. Raw storage URL; sized at display time.
    let imageURL: String?

    /// Photo and comment headlines already name the vehicle ("3 new photos on 1967 Mustang").
    var headlineNamesVehicle: Bool { kind == .photos || kind == .comments }
}

/// The events of one read, and what could not be read.
struct GarageActivityResult: Equatable {
    var events: [GarageActivityEvent]
    /// Plain names of the sources that failed ("comments", "jobs"), so the screen says what is missing.
    var unavailable: [String]
    var readAt: Date

    /// Newest event clock per vehicle id (lowercased).
    var latestByVehicle: [String: Date] { GarageActivityFeed.latestByVehicle(events) }
}

/// Events grouped the way the feed shows them.
struct GarageActivityGroups: Equatable {
    var today: [GarageActivityEvent]
    var yesterday: [GarageActivityEvent]
    var thisWeek: [GarageActivityEvent]
    /// The newest event overall, offered when nothing happened today.
    var latestWhenQuiet: GarageActivityEvent?

    var isQuietToday: Bool { today.isEmpty }
    var isEmpty: Bool { today.isEmpty && yesterday.isEmpty && thisWeek.isEmpty && latestWhenQuiet == nil }
}

// MARK: - Pure parts (unit-tested)

enum GarageActivityFeed {
    /// How far back the reads look. The feed shows today, yesterday and the week; the rest only feeds
    /// "Last activity" and the quiet-day latest item.
    static let lookbackDays = 30
    /// An event clock this far ahead of now is a camera or server clock error, not news.
    static let futureTolerance: TimeInterval = 5 * 60

    /// Events with a usable clock, newest first, one per id. Ties break on id so the order is stable.
    static func ordered(_ events: [GarageActivityEvent], now: Date) -> [GarageActivityEvent] {
        var seen = Set<String>()
        return events
            .filter { $0.at <= now.addingTimeInterval(futureTolerance) }
            .filter { seen.insert($0.id).inserted }
            .sorted { $0.at != $1.at ? $0.at > $1.at : $0.id > $1.id }
    }

    /// Today / Yesterday / This week (the five days before yesterday). On a quiet day the newest event
    /// is carried separately and left out of the other groups so it never shows twice.
    static func group(_ events: [GarageActivityEvent], now: Date, calendar: Calendar = .current) -> GarageActivityGroups {
        let all = ordered(events, now: now)
        let startOfToday = calendar.startOfDay(for: now)
        let startOfYesterday = calendar.date(byAdding: .day, value: -1, to: startOfToday) ?? startOfToday
        let startOfWeek = calendar.date(byAdding: .day, value: -6, to: startOfToday) ?? startOfYesterday
        let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? now

        let today = all.filter { $0.at >= startOfToday && $0.at < startOfTomorrow }
        let latest = today.isEmpty ? all.first : nil
        let rest = all.filter { $0.id != latest?.id }
        return GarageActivityGroups(
            today: today,
            yesterday: rest.filter { $0.at >= startOfYesterday && $0.at < startOfToday },
            thisWeek: rest.filter { $0.at >= startOfWeek && $0.at < startOfYesterday },
            latestWhenQuiet: latest)
    }

    static func latestByVehicle(_ events: [GarageActivityEvent]) -> [String: Date] {
        var out: [String: Date] = [:]
        for e in events {
            let key = e.vehicleId.lowercased()
            if let known = out[key], known >= e.at { continue }
            out[key] = e.at
        }
        return out
    }

    /// Vehicles by most recent activity, newest first. A vehicle with no known activity keeps the
    /// order the server gave and follows every vehicle that has some.
    static func byRecentActivity(_ vehicles: [GarageVehicle], latest: [String: Date]) -> [GarageVehicle] {
        vehicles.enumerated().sorted { a, b in
            switch (latest[a.element.vehicle_id.lowercased()], latest[b.element.vehicle_id.lowercased()]) {
            case let (x?, y?): return x != y ? x > y : a.offset < b.offset
            case (.some, nil): return true
            case (nil, .some): return false
            case (nil, nil): return a.offset < b.offset
            }
        }.map(\.element)
    }

    /// "just now", "5m ago", "2h ago", "3d ago", then the date.
    static func relative(_ date: Date, now: Date) -> String {
        let s = now.timeIntervalSince(date)
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60))m ago" }
        if s < 86_400 { return "\(Int(s / 3600))h ago" }
        if s < 7 * 86_400 { return "\(Int(s / 86_400))d ago" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// "Last activity 2h ago" for a vehicle card; nil when no activity is on record.
    static func lastActivity(_ date: Date?, now: Date) -> String? {
        guard let date else { return nil }
        let when = relative(date, now: now)
        return when == "just now" ? "Last activity just now" : "Last activity \(when)"
    }

    static func photosHeadline(count: Int, vehicleTitle: String?) -> String {
        let n = NukeDisplay.count(count, "new photo")
        guard let title = NukeDisplay.text(vehicleTitle) else { return n }
        return "\(n) on \(title)"
    }

    static func commentsHeadline(count: Int, vehicleTitle: String?) -> String {
        let n = NukeDisplay.count(count, "new comment")
        guard let title = NukeDisplay.text(vehicleTitle) else { return n }
        return "\(n) on \(title)"
    }

    /// "comments and jobs", for the footnote about what could not be read.
    static func listed(_ names: [String]) -> String {
        switch names.count {
        case 0: return ""
        case 1: return names[0]
        case 2: return "\(names[0]) and \(names[1])"
        default: return names.dropLast().joined(separator: ", ") + ", and " + (names.last ?? "")
        }
    }
}

// MARK: - Rows the readers decode

struct GarageActivityPhotoRow: Decodable, Equatable {
    let id: String
    let vehicle_id: String?
    let image_url: String?
    let thumbnail_url: String?
    let taken_at: String?
    let source: String?
    let photo_imported_at: String?

    /// Legacy importers copied the import clock into taken_at; that is not a camera date.
    var isImported: Bool { photo_imported_at != nil || source?.lowercased().contains("import") == true }
}

struct GarageActivityTimelineRow: Decodable, Equatable {
    let id: String
    let vehicle_id: String?
    let event_type: String?
    let event_date: String?
    let title: String?
}

struct GarageActivityCommentRow: Decodable, Equatable {
    let id: String
    let vehicle_id: String?
    let posted_at: String?
}

struct GarageActivityListingRow: Decodable, Equatable {
    let id: String
    let vehicle_id: String?
    let source_platform: String?
    let source_listing_id: String?
    let current_price: Double?
    let event_status: String?
    let source_observed_at: String?
}

/// What the builders know about the account's vehicles.
struct GarageActivityVehicles: Equatable {
    let titles: [String: String]
    let covers: [String: String]

    init(_ vehicles: [GarageVehicle]) {
        var titles: [String: String] = [:], covers: [String: String] = [:]
        for v in vehicles {
            let key = v.vehicle_id.lowercased()
            if let t = NukeDisplay.text(v.title) { titles[key] = t }
            if let c = NukeDisplay.text(v.image_url) { covers[key] = c }
        }
        self.titles = titles
        self.covers = covers
    }

    func title(_ id: String) -> String? { titles[id.lowercased()] }
    func cover(_ id: String) -> String? { covers[id.lowercased()] }
}

enum GarageActivityBuild {
    /// Timeline types the photo source already counts, or that record a look rather than an event.
    static let skippedTimelineTypes: Set<String> = ["photo_session", "image_upload", "photo_added", "view", "like"]
    /// Timeline types that are price or listing news.
    static let listingTimelineTypes: Set<String> = [
        "listing", "auction", "auction_listed", "auction_sold", "listing_sold", "sale", "sold", "price_change", "price_drop",
    ]

    private static func dayKey(_ date: Date, _ calendar: Calendar) -> Int {
        Int(calendar.startOfDay(for: date).timeIntervalSince1970)
    }

    /// One event per vehicle per day of taking: "3 new photos on 1967 Mustang", at the newest taken_at.
    static func photoEvents(_ rows: [GarageActivityPhotoRow], vehicles: GarageActivityVehicles, now: Date,
                            calendar: Calendar = .current) -> [GarageActivityEvent] {
        struct Dated { let row: GarageActivityPhotoRow; let vehicleId: String; let at: Date }
        let dated: [Dated] = rows.compactMap { row in
            guard !row.isImported, let vid = row.vehicle_id, !vid.isEmpty,
                  let at = EventTime.clock(takenAt: row.taken_at),
                  at <= now.addingTimeInterval(GarageActivityFeed.futureTolerance) else { return nil }
            return Dated(row: row, vehicleId: vid.lowercased(), at: at)
        }
        let groups = Dictionary(grouping: dated) { "\($0.vehicleId)|\(dayKey($0.at, calendar))" }
        return groups.values.compactMap { group -> GarageActivityEvent? in
            guard let newest = group.max(by: { $0.at != $1.at ? $0.at < $1.at : $0.row.id < $1.row.id }) else { return nil }
            let vid = newest.vehicleId
            let title = vehicles.title(vid)
            return GarageActivityEvent(
                id: "photos:\(vid):\(dayKey(newest.at, calendar))", vehicleId: vid, kind: .photos, at: newest.at,
                headline: GarageActivityFeed.photosHeadline(count: group.count, vehicleTitle: title),
                vehicleTitle: title, detail: nil,
                imageURL: NukeDisplay.text(newest.row.image_url) ?? NukeDisplay.text(newest.row.thumbnail_url) ?? vehicles.cover(vid))
        }
    }

    /// One event per vehicle per day of posting, at the newest posted_at.
    static func commentEvents(_ rows: [GarageActivityCommentRow], vehicles: GarageActivityVehicles, now: Date,
                              calendar: Calendar = .current) -> [GarageActivityEvent] {
        struct Dated { let id: String; let vehicleId: String; let at: Date }
        let dated: [Dated] = rows.compactMap { row in
            guard let vid = row.vehicle_id, !vid.isEmpty, let at = ProfileClock.date(row.posted_at),
                  at <= now.addingTimeInterval(GarageActivityFeed.futureTolerance) else { return nil }
            return Dated(id: row.id, vehicleId: vid.lowercased(), at: at)
        }
        let groups = Dictionary(grouping: dated) { "\($0.vehicleId)|\(dayKey($0.at, calendar))" }
        return groups.values.compactMap { group -> GarageActivityEvent? in
            guard let newest = group.max(by: { $0.at != $1.at ? $0.at < $1.at : $0.id < $1.id }) else { return nil }
            let vid = newest.vehicleId
            let title = vehicles.title(vid)
            return GarageActivityEvent(
                id: "comments:\(vid):\(dayKey(newest.at, calendar))", vehicleId: vid, kind: .comments, at: newest.at,
                headline: GarageActivityFeed.commentsHeadline(count: group.count, vehicleTitle: title),
                vehicleTitle: title, detail: "On the auction listing", imageURL: vehicles.cover(vid))
        }
    }

    /// Timeline rows with a clock and a title, minus the photo-derived types.
    static func timelineEvents(_ rows: [GarageActivityTimelineRow], vehicles: GarageActivityVehicles,
                               now: Date) -> [GarageActivityEvent] {
        rows.compactMap { row in
            let type = (row.event_type ?? "").lowercased()
            guard !skippedTimelineTypes.contains(type), let vid = row.vehicle_id, !vid.isEmpty,
                  let at = ProfileClock.date(row.event_date),
                  at <= now.addingTimeInterval(GarageActivityFeed.futureTolerance),
                  let title = NukeDisplay.text(row.title) else { return nil }
            let id = vid.lowercased()
            return GarageActivityEvent(
                id: "timeline:\(row.id)", vehicleId: id,
                kind: listingTimelineTypes.contains(type) ? .listing : .timeline, at: at, headline: title,
                vehicleTitle: vehicles.title(id), detail: nil, imageURL: vehicles.cover(id))
        }
    }

    /// Price and status changes between two observations of one listing. The first observation of a
    /// listing is not a change and is not an event; a missing price or status is never compared.
    static func listingEvents(_ rows: [GarageActivityListingRow], vehicles: GarageActivityVehicles,
                              now: Date) -> [GarageActivityEvent] {
        struct Obs { let row: GarageActivityListingRow; let vehicleId: String; let at: Date }
        let observed: [Obs] = rows.compactMap { row in
            guard let vid = row.vehicle_id, !vid.isEmpty, let at = ProfileClock.date(row.source_observed_at) else { return nil }
            return Obs(row: row, vehicleId: vid.lowercased(), at: at)
        }
        let listings = Dictionary(grouping: observed) {
            "\($0.vehicleId)|\($0.row.source_platform ?? "")|\($0.row.source_listing_id ?? "")"
        }
        var events: [GarageActivityEvent] = []
        for series in listings.values {
            let ordered = series.sorted { $0.at != $1.at ? $0.at < $1.at : $0.row.id < $1.row.id }
            var lastPrice: Double?
            var lastStatus: String?
            for obs in ordered {
                let price = obs.row.current_price.flatMap { $0 > 0 && $0.isFinite ? $0 : nil }
                let status = NukeDisplay.text(obs.row.event_status)?.lowercased()
                var headline: String?
                if let price, let before = lastPrice, price != before, let a = NukeDisplay.money(before), let b = NukeDisplay.money(price) {
                    headline = "Price changed from \(a) to \(b)"
                } else if let status, let before = lastStatus, status != before {
                    headline = "Listing marked \(status.replacingOccurrences(of: "_", with: " "))"
                }
                if let price { lastPrice = price }
                if let status { lastStatus = status }
                guard let headline, obs.at <= now.addingTimeInterval(GarageActivityFeed.futureTolerance) else { continue }
                events.append(GarageActivityEvent(
                    id: "listing:\(obs.row.id)", vehicleId: obs.vehicleId, kind: .listing, at: obs.at, headline: headline,
                    vehicleTitle: vehicles.title(obs.vehicleId),
                    detail: obs.row.source_platform.flatMap { NukeDisplay.text($0) }.map(CapturedListings.sourceName),
                    imageURL: vehicles.cover(obs.vehicleId)))
            }
        }
        return events
    }

    /// A job's own events at their own clocks. Evidence photos are left to the photo source, and an
    /// event with no readable title is dropped.
    static func jobEvents(workOrder: JobRow, activity: JobActivity, vehicles: GarageActivityVehicles,
                          now: Date) -> [GarageActivityEvent] {
        guard let vid = workOrder.vehicleId?.lowercased(), !vid.isEmpty else { return [] }
        return activity.events.compactMap { event in
            guard event.kind != "evidence", let at = JobClock.date(event.at),
                  at <= now.addingTimeInterval(GarageActivityFeed.futureTolerance),
                  let title = NukeDisplay.text(event.title) else { return nil }
            return GarageActivityEvent(
                id: "work:\(workOrder.workOrderId):\(event.id)", vehicleId: vid, kind: .work, at: at, headline: title,
                vehicleTitle: vehicles.title(vid),
                detail: NukeDisplay.joined([workOrder.headline == "Untitled job" ? nil : workOrder.headline,
                                            ActivityCopy.roleLabel(event.role)]),
                imageURL: vehicles.cover(vid))
        }
    }
}
