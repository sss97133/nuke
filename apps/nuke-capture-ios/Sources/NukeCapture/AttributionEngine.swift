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
//     • legacy day/GPS buckets suggest an anchored vehicle; this is not yet
//       sufficient for automatic walk-around session filing.
//
// Direct serial reads file through the existing audited device writers. Contextual
// session inheritance below still produces suggestions; it must not be mistaken for
// the completed capture-session resolver. Local original-byte OCR is reused before
// any fresh reading. Known targets include the account's contributor associations.
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
        let file_hash: String?
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
        let knownVehicles: [VehicleRow]
        let orphans: [OrphanRow]
        let albumMap: [String: Set<String>]
        do {
            knownVehicles = try await fetchKnownVehicles(userId: userId)
            orphans = try await fetchOrphans(userId: userId, limit: limit)
            albumMap = try await fetchAlbumMap(userId: userId)
        } catch {
            lastSummary = "Photo filing couldn't load its evidence. \(ReadFailure.text(error))"
            return false
        }
        // Sync also runs on PhotoKit changes and refresh wakes. Do not depend on the delayed
        // screen task to populate the album catalog before trying to file its new photos.
        await LibraryStore.shared.refreshAlbums()
        let knownVINs = knownVehicles.compactMap { $0.vin?.uppercased() }.filter { $0.count >= 8 }
        let vinToVehicle = Self.unambiguousSerialVehicles(knownVehicles.compactMap { v in
            v.vin.map { (serial: $0, vehicleId: v.id) }
        })
        let catalog = LibraryStore.shared.albumCatalog
        let localPhotos = Dictionary(((catalog?.photos ?? []) + (catalog?.albums.flatMap(\.photos) ?? []))
            .map { ($0.localIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
        let method = LibraryIngest.albumMethodVersion

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
            guard !Task.isCancelled else { return false }
            guard let assetID = row.exif_data?.uuid else { skippedNonLocal += 1; continue }
            // Foreground sync has a zero *new* OCR budget. It must still consume original-byte
            // reads already retained by LibraryIngest, qualified by source and method version.
            let cached: LocalAlbumImageReview?
            if let photo = localPhotos[assetID] {
                cached = try? await Task.detached {
                    try LocalStore.shared.albumImageReview(for: photo, methodVersion: method)
                }.value
            } else { cached = nil }
            let lines: [String]
            let isVehicle: Bool
            if let cached, cached.inputSHA256 == row.file_hash {
                lines = cached.textLines + cached.vinCandidates
                isVehicle = cached.isVehicle
            } else {
                guard read < ocrBudget else { continue }
                guard let photo = localPhotos[assetID] else { skippedNonLocal += 1; continue }
                read += 1
                let result = await Task.detached(priority: .utility) {
                    await LibraryIngest.reviewAlbumPhoto(photo, method: method, allowNetwork: false)
                }.value
                guard let review = result.review, review.inputSHA256 == row.file_hash else {
                    skippedNonLocal += 1; continue
                }
                do { try await Task.detached { try LocalStore.shared.recordAlbumImageReview(review) }.value }
                catch {
                    lastSummary = "Photo filing couldn't retain its source read. \(ReadFailure.text(error))"
                    return false
                }
                lines = review.textLines + review.vinCandidates
                isVehicle = review.isVehicle
            }
            let match = knownVINs.isEmpty ? nil : VisionEngine.matchSerial(in: lines, known: knownVINs)
            let unknown = match == nil ? VisionEngine.vinCandidates(in: lines).first(where: {
                VisionEngine.isValidVIN($0) && !knownVINs.contains($0)
            }) : nil
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
        var albumGroups: [String: (name: String, ids: [String])] = [:]
        for row in orphans where !filedIDs.contains(row.id) {
            guard let uuid = row.exif_data?.uuid, let albums = albumsByAsset[uuid], !albums.isEmpty else { continue }
            let mapped = Self.mappedVehicles(for: albums, in: albumMap)
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
        var completedIDs = filing.filed

        // New profiles: unmatched valid VINs, and "year make model" albums with enough photos.
        var profileResults: [String] = []
        var byVIN: [String: [String]] = [:]
        for s in signals where !filedIDs.contains(s.row.id) {
            if let v = s.unknownVIN { byVIN[v, default: []].append(s.row.id) }
        }
        for (vin, ids) in byVIN {
            let result = await createProfile(DeviceProfileRequest(basis: "vin", vin: vin, serial: nil, year: nil, make: nil,
                    model: nil, album_name: nil, album_native_id: nil, image_ids: ids,
                    evidence: ["edit_distance": "0", "read": "on_device_ocr"]))
            profileResults.append(result.summary)
            completedIDs.formUnion(result.filed)
            filedIDs.formUnion(result.filed)
        }
        for (albumId, group) in albumGroups where group.ids.count >= Config.albumProfileMinPhotos {
            // The server needs year, make and model, each present in the album name.
            guard let label = AlbumLabel.parse(group.name), label.model != nil else { continue }
            let ids = group.ids.filter { !filedIDs.contains($0) }
            guard ids.count >= Config.albumProfileMinPhotos else { continue }
            let result = await createProfile(DeviceProfileRequest(basis: "album", vin: nil, serial: nil, year: label.year,
                    make: label.make, model: label.model, album_name: group.name, album_native_id: albumId,
                    image_ids: ids, evidence: ["album": group.name]))
            profileResults.append(result.summary)
            completedIDs.formUnion(result.filed)
            filedIDs.formUnion(result.filed)
        }

        // Fallback and sessions: what the server did not file stays a suggestion for the owner.
        // A shop cell can contain several cars. Preserve competing anchors rather
        // than silently taking the final VIN in database order.
        let sessionVehicle = Self.unambiguousSerialVehicles(signals.compactMap { signal in
            signal.vinVehicleId.map { (serial: signal.session, vehicleId: $0) }
        })
        var suggested = 0, unresolved = 0
        for s in signals where !completedIDs.contains(s.row.id) {
            if let vid = s.vinVehicleId {
                let conf = [0: 0.99, 1: 0.97, 2: 0.93][s.vinDist ?? 0] ?? 0.93
                await suggest(imageId: s.row.id, vehicleId: vid, conf: conf,
                              reasons: ["vin_ocr_match", "edit_distance=\(s.vinDist ?? 0)"])
                suggestionByImage[s.row.id] = vid
                suggested += 1
            } else if let vid = sessionVehicle[s.session.uppercased()], s.isVehicle {
                await suggest(imageId: s.row.id, vehicleId: vid, conf: 0.80,
                              reasons: ["session_inheritance", "vin_anchored_session", "session=\(s.session)"])
                suggestionByImage[s.row.id] = vid
                suggested += 1
            } else {
                unresolved += 1
            }
        }

        let readIDs = Set(signals.map { $0.row.id })
        let awaitingRead = orphans.filter { !completedIDs.contains($0.id) && !readIDs.contains($0.id) }.count
        lastSummary = (["\(completedIDs.count) filed (\(filing.byMethod.map { "\($0.key) \($0.value)" }.sorted().joined(separator: ", ")))",
                        profileResults.isEmpty ? nil : "profiles: " + profileResults.joined(separator: "; "),
                        "\(suggested) suggested", "\(unresolved) unresolved",
                        awaitingRead > 0 ? "\(awaitingRead) awaiting a read" : nil,
                        skippedNonLocal > 0 ? "\(skippedNonLocal) not on this phone" : nil,
                        filing.refused > 0 ? "\(filing.refused) refused by the server" : nil,
                        "\(vinHits) serial reads"].compactMap { $0 }).joined(separator: " · ")
        NSLog("NukeCapture attribution: %@", lastSummary ?? "")
        // The same pass report the sync writes (app_events, insert-only): what was filed, refused and
        // asked of the profile writer, so a pass that changes nothing can be seen from the server.
        let props: [String: AnyJSON] = [
            "orphans": .integer(orphans.count), "read": .integer(read), "filed": .integer(completedIDs.count),
            "awaiting_read": .integer(awaitingRead), "album_map_keys": .integer(albumMap.count),
            "refused": .integer(filing.refused), "suggested": .integer(suggested), "unresolved": .integer(unresolved),
            "album_groups": .integer(albumGroups.count), "profiles": .array(profileResults.map { .string($0) }),
            "ocr_budget": .integer(ocrBudget),
        ]
        struct Row: Encodable { let event: String; let props: [String: AnyJSON]; let user_id: String?; let path: String }
        let row = Row(event: "ios_attribution_pass", props: props, user_id: userId, path: "ios/attribution")
        Task.detached { try? await SupabaseService.client.from("app_events").insert(row).execute() }
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

    /// Files through `device_file_images` in chunks of 40; returns the ids the server filed.
    /// Each filing fires the vehicle's recount triggers (~250 ms), so the server stops starting
    /// items before the 15 s statement limit and returns the rest as "deferred"; those are sent
    /// again, up to three rounds.
    private func deviceFile(_ items: [DeviceFileItem]) async -> (filed: Set<String>, byMethod: [String: Int], refused: Int) {
        var filed = Set<String>(), byMethod: [String: Int] = [:], refused = 0
        var pending = items
        for _ in 0..<3 where !pending.isEmpty {
            var deferred: [DeviceFileItem] = []
            var i = 0
            while i < pending.count {
                let chunk = Array(pending[i..<min(i + 40, pending.count)])
                i += chunk.count
                struct P: Encodable { let p_items: [DeviceFileItem] }
                do {
                    let res: AnyJSON = try await SupabaseService.client.rpc("device_file_images", params: P(p_items: chunk)).execute().value
                    let statuses = Self.statuses(from: res)
                    for it in chunk {
                        switch statuses[it.image_id] {
                        case "filed", "already":
                            filed.insert(it.image_id); byMethod[it.method, default: 0] += 1
                        case "deferred", "busy":
                            deferred.append(it)
                        default:
                            refused += 1
                        }
                    }
                } catch {
                    NSLog("NukeCapture device_file_images failed: %@", String(describing: error))
                    refused += chunk.count
                }
            }
            pending = deferred
        }
        refused += pending.count
        return (filed, byMethod, refused)
    }

    /// image_id → status, from device_file_images' results.
    nonisolated static func statuses(from res: AnyJSON) -> [String: String] {
        guard case .object(let o) = res, case .array(let results)? = o["results"] else { return [:] }
        var out: [String: String] = [:]
        for r in results {
            guard case .object(let row) = r, case .string(let id)? = row["image_id"],
                  case .string(let status)? = row["status"] else { continue }
            out[id] = status
        }
        return out
    }

    /// Asks the server to resolve or create a profile; returns a one-line outcome for the summary.
    private func createProfile(_ req: DeviceProfileRequest) async -> (summary: String, filed: Set<String>) {
        struct P: Encodable { let p_profile: DeviceProfileRequest }
        let label = req.vin ?? [req.year.map(String.init), req.make, req.model].compactMap { $0 }.joined(separator: " ")
        do {
            let res: AnyJSON = try await SupabaseService.client.rpc("device_create_vehicle_profile", params: P(p_profile: req)).execute().value
            guard case .object(let o) = res, case .string(let status)? = o["status"] else {
                return ("\(label): unreadable profile response", [])
            }
            return ("\(label): \(status)", Self.profileFiledIDs(from: res).intersection(req.image_ids))
        } catch {
            NSLog("NukeCapture device_create_vehicle_profile failed: %@", String(describing: error))
            return ("\(label): \(ReadFailure.text(error))", [])
        }
    }

    nonisolated static func profileFiledIDs(from res: AnyJSON) -> Set<String> {
        guard case .object(let o) = res, let filing = o["filing"] else { return [] }
        return Set(statuses(from: filing).filter { $0.value == "filed" || $0.value == "already" }.map(\.key))
    }

    struct AlbumMapRow: Decodable {
        let apple_album_id: String
        let apple_album_name: String?
        let vehicle_id: String?
    }
    /// The owner's album → vehicle map (album_sync_map; row security limits it to the owner).
    /// Indexes by full apple_album_id, stripped PhotoKit localIdentifier (without "ios-source:<uid>:"),
    /// and normalized album name ("name:<lowercased>") so local albums always resolve.
    private func fetchAlbumMap(userId: String) async throws -> [String: Set<String>] {
        let rows: [AlbumMapRow] = try await SupabaseService.client.from("album_sync_map")
            .select("apple_album_id,apple_album_name,vehicle_id").eq("user_id", value: userId)
            .not("vehicle_id", operator: .is, value: "null").execute().value
        return Self.albumMap(rows)
    }

    nonisolated static func albumNameKey(_ name: String?) -> String? {
        guard let name else { return nil }
        let normalized = name.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        return normalized.isEmpty ? nil : "name:\(normalized)"
    }

    /// Keep competing mappings unresolved; database return order must never pick a vehicle.
    nonisolated static func albumMap(_ rows: [AlbumMapRow]) -> [String: Set<String>] {
        var out: [String: Set<String>] = [:]
        for r in rows {
            guard let vid = r.vehicle_id, !vid.isEmpty else { continue }
            out[r.apple_album_id, default: []].insert(vid)
            let parts = r.apple_album_id.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
            if parts.count == 3, parts[0] == "ios-source" {
                out[String(parts[2]), default: []].insert(vid)
            }
            if let name = albumNameKey(r.apple_album_name) {
                out[name, default: []].insert(vid)
            }
        }
        return out
    }

    nonisolated static func mappedVehicles(for albums: [LocalPhotoAlbum], in map: [String: Set<String>]) -> Set<String> {
        albums.reduce(into: Set<String>()) { vehicles, album in
            if let exact = map[album.id] { vehicles.formUnion(exact) }
            else if let key = albumNameKey(album.name), let named = map[key] { vehicles.formUnion(named) }
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

    /// Duplicate serial claims retain ambiguity instead of choosing whichever row arrived first.
    nonisolated static func unambiguousSerialVehicles(_ entries: [(serial: String, vehicleId: String)]) -> [String: String] {
        let grouped = Dictionary(grouping: entries, by: { $0.serial.uppercased() })
        return grouped.compactMapValues { rows in
            let ids = Set(rows.map(\.vehicleId))
            return ids.count == 1 ? ids.first : nil
        }
    }

    private func fetchKnownVehicles(userId: String) async throws -> [VehicleRow] {
        struct Params: Encodable { let p_user: String }
        let ids: [String] = try await SupabaseService.client.rpc("user_associated_vehicle_ids",
            params: Params(p_user: userId)).execute().value
        var vehicles: [VehicleRow] = []
        for start in stride(from: 0, to: ids.count, by: 200) {
            let chunk = Array(ids[start..<min(start + 200, ids.count)])
            let rows: [VehicleRow] = try await SupabaseService.client.from("vehicles")
                .select("id, vin").in("id", values: chunk).execute().value
            vehicles.append(contentsOf: rows)
        }
        return vehicles
    }

    private func fetchOrphans(userId: String, limit: Int) async throws -> [OrphanRow] {
        return try await SupabaseService.client.from("vehicle_images")
            .select("id, latitude, longitude, taken_at, exif_data, file_hash")
            .eq("user_id", value: userId)
            .is("vehicle_id", value: nil)
            .eq("source", value: Config.sourceTag)
            .neq("image_url", value: "")          // metadata-only rows have no picture to file
            .not("is_superseded", operator: .is, value: true)
            .not("is_duplicate", operator: .is, value: true)
            .or("vision_gate_status.is.null,vision_gate_status.not.in.(rejected_personal,rejected_misattributed)")
            // A newly uploaded historic or undated photo still deserves its first filing pass.
            .order("created_at", ascending: false)
            .order("id", ascending: false)
            .limit(limit)
            .execute().value
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
    // Sessions organize review by day and place; a shop can hold several vehicles.
    // Suggested filing needs each photo's own serial match. A manually chosen vehicle
    // remains an explicit session selection. Both route through
    // the canonical attribute_image_session → attribute_testimony (audited).

    struct OrphanSession: Decodable, Identifiable, Sendable {
        let session_day: String
        let gps_cell: String
        let photo_count: Int
        let image_ids: [String]
        let sample_url: String?
        let suggested_vehicle_id: String?
        let suggested_vehicle_label: String?
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
                .neq("make", value: "UNRESOLVED")
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

    /// File the owner's explicitly reviewed subset. auth.uid() gates server-side.
    @discardableResult
    func confirm(session: OrphanSession, vehicleId: String, selectedImageIDs: [String]) async throws -> Int {
        let ids = Self.reviewedPhotoIDs(selectedImageIDs, sessionIDs: session.image_ids)
        guard !ids.isEmpty else { throw SessionConfirmationError.noPhotoMatches }
        let routed: Int
        do { routed = try await fileMatchedPhotos(ids, vehicleId: vehicleId) }
        catch { await loadConfirmData(); throw error }
        // A zero-row result is not proof that this session was filed.
        guard routed > 0 else { throw SessionConfirmationError.noPhotosRouted }
        await loadConfirmData()
        return routed
    }

    nonisolated static func reviewedPhotoIDs(_ selected: [String], sessionIDs: [String]) -> [String] {
        Set(selected).intersection(sessionIDs).sorted()
    }

    struct PhotoSuggestion: Decodable {
        let id: String
        let vehicle_id: String?
        let auto_suggested_vehicle_id: String?
        let auto_suggestion_confidence: Double?
        let auto_suggestion_reasons: [String]?
    }

    /// A day/location fallback and a session-inherited guess are not photo identity evidence.
    nonisolated static func photoBackedIDs(_ rows: [PhotoSuggestion], requestedIDs: Set<String>, vehicleId: String) -> [String] {
        rows.filter {
            requestedIDs.contains($0.id) && $0.vehicle_id == nil &&
            $0.auto_suggested_vehicle_id?.lowercased() == vehicleId.lowercased() &&
            ($0.auto_suggestion_confidence ?? 0) >= 0.9 &&
            ($0.auto_suggestion_confidence ?? 0) <= 1 &&
            $0.auto_suggestion_reasons?.contains("vin_ocr_match") == true &&
            $0.auto_suggestion_reasons?.contains("session_inheritance") != true
        }.map(\.id)
    }

    private func matchedPhotoIDs(_ ids: [String], vehicleId: String) async throws -> [String] {
        guard let userId = SupabaseService.currentUserId else { throw SessionConfirmationError.noPhotoMatches }
        var matches: [String] = []
        for start in stride(from: 0, to: ids.count, by: 250) {
            try Task.checkCancellation()
            let chunk = Array(ids[start..<min(start + 250, ids.count)])
            let rows: [PhotoSuggestion] = try await SupabaseService.client.from("vehicle_images")
                .select("id,vehicle_id,auto_suggested_vehicle_id,auto_suggestion_confidence,auto_suggestion_reasons")
                .eq("user_id", value: userId).in("id", values: chunk)
                .is("vehicle_id", value: nil)
                .not("is_superseded", operator: .is, value: true)
                .not("is_duplicate", operator: .is, value: true)
                .or("vision_gate_status.is.null,vision_gate_status.not.in.(rejected_personal,rejected_misattributed)")
                .execute().value
            matches.append(contentsOf: Self.photoBackedIDs(rows, requestedIDs: Set(chunk), vehicleId: vehicleId))
        }
        return matches
    }

    private func fileMatchedPhotos(_ ids: [String], vehicleId: String) async throws -> Int {
        var filed = 0
        for start in stride(from: 0, to: ids.count, by: 40) {
            try Task.checkCancellation()
            let chunk = Array(ids[start..<min(start + 40, ids.count)])
            let n: Int = try await SupabaseService.client.rpc("attribute_image_session",
                params: ConfirmParams(p_image_ids: chunk, p_vehicle_id: vehicleId)).execute().value
            filed += n
        }
        return filed
    }

    @discardableResult
    func confirmSuggested(session: OrphanSession) async throws -> Int {
        guard let vehicleId = session.suggested_vehicle_id else { throw SessionConfirmationError.noPhotoMatches }
        let ids = try await matchedPhotoIDs(session.image_ids, vehicleId: vehicleId)
        guard !ids.isEmpty else { throw SessionConfirmationError.noPhotoMatches }
        let filed: Int
        do {
            filed = try await fileMatchedPhotos(ids, vehicleId: vehicleId)
        } catch {
            await loadConfirmData()
            throw error
        }
        await loadConfirmData()
        guard filed > 0 else { throw SessionConfirmationError.noPhotosRouted }
        return filed
    }

    /// One explicit action files photo-backed matches across sessions. Unmatched photos stay
    /// available for manual review, including after a partial write or a later request failure.
    @discardableResult
    func confirmAllSuggested(limit: Int? = nil) async throws -> (sessions: Int, photos: Int) {
        let candidates = orphanSessions.filter { $0.suggested_vehicle_id != nil }
        let slice = limit.map { Array(candidates.prefix($0)) } ?? candidates
        guard !slice.isEmpty else { return (0, 0) }

        let byVehicle = Dictionary(grouping: slice, by: { $0.suggested_vehicle_id ?? "" })
        var totalPhotos = 0
        do {
            for (vehicleId, group) in byVehicle {
                let ids = try await matchedPhotoIDs(group.flatMap(\.image_ids), vehicleId: vehicleId)
                totalPhotos += try await fileMatchedPhotos(ids, vehicleId: vehicleId)
            }
        } catch {
            await loadConfirmData()
            throw error
        }
        await loadConfirmData()
        guard totalPhotos > 0 else { throw SessionConfirmationError.noPhotoMatches }
        let remaining = Set(orphanSessions.map(\.id))
        let totalSessions = slice.filter { !remaining.contains($0.id) }.count
        return (totalSessions, totalPhotos)
    }

    enum SessionConfirmationError: LocalizedError {
        case noPhotosRouted, noPhotoMatches
        var errorDescription: String? {
            switch self {
            case .noPhotosRouted: return "No photos were moved. Refresh sessions before trying again."
            case .noPhotoMatches: return "No individual photo matches this suggestion yet. Review the photos before choosing a vehicle."
            }
        }
    }
}
