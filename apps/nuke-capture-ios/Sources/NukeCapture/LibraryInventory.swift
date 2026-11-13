// LibraryInventory.swift — the whole-library denominator, server-side.
//
// Why: on 2026-11-07 the server held 29,749 image rows against a ~80,000-photo camera roll and nothing could
// say which assets were never offered. sync() looks one day back (Config.firstRunLookback) and the persisted
// backfill queue only holds assets handed over after site confirmation. LibraryIngest walks the whole library
// but only into the on-device store.
//
// What this does: (1) enumerates EVERY accessible image PHAsset, metadata only, into the server table
// `library_inventory` (keyed user + localIdentifier) through checkpointed keyset pages, independent of the
// live watermark; (2) hands the pending, gate-eligible rows back to the EXISTING backfill queue in small
// batches; (3) reports each asset's outcome so the table converges. It never reads a byte and decides
// no privacy: every asset the drain returns still goes through SyncEngine.processAsset (site gate,
// Apple-camera check, contributor firewall, owner triage), so personal photos, IDs and financial documents
// stay on the phone and held rows stay held. Exact coordinates never leave the phone: the row carries a
// coarse (2-decimal) location and the on-device gate verdict.
//
// The 1-day incremental sync() path is untouched; it runs first in every pass, so new photos lead and the
// backlog refills only when the queue is empty (a bounded batch at a time).
//
// Pure pieces (cursor planner, gate verdict, row building, outcome mapping) are Photos-free so
// UnitTests/LibraryInventoryTests.swift covers them.

import Foundation
import Photos
import UIKit

// MARK: - Pure pieces

/// One enumerated asset as the server stores it. Field names are the column names.
struct InventoryRow: Codable, Equatable, Sendable {
    var asset_local_id: String
    var creation_date: Date?
    var media_type = "image"
    var media_subtypes: Int
    var source_type: String
    var is_screenshot: Bool
    var pixel_width: Int
    var pixel_height: Int
    var has_location: Bool
    var loc_lat_coarse: Double?
    var loc_lon_coarse: Double?
    var gate_verdict: String
    var origin_device_id: String?
    var origin_scope: String
}

/// What the device said about one asset, free of PhotoKit types.
struct InventoryAssetFacts: Sendable {
    var localIdentifier: String
    var creationDate: Date?
    var mediaSubtypesRaw: Int
    var sourceType: String          // SyncEngine.sourceTypeLabel
    var isScreenshot: Bool
    var pixelWidth: Int
    var pixelHeight: Int
    var latitude: Double?
    var longitude: Double?
}

