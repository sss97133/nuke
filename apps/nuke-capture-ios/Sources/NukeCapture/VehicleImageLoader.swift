// VehicleImageLoader.swift — one place the vehicle profile reads `vehicle_images` rows from.
//
// The profile used to build the same select (and gate) in six places, and re-ran the hero,
// cover and bookend reads whenever their task re-fired (a header reload changes the cover URL
// key; a sheet or the same profile reopened read everything again). Every read here shares the
// column list and the gallery gate (`VehicleGalleryImage.eligible`), and the single-shot reads
// (hero candidates, cover, primary, a bookend by id, a capture day) go through a short-lived,
// in-flight-coalescing cache: two sections asking for the same rows at once make one request.
// The paged gallery keeps its own read (it carries the exact count and paging), using the same
// columns. Rows are identical to before; only duplicate requests are gone.

import Foundation
import Supabase

/// Main-actor cache of async results by key: concurrent requests for one key share one fetch,
/// a success is reused for `ttl`, a failure is not kept. Generic so it is unit-testable.
@MainActor
final class CoalescingCache<Value> {
    private struct Entry { let value: Value; let at: Date }
    private var values: [String: Entry] = [:]
    private var inFlight: [String: Task<Value, Error>] = [:]
    let ttl: TimeInterval
    let limit: Int
    private let now: () -> Date

    init(ttl: TimeInterval, limit: Int = 64, now: @escaping () -> Date = Date.init) {
        self.ttl = ttl; self.limit = limit; self.now = now
    }

    func value(_ key: String, fetch: @escaping () async throws -> Value) async throws -> Value {
        if let e = values[key], now().timeIntervalSince(e.at) < ttl { return e.value }
        if let task = inFlight[key] { return try await task.value }
        let task = Task { try await fetch() }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        let v = try await task.value
        if values.count >= limit { values.removeAll(keepingCapacity: true) }
        values[key] = Entry(value: v, at: now())
        return v
    }

    /// Drop cached values whose key starts with `prefix` (e.g. one vehicle), or all.
    func invalidate(prefix: String? = nil) {
        guard let prefix else { values.removeAll(); return }
        values = values.filter { !$0.key.hasPrefix(prefix) }
    }

    var cachedKeys: Set<String> { Set(values.keys) }
}

@MainActor
enum VehicleImageLoader {
    /// The one column list every profile read of vehicle_images selects.
    static let columns = "id,image_url,thumbnail_url,is_primary,taken_at,labels,ai_processing_status,is_document,image_category,created_at,vision_gate_agent_reasoning,source,photo_imported_at:exif_data->>imported_at,photo_listing_url:exif_data->>source_url"

    static let cache = CoalescingCache<[VehicleGalleryImage]>(ttl: 60)

    static func key(_ vehicleId: String, _ parts: String...) -> String { ([vehicleId] + parts).joined(separator: "|") }

    private static func rows(_ key: String,
                             _ build: @escaping () -> PostgrestTransformBuilder) async throws -> [VehicleGalleryImage] {
        try await cache.value(key) { try await build().execute().value }
    }

    private static func gated() -> PostgrestFilterBuilder {
        VehicleGalleryImage.eligible(SupabaseService.client.from("vehicle_images").select(columns))
    }

    /// The exterior_body lead-image candidates, newest first (up to 200).
    static func heroCandidates(vehicleId: String) async throws -> [VehicleGalleryImage] {
        try await rows(key(vehicleId, "hero")) {
            gated().eq("vehicle_id", value: vehicleId).eq("image_category", value: "exterior_body")
                .order("taken_at", ascending: false, nullsFirst: false).limit(200)
        }
    }

    /// The gallery row carrying the record's cover URL (0 or 1 rows).
    static func cover(vehicleId: String, url: String) async throws -> [VehicleGalleryImage] {
        try await rows(key(vehicleId, "cover", url)) {
            gated().eq("vehicle_id", value: vehicleId).eq("image_url", value: url).limit(1)
        }
    }

    /// The explicitly selected (is_primary) gallery row (0 or 1 rows).
    static func primary(vehicleId: String) async throws -> [VehicleGalleryImage] {
        try await rows(key(vehicleId, "primary")) {
            gated().eq("vehicle_id", value: vehicleId).eq("is_primary", value: true).limit(1)
        }
    }

    /// One row by id, through the same gate (0 or 1 rows).
    static func image(id: UUID) async throws -> [VehicleGalleryImage] {
        let idString = id.uuidString.lowercased()
        return try await rows(key("image", idString)) { gated().eq("id", value: idString).limit(1) }
    }

    /// One capture day's frames, oldest first (up to 200). `from`/`to` are yyyy-MM-dd.
    static func day(vehicleId: String, from: String, to: String) async throws -> [VehicleGalleryImage] {
        try await rows(key(vehicleId, "day", from)) {
            gated().eq("vehicle_id", value: vehicleId).gte("taken_at", value: from).lt("taken_at", value: to)
                .order("taken_at", ascending: true).limit(200)
        }
    }

    /// Forget one vehicle's cached rows (pull-to-refresh, after an owner edit).
    static func invalidate(vehicleId: String) {
        cache.invalidate(prefix: vehicleId + "|")
        cache.invalidate(prefix: "image|")
    }
}
