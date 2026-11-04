// VideoSyncEngine.swift — camera videos whose own frames identify one of the owner's vehicles, and only those.
//
// OFF by default (VideoSyncConfig.isEnabled). When on, after each photo sync pass:
//   1. List the owner's recent camera videos (14 days, newest first, 60 at most) from PhotoKit metadata only.
//      Screen recordings are never read (see VideoCaptureMatcher). No bytes are read yet.
//   2. NARROW (time and GPS only): the candidate vehicles are those of photos already filed to a vehicle within
//      30 minutes and 150 m of the clip. No candidates → the clip is not read and stays on the phone.
//   3. READ ON THE PHONE: 12 frames sampled evenly from the local file (never an iCloud download), each run through
//      the photo code: VisionEngine.classify + face check → VisionDecision, OnDeviceAnalysis.analyzeIdentity (the VIN
//      and plate reader), the document guard and the exact-match qualifiers (MediaAttributionGate.frameEvidence).
//      Frames, text and reads are never stored, logged or sent.
//   4. GATE (MediaAttributionGate): the clip clears only if every frame passes the privacy decision and an exact
//      read names exactly one of the narrowed vehicles at the photo confidence (0.99 / 0.97, floor 0.9).
//      Anything else stays on the phone. The user is never prompted and nothing is sent about it.
//   5. A cleared clip is filed by the server's own gate, the one photos use. Order matters because the server's
//      device_file_images works on an existing vehicle_images row:
//        a. insert a METADATA-ONLY row (no pixels, no object, vehicle_id null, image_url '');
//        b. call device_file_images (method vin_ocr / serial_ocr, the gate's confidence). The server checks ownership,
//           association of the vehicle with the user, supersession, the vision-gate state, the confidence floor and
//           the VIN length, writes the audit row, and sets vehicle_id;
//        c. only when the row has a vehicle_id, upload the low-res preview, then the full file, to the private
//           `capture-media` bucket by resumable transfers. The storage policy refuses both objects until
//           vehicle_id is set.
//      If the server refuses, the row stays metadata-only and nothing is uploaded.
//
// iCloud-only originals are never downloaded for this. Low Power Mode and a hot phone stop the pass.

import AVFoundation
import Foundation
import Photos
import Supabase
import UIKit
import UniformTypeIdentifiers

enum VideoSyncError: Error, Equatable {
    case unavailableOnDevice      // iCloud-only or unreadable: never downloaded for this feature
    case exportFailed
    case previewTooLarge
    case notEnoughStorage
}

/// What cleared the clip, kept on the row for audit (numbers and fixed words, never text).
struct MediaMatchBasis: Codable, Equatable, Sendable {
    let rule: String                 // VideoSyncConfig.gateVersion
    let method: String               // vin_ocr | serial_ocr
    let confidence: Double
    let frames_sampled: Int
    let frames_exact: Int
    let candidates: Int              // vehicles time/GPS left in play
    let anchors: Int                 // filed photos that narrowed them
    let window_seconds: Int
    let radius_m: Double
}

struct MediaExif: Codable, Equatable, Sendable {
    struct Media: Codable, Equatable, Sendable {
        let kind: String
        let bucket: String
        let preview_path: String
        let full_state: String          // "held_on_phone" until the full file lands
        let device_model: String
        let device_os: String
        let width: Int
        let height: Int
        let match: MediaMatchBasis
    }
    let synced_by: String
    let asset_key: String
    let media: Media
}

/// The vehicle_images insert. It is METADATA ONLY and deliberately has NO vehicle_id: the server's
/// device_file_images sets that, after its own checks. storage_path and file_size are absent until an object
/// lands. image_url is the '' sentinel the metadata-only photo rows already use: the objects are in a private
/// bucket, so there is no public URL.
struct MediaImageRow: Codable, Equatable, Sendable {
    let id: String
    let user_id: String
    let image_url: String
    var storage_path: String? = nil
    let file_name: String
    let mime_type: String
    var file_size: Int64? = nil
    let is_video: Bool
    let duration_seconds: Double?
    let video_codec: String?
    let video_resolution: String?
    let taken_at: String
    let latitude: Double?
    let longitude: Double?
    let source: String
    let image_medium: String
    let ai_processing_status: String
    let is_sensitive: Bool
    let ingest_kind: String
    let auto_suggested_vehicle_id: String?
    let auto_suggestion_reasons: [String]
    let exif_data: MediaExif
}

