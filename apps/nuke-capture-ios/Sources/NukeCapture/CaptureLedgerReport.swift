// CaptureLedgerReport.swift — the phone's end of the capture ledger (migration 20261111170000).
//
// THE ONE FILE that knows the ledger's RPC names. Three jobs:
//   1. report what this phone decided NOT to upload (the GPS site gate, screenshot / library / camera checks,
//      the personal hold, a photo that gave up) — asset id, reason and the photo's own clock, never coordinates
//      or pixels — so the website's ledger (/capture/ledger) can say why a photo is missing instead of nothing.
//   2. claim a "Re-scan my library" request the owner made on the website, and close it with the pass summary.
//   3. read the same ledger the website reads, in the same words, for the Work tab.
// Owner, 2026-11-07: "why's the website so disconnected functionally [from iOS]? they are not well aligned."

import Foundation
import Supabase
import UIKit

/// One skip, as the server's `report_capture_skips` takes it.
struct CaptureSkipRow: Encodable, Equatable {
    let asset_id: String
    let reason: String
    let taken_at: String?
    let device: String?
    let decided_at: String
}

/// The words both clients use. The website's CaptureLedger.tsx carries the same tables.
enum CaptureLedgerWords {
    static let skipReasons: [String: String] = [
        "no_location": "no location on the photo", "off_site": "outside a work site", "screenshot": "a screenshot",
        "not_library": "not in the photo library", "not_own_camera": "not from this phone's camera",
        "personal": "held as personal on the phone", "gave_up": "stopped retrying",
    ]
    static let allowedReasons: Set<String> = ["no_location", "off_site", "screenshot", "not_library", "not_own_camera", "personal", "gave_up"]

    static func skip(_ reason: String) -> String {
        skipReasons[reason] ?? reason.replacingOccurrences(of: "_", with: " ")
    }

    /// "949 photos · 507 on 1983 GMC K2500 · 417 on 1973 Pontiac Firebird · 14 held · 16 skipped on the phone · 1 failed":
    /// zero parts are dropped except the first. The same line the website's ingest bar shows.
    static func summary(totals t: CaptureLedgerTotals, vehicles: [CaptureLedgerVehicle]) -> String {
        let n = { (v: Int) -> String in NumberFormatter.localizedString(from: NSNumber(value: v), number: .decimal) }
        var parts = ["\(n(t.taken)) photo\(t.taken == 1 ? "" : "s")"]
        let top = Array(vehicles.sorted { $0.n != $1.n ? $0.n > $1.n : $0.name < $1.name }.prefix(2))
        parts += top.map { "\(n($0.n)) on \($0.name)" }
        let rest = t.on_vehicle + t.unverified - top.reduce(0) { $0 + $1.n }
        if rest > 0 { parts.append("\(n(rest)) on other vehicles") }
        if t.waiting > 0 { parts.append("\(n(t.waiting)) waiting on a check") }
        if t.held > 0 { parts.append("\(n(t.held)) held") }
        if t.unsorted > 0 { parts.append("\(n(t.unsorted)) not sorted yet") }
        if t.pulled > 0 { parts.append("\(n(t.pulled)) taken back off") }
        if t.private > 0 { parts.append("\(n(t.private)) kept private") }
        if t.skipped > 0 { parts.append("\(n(t.skipped)) skipped on the phone") }
        if t.failed > 0 { parts.append("\(n(t.failed)) failed") }
        return parts.joined(separator: " · ")
    }
}

struct CaptureLedgerTotals: Decodable, Equatable {
    var taken = 0, on_vehicle = 0, unverified = 0, waiting = 0, held = 0, pulled = 0, `private` = 0, unsorted = 0, failed = 0, skipped = 0
}
struct CaptureLedgerVehicle: Decodable, Equatable { let vehicle_id: String; let name: String; let n: Int }
struct CaptureLedgerDay: Decodable { let day: String; let vehicles: [CaptureLedgerVehicle] }
/// What `get_capture_ledger` returns; only what the phone shows is decoded.
struct CaptureLedgerPayload: Decodable {
    let totals: CaptureLedgerTotals
    let days: [CaptureLedgerDay]
    /// Vehicles across the window, biggest first, for the summary line.
    var vehicles: [CaptureLedgerVehicle] {
        var by: [String: CaptureLedgerVehicle] = [:]
        for d in days { for v in d.vehicles { by[v.vehicle_id] = CaptureLedgerVehicle(vehicle_id: v.vehicle_id, name: v.name, n: (by[v.vehicle_id]?.n ?? 0) + v.n) } }
        return by.values.sorted { $0.n != $1.n ? $0.n > $1.n : $0.name < $1.name }
    }
}
struct CaptureRescanRequest: Decodable { let id: String; let from_date: String?; let requested_at: String }