enum LibraryInventoryPlan {
    /// Coordinates leave the phone only rounded to ~1.1 km.
    static func coarse(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    /// The same order as SyncEngine.processAsset's Gate 1, so the server's "eligible" matches what the
    /// per-asset path will conclude. Evaluated with the current sites; re-run after a site confirmation.
    static func gateVerdict(facts: InventoryAssetFacts, isAtSite: (Double, Double) -> Bool) -> String {
        guard facts.sourceType == "user_library" else { return "not_library" }
        guard !facts.isScreenshot else { return "screenshot" }
        guard let lat = facts.latitude, let lon = facts.longitude else { return "no_location" }
        return isAtSite(lat, lon) ? "at_site" : "off_site"
    }

    static func row(from facts: InventoryAssetFacts, scope: String, deviceID: String?,
                    isAtSite: (Double, Double) -> Bool) -> InventoryRow {
        InventoryRow(
            asset_local_id: facts.localIdentifier, creation_date: facts.creationDate,
            media_subtypes: facts.mediaSubtypesRaw, source_type: facts.sourceType,
            is_screenshot: facts.isScreenshot, pixel_width: facts.pixelWidth, pixel_height: facts.pixelHeight,
            has_location: facts.latitude != nil && facts.longitude != nil,
            loc_lat_coarse: facts.latitude.map(coarse), loc_lon_coarse: facts.longitude.map(coarse),
            gate_verdict: gateVerdict(facts: facts, isAtSite: isAtSite),
            origin_device_id: deviceID, origin_scope: scope)
    }

    /// Keyset paging over creationDate ascending. A page is fetched with `creationDate >= cursor`, so rows
    /// tied at the cursor are re-read (the server upsert is idempotent) and none is skipped at a page boundary.
    enum Step: Equatable {
        case done
        case advance(to: Date)      // next page starts at this date (inclusive)
        case widen(at: Date)        // a full page of one timestamp: read [at, at+tieWindow) unbounded, then move past it
    }
    static let tieWindow: TimeInterval = 0.001

    static func step(pageDates: [Date], pageSize: Int, cursor: Date) -> Step {
        guard pageDates.count >= pageSize, let last = pageDates.max() else { return .done }
        return last > cursor ? .advance(to: last) : .widen(at: cursor)
    }

    /// Whether a new enumeration run should start, and from where.
    enum RunPlan: Equatable { case none, full, incremental(from: Date) }
    static let fullRescanEvery: TimeInterval = 7 * 24 * 3600
    static let incrementalEvery: TimeInterval = 6 * 3600
    /// Late iCloud arrivals carry old creation dates, so an incremental run re-reads a margin behind its last
    /// completion; the weekly full run catches the rest.
    static let incrementalOverlap: TimeInterval = 3 * 24 * 3600

    static func plan(activeRun: Bool, lastFullAt: Date?, lastCompletedAt: Date?, now: Date) -> RunPlan {
        if activeRun { return .none }   // resume what is in flight
        guard let full = lastFullAt else { return .full }
        if now.timeIntervalSince(full) >= fullRescanEvery { return .full }
        if let done = lastCompletedAt, now.timeIntervalSince(done) >= incrementalEvery {
            return .incremental(from: done.addingTimeInterval(-incrementalOverlap))
        }
        return .none
    }

    /// The server's outcome name for an AssetOutcome; nil leaves the row untouched (iCloud-deferred or
    /// session-refused work costs the photo no attempt).
    static func outcomeState(_ outcome: SyncEngine.AssetOutcome) -> (state: String, reason: String?)? {
        switch outcome {
        case .uploaded, .queued: return ("uploaded", nil)
        case .offSite(let r): return ("off_site", r)
        case .notOwnCamera: return ("not_own_camera", nil)
        case .heldPrivate: return ("held_private", nil)
        case .deduped: return ("deduped", nil)
        case .gaveUp: return ("gave_up", "max_attempts")
        case .failed(let retry): return retry ? ("retry", nil) : ("gave_up", "failed")
        case .deferred, .authFailed: return nil
        }
    }
}

struct InventoryOutcome: Codable, Equatable, Sendable {
    var asset_local_id: String
    var state: String
    var reason: String?
}

// MARK: - Engine

@MainActor
final class LibraryInventory {
    static let shared = LibraryInventory()

    private let defaults = UserDefaults.standard
    private enum K {
        static let cursor = "libraryInventoryCursor"            // Double, timeIntervalSinceReferenceDate
        static let runID = "libraryInventoryRunID"              // String — present while a run is in flight
        static let runIsFull = "libraryInventoryRunIsFull"
        static let nilDatesDone = "libraryInventoryNilDatesDone"
        static let lastFullAt = "libraryInventoryLastFullAt"
        static let lastCompletedAt = "libraryInventoryLastCompletedAt"
        static let settledMarkedRun = "libraryInventorySettledMarkedRun"
        static let outbox = "libraryInventoryOutbox"           // JSON [InventoryOutcome] not yet reported
    }
    static let pageSize = 500
    private var running = false