@MainActor
final class VideoSyncEngine: ObservableObject {
    static let shared = VideoSyncEngine()

    @Published private(set) var lastSummary: String?
    private(set) var ledger = VideoLedger()
    private var running = false
    private let fm = FileManager.default
    private let directory: URL
    private let ledgerURL: URL

    private init() {
        let base = (try? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? fm.temporaryDirectory
        directory = base.appendingPathComponent("VideoSync", isDirectory: true)
        ledgerURL = directory.appendingPathComponent("ledger.json")
        try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: ledgerURL), let l = try? JSONDecoder().decode(VideoLedger.self, from: data) {
            ledger = l
        }
    }

    // ─── Entry point ─────────────────────────────────────────────────────────

    /// Called at the end of a photo sync pass. A no-op, before anything is read, unless the flag is on.
    func runAfterPhotoPass(userId: String) async {
        guard VideoSyncConfig.isEnabled() else { return }
        guard !running, !Task.isCancelled else { return }
        guard gatesAllow() else { return }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else { return }
        running = true
        defer { running = false }
        guard let token = await SupabaseService.accessToken() else { return }

        // Earlier clips that cleared: insert, file, upload.
        await advanceFilings(userId: userId)
        await resumePending(token: token, userId: userId)

        var tally = Tally()
        let found = candidates(userId: userId)
        if !found.isEmpty {
            do {
                let photos = try await filedPhotos(for: found.map(\.candidate), userId: userId)
                var roster: [MediaRosterVehicle]? = nil
                for item in found where !Task.isCancelled {
                    guard case .candidates(let ids, let anchors) = VideoCaptureMatcher.narrow(item.candidate, photos: photos) else {
                        tally.stayed += 1; continue                 // not narrowed: never read, nothing sent
                    }
                    guard tally.read < VideoSyncConfig.maxClipsReadPerPass, readingAllowed() else { break }
                    if roster == nil { roster = try await fetchRoster() }
                    tally.read += 1
                    switch await evaluate(item, roster: roster ?? [], candidates: ids, anchors: anchors, userId: userId) {
                    case .unreadable:
                        tally.unreadable += 1                       // not marked: tried again on a later pass
                    case .refused(let why):
                        ledger.markChecked(item.candidate.assetKey, outcome: "refused:\(why.rawValue)")
                        persist()
                        tally.stayed += 1
                    case .cleared:
                        tally.cleared += 1
                    }
                }
            } catch {
                NSLog("NukeCapture media: narrowing unavailable (%@)", ReadFailure.text(error))
                tally.failed += 1
            }
        }
        await advanceFilings(userId: userId)
        await resumePending(token: token, userId: userId)
        await advanceFilings(userId: userId)        // stages the full file once its preview has landed
        await resumePending(token: token, userId: userId)
        lastSummary = "media: \(tally.cleared) attributed by content, \(tally.stayed) stayed on the phone"
            + (tally.failed > 0 ? ", \(tally.failed) failed" : "")
        NSLog("NukeCapture media: %d attributed, %d left on phone, %d unreadable, %d failed",
              tally.cleared, tally.stayed, tally.unreadable, tally.failed)
    }

    private struct Tally { var read = 0, cleared = 0, stayed = 0, unreadable = 0, failed = 0 }

    /// Wi-Fi only (default), not hot, not Low Power Mode.
    private func gatesAllow() -> Bool {
        if VideoSyncConfig.wifiOnly() && !NetworkMonitor.shared.isUnmetered { return false }
        return readingAllowed()
    }

