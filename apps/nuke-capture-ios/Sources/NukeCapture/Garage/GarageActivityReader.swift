// GarageActivityReader.swift — the reads behind the garage activity feed, and the store a screen holds.
//
// Every source is a table or reader the app already calls (see GarageActivity.swift). A source that
// fails is named so the screen can say what is missing; only all of them failing is a failed read.
// No writes, no new RPC.

import Foundation
import Supabase

// MARK: - The reads

enum GarageActivityReader {
    /// Photos, timeline events, comments, listings and jobs.
    static let sourceCount = 5
    static let chunkSize = 40
    /// Work orders whose activity is read per refresh, newest listed first by the server.
    static let workOrderLimit = 10

    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }

    /// Reads every source at once. A source that fails is named in `unavailable`; the rest still show.
    static func read(vehicles: [GarageVehicle], now: Date = Date(), calendar: Calendar = .current) async -> GarageActivityResult {
        let known = GarageActivityVehicles(vehicles)
        let ids = Array(Set(vehicles.map { $0.vehicle_id.lowercased() })).sorted()
        guard !ids.isEmpty else { return GarageActivityResult(events: [], unavailable: [], readAt: now) }
        let since = now.addingTimeInterval(-Double(GarageActivityFeed.lookbackDays) * 86_400)

        async let photos = photoEvents(ids, known, since, now, calendar)
        async let timeline = timelineEvents(ids, known, since, now)
        async let comments = commentEvents(ids, known, since, now, calendar)
        async let listings = listingEvents(ids, known, now)
        async let jobs = jobEvents(Set(ids), known, since, now)
        let sources: [(name: String, events: [GarageActivityEvent]?)] = [
            ("photos", await photos), ("timeline events", await timeline), ("comments", await comments),
            ("listings", await listings), ("jobs", await jobs),
        ]
        let events = GarageActivityFeed.ordered(sources.flatMap { $0.events ?? [] }, now: now)
        return GarageActivityResult(events: events, unavailable: sources.filter { $0.events == nil }.map(\.name), readAt: now)
    }

    /// Runs one read per chunk of vehicle ids and joins the rows.
    private static func rows<T: Decodable>(_ ids: [String], _ fetch: @escaping ([String]) async throws -> [T]) async throws -> [T] {
        let chunks = stride(from: 0, to: ids.count, by: chunkSize).map { Array(ids[$0..<min($0 + chunkSize, ids.count)]) }
        return try await withThrowingTaskGroup(of: [T].self) { group in
            for chunk in chunks { group.addTask { try await fetch(chunk) } }
            var all: [T] = []
            for try await part in group { all += part }
            return all
        }
    }

    private static func fail(_ source: String, _ error: Error) -> [GarageActivityEvent]? {
        NSLog("NukeCapture garage activity %@ failed: %@", source, String(describing: error))
        return nil
    }

    private static func photoEvents(_ ids: [String], _ v: GarageActivityVehicles, _ since: Date, _ now: Date,
                                    _ calendar: Calendar) async -> [GarageActivityEvent]? {
        do {
            let sinceISO = iso(since)
            let found: [GarageActivityPhotoRow] = try await rows(ids) { chunk in
                try await VehicleGalleryImage.eligible(
                    SupabaseService.client.from("vehicle_images")
                        .select("id,vehicle_id,image_url,thumbnail_url,taken_at,source,photo_imported_at:exif_data->>imported_at"))
                    .in("vehicle_id", values: chunk)
                    .gte("taken_at", value: sinceISO)
                    .order("taken_at", ascending: false)
                    .limit(300)
                    .execute().value
            }
            return GarageActivityBuild.photoEvents(found, vehicles: v, now: now, calendar: calendar)
        } catch { return fail("photos", error) }
    }

    private static func timelineEvents(_ ids: [String], _ v: GarageActivityVehicles, _ since: Date, _ now: Date) async -> [GarageActivityEvent]? {
        do {
            let sinceISO = iso(since)
            let found: [GarageActivityTimelineRow] = try await rows(ids) { chunk in
                try await SupabaseService.client.from("vehicle_timeline_events")
                    .select("id,vehicle_id,event_type,event_date,title")
                    .in("vehicle_id", values: chunk)
                    .gte("event_date", value: sinceISO)
                    .order("event_date", ascending: false)
                    .limit(300)
                    .execute().value
            }
            return GarageActivityBuild.timelineEvents(found, vehicles: v, now: now)
        } catch { return fail("timeline", error) }
    }

    private static func commentEvents(_ ids: [String], _ v: GarageActivityVehicles, _ since: Date, _ now: Date,
                                      _ calendar: Calendar) async -> [GarageActivityEvent]? {
        do {
            let sinceISO = iso(since)
            let found: [GarageActivityCommentRow] = try await rows(ids) { chunk in
                try await SupabaseService.client.from("auction_comments")
                    .select("id,vehicle_id,posted_at")
                    .in("vehicle_id", values: chunk)
                    .gte("posted_at", value: sinceISO)
                    .order("posted_at", ascending: false)
                    .limit(500)
                    .execute().value
            }
            return GarageActivityBuild.commentEvents(found, vehicles: v, now: now, calendar: calendar)
        } catch { return fail("comments", error) }
    }

    /// No date filter: a change is a comparison with the observation before it, which may be older
    /// than the lookback. Only changes inside the lookback are shown by the feed's own grouping.
    private static func listingEvents(_ ids: [String], _ v: GarageActivityVehicles, _ now: Date) async -> [GarageActivityEvent]? {
        do {
            let found: [GarageActivityListingRow] = try await rows(ids) { chunk in
                try await SupabaseService.client.from("vehicle_events")
                    .select("id,vehicle_id,source_platform,source_listing_id,current_price,event_status,source_observed_at:metadata->>source_observed_at")
                    .in("vehicle_id", values: chunk)
                    .order("updated_at", ascending: false)
                    .limit(300)
                    .execute().value
            }
            let cutoff = now.addingTimeInterval(-Double(GarageActivityFeed.lookbackDays) * 86_400)
            return GarageActivityBuild.listingEvents(found, vehicles: v, now: now).filter { $0.at >= cutoff }
        } catch { return fail("listings", error) }
    }

    private static func jobEvents(_ ids: Set<String>, _ v: GarageActivityVehicles, _ since: Date, _ now: Date) async -> [GarageActivityEvent]? {
        guard case .loaded(let mine) = await JobReaders.myWorkOrders(limit: 25) else { return nil }
        let orders = Array(mine.rows.filter { row in row.vehicleId.map { ids.contains($0.lowercased()) } ?? false }.prefix(workOrderLimit))
        let sinceISO = iso(since)
        let reads: [(JobRow, JobActivity?)] = await withTaskGroup(of: (JobRow, JobActivity?).self) { group in
            for order in orders {
                group.addTask {
                    if case .loaded(let activity) = await ActivityReaders.read(workOrderId: order.workOrderId, since: sinceISO) {
                        return (order, activity)
                    }
                    return (order, nil)
                }
            }
            var out: [(JobRow, JobActivity?)] = []
            for await item in group { out.append(item) }
            return out
        }
        // One job that cannot be read makes the jobs source incomplete; say so rather than show a partial list as whole.
        if reads.contains(where: { $0.1 == nil }) { return nil }
        return reads.flatMap { order, activity in
            activity.map { GarageActivityBuild.jobEvents(workOrder: order, activity: $0, vehicles: v, now: now) } ?? []
        }
    }
}

