// CaptureIngestStore.swift — feeds the live ingest status bar.
//
// Seeds from the table (rows created since the session started), then follows Realtime
// postgres_changes on public.capture_upload_status filtered to the signed-in user. Column names and
// decoding live in CaptureIngestStatus.swift. Read-only: nothing here writes to the database.
//
// (The capture_session_summary RPC returns totals, not per-photo rows, so the list seeds from the table.)
// If the table or the Realtime publication is missing, every call fails quietly: the rows
// stay empty and the bar stays hidden. Failures are logged, never shown, never thrown.

import Foundation
import Supabase

@MainActor
final class CaptureIngestStore: ObservableObject {
    @Published private(set) var rows: [CaptureUploadRow] = []
    @Published private(set) var vehicleNames: [String: String] = [:]

    /// Photos older than this belong to an earlier session. "Clear" moves it to now.
    private(set) var since: Date = Date().addingTimeInterval(-CaptureIngestStore.sessionWindow)
    static let sessionWindow: TimeInterval = 6 * 3600
    static let seedLimit = 200

    private var userId: String?
    private var lookedUp: Set<String> = []

    var summary: CaptureIngestSummary { CaptureIngestSummary(rows: rows, names: vehicleNames) }
    var isHidden: Bool { rows.isEmpty }

    /// Hide everything shot so far; the bar returns when the next photo arrives.
    func clear() {
        since = Date()
        rows = []
    }

    /// Runs until the calling task is cancelled (sign-out, account change, view gone).
    func run(userId: String) async {
        self.userId = userId
        if rows.isEmpty { since = Date().addingTimeInterval(-Self.sessionWindow) }
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
    }

    /// Re-read after the app returns to the foreground (postgres_changes has no replay).
    func refresh() async { await seed() }

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
