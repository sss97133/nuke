// CaptureIngestStore.swift — feeds the live ingest status bar.
//
// Seeds from the table (rows created since the session started), then follows Realtime
// postgres_changes on public.capture_upload_status filtered to the signed-in user. Column names and
// decoding live in CaptureIngestStatus.swift. Read-only: nothing here writes to the database.
//
// (The capture_session_summary RPC returns totals, not per-photo rows, so the list seeds from the table.)
// If the table or the Realtime publication is missing, every call fails quietly: the rows
// stay empty and the bar stays hidden. Failures are logged, never shown, never thrown.
//
// It also holds the photo reading status (PhotoReadingStatus.swift): whether reading the owner's
// photos is moving or has stalled, in the server's words. That is one small read on its own slow
// loop (see `followReading`), beside the per-photo rows and independent of Realtime.

import Foundation
import Supabase
import UIKit

@MainActor
final class CaptureIngestStore: ObservableObject {
    @Published private(set) var rows: [CaptureUploadRow] = []
    @Published private(set) var vehicleNames: [String: String] = [:]
    /// Whether photo reading is moving or has stalled, in the server's words; nil when there is none.
    @Published private(set) var reading: PhotoReadingStatus?

    /// Photos older than this belong to an earlier session. "Clear" moves it to now.
    private(set) var since: Date = Date().addingTimeInterval(-CaptureIngestStore.sessionWindow)
    static let sessionWindow: TimeInterval = 6 * 3600
    static let seedLimit = 200

    private var userId: String?
    private var lookedUp: Set<String> = []
    /// Set while a `run` is following the reading. A new `run`, or the end of this one, replaces it,
    /// so an answer that arrives late for an earlier sign-in is dropped instead of shown.
    private var readingRun: UUID?

    var summary: CaptureIngestSummary { CaptureIngestSummary(rows: rows, names: vehicleNames) }
    /// Hidden with no photos to list, unless photo reading is moving or has stalled.
    var isHidden: Bool { PhotoReadingWords.barIsHidden(hasRows: !rows.isEmpty, reading: reading) }

    /// Hide everything shot so far; the bar returns when the next photo arrives.
    func clear() {
        since = Date()
        rows = []
    }

    /// Runs until the calling task is cancelled (sign-out, account change, view gone).
    func run(userId: String) async {
        self.userId = userId
        if rows.isEmpty { since = Date().addingTimeInterval(-Self.sessionWindow) }
        // A reading belongs to the run that read it: never carry one over from an earlier sign-in.
        let thisRun = UUID()
        readingRun = thisRun
        reading = nil
        // Photo reading follows its own loop, so it keeps answering when Realtime is unavailable.
        async let polling: Void = self.followReading()
        await seed()
        let channel = SupabaseService.client.channel("capture-ingest-\(userId)")
        let stream = channel.postgresChange(AnyAction.self, schema: "public",
                                            table: CaptureColumns.table,
                                            filter: "\(CaptureColumns.userId)=eq.\(userId)")
        await channel.subscribe()
        for await action in stream {
            if Task.isCancelled { break }
            apply(action)
        }
        await SupabaseService.client.removeChannel(channel)
        await polling
        // Nothing follows the reading any more, so it must not stay on screen and go stale.
        if readingRun == thisRun {
            readingRun = nil
            reading = nil
        }
    }

    /// Re-read after the app returns to the foreground (postgres_changes has no replay).
    func refresh() async {
        async let rowsRead: Void = self.seed()
        async let readingRead: Bool = self.loadReading()
        _ = await (rowsRead, readingRead)
    }

    // MARK: Photo reading status