    /// Foreground: a few pages per call, any network (the payload is a few hundred KB per 500 assets).
    /// Background: more pages, and only on the un-metered link the drain already requires.
    func runIfDue(background: Bool) async {
        guard !running, SupabaseService.currentUserId != nil else { return }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else { return }
        if background, !NetworkMonitor.shared.isUnmetered { return }
        if SyncEngine.deviceTooHotOrLow { return }
        running = true
        defer { running = false }

        let active = defaults.string(forKey: K.runID) != nil
        switch LibraryInventoryPlan.plan(activeRun: active, lastFullAt: defaults.object(forKey: K.lastFullAt) as? Date,
                                         lastCompletedAt: defaults.object(forKey: K.lastCompletedAt) as? Date, now: Date()) {
        case .none: if !active { return }
        case .full: begin(full: true, from: .distantPast)
        case .incremental(let from): begin(full: false, from: from)
        }
        let runID = UUID(uuidString: defaults.string(forKey: K.runID) ?? "") ?? UUID()
        let scope = status == .limited ? "limited" : "full"
        let device = UIDevice.current.identifierForVendor?.uuidString
        let maxPages = background ? 40 : 6

        if !defaults.bool(forKey: K.nilDatesDone) {
            guard await upload(fetch(nilDates: true), runID: runID, scope: scope, device: device) else { return }
            defaults.set(true, forKey: K.nilDatesDone)
        }
        for _ in 0..<maxPages {
            if Task.isCancelled || SyncEngine.deviceTooHotOrLow { return }
            if background, !NetworkMonitor.shared.isUnmetered { return }
            let cursor = Date(timeIntervalSinceReferenceDate: defaults.double(forKey: K.cursor))
            let page = fetch(from: cursor, limit: Self.pageSize)
            guard await upload(page, runID: runID, scope: scope, device: device) else { return }
            switch LibraryInventoryPlan.step(pageDates: page.compactMap(\.creationDate), pageSize: Self.pageSize, cursor: cursor) {
            case .done:
                complete()
                return
            case .advance(let to):
                defaults.set(to.timeIntervalSinceReferenceDate, forKey: K.cursor)
            case .widen(let at):
                let tied = fetch(from: at, until: at.addingTimeInterval(LibraryInventoryPlan.tieWindow))
                guard await upload(tied, runID: runID, scope: scope, device: device) else { return }
                defaults.set(at.addingTimeInterval(LibraryInventoryPlan.tieWindow).timeIntervalSinceReferenceDate, forKey: K.cursor)
            }
            await Task.yield()
        }
        // Budget spent: the cursor is checkpointed, the next call resumes here.
    }

    private func begin(full: Bool, from: Date) {
        defaults.set(UUID().uuidString, forKey: K.runID)
        defaults.set(full, forKey: K.runIsFull)
        defaults.set(from.timeIntervalSinceReferenceDate, forKey: K.cursor)
        defaults.set(!full, forKey: K.nilDatesDone)   // incremental runs skip the undated pass
    }

    private func complete() {
        let now = Date()
        if defaults.bool(forKey: K.runIsFull) { defaults.set(now, forKey: K.lastFullAt) }
        defaults.set(now, forKey: K.lastCompletedAt)
        defaults.removeObject(forKey: K.runID)
    }

    // PhotoKit reads (metadata only; no image data is requested)
    private func fetch(from: Date, until: Date? = nil, limit: Int = 0) -> [InventoryAssetFacts] {
        let o = PHFetchOptions()
        var format = "creationDate >= %@ AND mediaType == %d"
        var args: [Any] = [from as NSDate, PHAssetMediaType.image.rawValue]
        if let until { format += " AND creationDate < %@"; args.append(until as NSDate) }
        o.predicate = NSPredicate(format: format, argumentArray: args)
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        if limit > 0 { o.fetchLimit = limit }
        return facts(PHAsset.fetchAssets(with: o))
    }

    private func fetch(nilDates: Bool) -> [InventoryAssetFacts] {
        let o = PHFetchOptions()
        o.predicate = NSPredicate(format: "creationDate == nil AND mediaType == %d", PHAssetMediaType.image.rawValue)
        return facts(PHAsset.fetchAssets(with: o))
    }

