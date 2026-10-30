// AttributionEngine.swift — the on-device critical-mass router.
//
// Closes the upload→attribute gap: uploaded photos sit with vehicle_id=NULL
// until something routes them home. This is that something, on the phone:
//
//   PASS A (per orphan, on-device, $0):
//     • load the LOCAL asset (PhotoKit, no download)
//     • fresh classify + OCR against this method's source-hash cache namespace
//   PASS B (context before identity):
//     • exact valid VIN + same-run time/GPS neighborhood + classified car views
//       → source-pass receipt → existing audited VIN/profile writer
//
// Old cloud analysis and older local method versions never qualify as the new read.
// A VIN printed on a document cannot file a photo by itself.
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
    /// Sessions with a cowl tag but no VIN/serial read: no profile until the plate is photographed.
    @Published private(set) var pendingIdentifiers: [CaptureContextReader.PendingIdentifier] = []
    /// Server candidate-profile path (another lane). Nil until that lane provides one.
    var candidateProfiles: CandidateProfileRequesting? = nil
    private var qualifiedFollowupKeys = Set<String>()

    // ─── DB shapes ───────────────────────────────────────────────────────────
    private struct VehicleRow: Decodable {
        let id: String; let vin: String?
        var body_style: String? = nil; var canonical_body_style: String? = nil; var model: String? = nil
    }
    private struct Exif: Decodable { let uuid: String? }
    private struct OrphanRow: Decodable {
        let id: String
        let vehicle_id: String?
        let latitude: Double?
        let longitude: Double?
        let taken_at: String?
        let is_document: Bool?
        let doc_flag: Bool?
        let is_sensitive: Bool?
        let exif_data: Exif?
        let file_hash: String?
    }
    struct VINCaptureFrame: Equatable, Sendable {
        let imageID: String
        let vin: String?
        let exactVIN: Bool
        let takenAt: String?
        let latitude: Double?
        let longitude: Double?
        let fileHash: String?
        let isVehicle: Bool
        let isDocument: Bool
        let isSensitive: Bool
        let contextualYear: Int?
        let contextualMake: String?
        let contextualModel: String?
        let albumContextAmbiguous: Bool
        /// The read matched one of the owner's own vehicles exactly (roster match), so a classic
        /// serial needs no album context to be worth uploading.
        var rosterMatch: Bool = false

        /// The same frame with a session-derived namespace in the contextual slots (for the
        /// serial-read upload confidence, which keys on a known make).
        func withContext(_ c: CaptureContext) -> VINCaptureFrame {
            VINCaptureFrame(imageID: imageID, vin: vin, exactVIN: exactVIN, takenAt: takenAt, latitude: latitude,
                longitude: longitude, fileHash: fileHash, isVehicle: isVehicle, isDocument: isDocument,
                isSensitive: isSensitive, contextualYear: c.year, contextualMake: c.make, contextualModel: c.model,
                albumContextAmbiguous: albumContextAmbiguous, rosterMatch: rosterMatch)
        }
    }
    struct VINCaptureGroup: Equatable, Sendable {
        let vin: String
        let year: Int?
        let make: String?
        let model: String?
        let anchorImageID: String
        let imageIDs: [String]
        let vehicleFrameCount: Int
        /// The capture-session namespace (document / cowl tag / badge) that made a classic serial
        /// eligible; nil when the year/make came from an album label or the VIN is a 17-digit one.
        var context: CaptureContext? = nil
    }
    private struct IdentitySourceItem: Encodable {
        let image_id: String
        let read_at: String
        let is_vehicle: Bool
        let is_document: Bool
        let labels: [String]
        let vin_candidates: [String]
        /// Each on-device read with its source (framework/request/revision) and confidence.
        /// Omitted when the cached read predates OnDeviceAnalysis.
        let on_device: [OnDeviceObservation]?
    }
    private struct DeviceReadingRequest: Encodable {
        let mode = "record_device_reading"
        let user_id: String
        let image_ids: [String]
        let expected_source_hashes: [String: String]
        let identity_run_id: String
        let identity_method_version: String
        let observations: [IdentitySourceItem]
        let device_privacy_receipts: [String: DevicePrivacyReceipt]
    }
    private struct CaptureProfileRequestBody: Encodable {
        let mode = "create_capture_profile"
        let user_id: String
        let profile: DeviceProfileRequest
    }
    private struct Signal {
        let row: OrphanRow
        let isVehicle: Bool
        let vinVehicleId: String?
        let vinDist: Int?
        let vinRead: String?
        let unknownVIN: String?
        let identityReadAt: Date
        let labels: [String]
        let vinCandidates: [String]
        let isDocument: Bool
        let session: String
        var onDevice: [OnDeviceObservation] = []
        /// The on-device OCR lines, read again here for capture context (no new read).
        var textLines: [String] = []
    }
    private struct SuggestUpdate: Encodable {
        let auto_suggested_vehicle_id: String
        let auto_suggestion_confidence: Double
        let auto_suggestion_reasons: [String]
    }

    // ─── Run ───────────────────────────────────────────────────────────────────

    func recentAcknowledgedSources(userID: String) async throws -> [IdentityFollowupSource] {
        guard SupabaseService.currentUserId == userID else { return [] }
        let rows = try await fetchOrphans(userId: userID, limit: 500, uploadedSince: Date().addingTimeInterval(-3 * 86400))
        guard SupabaseService.currentUserId == userID else { return [] }
        let receipts = SubjectResolutionEngine.shared.privacyReceipts(for: Set(rows.compactMap(\.file_hash)), userId: userID)
        return rows.compactMap { row in
            guard let assetID = row.exif_data?.uuid, let hash = row.file_hash,
                  row.is_sensitive != true,
                  hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
            return IdentityFollowupSource(assetID: assetID, sha256: hash, userID: userID,
                methodVersion: LibraryIngest.identityMethodVersion, privacyReceipt: receipts[assetID])
        }
    }

    /// The durable upload queue supplies exact sources. Old album reads never qualify as identity reads.
    func runAcknowledged(sources: [IdentityFollowupSource], ocrBudget: Int) async -> Set<String> {
        guard let userID = SupabaseService.currentUserId else { return [] }
        let own = Array(sources.filter { $0.userID == userID && $0.methodVersion == LibraryIngest.identityMethodVersion }.prefix(200))
        guard !own.isEmpty, !isRunning,
              await run(limit: 500, ocrBudget: ocrBudget, acknowledgedSources: own),
              SupabaseService.currentUserId == userID else { return [] }
        return qualifiedFollowupKeys
    }

    // ─── Automatic-run gate (foreground + post-sync) ─────────────────────────
    // Foreground, every sync with uploads and every library change used to re-run the whole pass,
    // keeping the phone hot. Automatic runs now skip when the device is seriously hot or in Low
    // Power Mode and run at most once per 15 minutes. Explicit calls to `run` are unaffected.
    static let automaticInterval: TimeInterval = 15 * 60
    static let lastAutomaticRunKey = "AttributionEngine.lastAutomaticRun"

    nonisolated static func shouldRunAutomatic(now: Date, lastRun: Date?, tooHot: Bool, lowPower: Bool,
                                               interval: TimeInterval = automaticInterval) -> Bool {
        if tooHot || lowPower { return false }
        guard let lastRun else { return true }
        // A clock moved backwards does not hold attribution off forever.
        return now.timeIntervalSince(lastRun) >= interval || now < lastRun
    }

    @discardableResult
    func runAutomatic(limit: Int, ocrBudget: Int, defaults: UserDefaults = .standard) async -> Bool {
        let now = Date()
        let last = defaults.object(forKey: Self.lastAutomaticRunKey) as? Date
        guard Self.shouldRunAutomatic(now: now, lastRun: last, tooHot: SyncEngine.deviceTooHot,
                                      lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled) else { return false }
        guard !isRunning else { return false }
        defaults.set(now, forKey: Self.lastAutomaticRunKey)
        return await run(limit: limit, ocrBudget: ocrBudget)
    }

    /// Attribute this device's orphan photos (uploaded rows with no vehicle). Returns true on a
    /// clean pass.
    ///
    /// Owner direction, 2026-10-15: "the app after vision run is supposed to assign the vehicle to a
    /// profile under the image owners associated vehicle profiles, its supposed to create new
    /// profiles if theres enough data to support it." So, in order of evidence strength:
    ///   1. a fresh exact VIN/chassis serial in a fresh vehicle-classified frame matching one of the
    ///      owner's vehicles → file the photo (`device_file_images`, method vin_ocr / serial_ocr);
    ///   2. the owner's own mapped album plus a fresh vehicle-classified source frame → file (album_map);
    ///   3. a valid modern VIN or labelled classic serial with an unambiguous "year make model"
    ///      album context, or an album named "year make model"
    ///      holding enough uploaded photos → ask the server to resolve or create the profile
    ///      (`device_create_vehicle_profile`, which enforces the thresholds and dedupes);
    ///   4. an identifier-anchored capture fold records fresh per-image source reads, then checks exact
    ///      source bytes, capture clock/GPS, privacy gates and conflicting anchors on the server.
    ///      Broad day/place inheritance remains a suggestion.
    /// The server is the gate for every write (ownership of the photo, association with the
    /// vehicle, thresholds, audit through attribute_testimony). If it refuses or is not deployed,
    /// an inexact identifier read falls back to a suggestion.
    @discardableResult
    func run(limit: Int = 2000, ocrBudget: Int = 200, acknowledgedSources: [IdentityFollowupSource] = []) async -> Bool {
        guard !isRunning else { return false }
        guard let userId = SupabaseService.currentUserId else { lastSummary = "Not signed in"; return false }
        isRunning = true
        qualifiedFollowupKeys = []
        defer { isRunning = false }

        // Known vehicles + VINs (the small set we fuzzy-match against).
        let knownVehicles: [VehicleRow]
        let orphans: [OrphanRow]
        let albumMap: [String: Set<String>]
        do {
            knownVehicles = try await fetchKnownVehicles(userId: userId)
            orphans = try await fetchOrphans(userId: userId, limit: limit, acknowledgedSources: acknowledgedSources)
            albumMap = try await fetchAlbumMap(userId: userId)
        } catch {
            lastSummary = "Photo filing couldn't load its evidence. \(ReadFailure.text(error))"
            return false
        }
        // Sync also runs on PhotoKit changes and refresh wakes. Do not depend on the delayed
        // screen task to populate the album catalog before trying to file its new photos.
        await LibraryStore.shared.ensureAlbumCatalog()
        let knownVINs = knownVehicles.compactMap { $0.vin?.uppercased() }.filter { $0.count >= 8 }
        let vinToVehicle = Self.unambiguousSerialVehicles(knownVehicles.compactMap { v in
            v.vin.map { (serial: $0, vehicleId: v.id) }
        })
        let catalog = LibraryStore.shared.albumCatalog
        let method = LibraryIngest.identityMethodVersion
        // Build the catalog index and read every retained source review in ONE detached task
        // (off the main actor) instead of a whole-catalog dictionary on main plus a hop per orphan.
        let orphanAssetIDs = orphans.compactMap { $0.exif_data?.uuid }
        let (localPhotos, cachedReviews) = await Task.detached(priority: .utility) {
            () -> ([String: LocalAlbumPhoto], [String: LocalAlbumImageReview]) in
            let photos = Dictionary(((catalog?.photos ?? []) + (catalog?.albums.flatMap(\.photos) ?? []))
                .map { ($0.localIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
            var reviews: [String: LocalAlbumImageReview] = [:]
            for id in orphanAssetIDs where reviews[id] == nil {
                guard let photo = photos[id] else { continue }
                if let r = try? LocalStore.shared.albumImageReview(for: photo, methodVersion: method) { reviews[id] = r }
            }
            return (photos, reviews)
        }.value
        let identityRunID = UUID().uuidString.lowercased()

        guard !orphans.isEmpty else {
            let missing = acknowledgedSources.contains { !qualifiedFollowupKeys.contains($0.key) }
            lastSummary = missing ? "Uploaded sources could not be matched; identity follow-up remains pending." : "No orphan photos to attribute"
            return !missing
        }
        progress = (0, orphans.count)

        // PASS A — per-orphan on-device reading, within the OCR budget.
        var signals: [Signal] = []
        var vinHits = 0, skippedNonLocal = 0, changedSources = 0, read = 0
        suggestionByImage = [:]

        for row in orphans {
            defer { progress.done += 1 }
            guard !Task.isCancelled else { return false }
            // Non-sensitive documents can supply namespace context, never a filing anchor.
            if row.is_sensitive == true { continue }
            guard let assetID = row.exif_data?.uuid else { skippedNonLocal += 1; continue }
            // Foreground sync has a zero *new* OCR budget. It must still consume original-byte
            // reads already retained by LibraryIngest, qualified by source and method version.
            let cached = cachedReviews[assetID]
            // This method already read the current local original. A different uploaded hash
            // awaits a source repair; rereading the same bytes cannot make that witness match.
            if let cached, cached.inputSHA256 != row.file_hash { changedSources += 1; continue }
            let lines: [String]
            let isVehicle: Bool
            let identityReadAt: Date
            let labels: [String]
            let sourceVINCandidates: [String]
            let isDocument: Bool
            let onDevice: [OnDeviceObservation]
            if let cached, cached.inputSHA256 == row.file_hash {
                lines = cached.textLines + cached.vinCandidates
                isVehicle = cached.isVehicle
                identityReadAt = cached.analyzedAt
                labels = cached.labels
                isDocument = row.is_document == true || row.doc_flag == true || VisionEngine.isIdentityDocument(labels: cached.labels,
                    isScreenshot: VisionEngine.isScreenshot(localIdentifier: assetID), ocrLines: cached.textLines)
                let classic = Set(VisionEngine.labelledClassicSerialCandidates(in: cached.textLines))
                sourceVINCandidates = isDocument ? [] : cached.vinCandidates.filter { VisionEngine.isValidVIN($0) || classic.contains($0) }
                onDevice = OnDeviceAnalysis.uploadable(cached.onDeviceObservations, isDocument: isDocument)
            } else {
                guard read < ocrBudget else { continue }
                guard !SyncEngine.deviceTooHotOrLow else { continue }
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
                identityReadAt = review.analyzedAt
                labels = review.labels
                isDocument = row.is_document == true || row.doc_flag == true || VisionEngine.isIdentityDocument(labels: review.labels,
                    isScreenshot: VisionEngine.isScreenshot(localIdentifier: assetID), ocrLines: review.textLines)
                let classic = Set(VisionEngine.labelledClassicSerialCandidates(in: review.textLines))
                sourceVINCandidates = isDocument ? [] : review.vinCandidates.filter { VisionEngine.isValidVIN($0) || classic.contains($0) }
                onDevice = OnDeviceAnalysis.uploadable(review.onDeviceObservations, isDocument: isDocument)
            }
            let match = isDocument || knownVINs.isEmpty ? nil : VisionEngine.matchSerial(in: lines, known: knownVINs)
            let classicIdentifiers = Set(VisionEngine.labelledClassicSerialCandidates(in: lines))
            let rawIdentifiers = VisionEngine.vinCandidates(in: lines) + Array(classicIdentifiers)
            let unknown = !isDocument && match == nil ? rawIdentifiers.first(where: {
                (VisionEngine.isValidVIN($0) || classicIdentifiers.contains($0)) && !knownVINs.contains($0)
            }) : nil
            var vinVehicleId: String? = nil, vinDist: Int? = nil
            if let m = match {
                vinVehicleId = vinToVehicle[m.vin]; vinDist = m.editDistance; if vinVehicleId != nil { vinHits += 1 }
            }
            signals.append(Signal(row: row, isVehicle: isVehicle, vinVehicleId: vinVehicleId, vinDist: vinDist,
                                  vinRead: match?.vin ?? unknown, unknownVIN: unknown,
                                  identityReadAt: identityReadAt, labels: labels,
                                  vinCandidates: sourceVINCandidates, isDocument: isDocument,
                                  session: sessionKey(row), onDevice: onDevice, textLines: lines))
            for source in acknowledgedSources where source.matches(assetID: assetID, sha256: row.file_hash,
                userID: userId, methodVersion: method) { qualifiedFollowupKeys.insert(source.key) }
        }

        let albumContext = Self.albumContextByAsset()
        let captureFrames = signals.map { s in
            let assetID = s.row.exif_data?.uuid
            let albumLabel = assetID.flatMap { albumContext.labels[$0] }
            return VINCaptureFrame(imageID: s.row.id, vin: s.unknownVIN ?? (s.vinDist == 0 ? s.vinRead : nil),
                exactVIN: s.unknownVIN != nil || s.vinDist == 0,
                takenAt: s.row.taken_at, latitude: s.row.latitude, longitude: s.row.longitude,
                fileHash: s.row.file_hash, isVehicle: s.isVehicle,
                isDocument: s.isDocument || s.row.is_document == true || s.row.doc_flag == true,
                isSensitive: s.row.is_sensitive == true,
                contextualYear: albumLabel?.year, contextualMake: albumLabel?.make, contextualModel: albumLabel?.model,
                albumContextAmbiguous: assetID.map { albumContext.ambiguous.contains($0) } ?? false,
                rosterMatch: s.vinVehicleId != nil && s.vinDist == 0)
        }
        // Identity context from the session's own frames (document, cowl tag, badge); albums stay a weaker fallback.
        let contextReads = signals.flatMap { s in
            CaptureContextReader.reads(imageID: s.row.id, lines: s.textLines, isVehicle: s.isVehicle,
                isDocument: s.isDocument, takenAt: s.row.taken_at, latitude: s.row.latitude, longitude: s.row.longitude)
        }
        let sessionContextFrames = captureFrames.map { f in
            guard f.contextualMake == nil, f.exactVIN, let vin = f.vin, !VisionEngine.isValidVIN(vin),
                  let ctx = Self.sessionContext(for: f, reads: contextReads) else { return f }
            return f.withContext(ctx)
        }
        await uploadVINReads(sessionContextFrames)
        // anchors × frames × frontier: run off the main actor.
        let identityGroups = await Task.detached(priority: .utility) {
            Self.vinAnchoredCaptureGroups(captureFrames, contexts: contextReads)
        }.value
        pendingIdentifiers = Self.pendingIdentifiers(frames: captureFrames, reads: contextReads, groups: identityGroups)
        if let candidates = candidateProfiles { for p in pendingIdentifiers { await candidates.requestCandidateProfile(p) } }
        // Persist contextual 2–3 source reading receipts before any VIN profile write.
        // They use image_observations' protected reading-only lane; no subject membership is asserted.
        if !identityGroups.isEmpty {
            let receipts = Dictionary(acknowledgedSources.compactMap { source -> (String, DevicePrivacyReceipt)? in
                guard let receipt = source.privacyReceipt, receipt.source_sha256 == source.sha256,
                      receipt.owner_user_id == userId.lowercased() else { return nil }
                return (source.sha256, receipt)
            }, uniquingKeysWith: { first, _ in first })
            guard await recordIdentitySourcePass(identityGroups, signals: signals, runID: identityRunID,
                    method: method, userId: userId, uploadReceipts: receipts) else {
                lastSummary = "Fresh photo readings couldn't be recorded; nothing was filed."
                return false
            }
        }

        // PASS B — file what the evidence supports.
        var fileItems: [DeviceFileItem] = []
        var filedIDs = Set<String>()
        for s in signals {
            // Fuzzy OCR remains a review suggestion; only an exact source read in a
            // fresh vehicle frame can file this image directly.
            guard let vid = s.vinVehicleId, s.vinDist == 0, s.isVehicle, !s.isDocument,
                  s.row.is_document != true, s.row.doc_flag != true, s.row.is_sensitive != true else { continue }
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
        let localDocumentIDs = Set(signals.filter(\.isDocument).map { $0.row.id })
        let freshlyClassifiedVehicleIDs = Set(signals.filter { $0.isVehicle && !$0.isDocument }
            .map { $0.row.id })
        for row in orphans where !filedIDs.contains(row.id) && !localDocumentIDs.contains(row.id) && row.is_document != true &&
                row.doc_flag != true && row.is_sensitive != true {
            // Album names and maps are context, not proof that a source is a car.
            // Old rows without a fresh original-byte vehicle read cannot file or seed a profile.
            guard freshlyClassifiedVehicleIDs.contains(row.id) else { continue }
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

        // First fold each fresh identifier read with its bounded capture context.
        // The server validates current source hash, ownership, document/sensitivity
        // gates, capture clock, GPS and conflicts again before filing.
        var profileResults: [String] = []
        var profileRetry = false
        let albumMappedIDs = Set(fileItems.filter { $0.method == "album_map" }.map(\.image_id))
        for group in identityGroups {
            // An explicit album mapping is a separate claim. Never include that
            // image in a VIN fold that could conflict with its selected profile.
            guard !albumMappedIDs.contains(group.anchorImageID) else { continue }
            let ids = group.imageIDs.filter { !albumMappedIDs.contains($0) }
            guard ids.count >= 2, ids.contains(group.anchorImageID) else { continue }
            guard let anchorSignal = signals.first(where: { $0.row.id == group.anchorImageID }) else { continue }
            var evidence: [String: String] = [
                "context_method": "vin_capture_session_v1",
                "identifier_read": group.vin,
                "edit_distance": "0",
                "identifier_legibility": "clear",
                "identity_run_id": identityRunID,
                "identity_method_version": method,
                "anchor_image_id": group.anchorImageID,
                "anchor_source_sha256": captureFrames.first(where: { $0.imageID == group.anchorImageID })?.fileHash ?? "",
                "read_at": ISO8601DateFormatter().string(from: anchorSignal.identityReadAt),
            ]
            if let ctx = group.context { evidence.merge(ctx.evidence) { current, _ in current } }
            else if group.make != nil { evidence["identity_context_method"] = CaptureContextMethod.album.rawValue }
            let modernVIN = group.vin.count == 17
            let result = await createProfile(DeviceProfileRequest(basis: "capture_session", vin: modernVIN ? group.vin : nil,
                    serial: modernVIN ? nil : group.vin,
                    year: modernVIN ? nil : group.year, make: modernVIN ? nil : group.make, model: modernVIN ? nil : group.model,
                    album_name: nil, album_native_id: nil,
                    image_ids: ids, evidence: evidence), userId: userId)
            profileResults.append(result.summary)
            profileRetry = profileRetry || result.retry
            completedIDs.formUnion(result.filed)
            filedIDs.formUnion(result.filed)
        }

        // Album profiles remain available, but are processed only after VIN capture
        // folds have had a chance to claim their exact source images.
        for (albumId, group) in albumGroups where group.ids.count >= Config.albumProfileMinPhotos {
            // The server needs year, make and model, each present in the album name.
            guard let label = AlbumLabel.parse(group.name), label.model != nil else { continue }
            let ids = group.ids.filter { !filedIDs.contains($0) }
            guard ids.count >= Config.albumProfileMinPhotos else { continue }
            let result = await createProfile(DeviceProfileRequest(basis: "album", vin: nil, serial: nil, year: label.year,
                    make: label.make, model: label.model, album_name: group.name, album_native_id: albumId,
                    image_ids: ids, evidence: ["album": group.name]), userId: userId)
            profileResults.append(result.summary)
            profileRetry = profileRetry || result.retry
            completedIDs.formUnion(result.filed)
            filedIDs.formUnion(result.filed)
        }

        // Fallback and sessions: what the server did not file stays a suggestion for the owner.
        // A shop cell can contain several cars. Preserve competing anchors rather
        // than silently taking the final VIN in database order.
        let sessionVehicle = Self.unambiguousSerialVehicles(signals.compactMap { signal in
            signal.vinVehicleId.map { (serial: signal.session, vehicleId: $0) }
        })
        // Candidate-set routing for close-ups with no identifier of their own: only the few vehicles
        // plausible that day survive the hard constraints, and only a clear margin is a strong lead.
        let filedThisRun = fileItems.filter { completedIDs.contains($0.image_id) }
            .map { FiledPhoto(id: $0.image_id, vehicle_id: $0.vehicle_id, taken_at: nil, latitude: nil, longitude: nil) }
        let filedHistory = (try? await fetchFiledContext(userId: userId,
            around: signals.compactMap { LocalDay.parse($0.row.taken_at) })) ?? []
        let rowsByID = Dictionary(signals.map { ($0.row.id, $0.row) }, uniquingKeysWith: { a, _ in a })
        let filedAnchors = filedHistory + filedThisRun.map { f in
            let r = rowsByID[f.id]
            return FiledPhoto(id: f.id, vehicle_id: f.vehicle_id, taken_at: r?.taken_at, latitude: r?.latitude, longitude: r?.longitude)
        }
        var albumVehicleByImage: [String: String] = [:]
        for row in orphans {
            guard let uuid = row.exif_data?.uuid, let albums = albumsByAsset[uuid] else { continue }
            let mapped = Self.mappedVehicles(for: albums, in: albumMap)
            if mapped.count == 1, let v = mapped.first { albumVehicleByImage[row.id] = v }
        }
        let bodyByVehicle = Dictionary(knownVehicles.map {
            ($0.id, BodyClass.ofVehicle(bodyStyle: $0.canonical_body_style ?? $0.body_style, model: $0.model))
        }, uniquingKeysWith: { a, _ in a })
        let routed = Self.routeCloseUps(
            inputs: signals.filter { !completedIDs.contains($0.row.id) }.map {
                RouteInput(id: $0.row.id, takenAt: $0.row.taken_at, latitude: $0.row.latitude, longitude: $0.row.longitude,
                           labels: $0.labels, isDocument: $0.isDocument,
                           identifierVehicleID: $0.vinDist == 0 ? $0.vinVehicleId : nil)
            },
            filed: filedAnchors, bodyByVehicle: bodyByVehicle, albumVehicleByImage: albumVehicleByImage)

        var suggested = 0, unresolved = 0
        for s in signals where !completedIDs.contains(s.row.id) {
            if s.isDocument { unresolved += 1; continue }
            if let vid = s.vinVehicleId {
                let conf = [0: 0.99, 1: 0.97, 2: 0.93][s.vinDist ?? 0] ?? 0.93
                await suggest(imageId: s.row.id, vehicleId: vid, conf: conf,
                              reasons: ["vin_ocr_match", "edit_distance=\(s.vinDist ?? 0)"])
                suggestionByImage[s.row.id] = vid
                suggested += 1
            } else if let r = routed[s.row.id], let lead = r.decision.lead {
                // A clear margin keeps its score; a contested lead stays below every bulk-filing bar.
                await suggest(imageId: s.row.id, vehicleId: lead.0,
                              conf: r.decision.isClear ? lead.1 : min(lead.1, 0.79), reasons: lead.2)
                suggestionByImage[s.row.id] = lead.0
                suggested += 1
            } else if let vid = sessionVehicle[s.session.uppercased()], s.isVehicle,
                      (routed[s.row.id]?.candidateCount ?? 0) <= 1 {
                // Never spread one VIN across a cell where more than one vehicle was plausible that day.
                await suggest(imageId: s.row.id, vehicleId: vid, conf: 0.80,
                              reasons: ["session_inheritance", "vin_anchored_session", "session=\(s.session)"])
                suggestionByImage[s.row.id] = vid
                suggested += 1
            } else {
                unresolved += 1
            }
        }

        // The owner's own album is a sloppy but real lead (owner, 2026-10-20: "album helps at least get a
        // sloppy id"). A photo in exactly one mapped album surfaces in the confirm sweep with that
        // vehicle as a suggestion even before any pixel read. It files nothing: filing still needs a
        // fresh vehicle-classified read (above), and bulk filing still needs a serial match.
        var albumLeads = 0
        for row in orphans where !completedIDs.contains(row.id) && suggestionByImage[row.id] == nil
            && row.is_document != true && row.doc_flag != true && row.is_sensitive != true
            && !localDocumentIDs.contains(row.id) {
            guard let uuid = row.exif_data?.uuid, let albums = albumsByAsset[uuid], !albums.isEmpty else { continue }
            let mapped = Self.mappedVehicles(for: albums, in: albumMap)
            guard mapped.count == 1, let vid = mapped.first else { continue }
            let names = albums.compactMap(\.name).prefix(2).joined(separator: " | ")
            await suggest(imageId: row.id, vehicleId: vid, conf: 0.5, reasons: ["album_context", "album=\(names)"], onlyIfNone: true)
            suggestionByImage[row.id] = vid
            albumLeads += 1
        }
        if albumLeads > 0 { suggested += albumLeads }

        let readIDs = Set(signals.map { $0.row.id })
        let awaitingRead = orphans.filter { !completedIDs.contains($0.id) && !readIDs.contains($0.id) }.count
        lastSummary = (["\(completedIDs.count) filed (\(filing.byMethod.map { "\($0.key) \($0.value)" }.sorted().joined(separator: ", ")))",
                        profileResults.isEmpty ? nil : "profiles: " + profileResults.joined(separator: "; "),
                        "\(suggested) suggested", "\(unresolved) unresolved",
                        awaitingRead > 0 ? "\(awaitingRead) awaiting a read" : nil,
                        skippedNonLocal > 0 ? "\(skippedNonLocal) not on this phone" : nil,
                        changedSources > 0 ? "\(changedSources) source hashes changed; not filed" : nil,
                        filing.refused > 0 ? "\(filing.refused) refused by the server" : nil,
                        "\(vinHits) serial reads"].compactMap { $0 }).joined(separator: " · ")
        NSLog("NukeCapture attribution: %@", lastSummary ?? "")
        if !completedIDs.isEmpty { NotificationCenter.default.post(name: SubjectResolutionEngine.didChange, object: nil) }
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
        return filing.refused == 0 && !profileRetry
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
    private func createProfile(_ req: DeviceProfileRequest, userId: String) async -> (summary: String, filed: Set<String>, retry: Bool) {
        let label = req.vin ?? [req.year.map(String.init), req.make, req.model].compactMap { $0 }.joined(separator: " ")
        do {
            let res: AnyJSON = try await SupabaseService.client.functions.invoke("check-image-vehicle-match",
                options: FunctionInvokeOptions(body: CaptureProfileRequestBody(user_id: userId, profile: req)))
            guard case .object(let o) = res, case .string(let status)? = o["status"] else {
                return ("\(label): unreadable profile response", [], true)
            }
            let seedStatus: String? = {
                guard case .object(let seed)? = o["identity_seed"], case .string(let value)? = seed["status"] else { return nil }
                return value
            }()
            let seedSummary = seedStatus.map { " · VIN data \($0)" } ?? ""
            return ("\(label): \(status)\(seedSummary)", Self.profileFiledIDs(from: res).intersection(req.image_ids), Self.profileNeedsRetry(res))
        } catch {
            NSLog("NukeCapture device_create_vehicle_profile failed: %@", String(describing: error))
            return ("\(label): \(ReadFailure.text(error))", [], true)
        }
    }

    /// A refused identity is still unresolved; a transient writer failure remains owed work.
    nonisolated static func profileNeedsRetry(_ res: AnyJSON) -> Bool {
        guard case .object(let o) = res, case .string(let status)? = o["status"] else { return true }
        if ["busy", "error", "rate_limited"].contains(status) { return true }
        guard case .object(let filing)? = o["filing"] else { return false }
        return statuses(from: .object(filing)).values.contains { ["busy", "deferred", "error"].contains($0) }
    }

    /// Append the cheap, fresh per-image source pass under one run key. Only
    /// check-digit-valid VIN or explicitly labelled classic-serial candidates, local classification, labels, source hash
    /// and reading clock leave the phone; free-form OCR text and pixels stay local.
    private func recordIdentitySourcePass(_ groups: [VINCaptureGroup], signals: [Signal], runID: String,
                                         method: String, userId: String, uploadReceipts: [String: DevicePrivacyReceipt] = [:]) async -> Bool {
        let byID = Dictionary(uniqueKeysWithValues: signals.map { ($0.row.id, $0) })
        for group in groups {
            let remaining = group.imageIDs.filter { byID[$0] != nil && $0 != group.anchorImageID }
            for start in remaining.indices {
                let ids = [group.anchorImageID, remaining[start]]
                guard ids.count >= 2, ids.count <= 3 else { continue }
                let selected = ids.compactMap { byID[$0] }
                guard selected.count == ids.count else { return false }
                let items = selected.map { signal in IdentitySourceItem(image_id: signal.row.id,
                    read_at: ISO8601DateFormatter().string(from: signal.identityReadAt),
                    is_vehicle: signal.isVehicle, is_document: signal.isDocument,
                    labels: Array(signal.labels.prefix(12)), vin_candidates: Array(signal.vinCandidates.prefix(8)),
                    on_device: signal.onDevice.isEmpty ? nil : signal.onDevice) }
                let hashes = Dictionary(uniqueKeysWithValues: selected.compactMap { signal in
                    signal.row.file_hash.map { (signal.row.id, $0) }
                })
                guard hashes.count == ids.count else { return false }
                let retainedPrivacy = SubjectResolutionEngine.shared.privacyReceipts(for: Set(hashes.values), userId: userId)
                let privacyByImage = Dictionary(uniqueKeysWithValues: selected.compactMap { signal -> (String, DevicePrivacyReceipt)? in
                    guard let localID = signal.row.exif_data?.uuid,
                          let receipt = uploadReceipts[signal.row.file_hash ?? ""] ?? retainedPrivacy[localID] else { return nil }
                    return (signal.row.id, receipt)
                })
                do {
                    let response: AnyJSON = try await SupabaseService.client.functions.invoke("check-image-vehicle-match",
                        options: FunctionInvokeOptions(body: DeviceReadingRequest(user_id: userId, image_ids: ids,
                            expected_source_hashes: hashes, identity_run_id: runID,
                            identity_method_version: method, observations: items,
                            device_privacy_receipts: privacyByImage)))
                    guard case .object(let object) = response, case .string("reading_retained")? = object["status"] else {
                        NSLog("NukeCapture on-device reading refused: %@", String(describing: response)); return false
                    }
                } catch {
                    NSLog("NukeCapture on-device reading retention failed: %@", String(describing: error)); return false
                }
            }
        }
        return true
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

    private static func albumContextByAsset() -> (labels: [String: AlbumLabel], ambiguous: Set<String>) {
        guard let catalog = LibraryStore.shared.albumCatalog else { return ([:], []) }
        var labels: [String: Set<AlbumLabel>] = [:]
        for album in catalog.albums {
            guard let label = AlbumLabel.parse(album.name) else { continue }
            for photo in album.photos { labels[photo.localIdentifier, default: []].insert(label) }
        }
        return (labels.compactMapValues { values in values.count == 1 ? values.first : nil },
                Set(labels.filter { $0.value.count > 1 }.keys))
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /// Day + ~100m GPS cell = one work session = one truck (the sequence unit).
    // ─── Candidate-set routing (see CandidateRouting.swift) ──────────────────

    struct FiledPhoto: Decodable, Sendable, Equatable {
        let id: String
        let vehicle_id: String
        let taken_at: String?
        let latitude: Double?
        let longitude: Double?
    }
    struct RouteInput: Sendable, Equatable {
        let id: String
        let takenAt: String?
        let latitude: Double?
        let longitude: Double?
        let labels: [String]
        let isDocument: Bool
        let identifierVehicleID: String?
    }
    struct RouteResult: Sendable, Equatable {
        let decision: RoutingDecision
        let candidateCount: Int
    }

    /// The owner's filed photos within 14 days of the orphans' days: positional anchors and the
    /// "worked on recently at this place" prior. Read-only; a failure only weakens routing.
    private func fetchFiledContext(userId: String, around dates: [Date]) async throws -> [FiledPhoto] {
        guard let lo = dates.min(), let hi = dates.max() else { return [] }
        let f = ISO8601DateFormatter()
        return try await SupabaseService.client.from("vehicle_images")
            .select("id, vehicle_id, taken_at, latitude, longitude")
            .eq("user_id", value: userId)
            .not("vehicle_id", operator: .is, value: "null")
            .not("is_duplicate", operator: .is, value: true)
            .gte("taken_at", value: f.string(from: lo.addingTimeInterval(-14 * 86_400)))
            .lte("taken_at", value: f.string(from: hi.addingTimeInterval(86_400)))
            .order("taken_at", ascending: false)
            .limit(1000)
            .execute().value
    }

    /// Pure: route each orphan without its own identifier among only the vehicles plausible for its
    /// local day and place. Known vehicles (`bodyByVehicle`) are the owner's associated roster; a
    /// vehicle outside it is `not_held` and locked out.
    nonisolated static func routeCloseUps(inputs: [RouteInput], filed: [FiledPhoto], bodyByVehicle: [String: BodyClass],
                                          albumVehicleByImage: [String: String],
                                          timeZone: TimeZone = .current) -> [String: RouteResult] {
        let orphanPhotos = inputs.map { i in
            RoutingPhoto(id: i.id, takenAt: LocalDay.parse(i.takenAt), latitude: i.latitude, longitude: i.longitude,
                         labels: i.labels, kind: PhotoKind.of(labels: i.labels, isDocument: i.isDocument),
                         identifierVehicleID: i.identifierVehicleID)
        }
        let filedPhotos = filed.map { f in
            RoutingPhoto(id: f.id, takenAt: LocalDay.parse(f.taken_at), latitude: f.latitude, longitude: f.longitude,
                         filedVehicleID: f.vehicle_id)
        }
        let all = orphanPhotos + filedPhotos
        let shoots = ShootSegmenter.segment(all)
        var shootOf: [String: [RoutingPhoto]] = [:]
        for shoot in shoots { for p in shoot { shootOf[p.id] = shoot } }
        // Day activity: identifier reads and filed photos, keyed by the local day.
        var activeByDay: [String: Set<String>] = [:]
        for p in all {
            guard let t = p.takenAt, let v = p.identifierVehicleID ?? p.filedVehicleID else { continue }
            activeByDay[LocalDay.key(t, timeZone: timeZone), default: []].insert(v)
        }
        var out: [String: RouteResult] = [:]
        for p in orphanPhotos where p.identifierVehicleID == nil {
            guard let t = p.takenAt, let shoot = shootOf[p.id] else { continue }
            let day = LocalDay.key(t, timeZone: timeZone)
            let active = activeByDay[day] ?? []
            let recent = Set(filedPhotos.filter { f in
                guard let ft = f.takenAt, ft <= t.addingTimeInterval(86_400), t.timeIntervalSince(ft) <= 14 * 86_400 else { return false }
                return (ShootSegmenter.meters(f, p) ?? .infinity) <= ShootSegmenter.maxMoveMeters
            }.compactMap(\.filedVehicleID))
            let album = albumVehicleByImage[p.id]
            let ids = active.union(recent).union(album.map { [$0] } ?? [])
            let candidates = ids.sorted().map { v in
                RoutingCandidate(vehicleID: v, bodyClass: bodyByVehicle[v] ?? .unknown,
                                 possession: bodyByVehicle[v] == nil ? .notHeld : .unknown,
                                 activeThatDay: active.contains(v), recentAtLocation: recent.contains(v),
                                 albumMapped: album == v)
            }
            guard !candidates.isEmpty else { continue }
            out[p.id] = RouteResult(decision: CandidateRouter.decide(p, shoot: shoot, candidates: candidates),
                                    candidateCount: candidates.count)
        }
        return out
    }

    private func sessionKey(_ r: OrphanRow) -> String {
        Self.sessionKey(takenAt: r.taken_at, latitude: r.latitude, longitude: r.longitude)
    }

    /// The owner's local working day (not the UTC prefix, which rolls over at 5 PM in California)
    /// plus a ~100 m cell.
    nonisolated static func sessionKey(takenAt: String?, latitude: Double?, longitude: Double?,
                                       timeZone: TimeZone = .current) -> String {
        let day = LocalDay.key(taken: takenAt, timeZone: timeZone)
        let r = latitude, l = longitude
        let lat = r.map { (($0 * 1000).rounded() / 1000) } ?? 0
        let lon = l.map { (($0 * 1000).rounded() / 1000) } ?? 0
        return "\(day)|\(lat),\(lon)"
    }

    /// Build identity groups from fresh source reads. Every member is within five minutes and
    /// 25 m of the anchor or of another member (chained), and within 45 min of one exact VIN anchor. The run key is
    /// the relation; camera make/model/lens metadata is not a device identity.
    /// A competing VIN anchor in that neighborhood makes the whole fold ambiguous.
    /// The widest a VIN-anchored shoot may reach from its anchor (chained 5 min / 25 m hops).
    nonisolated static let setWindowSeconds: TimeInterval = 45 * 60

    /// The session-derived namespace for one identifier frame: context reads in the same run
    /// (set window, ~100 m), resolved strongest-first. A 17-digit VIN needs none.
    nonisolated static func sessionContext(for frame: VINCaptureFrame, reads: [CaptureContextRead]) -> CaptureContext? {
        guard !reads.isEmpty else { return nil }
        let near = reads.filter { CaptureContextReader.sameRun($0, anchorTakenAt: frame.takenAt,
            anchorLat: frame.latitude, anchorLon: frame.longitude) }
        return CaptureContextReader.resolve(near, serial: frame.vin)
    }

    /// Sessions with a cowl-tag read and no identifier group (and no exact identifier read):
    /// no profile is created; Today shows "needs the VIN plate" with the frames waiting.
    nonisolated static func pendingIdentifiers(frames: [VINCaptureFrame], reads: [CaptureContextRead],
                                               groups: [VINCaptureGroup]) -> [CaptureContextReader.PendingIdentifier] {
        let byID = Dictionary(frames.map { ($0.imageID, $0) }, uniquingKeysWith: { a, _ in a })
        func key(_ f: VINCaptureFrame) -> String { sessionKey(takenAt: f.takenAt, latitude: f.latitude, longitude: f.longitude) }
        var tagReads: [String: [CaptureContextRead]] = [:]
        for r in reads where r.method == .cowlTag {
            guard let f = byID[r.imageID] else { continue }
            tagReads[key(f), default: []].append(r)
        }
        var sessionFrames: [String: Set<String>] = [:]
        for f in frames where f.isVehicle && !f.isDocument && !f.isSensitive { sessionFrames[key(f), default: []].insert(f.imageID) }
        var anchored = Set(frames.filter { $0.exactVIN && $0.vin != nil }.map(key))
        for g in groups { if let a = byID[g.anchorImageID] { anchored.insert(key(a)) } }
        return CaptureContextReader.pendingIdentifiers(tagReadsBySession: tagReads, sessionFrames: sessionFrames, anchored: anchored)
    }

    nonisolated static func vinAnchoredCaptureGroups(_ frames: [VINCaptureFrame],
                                                     contexts: [CaptureContextRead] = []) -> [VINCaptureGroup] {
        func captureDate(_ value: String?) -> Date? {
            guard let value else { return nil }
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let parsed = fractional.date(from: value) { return parsed }
            let standard = ISO8601DateFormatter()
            standard.formatOptions = [.withInternetDateTime]
            return standard.date(from: value)
        }
        func near(_ a: VINCaptureFrame, _ b: VINCaptureFrame) -> Bool {
            guard let ta = captureDate(a.takenAt), let tb = captureDate(b.takenAt), abs(ta.timeIntervalSince(tb)) <= 300,
                  let lat1 = a.latitude, let lon1 = a.longitude, let lat2 = b.latitude, let lon2 = b.longitude,
                  abs(lat1) <= 90, abs(lat2) <= 90, abs(lon1) <= 180, abs(lon2) <= 180 else { return false }
            let radians = Double.pi / 180
            let dLat = (lat2 - lat1) * radians, dLon = (lon2 - lon1) * radians
            let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1 * radians) * cos(lat2 * radians) *
                sin(dLon / 2) * sin(dLon / 2)
            return 6_371_000 * 2 * asin(sqrt(min(1, h))) <= 25
        }
        func albumContextAgrees(_ a: VINCaptureFrame, _ b: VINCaptureFrame) -> Bool {
            guard !a.albumContextAmbiguous, !b.albumContextAmbiguous else { return false }
            let first = (a.contextualYear, a.contextualMake, a.contextualModel)
            let second = (b.contextualYear, b.contextualMake, b.contextualModel)
            let firstHasContext = first.0 != nil || first.1 != nil || first.2 != nil
            let secondHasContext = second.0 != nil || second.1 != nil || second.2 != nil
            if !secondHasContext { return true }
            return firstHasContext && first.0 == second.0 && first.1 == second.1 && first.2 == second.2
        }
        func withinSetWindow(_ a: VINCaptureFrame, _ b: VINCaptureFrame) -> Bool {
            guard let ta = captureDate(a.takenAt), let tb = captureDate(b.takenAt) else { return false }
            return abs(ta.timeIntervalSince(tb)) <= setWindowSeconds
        }
        // A classic serial's namespace: the session's own context first, the album label second.
        func context(_ frame: VINCaptureFrame) -> CaptureContext? { sessionContext(for: frame, reads: contexts) }
        let anchors = frames.filter { frame in
            frame.exactVIN && !frame.isDocument && !frame.isSensitive &&
            frame.fileHash?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil &&
            frame.vin.map { VisionEngine.isValidVIN($0) ||
                ((8...16).contains($0.count) && $0.contains(where: \.isLetter) && $0.contains(where: \.isNumber) && (frame.contextualMake != nil || context(frame) != nil)) } == true &&
            captureDate(frame.takenAt) != nil && frame.latitude.map { abs($0) <= 90 } == true &&
            frame.longitude.map { abs($0) <= 180 } == true
        }.sorted { ($0.takenAt ?? "", $0.imageID) < ($1.takenAt ?? "", $1.imageID) }
        guard !anchors.isEmpty else { return [] }
        var emitted = Set<String>()
        var groups: [VINCaptureGroup] = []
        for anchor in anchors where emitted.insert(anchor.vin!).inserted {
            guard !anchors.contains(where: { $0.vin != anchor.vin && near(anchor, $0) }) else { continue }
            // A shoot runs 20–40 minutes: grow the set through frames that are each within 5 min / 25 m
            // of an admitted frame, up to the set window from the anchor. A frame near a competing anchor is
            // never admitted (so the walk stops there); a competing anchor near this one makes it ambiguous.
            let eligible = frames.filter { $0.isVehicle && !$0.isDocument && !$0.isSensitive && albumContextAgrees(anchor, $0) &&
                withinSetWindow(anchor, $0) }
            var members: [VINCaptureFrame] = []
            var admitted = Set<String>(), frontier = [anchor], ambiguous = false
            while let cur = frontier.popLast(), !ambiguous {
                if anchors.contains(where: { $0.vin != anchor.vin && withinSetWindow(anchor, $0) && near(cur, $0) }) { ambiguous = true; break }
                for f in eligible where !admitted.contains(f.imageID) && f.imageID != anchor.imageID && near(cur, f) {
                    guard Set(anchors.filter { near($0, f) }.compactMap(\.vin)).isSubset(of: [anchor.vin!]) else { continue }
                    admitted.insert(f.imageID); members.append(f); frontier.append(f)
                }
            }
            guard !ambiguous else { continue }
            guard !members.isEmpty else { continue }
            if members.count > 99, let t0 = captureDate(anchor.takenAt) {   // server takes 2–100 images: keep the closest
                members = Array(members.sorted {
                    abs((captureDate($0.takenAt) ?? t0).timeIntervalSince(t0)) < abs((captureDate($1.takenAt) ?? t0).timeIntervalSince(t0))
                }.prefix(99))
            }
            let ids = Array(Set([anchor.imageID] + members.map(\.imageID))).sorted()
            guard (2...100).contains(ids.count) else { continue }
            let classic = !VisionEngine.isValidVIN(anchor.vin!)
            if classic, let ctx = context(anchor) {
                groups.append(VINCaptureGroup(vin: anchor.vin!, year: ctx.year ?? anchor.contextualYear, make: ctx.make,
                    model: ctx.model ?? (anchor.contextualMake?.lowercased() == ctx.make.lowercased() ? anchor.contextualModel : nil),
                    anchorImageID: anchor.imageID, imageIDs: ids,
                    vehicleFrameCount: Set(members.map(\.imageID)).count, context: ctx))
            } else {
                groups.append(VINCaptureGroup(vin: anchor.vin!, year: anchor.contextualYear, make: anchor.contextualMake,
                    model: anchor.contextualModel, anchorImageID: anchor.imageID,
                    imageIDs: ids, vehicleFrameCount: Set(members.map(\.imageID)).count))
            }
        }
        return groups
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
                .select("id, vin, body_style, canonical_body_style, model").in("id", values: chunk).execute().value
            vehicles.append(contentsOf: rows)
        }
        return vehicles
    }

    /// Every unfiled photo, newest first, paged by 200 up to `limit` (hard cap 5,000) so a backlog
    /// older than the newest 200 still gets its filing pass. The OCR budget still bounds per-run work.
    nonisolated static let orphanPageSize = 200
    nonisolated static let orphanHardCap = 5000
    nonisolated static func orphanPageRanges(limit: Int) -> [ClosedRange<Int>] {
        let total = min(orphanHardCap, max(1, limit))
        return stride(from: 0, to: total, by: orphanPageSize).map { $0...(min($0 + orphanPageSize, total) - 1) }
    }

    private func fetchOrphans(userId: String, limit: Int, acknowledgedSources: [IdentityFollowupSource] = [], uploadedSince: Date? = nil) async throws -> [OrphanRow] {
        var out: [OrphanRow] = []
        var seen = Set<String>()
        // Exact hash lookup prevents an older acknowledged source falling outside the ordinary page.
        if !acknowledgedSources.isEmpty {
            let focused: [OrphanRow] = try await SupabaseService.client.from("vehicle_images")
                .select("id, vehicle_id, latitude, longitude, taken_at, is_document, doc_flag, is_sensitive, exif_data, file_hash")
                .eq("user_id", value: userId).eq("source", value: Config.sourceTag)
                .in("file_hash", values: Array(Set(acknowledgedSources.map(\.sha256))))
                .in("exif_data->>uuid", values: Array(Set(acknowledgedSources.map(\.assetID))))
                .neq("image_url", value: "")
                .not("is_superseded", operator: .is, value: true)
                .not("is_duplicate", operator: .is, value: true)
                .or("vision_gate_status.is.null,vision_gate_status.not.in.(rejected_personal,rejected_misattributed)")
                .limit(400).execute().value
            for row in focused {
                let matches = acknowledgedSources.filter { $0.matches(assetID: row.exif_data?.uuid, sha256: row.file_hash,
                    userID: userId, methodVersion: LibraryIngest.identityMethodVersion) }
                guard !matches.isEmpty else { continue }
                if row.vehicle_id != nil { qualifiedFollowupKeys.formUnion(matches.map(\.key)) }
                else if seen.insert(row.id).inserted { out.append(row) }
            }
        }
        for range in Self.orphanPageRanges(limit: limit) {
            var query = SupabaseService.client.from("vehicle_images")
                .select("id, vehicle_id, latitude, longitude, taken_at, is_document, doc_flag, is_sensitive, exif_data, file_hash")
                .eq("user_id", value: userId)
                .is("vehicle_id", value: nil)
                .eq("source", value: Config.sourceTag)
                .neq("image_url", value: "")          // metadata-only rows have no picture to file
                .not("is_superseded", operator: .is, value: true)
                .not("is_duplicate", operator: .is, value: true)
                .or("vision_gate_status.is.null,vision_gate_status.not.in.(rejected_personal,rejected_misattributed)")
            if let uploadedSince { query = query.gte("created_at", value: ISO8601DateFormatter().string(from: uploadedSince)) }
            let page: [OrphanRow] = try await query
                // A newly uploaded historic or undated photo still deserves its first filing pass.
                .order("created_at", ascending: false)
                .order("id", ascending: false)
                .range(from: range.lowerBound, to: range.upperBound)
                .execute().value
            for row in page where seen.insert(row.id).inserted { out.append(row) }
            if page.count < range.count { break }
        }
        // Fetched by upload so new arrivals get their first pass; filed by when they were taken,
        // newest first, undated last (upload time is not event time).
        let preferred = Set(acknowledgedSources.map(\.assetID))
        return out.sorted {
            let a = $0.exif_data?.uuid.map { preferred.contains($0) } ?? false
            let b = $1.exif_data?.uuid.map { preferred.contains($0) } ?? false
            if a != b { return a }
            return EventTime.newestFirst(EventTime.clock(takenAt: $0.taken_at), EventTime.clock(takenAt: $1.taken_at), tie: ($0.id, $1.id))
        }
    }

    /// The phone's exact identifier read, uploaded so the server can link without re-running OCR.
    /// Only fills an empty vehicle_vin; never overwrites a stored read.
    private struct VINReadUpdate: Encodable { let vehicle_vin: String; let vehicle_vin_confidence: Double }
    nonisolated static func vinReadUploads(_ frames: [VINCaptureFrame]) -> [(imageID: String, vin: String, confidence: Double)] {
        frames.compactMap { f in
            guard f.exactVIN, !f.isDocument, !f.isSensitive, let vin = f.vin?.uppercased() else { return nil }
            if VisionEngine.isValidVIN(vin) { return (f.imageID, vin, 0.95) }
            guard (5...16).contains(vin.count), vin.contains(where: \.isNumber) else { return nil }
            // A roster match is an exact read of one of the owner's own serials (#2513 accepts ≥ 0.8).
            if f.rosterMatch { return (f.imageID, vin, 0.9) }
            if f.contextualMake != nil { return (f.imageID, vin, 0.8) }
            return nil
        }
    }

    private func uploadVINReads(_ frames: [VINCaptureFrame]) async {
        for u in Self.vinReadUploads(frames) {
            do {
                try await SupabaseService.client.from("vehicle_images")
                    .update(VINReadUpdate(vehicle_vin: u.vin, vehicle_vin_confidence: u.confidence))
                    .eq("id", value: u.imageID)
                    .is("vehicle_vin", value: nil)
                    .execute()
            } catch { NSLog("attribution vin upload: %@", String(describing: error)) }
        }
    }

    private func suggest(imageId: String, vehicleId: String, conf: Double, reasons: [String], onlyIfNone: Bool = false) async {
        do {
            // A weak lead (the album) never replaces a stronger earlier suggestion (a serial read).
            var q = try SupabaseService.client.from("vehicle_images")
                .update(SuggestUpdate(auto_suggested_vehicle_id: vehicleId,
                                      auto_suggestion_confidence: conf, auto_suggestion_reasons: reasons))
                .eq("id", value: imageId)
            if onlyIfNone { q = q.is("auto_suggested_vehicle_id", value: nil) }
            try await q.execute()
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
