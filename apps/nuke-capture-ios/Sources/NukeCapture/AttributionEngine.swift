// AttributionEngine.swift — the on-device critical-mass router.
//
// Closes the upload→attribute gap: uploaded photos sit with vehicle_id=NULL
// until something routes them home. This is that something, on the phone:
//
//   PASS A (per orphan, on-device, $0):
//     • load the LOCAL asset (PhotoKit, no download)
//     • classify  → gate out non-vehicle frames (VisionEngine)
//     • VIN OCR + fuzzy-match against the owner's known VINs  → DEFINITIVE
//       (validated on a real worn 1984 plate: G→6 misread recovered at edit-dist 1)
//   PASS B (the sequence — "images are linear"):
//     • a session = one day at one GPS cell = one truck. If ANY frame in a
//       session got a VIN hit, the whole session inherits that vehicle.
//
// Trust: a VIN match PROMOTES vehicle_id (definitive). Session inheritance is
// written as a SUGGESTION (auto_suggested_vehicle_id + confidence) for the
// owner to confirm — never a raw vehicle_id from an unconfirmed guess.
//
// Feature-print similarity is deliberately NOT the decider: the live test
// proved Apple's generic print can't separate same-bodystyle trucks
// (white K10 ≈ blue GMC ≈ 0.69). It's a future weak tiebreaker only.

import Foundation
import Supabase

@MainActor
final class AttributionEngine: ObservableObject {
    static let shared = AttributionEngine()
    private init() {}

    @Published private(set) var isRunning = false
    @Published private(set) var lastSummary: String?
    @Published private(set) var progress: (done: Int, total: Int) = (0, 0)

    // ─── DB shapes ───────────────────────────────────────────────────────────
    private struct VehicleRow: Decodable { let id: String; let vin: String? }
    private struct Exif: Decodable { let uuid: String? }
    private struct OrphanRow: Decodable {
        let id: String
        let latitude: Double?
        let longitude: Double?
        let taken_at: String?
        let exif_data: Exif?
    }
    private struct SuggestUpdate: Encodable {
        let auto_suggested_vehicle_id: String
        let auto_suggestion_confidence: Double
        let auto_suggestion_reasons: [String]
    }
    private struct PromoteUpdate: Encodable {
        let vehicle_id: String
        let auto_suggested_vehicle_id: String
        let auto_suggestion_confidence: Double
        let auto_suggestion_reasons: [String]
    }

    // ─── Run ───────────────────────────────────────────────────────────────────