    private func facts(_ result: PHFetchResult<PHAsset>) -> [InventoryAssetFacts] {
        var out: [InventoryAssetFacts] = []
        result.enumerateObjects { a, _, _ in
            out.append(InventoryAssetFacts(
                localIdentifier: a.localIdentifier, creationDate: a.creationDate,
                mediaSubtypesRaw: Int(a.mediaSubtypes.rawValue), sourceType: SyncEngine.sourceTypeLabel(for: a),
                isScreenshot: a.mediaSubtypes.contains(.photoScreenshot),
                pixelWidth: a.pixelWidth, pixelHeight: a.pixelHeight,
                latitude: a.location?.coordinate.latitude, longitude: a.location?.coordinate.longitude))
        }
        return out
    }

    private struct UpsertParams: Encodable { let p_rows: [InventoryRow]; let p_run_id: String }

    /// Upload one enumerated page in chunks of 500. False = a chunk failed; the cursor stays put and the
    /// next call retries the same page (the upsert is idempotent).
    private func upload(_ facts: [InventoryAssetFacts], runID: UUID, scope: String, device: String?) async -> Bool {
        let sites = SiteStore.shared
        let rows = facts.map { LibraryInventoryPlan.row(from: $0, scope: scope, deviceID: device) {
            sites.isAtSite(latitude: $0, longitude: $1)
        } }
        for start in stride(from: 0, to: rows.count, by: 500) {
            let chunk = Array(rows[start..<min(start + 500, rows.count)])
            do {
                try await SupabaseService.client.rpc("library_inventory_upsert",
                    params: UpsertParams(p_rows: chunk, p_run_id: runID.uuidString)).execute()
            } catch {
                NSLog("NukeCapture inventory upsert failed: %@", String(describing: error))
                return false
            }
        }
        return true
    }

    // MARK: Drain feed

    private struct IDRow: Decodable { let asset_local_id: String }
    private struct NextParams: Encodable { let p_limit: Int; let p_max_attempts: Int }

    /// The next backlog batch for the backfill queue: pending, gate-eligible rows, fewest attempts first.
    /// Rows that already have a vehicle_images row are settled server-side first (once per run).
    func nextBatch(limit: Int) async -> [String] {
        guard SupabaseService.currentUserId != nil else { return [] }
        let marker = defaults.string(forKey: K.settledMarkedRun) ?? ""
        let runKey = ((defaults.object(forKey: K.lastCompletedAt) as? Date)?.timeIntervalSince1970).map { String($0) } ?? "none"
        if marker != runKey {
            do {
                try await SupabaseService.client.rpc("library_inventory_mark_already_on_server").execute()
                defaults.set(runKey, forKey: K.settledMarkedRun)
            } catch { NSLog("NukeCapture inventory settle failed: %@", String(describing: error)) }
        }
        do {
            let rows: [IDRow] = try await SupabaseService.client.rpc("library_inventory_next_batch",
                params: NextParams(p_limit: limit, p_max_attempts: Config.maxAttemptsPerAsset)).execute().value
            return rows.map(\.asset_local_id)
        } catch {
            NSLog("NukeCapture inventory next_batch failed: %@", String(describing: error))
            return []
        }
    }

    // MARK: Outcomes (persisted, so an offline or killed pass loses nothing)

    func note(_ id: String, _ outcome: SyncEngine.AssetOutcome) {
        guard let o = LibraryInventoryPlan.outcomeState(outcome) else { return }
        var box = outbox
        box.append(InventoryOutcome(asset_local_id: id, state: o.state, reason: o.reason))
        outbox = box
    }

    func flushOutcomes() async {
        var box = outbox
        guard !box.isEmpty, SupabaseService.currentUserId != nil else { return }
        struct P: Encodable { let p_outcomes: [InventoryOutcome] }
        while !box.isEmpty {
            let chunk = Array(box.prefix(500))
            do {
                try await SupabaseService.client.rpc("library_inventory_record_outcomes", params: P(p_outcomes: chunk)).execute()
            } catch { NSLog("NukeCapture inventory outcomes failed: %@", String(describing: error)); return }
            box.removeFirst(chunk.count)
            outbox = box
        }
    }

    private var outbox: [InventoryOutcome] {
        get { (defaults.data(forKey: K.outbox)).flatMap { try? JSONDecoder().decode([InventoryOutcome].self, from: $0) } ?? [] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: K.outbox) }
    }
}