    /// Follows the photo reading status until the calling task is cancelled.
    /// Bound (README, "Heat is a budget"): one small read when the store starts, then at most one
    /// every 120 seconds, and only while the app is active. After a failed read the wait doubles, up
    /// to 10 minutes, and the next read that works returns it to 120 seconds. It reads no photos and
    /// no originals, so it needs no thermal gate of its own.
    private func followReading() async {
        await loadReading()
        var wait = PhotoReadingReader.interval
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(wait)) } catch { return }
            guard UIApplication.shared.applicationState == .active else { continue }
            let worked = await loadReading()
            wait = PhotoReadingReader.nextWait(after: wait, succeeded: worked)
        }
    }

    /// One read; false when it failed. A failed read keeps the reading already on screen. A null
    /// answer (the server has no reading for this account) clears it. Nothing is read unless a `run`
    /// is following the reading, so the fixture backend never reaches this.
    @discardableResult
    private func loadReading() async -> Bool {
        guard let thisRun = readingRun else { return true }
        do {
            let fresh = try await PhotoReadingReader.read()
            // The sign-in may have changed, or the run ended, while the read was in flight.
            guard readingRun == thisRun else { return true }
            reading = fresh
            return true
        } catch {
            if !Task.isCancelled {
                NSLog("NukeCapture photo reading status unavailable: %@", String(describing: error))
            }
            return false
        }
    }

    // MARK: Seeding

    private func seed() async {
        guard let userId else { return }
        let sinceISO = CaptureParse.isoString(since)
        var fetched: [CaptureUploadRow]?
        do {
            let response = try await SupabaseService.client
                .from(CaptureColumns.table).select()
                .eq(CaptureColumns.userId, value: userId)
                .gte(CaptureColumns.createdAt, value: sinceISO)
                .order(CaptureColumns.updatedAt, ascending: false)
                .limit(Self.seedLimit)
                .execute()
            fetched = CaptureUploadRow.parseList(response.data)
        } catch {
            NSLog("NukeCapture ingest status select unavailable: %@", String(describing: error))
        }
        guard let fetched else { return }
        for row in fetched { merge(row) }
        await lookUpVehicleNames()
    }

    // MARK: Realtime

    private func apply(_ action: AnyAction) {
        switch action {
        case .insert(let a): applyRecord(a.record)
        case .update(let a): applyRecord(a.record)
        case .delete(let a):
            let old = Self.foundation(a.oldRecord)
            if let id = CaptureParse.string(CaptureParse.first(CaptureColumns.rowId, in: old)) {
                rows.removeAll { $0.id == id }
            }
        }
    }

    private func applyRecord(_ record: [String: AnyJSON]) {
        guard let row = CaptureUploadRow(json: Self.foundation(record)) else { return }
        merge(row)
        Task { await lookUpVehicleNames() }
    }

    /// AnyJSON → loose Foundation objects, so the tolerant reader in CaptureIngestStatus.swift sees it.
    private static func foundation(_ record: [String: AnyJSON]) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(record),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return object
    }

    /// Newest write wins; rows from before this session are ignored.
    private func merge(_ row: CaptureUploadRow) {
        if let t = row.createdAt ?? row.updatedAt, t < since { return }
        if let i = rows.firstIndex(where: { $0.id == row.id }) {
            if let old = rows[i].updatedAt, let new = row.updatedAt, new < old { return }
            rows[i] = row
        } else {
            rows.append(row)
        }
        rows.sort { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
    }

    // MARK: Vehicle names

    /// One quiet lookup per vehicle id, for rows that carry no name of their own.
    private func lookUpVehicleNames() async {
        // Names for the vehicles photos are on, and for ones the engine only matched so far.
        let ids = Set(rows.flatMap { row -> [String] in
            [row.vehicleName == nil ? row.vehicleId : nil, row.stepDetail.matchVehicleId].compactMap { $0 }
        })
            .subtracting(lookedUp).subtracting(vehicleNames.keys)
        guard !ids.isEmpty else { return }
        lookedUp.formUnion(ids)
        do {
            let response = try await SupabaseService.client
                .from("vehicles").select("id,year,make,model")
                .in("id", values: Array(ids))
                .execute()
            guard let list = (try? JSONSerialization.jsonObject(with: response.data)) as? [[String: Any]] else { return }
            for v in list {
                if let id = CaptureParse.string(v["id"]), let title = CaptureParse.vehicleTitle(v) { vehicleNames[id] = title }
            }
        } catch {
            NSLog("NukeCapture ingest vehicle names unavailable: %@", String(describing: error))
        }
    }
}