    /// Attribute this device's orphan photos. Returns true on a clean pass.
    @discardableResult
    func run(limit: Int = 200) async -> Bool {
        guard !isRunning else { return false }
        guard let userId = SupabaseService.currentUserId else { lastSummary = "Not signed in"; return false }
        isRunning = true
        defer { isRunning = false }

        // Known vehicles + VINs (the small set we fuzzy-match against).
        let knownVehicles = await fetchKnownVehicles(userId: userId)
        let knownVINs = knownVehicles.compactMap { $0.vin?.uppercased() }.filter { $0.count == 17 }
        let vinToVehicle = Dictionary(uniqueKeysWithValues:
            knownVehicles.compactMap { v in v.vin.map { ($0.uppercased(), v.id) } })

        let orphans = await fetchOrphans(userId: userId, limit: limit)
        guard !orphans.isEmpty else { lastSummary = "No orphan photos to attribute"; return true }
        progress = (0, orphans.count)

        // PASS A — per-orphan on-device analysis.
        struct Signal { let row: OrphanRow; let isVehicle: Bool; let vinVehicleId: String?; let vinDist: Int?; let session: String }
        var signals: [Signal] = []
        var vinHits = 0, skippedNonLocal = 0

        for row in orphans {
            defer { progress.done += 1 }
            guard let assetID = row.exif_data?.uuid,
                  let cg = await VisionEngine.loadCGImage(assetID: assetID) else { skippedNonLocal += 1; continue }

            let cls = VisionEngine.classify(cg)
            var vinVehicleId: String? = nil, vinDist: Int? = nil
            if !knownVINs.isEmpty, let m = VisionEngine.matchVIN(cg, knownVINs: knownVINs) {
                vinVehicleId = vinToVehicle[m.vin]; vinDist = m.editDistance; if vinVehicleId != nil { vinHits += 1 }
            }
            signals.append(Signal(row: row, isVehicle: cls?.isVehicle ?? false,
                                  vinVehicleId: vinVehicleId, vinDist: vinDist, session: sessionKey(row)))
        }

        // Build session→vehicle from VIN hits (one VIN anchors the whole session).
        var sessionVehicle: [String: String] = [:]
        for s in signals where s.vinVehicleId != nil { sessionVehicle[s.session] = s.vinVehicleId }

        // PASS B — write verdicts.
        var promoted = 0, suggested = 0, unresolved = 0
        for s in signals {
            if let vid = s.vinVehicleId {
                let conf = [0: 0.99, 1: 0.97, 2: 0.93][s.vinDist ?? 0] ?? 0.93
                await promote(imageId: s.row.id, vehicleId: vid, conf: conf,
                              reasons: ["vin_ocr_match", "edit_distance=\(s.vinDist ?? 0)"])
                promoted += 1
            } else if let vid = sessionVehicle[s.session], s.isVehicle {
                await suggest(imageId: s.row.id, vehicleId: vid, conf: 0.80,
                              reasons: ["session_inheritance", "vin_anchored_session", "session=\(s.session)"])
                suggested += 1
            } else {
                unresolved += 1   // no VIN, no anchored session, or not a vehicle frame → owner/server tier
            }
        }

        lastSummary = "\(promoted) routed (VIN) · \(suggested) suggested (session) · \(unresolved) unresolved · \(skippedNonLocal) not local · \(vinHits) VIN reads"
        NSLog("NukeCapture attribution: %@", lastSummary ?? "")
        return true
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /// Day + ~100m GPS cell = one work session = one truck (the sequence unit).
    private func sessionKey(_ r: OrphanRow) -> String {
        let day = (r.taken_at ?? "nodate").prefix(10)
        let lat = r.latitude.map { (($0 * 1000).rounded() / 1000) } ?? 0
        let lon = r.longitude.map { (($0 * 1000).rounded() / 1000) } ?? 0
        return "\(day)|\(lat),\(lon)"
    }

    private func fetchKnownVehicles(userId: String) async -> [VehicleRow] {
        do {
            return try await SupabaseService.client.from("vehicles")
                .select("id, vin").eq("user_id", value: userId).execute().value
        } catch { NSLog("attribution fetchKnownVehicles: %@", String(describing: error)); return [] }
    }

    private func fetchOrphans(userId: String, limit: Int) async -> [OrphanRow] {
        do {
            return try await SupabaseService.client.from("vehicle_images")
                .select("id, latitude, longitude, taken_at, exif_data")
                .eq("user_id", value: userId)
                .is("vehicle_id", value: nil)
                .eq("source", value: Config.sourceTag)
                .order("taken_at", ascending: false)
                .limit(limit)
                .execute().value
        } catch { NSLog("attribution fetchOrphans: %@", String(describing: error)); return [] }
    }

    private func promote(imageId: String, vehicleId: String, conf: Double, reasons: [String]) async {
        do {
            try await SupabaseService.client.from("vehicle_images")
                .update(PromoteUpdate(vehicle_id: vehicleId, auto_suggested_vehicle_id: vehicleId,
                                      auto_suggestion_confidence: conf, auto_suggestion_reasons: reasons))
                .eq("id", value: imageId).execute()
        } catch { NSLog("attribution promote: %@", String(describing: error)) }
    }

    private func suggest(imageId: String, vehicleId: String, conf: Double, reasons: [String]) async {
        do {
            try await SupabaseService.client.from("vehicle_images")
                .update(SuggestUpdate(auto_suggested_vehicle_id: vehicleId,
                                      auto_suggestion_confidence: conf, auto_suggestion_reasons: reasons))
                .eq("id", value: imageId).execute()
        } catch { NSLog("attribution suggest: %@", String(describing: error)) }
    }

    // ─── Owner-confirm sweep (the backlog surface) ───────────────────────────
    // Lists orphan sessions (one truck per day+GPS) and the owner's vehicles, so
    // the owner routes a whole session with one tap — the reliable path for
    // VIN-less sessions and the place "unknown vehicle?" surfaces. Routes through
    // the canonical attribute_image_session → attribute_testimony (audited).

    struct OrphanSession: Decodable, Identifiable, Sendable {
        let session_day: String
        let gps_cell: String
        let photo_count: Int
        let image_ids: [String]
        let sample_url: String?
        var id: String { session_day + "|" + gps_cell }
    }
    struct OwnerVehicle: Decodable, Identifiable, Sendable {
        let id: String
        let year: Int?
        let make: String?
        let model: String?
        let primary_image_url: String?
        var label: String {
            [year.map(String.init), make, model].compactMap { $0 }.filter { !$0.isEmpty }
                .joined(separator: " ").uppercased()
        }
    }
    private struct OrphanParams: Encodable { let p_user_id: String }
    private struct ConfirmParams: Encodable { let p_image_ids: [String]; let p_vehicle_id: String }

    @Published private(set) var orphanSessions: [OrphanSession] = []
    @Published private(set) var ownerVehicles: [OwnerVehicle] = []
    @Published private(set) var isLoadingConfirm = false

    /// Load the sessions awaiting confirmation + the owner's vehicles for the picker.
    func loadConfirmData() async {
        guard let userId = SupabaseService.currentUserId else { return }
        isLoadingConfirm = true
        defer { isLoadingConfirm = false }
        do {
            orphanSessions = try await SupabaseService.client
                .rpc("get_orphan_sessions", params: OrphanParams(p_user_id: userId))
                .execute().value
        } catch { NSLog("loadConfirmData sessions: %@", String(describing: error)) }
        do {
            ownerVehicles = try await SupabaseService.client.from("vehicles")
                .select("id, year, make, model, primary_image_url")
                .eq("user_id", value: userId)
                .order("updated_at", ascending: false)
                .execute().value
        } catch { NSLog("loadConfirmData vehicles: %@", String(describing: error)) }
    }

    /// Route a whole session to a vehicle (one tap). auth.uid() gates server-side.
    @discardableResult
    func confirm(session: OrphanSession, vehicleId: String) async -> Int {
        do {
            let routed: Int = try await SupabaseService.client
                .rpc("attribute_image_session",
                     params: ConfirmParams(p_image_ids: session.image_ids, p_vehicle_id: vehicleId))
                .execute().value
            orphanSessions.removeAll { $0.id == session.id }   // it's filed; drop it from the list
            return routed
        } catch { NSLog("confirm session: %@", String(describing: error)); return 0 }
    }
}