// MARK: - The store

/// The feed's state for one screen: loading, loaded (kept while a refresh runs), or failed with a retry.
@MainActor
final class GarageActivityStore: ObservableObject {
    enum State: Equatable {
        case idle
        case loading
        case loaded(GarageActivityResult)
        case failed
    }

    @Published private(set) var state: State = .idle
    /// A refresh failed while an earlier read is still on screen.
    @Published private(set) var refreshFailed = false
    private var requests = ReadRequestGuard()

    var result: GarageActivityResult? {
        if case .loaded(let r) = state { return r }
        return nil
    }

    var latestByVehicle: [String: Date] { result?.latestByVehicle ?? [:] }

    func sorted(_ vehicles: [GarageVehicle]) -> [GarageVehicle] {
        GarageActivityFeed.byRecentActivity(vehicles, latest: latestByVehicle)
    }

    func refresh(vehicles: [GarageVehicle]) async {
        let request = requests.begin()
        if result == nil { state = .loading }
        let read = await GarageActivityReader.read(vehicles: vehicles)
        guard requests.isCurrent(request) else { return }
        if Task.isCancelled {
            if result == nil { state = .idle }
            return
        }
        // Every source failing is a failed read, not a quiet garage.
        if read.unavailable.count == GarageActivityReader.sourceCount {
            refreshFailed = result != nil
            if result == nil { state = .failed }
        } else {
            refreshFailed = false
            state = .loaded(read)
        }
    }
}
