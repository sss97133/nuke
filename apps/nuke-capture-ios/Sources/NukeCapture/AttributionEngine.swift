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
// Trust: nothing here writes vehicle_id. A VIN match and a session inheritance are both
// SUGGESTIONS (auto_suggested_vehicle_id + confidence + reasons); the owner files them in
// the confirm sheet, which goes through attribute_image_session → attribute_testimony
// (audited). The VIN match used to write vehicle_id with a raw client UPDATE, outside the
// sanctioned writers and without an audit row (2026-10-15).
//
// The vehicles matched against are every vehicle the account holds by user_id OR owner_id:
// user_id alone saw 5 VINs of the owner's 211 vehicles and missed the Charger and the
// Mustang, which he holds by owner_id.
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
    /// This run's suggestion per image id, so the confirm sheet can lead with it.
    @Published private(set) var suggestionByImage: [String: String] = [:]

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

    // ─── Run ───────────────────────────────────────────────────────────────────

    /// Attribute this device's orphan photos (uploaded rows with no vehicle). Returns true on a
    /// clean pass.
    ///
    /// Owner direction, 2026-10-15: "the app after vision run is supposed to assign the vehicle to a
    /// profile under the image owners associated vehicle profiles, its supposed to create new
    /// profiles if theres enough data to support it." So, in order of evidence strength:
    ///   1. a serial read (VIN or pre-1981 chassis number) matching one of the owner's vehicles →
    ///      file the photo (`device_file_images`, method vin_ocr / serial_ocr);
    ///   2. the owner's own album, mapped to a vehicle in album_sync_map → file (album_map);
    ///   3. a valid 17-character VIN that matches no vehicle, or an album named "year make model"
    ///      holding enough uploaded photos → ask the server to resolve or create the profile
    ///      (`device_create_vehicle_profile`, which enforces the thresholds and dedupes);
    ///   4. a session (same day, same ~100 m cell) anchored by a VIN read stays a suggestion: a lot
    ///      holds many vehicles.
    /// The server is the gate for every write (ownership of the photo, association with the
    /// vehicle, thresholds, audit through attribute_testimony). If it refuses or is not deployed,
    /// a serial read falls back to a suggestion, as before.
    @discardableResult
    func run(limit: Int = 200, ocrBudget: Int = 200) async -> Bool {
        guard !isRunning else { return false }
        guard let userId = SupabaseService.currentUserId else { lastSummary = "Not signed in"; return false }
        isRunning = true
        defer { isRunning = false }

        // Known vehicles + VINs (the small set we fuzzy-match against).
        let knownVehicles = await fetchKnownVehicles(userId: userId)
        let knownVINs = knownVehicles.compactMap { $0.vin?.uppercased() }.filter { $0.count >= 8 }
        let vinToVehicle = Dictionary(knownVehicles.compactMap { v in v.vin.map { ($0.uppercased(), v.id) } },
                                      uniquingKeysWith: { first, _ in first })

        let orphans = await fetchOrphans(userId: userId, limit: limit)
        guard !orphans.isEmpty else { lastSummary = "No orphan photos to attribute"; return true }
        progress = (0, orphans.count)

        // PASS A — per-orphan on-device reading, within the OCR budget.
        struct Signal {
            let row: OrphanRow; let isVehicle: Bool; let vinVehicleId: String?; let vinDist: Int?
            let unknownVIN: String?; let session: String
        }
        var signals: [Signal] = []
        var vinHits = 0, skippedNonLocal = 0, read = 0
        suggestionByImage = [:]

        for row in orphans {
            defer { progress.done += 1 }
            guard read < ocrBudget else { break }
            guard let assetID = row.exif_data?.uuid,
                  let cg = await VisionEngine.loadCGImage(assetID: assetID, maxPixel: 1600) else { skippedNonLocal += 1; continue }
            read += 1

            // Classify and OCR off the main actor (accurate OCR is seconds per frame).
            let vins = knownVINs
            let (isVehicle, match, unknown) = await Task.detached(priority: .utility) { () -> (Bool, (vin: String, editDistance: Int)?, String?) in
                let lines = VisionEngine.recognizeText(cg)
                let m = vins.isEmpty ? nil : VisionEngine.matchSerial(in: lines, known: vins)
                // A 17-character VIN with a valid check digit that matches none of the vehicles.
                let fresh = m == nil
                    ? VisionEngine.vinCandidates(in: lines).first(where: { VisionEngine.isValidVIN($0) && !vins.contains($0) })
                    : nil
                return (VisionEngine.classify(cg)?.isVehicle ?? false, m, fresh)
            }.value
            var vinVehicleId: String? = nil, vinDist: Int? = nil
            if let m = match {
                vinVehicleId = vinToVehicle[m.vin]; vinDist = m.editDistance; if vinVehicleId != nil { vinHits += 1 }
            }
            signals.append(Signal(row: row, isVehicle: isVehicle, vinVehicleId: vinVehicleId, vinDist: vinDist,
                                  unknownVIN: unknown, session: sessionKey(row)))
        }

        // PASS B — file what the evidence supports.
        var fileItems: [DeviceFileItem] = []
        var filedIDs = Set<String>()
        for s in signals {
            guard let vid = s.vinVehicleId else { continue }
            let full = (knownVehicles.first { $0.id == vid }?.vin?.count ?? 0) == 17
            let conf = full ? ([0: 0.99, 1: 0.97, 2: 0.93][s.vinDist ?? 0] ?? 0.93)
                            : ([0: 0.97, 1: 0.92][s.vinDist ?? 0] ?? 0.92)
            fileItems.append(DeviceFileItem(image_id: s.row.id, vehicle_id: vid, method: full ? "vin_ocr" : "serial_ocr",
                                            confidence: conf, evidence: ["edit_distance": "\(s.vinDist ?? 0)"]))
            filedIDs.insert(s.row.id)
        }

        // Albums: the owner's own grouping. Mapped albums file; unmapped "year make model" albums
        // with enough uploaded photos become profile requests.
        let albumsByAsset = Self.albumsByAsset()
        let albumMap = await fetchAlbumMap(userId: userId)
        var albumGroups: [String: (name: String, ids: [String])] = [:]
        for row in orphans where !filedIDs.contains(row.id) {
            guard let uuid = row.exif_data?.uuid, let albums = albumsByAsset[uuid], !albums.isEmpty else { continue }
            let mapped = Set(albums.compactMap { albumMap[$0.id] })
            if mapped.count == 1, let vid = mapped.first {
                let names = albums.compactMap(\.name).prefix(2).joined(separator: " | ")
                fileItems.append(DeviceFileItem(image_id: row.id, vehicle_id: vid, method: "album_map", confidence: 0.9,
                                                evidence: ["album": names]))
                filedIDs.insert(row.id)
            } else if mapped.isEmpty {
                for a in albums where AlbumLabel.parse(a.name) != nil {
                    albumGroups[a.id, default: (a.name ?? "", [])].ids.append(row.id)
                }
            }
        }

        let filing = await deviceFile(fileItems)

        // New profiles: unmatched valid VINs, and "year make model" albums with enough photos.
        var profileResults: [String] = []
        var byVIN: [String: [String]] = [:]
        for s in signals where !filedIDs.contains(s.row.id) {
            if let v = s.unknownVIN { byVIN[v, default: []].append(s.row.id) }
        }
        for (vin, ids) in byVIN {
            if let r = await createProfile(DeviceProfileRequest(basis: "vin", vin: vin, serial: nil, year: nil, make: nil,
                    model: nil, album_name: nil, album_native_id: nil, image_ids: ids,
                    evidence: ["edit_distance": "0", "read": "on_device_ocr"])) { profileResults.append(r) }
            ids.forEach { filedIDs.insert($0) }
        }
        for (albumId, group) in albumGroups where group.ids.count >= Config.albumProfileMinPhotos {
            guard let label = AlbumLabel.parse(group.name) else { continue }
            let ids = group.ids.filter { !filedIDs.contains($0) }
            guard ids.count >= Config.albumProfileMinPhotos else { continue }
            if let r = await createProfile(DeviceProfileRequest(basis: "album", vin: nil, serial: nil, year: label.year,
                    make: label.make, model: label.model, album_name: group.name, album_native_id: albumId,
                    image_ids: ids, evidence: ["album": group.name])) { profileResults.append(r) }
            ids.forEach { filedIDs.insert($0) }
        }

        // Fallback and sessions: what the server did not file stays a suggestion for the owner.
        var sessionVehicle: [String: String] = [:]
        for s in signals where s.vinVehicleId != nil { sessionVehicle[s.session] = s.vinVehicleId }
        var suggested = 0, unresolved = 0
        for s in signals where !filing.filed.contains(s.row.id) {
            if let vid = s.vinVehicleId {
                let conf = [0: 0.99, 1: 0.97, 2: 0.93][s.vinDist ?? 0] ?? 0.93
                await suggest(imageId: s.row.id, vehicleId: vid, conf: conf,
                              reasons: ["vin_ocr_match", "edit_distance=\(s.vinDist ?? 0)"])
                suggestionByImage[s.row.id] = vid
                suggested += 1
            } else if let vid = sessionVehicle[s.session], s.isVehicle {
                await suggest(imageId: s.row.id, vehicleId: vid, conf: 0.80,
                              reasons: ["session_inheritance", "vin_anchored_session", "session=\(s.session)"])
                suggestionByImage[s.row.id] = vid
                suggested += 1
            } else {
                unresolved += 1
            }
        }

        lastSummary = (["\(filing.filed.count) filed (\(filing.byMethod.map { "\($0.key) \($0.value)" }.sorted().joined(separator: ", ")))",
                        profileResults.isEmpty ? nil : "profiles: " + profileResults.joined(separator: "; "),
                        "\(suggested) suggested", "\(unresolved) unresolved",
                        skippedNonLocal > 0 ? "\(skippedNonLocal) not on this phone" : nil,
                        filing.refused > 0 ? "\(filing.refused) refused by the server" : nil,
                        "\(vinHits) serial reads"].compactMap { $0 }).joined(separator: " · ")
        NSLog("NukeCapture attribution: %@", lastSummary ?? "")
        return true
    }

    // ─── Device filing and profile requests (server-gated) ────────────────────

    struct DeviceFileItem: Encodable {
        let image_id: String
        let vehicle_id: String
        let method: String
        let confidence: Double
        let evidence: [String: String]
    }
    struct DeviceProfileRequest: Encodable {
        let basis: String
        let vin: String?
        let serial: String?
        let year: Int?
        let make: String?
        let model: String?
        let album_name: String?
        let album_native_id: String?
        let image_ids: [String]
        let evidence: [String: String]
    }

    /// Files through `device_file_images` in chunks; returns the ids the server filed.
    private func deviceFile(_ items: [DeviceFileItem]) async -> (filed: Set<String>, byMethod: [String: Int], refused: Int) {
        var filed = Set<String>(), byMethod: [String: Int] = [:], refused = 0
        var i = 0
        while i < items.count {
            let chunk = Array(items[i..<min(i + 200, items.count)])
            i += chunk.count
            struct P: Encodable { let p_items: [DeviceFileItem] }
            do {
                let res: AnyJSON = try await SupabaseService.client.rpc("device_file_images", params: P(p_items: chunk)).execute().value
                let ok = Self.filedIDs(from: res)
                filed.formUnion(ok)
                for it in chunk where ok.contains(it.image_id) { byMethod[it.method, default: 0] += 1 }
                refused += chunk.count - ok.count
            } catch {
                NSLog("NukeCapture device_file_images failed: %@", String(describing: error))
                refused += chunk.count
            }
        }
        return (filed, byMethod, refused)
    }

    /// Reads the image ids the server reports as filed (status "filed" or "already").
    private static func filedIDs(from res: AnyJSON) -> Set<String> {
        guard case .object(let o) = res, case .array(let results)? = o["results"] else { return [] }
        var out = Set<String>()
        for r in results {
            guard case .object(let row) = r, case .string(let id)? = row["image_id"],
                  case .string(let status)? = row["status"] else { continue }
            if status == "filed" || status == "already" { out.insert(id) }
        }
        return out
    }

    /// Asks the server to resolve or create a profile; returns a one-line outcome for the summary.
    private func createProfile(_ req: DeviceProfileRequest) async -> String? {
        struct P: Encodable { let p_profile: DeviceProfileRequest }
        do {
            let res: AnyJSON = try await SupabaseService.client.rpc("device_create_vehicle_profile", params: P(p_profile: req)).execute().value
            guard case .object(let o) = res, case .string(let status)? = o["status"] else { return nil }
            let label = req.vin ?? [req.year.map(String.init), req.make, req.model].compactMap { $0 }.joined(separator: " ")
            return "\(label): \(status)"
        } catch {
            NSLog("NukeCapture device_create_vehicle_profile failed: %@", String(describing: error))
            return nil
        }
    }

    private struct AlbumMapRow: Decodable { let apple_album_id: String; let vehicle_id: String? }
    /// The owner's album → vehicle map (album_sync_map; row security limits it to the owner).
    private func fetchAlbumMap(userId: String) async -> [String: String] {
        do {
            let rows: [AlbumMapRow] = try await SupabaseService.client.from("album_sync_map")
                .select("apple_album_id,vehicle_id").eq("user_id", value: userId)
                .not("vehicle_id", operator: .is, value: "null").execute().value
            return Dictionary(rows.compactMap { r in r.vehicle_id.map { (r.apple_album_id, $0) } },
                              uniquingKeysWith: { first, _ in first })
        } catch {
            NSLog("NukeCapture album map read failed: %@", String(describing: error))
            return [:]
        }
    }

    /// Asset id → the albums holding it, from the local album catalog.
    private static func albumsByAsset() -> [String: [LocalPhotoAlbum]] {
        guard let catalog = LibraryStore.shared.albumCatalog else { return [:] }
        var out: [String: [LocalPhotoAlbum]] = [:]
        for album in catalog.albums {
            for p in album.photos { out[p.localIdentifier, default: []].append(album) }
        }
        return out
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
                .select("id, vin").or("user_id.eq.\(userId),owner_id.eq.\(userId)").execute().value
        } catch { NSLog("attribution fetchKnownVehicles: %@", String(describing: error)); return [] }
    }

    private func fetchOrphans(userId: String, limit: Int) async -> [OrphanRow] {
        do {
            return try await SupabaseService.client.from("vehicle_images")
                .select("id, latitude, longitude, taken_at, exif_data")
                .eq("user_id", value: userId)
                .is("vehicle_id", value: nil)
                .eq("source", value: Config.sourceTag)
                .neq("image_url", value: "")          // metadata-only rows have no picture to file
                .order("taken_at", ascending: false)
                .limit(limit)
                .execute().value
        } catch { NSLog("attribution fetchOrphans: %@", String(describing: error)); return [] }
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
    @Published private(set) var confirmLoaded = false
    @Published private(set) var confirmLoadError: String?

    /// Load the sessions awaiting confirmation + the owner's vehicles for the picker.
    func loadConfirmData() async {
        guard !isLoadingConfirm else { return }
        guard let userId = SupabaseService.currentUserId else {
            confirmLoadError = "Sign in to load your sessions."
            return
        }
        isLoadingConfirm = true
        confirmLoadError = nil
        defer { isLoadingConfirm = false }
        do {
            let sessions: [OrphanSession] = try await SupabaseService.client
                .rpc("get_orphan_sessions", params: OrphanParams(p_user_id: userId))
                .execute().value
            let vehicles: [OwnerVehicle] = try await SupabaseService.client.from("vehicles")
                .select("id, year, make, model, primary_image_url")
                .or("user_id.eq.\(userId),owner_id.eq.\(userId)")
                .order("updated_at", ascending: false)
                .execute().value
            orphanSessions = sessions
            ownerVehicles = vehicles
            confirmLoaded = true
        } catch {
            confirmLoadError = "Couldn't load your sessions. Retry."
            NSLog("NukeCapture confirmation load failed: %@", String(describing: error))
        }
    }

    /// Route a whole session to a vehicle (one tap). auth.uid() gates server-side.
    @discardableResult
    func confirm(session: OrphanSession, vehicleId: String) async throws -> Int {
        let routed: Int = try await SupabaseService.client
            .rpc("attribute_image_session",
                 params: ConfirmParams(p_image_ids: session.image_ids, p_vehicle_id: vehicleId))
            .execute().value
        // A zero-row result is not proof that this session was filed.
        guard routed > 0 else { throw SessionConfirmationError.noPhotosRouted }
        orphanSessions.removeAll { $0.id == session.id }
        return routed
    }

    enum SessionConfirmationError: LocalizedError {
        case noPhotosRouted
        var errorDescription: String? {
            "No photos were moved. Close this sheet and refresh sessions before trying again."
        }
    }
}