    /// Frame reading is local, but heavy: not on a hot phone or in Low Power Mode.
    private func readingAllowed() -> Bool {
        !(SyncEngine.deviceTooHot || SyncEngine.lowPowerHolds)
    }

    // ─── 1. Candidates (PhotoKit metadata only) ──────────────────────────────

    struct Found {
        let candidate: VideoCandidate
        let asset: PHAsset
    }

    nonisolated static func assetKey(userId: String, localIdentifier: String) -> String {
        SupabaseService.sha256Hex(Data("\(userId)|\(localIdentifier)".utf8))
    }

    /// A clip is a screen recording when PhotoKit says so, or its resource is named like one (ReplayKit
    /// writes RPReplay_*). When unsure the stricter rule applies: it is treated as a screen recording, which is
    /// never read.
    nonisolated static func isScreenRecording(subtypes: PHAssetMediaSubtype, originalFilename: String?) -> Bool {
        if subtypes.contains(.videoScreenRecording) { return true }
        return (originalFilename ?? "").uppercased().hasPrefix("RPREPLAY")
    }

    private func candidates(userId: String) -> [Found] {
        let since = Date(timeIntervalSinceNow: -VideoSyncConfig.lookback)
        var out: [Found] = []
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d AND creationDate > %@",
                                        PHAssetMediaType.video.rawValue, since as NSDate)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = VideoSyncConfig.maxAssetsPerPass
        PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
            guard let started = asset.creationDate else { return }
            let key = Self.assetKey(userId: userId, localIdentifier: asset.localIdentifier)
            guard !self.ledger.isKnown(key) else { return }
            let name = PHAssetResource.assetResources(for: asset).first?.originalFilename
            let screen = Self.isScreenRecording(subtypes: asset.mediaSubtypes, originalFilename: name)
            let coordinate = asset.location?.coordinate
            out.append(Found(candidate: VideoCandidate(
                assetKey: key, kind: screen ? .screenRecording : .cameraVideo, startedAt: started,
                duration: asset.duration,
                latitude: screen ? nil : coordinate?.latitude, longitude: screen ? nil : coordinate?.longitude),
                             asset: asset))
        }
        return out
    }

    // ─── 2. Narrowing inputs (server reads, owner-scoped by RLS and by eq(user_id)) ─

    private struct PhotoAnchorRow: Decodable {
        let vehicle_id: String
        let taken_at: String
        let latitude: Double?
        let longitude: Double?
        let source: String?
        let is_video: Bool?
    }

    private static func parseInstant(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    private func filedPhotos(for items: [VideoCandidate], userId: String) async throws -> [FiledPhotoAnchor] {
        let needs = items.filter { $0.kind == .cameraVideo && $0.latitude != nil }
        guard let first = needs.map(\.startedAt).min(), let last = needs.map(\.endedAt).max() else { return [] }
        let iso = ISO8601DateFormatter()
        let rows: [PhotoAnchorRow] = try await SupabaseService.client.from("vehicle_images")
            .select("vehicle_id, taken_at, latitude, longitude, source, is_video")
            .eq("user_id", value: userId)
            .not("vehicle_id", operator: .is, value: "null")
            .not("latitude", operator: .is, value: "null")
            .not("is_sensitive", operator: .is, value: true)
            .not("is_superseded", operator: .is, value: true)
            .not("is_duplicate", operator: .is, value: true)
            .gte("taken_at", value: iso.string(from: first.addingTimeInterval(-VideoSyncConfig.photoTimeWindow)))
            .lte("taken_at", value: iso.string(from: last.addingTimeInterval(VideoSyncConfig.photoTimeWindow)))
            .limit(2000)
            .execute().value
        return rows.compactMap { r in
            // Only real photos narrow: never a clip this feature filed itself, so a clip cannot anchor a clip.
            guard r.source != VideoSyncConfig.rowSource, r.is_video != true else { return nil }
            guard let t = Self.parseInstant(r.taken_at), let la = r.latitude, let lo = r.longitude else { return nil }
            return FiledPhotoAnchor(vehicleID: r.vehicle_id, takenAt: t, latitude: la, longitude: lo)
        }
    }

    private struct RosterRow: Decodable {
        let id: String
        let vin: String?
    }

    /// The owner's vehicles, the same roster the photo filing pass matches against
    /// (user_associated_vehicle_ids → vehicles).
    private func fetchRoster() async throws -> [MediaRosterVehicle] {
        struct Params: Encodable { let p_user: String }
        guard let userId = SupabaseService.currentUserId else { return [] }
        let ids: [String] = try await SupabaseService.client.rpc("user_associated_vehicle_ids",
            params: Params(p_user: userId)).execute().value
        var out: [MediaRosterVehicle] = []
        for start in stride(from: 0, to: ids.count, by: 200) {
            let chunk = Array(ids[start..<min(start + 200, ids.count)])
            let rows: [RosterRow] = try await SupabaseService.client.from("vehicles")
                .select("id, vin").in("id", values: chunk).execute().value
            out.append(contentsOf: rows.map { MediaRosterVehicle(id: $0.id, vin: $0.vin) })
        }
        return out
    }

    // ─── 3 + 4. Read frames on the phone, then the gate ──────────────────────

    private enum ClipOutcome {
        case unreadable
        case refused(MediaRefusal)
        case cleared
    }

    private struct ClipFacts {
        let codec: String?
        let width: Int
        let height: Int
    }

    private func evaluate(_ item: Found, roster: [MediaRosterVehicle], candidates: Set<String>,
                          anchors: Int, userId: String) async -> ClipOutcome {
        let c = item.candidate
        guard let avAsset = try? await loadAVAsset(item.asset) else { return .unreadable }   // iCloud-only: not read
        let facts = await Self.facts(of: avAsset)
        let count = VideoSyncConfig.framesPerClip
        let frames: [FrameEvidence]? = await Task.detached(priority: .utility) {
            await Self.readFrames(of: avAsset, duration: c.duration, count: count, roster: roster)
        }.value
        guard let frames else { return .unreadable }
        let lengths = Dictionary(roster.compactMap { v in v.vin.map { (v.id, $0.count) } }, uniquingKeysWith: { a, _ in a })
        let verdict = MediaAttributionGate.evaluate(
            isScreenCapture: c.kind != .cameraVideo, frames: frames, framesRequested: count,
            candidates: candidates, vinLengthByVehicle: lengths)
        guard case .cleared(let clearance) = verdict else {
            if case .refused(let why) = verdict { return .refused(why) }
            return .unreadable
        }
        do {
            let filing = try makeFiling(item, clearance: clearance, facts: facts, framesSampled: frames.count,
                                        candidates: candidates.count, anchors: anchors, userId: userId)
            ledger.recordCleared(filing)
            persist()
            await advance(assetKey: filing.assetKey, userId: userId)
            return .cleared
        } catch {
            NSLog("NukeCapture media: filing not staged (%@)", String(describing: error))
            return .unreadable
        }
    }

    /// 12 frames, evenly spaced, from the local file. nil = a frame could not be read or the reader was held
    /// (hot phone, Vision unavailable): the clip is not evaluated and is retried on a later pass.
    nonisolated static func readFrames(of avAsset: AVAsset, duration: TimeInterval, count: Int,
                                       roster: [MediaRosterVehicle]) async -> [FrameEvidence]? {
        guard duration > 0, count > 0 else { return nil }
        let generator = AVAssetImageGenerator(asset: avAsset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: NativeIdentityOCR.maxPixel, height: NativeIdentityOCR.maxPixel)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
        var out: [FrameEvidence] = []
        for i in 0..<count {
            let t = CMTime(seconds: duration * (Double(i) + 0.5) / Double(count), preferredTimescale: 600)
            guard let result = try? await generator.image(at: t) else { return nil }
            guard let evidence = autoreleasepool(invoking: { frameEvidence(result.image, roster: roster) }) else { return nil }
            out.append(evidence)
        }
        return out
    }

    /// One frame through the photo readers. Fails closed: a classifier, face detector or identity reader that did
    /// not answer makes the frame (and the clip) unreadable, never "fine".
    private nonisolated static func frameEvidence(_ cg: CGImage, roster: [MediaRosterVehicle]) -> FrameEvidence? {
        guard let classification = VisionEngine.classify(cg),
              let face = try? VisionEngine.detectProminentFace(cg),
              let read = OnDeviceAnalysis.analyzeIdentity(cg, classification: classification) else { return nil }
        let decision = VisionDecision.decide(labels: classification.labels, isVehicle: classification.isVehicle, face: face)
        let labels = Array(classification.labels.prefix(12).map { $0.0 })
        let vins = Array(Set(VisionEngine.vinCandidates(in: read.textLines) + VisionEngine.checkedVINs(in: read.textLines) +
            VisionEngine.labelledClassicSerialCandidates(in: read.textLines))).sorted()
        return MediaAttributionGate.frameEvidence(decision: decision.category, labels: labels, textLines: read.textLines,
                                                  vinCandidates: vins, observations: read.observations, roster: roster)
    }

    private nonisolated static func facts(of avAsset: AVAsset) async -> ClipFacts {
        var codec: String? = nil
        var size = CGSize(width: 0, height: 0)
        if let track = try? await avAsset.loadTracks(withMediaType: .video).first {
            if let desc = (try? await track.load(.formatDescriptions))?.first {
                let n = UInt32(CMFormatDescriptionGetMediaSubType(desc))
                let bytes = [UInt8((n >> 24) & 255), UInt8((n >> 16) & 255), UInt8((n >> 8) & 255), UInt8(n & 255)]
                codec = String(bytes: bytes, encoding: .ascii)
            }
            let natural = (try? await track.load(.naturalSize)) ?? .zero
            let transform = (try? await track.load(.preferredTransform)) ?? .identity
            let applied = natural.applying(transform)
            size = CGSize(width: abs(applied.width), height: abs(applied.height))
        }
        return ClipFacts(codec: codec, width: Int(size.width), height: Int(size.height))
    }

    private static func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { (raw: UnsafeRawBufferPointer) -> String in
            let bytes = raw.prefix(while: { (b: UInt8) -> Bool in b != 0 })
            return String(decoding: bytes, as: UTF8.self)
        }
    }

    /// Builds the metadata-only insert for a clip that cleared. Nothing is sent here.
    private func makeFiling(_ item: Found, clearance: MediaClearance, facts: ClipFacts, framesSampled: Int,
                            candidates: Int, anchors: Int, userId: String) throws -> VideoFiling {
        let c = item.candidate
        let rowID = UUID().uuidString.lowercased()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let basis = MediaMatchBasis(
            rule: VideoSyncConfig.gateVersion, method: clearance.method, confidence: clearance.confidence,
            frames_sampled: framesSampled, frames_exact: clearance.exactFrames, candidates: candidates, anchors: anchors,
            window_seconds: Int(VideoSyncConfig.photoTimeWindow), radius_m: VideoSyncConfig.photoRadiusMeters)
        let row = MediaImageRow(
            id: rowID, user_id: userId, image_url: "", file_name: "\(c.assetKey)-preview.mp4", mime_type: "video/mp4",
            is_video: true, duration_seconds: c.duration, video_codec: facts.codec,
            video_resolution: facts.width > 0 ? "\(facts.width)x\(facts.height)" : nil,
            taken_at: iso.string(from: c.startedAt), latitude: c.latitude, longitude: c.longitude,
            source: VideoSyncConfig.rowSource, image_medium: "other", ai_processing_status: "skipped",
            is_sensitive: false, ingest_kind: "live", auto_suggested_vehicle_id: clearance.vehicleID,
            auto_suggestion_reasons: [VideoSyncConfig.gateVersion],
            exif_data: MediaExif(synced_by: "capture-relay-ios", asset_key: c.assetKey, media: .init(
                kind: c.kind.rawValue, bucket: VideoSyncConfig.bucket,
                preview_path: VideoSyncConfig.previewPath(userID: userId, rowID: rowID),
                full_state: "held_on_phone", device_model: Self.deviceModel(), device_os: UIDevice.current.systemVersion,
                width: facts.width, height: facts.height, match: basis)))
        return VideoFiling(assetKey: c.assetKey, localID: item.asset.localIdentifier, rowID: rowID,
                           vehicleID: clearance.vehicleID, method: clearance.method, confidence: clearance.confidence,
                           rowJSON: try JSONEncoder().encode(row))
    }

    // ─── 5. Row, then the server's filing gate, then (and only then) pixels ──

    private struct IDRow: Decodable { let id: String }

    private func advanceFilings(userId: String) async {
        for key in Array(ledger.filings.keys) where !Task.isCancelled {
            await advance(assetKey: key, userId: userId)
        }
    }

    private func advance(assetKey: String, userId: String) async {
        guard var filing = ledger.filings[assetKey] else { return }
        if filing.state == .cleared {
            do {
                // After a reinstall the ledger is gone: look for this asset's row before inserting another.
                let existing: [IDRow] = (try? await SupabaseService.client.from(VideoSyncConfig.table)
                    .select("id")
                    .eq("user_id", value: userId)
                    .eq("source", value: VideoSyncConfig.rowSource)
                    .eq("exif_data->>asset_key", value: filing.assetKey)
                    .limit(1)
                    .execute().value) ?? []
                if existing.isEmpty {
                    let value = try JSONDecoder().decode(AnyJSON.self, from: filing.rowJSON)
                    do {
                        try await SupabaseService.client.from(VideoSyncConfig.table).insert(value).execute()
                    } catch {
                        let msg = String(describing: error).lowercased()
                        guard msg.contains("duplicate") || msg.contains("unique") else { throw error }
                    }
                }
                ledger.setState(assetKey, .rowInserted)
                persist()
                filing.state = .rowInserted
            } catch {
                if SupabaseService.isAuthFailure(error) { SyncEngine.shared.noteSessionRefused(); return }
                ledger.noteFilingAttempt(assetKey, maxAttempts: VideoSyncConfig.maxFilingAttempts)
                persist()
                return
            }
        }
        if filing.state == .rowInserted {
            switch await fileOnServer(filing) {
            case .filed:
                ledger.setState(assetKey, .filed)
                persist()
                filing.state = .filed
            case .retry:
                ledger.noteFilingAttempt(assetKey, maxAttempts: VideoSyncConfig.maxFilingAttempts)
                persist()
                return
            case .refused(let status):
                // The row stays metadata-only; no object is ever uploaded for it.
                ledger.serverRefused(assetKey, status: status)
                persist()
                return
            }
        }
        if filing.state == .filed { await stageUploads(filing, userId: userId) }
    }

    private enum FilingResult { case filed, retry, refused(String) }

    /// device_file_images: the photo filing gate's server half (ownership, association, supersession,
    /// vision-gate state, confidence floor, VIN length, audit row, vehicle_id).
    private func fileOnServer(_ filing: VideoFiling) async -> FilingResult {
        struct P: Encodable { let p_items: [AttributionEngine.DeviceFileItem] }
        let item = AttributionEngine.DeviceFileItem(
            image_id: filing.rowID, vehicle_id: filing.vehicleID, method: filing.method, confidence: filing.confidence,
            evidence: ["edit_distance": "0", "source": "video_frames"])
        do {
            let res: AnyJSON = try await SupabaseService.client.rpc("device_file_images", params: P(p_items: [item])).execute().value
            switch AttributionEngine.statuses(from: res)[filing.rowID] {
            case "filed", "already": return .filed
            case "deferred", "busy", nil: return .retry
            case .some(let other): return .refused(other)
            }
        } catch {
            NSLog("NukeCapture media: device_file_images failed (%@)", String(describing: error))
            return .retry
        }
    }

    /// The row has a vehicle_id: stage the preview, then (once it has landed) the full file.
    private func stageUploads(_ filing: VideoFiling, userId: String) async {
        guard gatesAllow() else { return }
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [filing.localID], options: nil).firstObject else { return }
        let pendingKeys = Set(ledger.pending.map(\.key))
        if !filing.previewDone, !pendingKeys.contains("\(filing.assetKey)|preview") {
            let fileName = "\(filing.assetKey)-preview.mp4"
            let file = directory.appendingPathComponent(fileName)
            do {
                _ = try await exportVideoPreview(asset, to: file)
                let record = VideoUploadRecord(
                    assetKey: filing.assetKey, rowID: filing.rowID, stage: .preview,
                    objectName: VideoSyncConfig.previewPath(userID: userId, rowID: filing.rowID),
                    fileName: fileName, contentType: "video/mp4")
                if ledger.enqueue(record) { persist() } else { try? fm.removeItem(at: file) }
            } catch {
                NSLog("NukeCapture media: preview not staged (%@)", String(describing: error))
            }
            return
        }
        guard filing.previewDone, !filing.fullDone, !pendingKeys.contains("\(filing.assetKey)|full") else { return }
        let resources = PHAssetResource.assetResources(for: asset)
        guard let resource = resources.first(where: { $0.type == .fullSizeVideo })
                ?? resources.first(where: { $0.type == .video }) else { return }
        guard Self.hasRoom(for: directory) else { return }
        let name = resource.originalFilename as NSString
        let ext = (name.pathExtension.isEmpty ? "mov" : name.pathExtension).lowercased()
        let fileName = "\(filing.assetKey)-full.\(ext)"
        let file = directory.appendingPathComponent(fileName)
        do { try await copyOriginal(resource, to: file) } catch { try? fm.removeItem(at: file); return }
        let type = UTType(filenameExtension: ext)?.preferredMIMEType ?? "video/quicktime"
        let record = VideoUploadRecord(
            assetKey: filing.assetKey, rowID: filing.rowID, stage: .full,
            objectName: VideoSyncConfig.fullPath(userID: userId, rowID: filing.rowID, fileExtension: ext),
            fileName: fileName, contentType: type)
        if ledger.enqueue(record) { persist() } else { try? fm.removeItem(at: file) }
    }

    /// A full-file copy needs room on the phone; stay well clear of filling it.
    nonisolated static func hasRoom(for url: URL, minimumBytes: Int64 = 2 * 1024 * 1024 * 1024) -> Bool {
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        guard let free = values?.volumeAvailableCapacityForImportantUsage else { return false }
        return free >= minimumBytes
    }

    // ─── Previews (low-res) ───────────────────────────────────────────────────

    private func loadAVAsset(_ asset: PHAsset) async throws -> AVAsset {
        try await withCheckedThrowingContinuation { cont in
            let o = PHVideoRequestOptions()
            o.isNetworkAccessAllowed = false          // never pull an iCloud original for this
            o.deliveryMode = .highQualityFormat
            PHImageManager.default().requestAVAsset(forVideo: asset, options: o) { avAsset, _, _ in
                if let avAsset { cont.resume(returning: avAsset) }
                else { cont.resume(throwing: VideoSyncError.unavailableOnDevice) }
            }
        }
    }

    /// First 60 s, video track only (the audio never leaves the phone), 640x480 or smaller, MP4.
    private func exportVideoPreview(_ asset: PHAsset, to out: URL) async throws -> Int {
        let avAsset = try await loadAVAsset(asset)
        let composition = AVMutableComposition()
        guard let source = try await avAsset.loadTracks(withMediaType: .video).first,
              let target = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw VideoSyncError.exportFailed }
        let total = try await avAsset.load(.duration)
        let cut = CMTimeMinimum(total, CMTime(seconds: VideoSyncConfig.previewMaxSeconds, preferredTimescale: 600))
        try target.insertTimeRange(CMTimeRange(start: .zero, duration: cut), of: source, at: .zero)
        target.preferredTransform = try await source.load(.preferredTransform)
        try? fm.removeItem(at: out)
        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset640x480) else {
            throw VideoSyncError.exportFailed
        }
        session.outputURL = out
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        session.fileLengthLimit = Int64(VideoSyncConfig.previewMaxBytes)
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { c.resume() }
        }
        guard session.status == .completed else { throw VideoSyncError.exportFailed }
        let size = (try? fm.attributesOfItem(atPath: out.path)[.size] as? NSNumber)?.intValue ?? 0
        guard size > 0, size <= VideoSyncConfig.previewMaxBytes else {
            try? fm.removeItem(at: out)
            throw VideoSyncError.previewTooLarge
        }
        return size
    }

    private func copyOriginal(_ resource: PHAssetResource, to out: URL) async throws {
        try? fm.removeItem(at: out)
        let o = PHAssetResourceRequestOptions()
        o.isNetworkAccessAllowed = false
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().writeData(for: resource, toFile: out, options: o) { error in
                if let error { c.resume(throwing: error) } else { c.resume() }
            }
        }
    }

    // ─── Transfers (resumable) ────────────────────────────────────────────────

    private func resumePending(token: String, userId: String) async {
        guard gatesAllow() else { return }
        let session = Tus.makeSession(wifiOnly: VideoSyncConfig.wifiOnly())
        defer { session.finishTasksAndInvalidate() }
        for record in ledger.pending where !Task.isCancelled {
            let file = directory.appendingPathComponent(record.fileName)
            guard fm.fileExists(atPath: file.path) else {
                ledger.noteFailure(key: record.key, error: "staged file missing", maxAttempts: 1)
                persist()
                continue
            }
            // Belt and braces: the storage policy refuses this too. Never send pixels for a row the server
            // has not filed.
            guard ledger.filings[record.assetKey]?.state == .filed else { continue }
            let key = record.key
            do {
                try await Tus.upload(
                    file: file, bucket: VideoSyncConfig.bucket, objectName: record.objectName,
                    contentType: record.contentType, accessToken: token, progress: record.tus, session: session,
                    persist: { progress in Task { @MainActor in self.noteTus(key: key, progress) } })
                try await finish(record, file: file, userId: userId)
                try? fm.removeItem(at: file)
            } catch {
                if SupabaseService.isAuthFailure(error) { SyncEngine.shared.noteSessionRefused(); return }
                ledger.noteFailure(key: key, error: String(describing: error), maxAttempts: 8)
                persist()
                // A lost connection ends this pass; the next one resumes from the stored offset.
                if error is URLError { return }
            }
        }
    }

    private func noteTus(key: String, _ progress: TusProgress) {
        ledger.updateTus(key: key, progress)
        persist()
    }

    private struct ObjectPatch: Encodable, Sendable {
        let storage_path: String
        let file_size: Int64
        let mime_type: String
    }

    /// The bytes are complete: point the row at the object.
    private func finish(_ record: VideoUploadRecord, file: URL, userId: String) async throws {
        let size = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
        try await SupabaseService.client.from(VideoSyncConfig.table)
            .update(ObjectPatch(storage_path: record.objectName, file_size: size, mime_type: record.contentType))
            .eq("id", value: record.rowID)
            .eq("user_id", value: userId)
            .execute()
        switch record.stage {
        case .preview: ledger.completePreview(key: record.key)
        case .full: ledger.completeFull(key: record.key)
        }
        persist()
    }

    // ─── Persistence ──────────────────────────────────────────────────────────

    @discardableResult
    private func persist() -> Bool {
        do {
            try JSONEncoder().encode(ledger).write(to: ledgerURL, options: .atomic)
            return true
        } catch {
            NSLog("NukeCapture media: ledger not saved (%@)", error.localizedDescription)
            return false
        }
    }
}