@MainActor
final class CaptureLedgerReporter {
    static let shared = CaptureLedgerReporter()
    static let rescanKey = "captureRescanRequestID"
    static let batch = 500

    /// What this run already reported, asset → reason; a changed reason is reported again.
    private(set) var reported: [String: String] = [:]
    private(set) var pending: [CaptureSkipRow] = []
    private let iso = ISO8601DateFormatter()
    private let defaults = UserDefaults.standard
    var device: String { "\(UIDevice.current.model) \(UIDevice.current.systemVersion)" }

    init() {}

    /// Queues one skip. Nothing leaves the phone until `flush()`; a repeat of the same decision is dropped.
    func record(assetId: String, reason: String, takenAt: Date?) {
        guard CaptureLedgerWords.allowedReasons.contains(reason), reported[assetId] != reason else { return }
        reported[assetId] = reason
        pending.append(CaptureSkipRow(asset_id: assetId, reason: reason, taken_at: takenAt.map(iso.string(from:)),
                                      device: device, decided_at: iso.string(from: Date())))
    }

    /// Sends what is queued, 500 at a time. A failure keeps the rows for the next pass.
    func flush() async {
        guard !pending.isEmpty, SupabaseService.currentUserId != nil else { return }
        struct Params: Encodable { let p_skips: [CaptureSkipRow] }
        while !pending.isEmpty {
            let chunk = Array(pending.prefix(Self.batch))
            do {
                _ = try await SupabaseService.client.rpc("report_capture_skips", params: Params(p_skips: chunk)).execute()
                pending.removeFirst(chunk.count)
            } catch {
                NSLog("NukeCapture: report_capture_skips failed: %@", String(describing: error))
                for row in chunk { reported[row.asset_id] = nil }   // let the next pass try again
                return
            }
        }
    }

    // MARK: Re-scan requests

    /// The request this phone claimed and has not yet closed.
    var pendingRescanID: String? {
        get { defaults.string(forKey: Self.rescanKey) }
        set { if let newValue { defaults.set(newValue, forKey: Self.rescanKey) } else { defaults.removeObject(forKey: Self.rescanKey) } }
    }

    /// Claims the owner's open re-scan request, if any. The caller re-arms ignition; the next pass closes it.
    func claimRescan() async -> CaptureRescanRequest? {
        guard SupabaseService.currentUserId != nil, pendingRescanID == nil else { return nil }
        do {
            let response = try await SupabaseService.client.rpc("claim_capture_rescan", params: ["p_device": device]).execute()
            guard let request = Self.decodeOptional(CaptureRescanRequest.self, from: response.data) else { return nil }
            pendingRescanID = request.id
            return request
        } catch {
            NSLog("NukeCapture: claim_capture_rescan failed: %@", String(describing: error))
            return nil
        }
    }

    /// Closes the claimed request with the pass that served it.
    func finishRescan(uploaded: Int, skipped: Int, failed: Int) async {
        guard let id = pendingRescanID else { return }
        struct Params: Encodable { let p_id: String; let p_result: [String: Int] }
        do {
            _ = try await SupabaseService.client.rpc("finish_capture_rescan", params: Params(p_id: id, p_result: ["uploaded": uploaded, "skipped": skipped, "failed": failed])).execute()
            pendingRescanID = nil
        } catch {
            NSLog("NukeCapture: finish_capture_rescan failed: %@", String(describing: error))
        }
    }

    // MARK: The ledger, read the way the website reads it

    func summaryLine(days: Int = 30) async -> String? {
        guard SupabaseService.currentUserId != nil else { return nil }
        struct Params: Encodable { let p_tz: String; let p_from: String; let p_to: String?; let p_limit: Int }
        let from = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone.current
        do {
            let response = try await SupabaseService.client
                .rpc("get_capture_ledger", params: Params(p_tz: TimeZone.current.identifier, p_from: f.string(from: from), p_to: nil, p_limit: 400))
                .execute()
            let payload = try JSONDecoder().decode(CaptureLedgerPayload.self, from: response.data)
            return CaptureLedgerWords.summary(totals: payload.totals, vehicles: payload.vehicles)
        } catch {
            NSLog("NukeCapture: get_capture_ledger failed: %@", String(describing: error))
            return nil
        }
    }

    /// A jsonb function returns `null` for nothing; JSONDecoder wants a real value.
    nonisolated static func decodeOptional<T: Decodable>(_ type: T.Type, from data: Data) -> T? {
        guard let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]), !(object is NSNull) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
