// VideoSyncEngine.swift — videos, screen recordings and screenshots that belong to a vehicle, and only those.
//
// OFF by default (VideoSyncConfig.isEnabled). When on, after each photo sync pass:
//   1. Read the owner's recent videos and screenshots (last 14 days, newest first, 60 of each at most) from
//      PhotoKit metadata only: no bytes are read for a clip that does not match.
//   2. Ask the server which photos are already filed to a vehicle near each item in time and place, and which
//      vehicles have a purchase date around a screen recording or screenshot (VideoCaptureMatcher).
//   3. A screenshot that matches neither is read ON THE PHONE by Vision text recognition; only a VIN with a
//      valid check digit, or a model year followed by a make, matches (ScreenshotVehicleTerms). The text is
//      never stored, logged or sent.
//   4. An item with no match stays on the phone. Nothing about it is sent, not even a row.
//   5. A match gets a low-resolution PREVIEW (a silent 60-second video, or a 1280 px JPEG without metadata)
//      uploaded over Wi-Fi to the private `capture-media` bucket by a resumable (TUS) transfer, and ONE
//      vehicle_images row (is_video, duration_seconds, video_codec, video_resolution, mime_type) with no
//      vehicle_id: the phone only suggests (auto_suggested_vehicle_id).
//   6. The full file stays on the phone until that row has a vehicle_id AND user_confirmed_vehicle = true.
//      The storage policy refuses the full object otherwise.
//
// iCloud-only originals are never downloaded for this. Low Power Mode and a hot phone stop the pass.

import AVFoundation
import Foundation
import Photos
import Supabase
import UIKit
import UniformTypeIdentifiers
import Vision

enum VideoSyncError: Error, Equatable {
    case unavailableOnDevice      // iCloud-only or unreadable: never downloaded for this feature
    case exportFailed
    case previewTooLarge
}

/// What the match looked like, kept on the row for audit (numbers, never text).
struct MediaMatchBasis: Codable, Equatable, Sendable {
    let rule: String
    let anchors: Int
    let window_seconds: Int?
    let radius_m: Double?
    let days_before: Int?
    let days_after: Int?
    let terms: [String]?          // OCR match classes only: "vin", "year_make"
}

struct MediaExif: Codable, Equatable, Sendable {
    struct Media: Codable, Equatable, Sendable {
        let kind: String
        let bucket: String
        let preview_path: String
        let preview_bytes: Int64
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

/// The vehicle_images insert for a landed preview. There is deliberately NO vehicle_id: the phone suggests
/// (auto_suggested_vehicle_id) and a person decides. image_url is the '' sentinel the metadata-only photo rows
/// already use: the object is in a private bucket, so there is no public URL.
struct MediaImageRow: Codable, Equatable, Sendable {
    let id: String
    let user_id: String
    let image_url: String
    let storage_path: String
    let file_name: String
    let mime_type: String
    let file_size: Int64
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

        await resumePending(token: token, userId: userId)

        var matched = 0, failed = 0, videoPreviews = 0, shotPreviews = 0, ocrRuns = 0
        let found = candidates(userId: userId)
        if !found.isEmpty {
            do {
                let (photos, acquisitions) = try await anchors(for: found.map(\.candidate), userId: userId)
                for item in found where !Task.isCancelled {
                    let isShot = item.candidate.kind == .screenshot
                    if isShot ? shotPreviews >= VideoSyncConfig.maxScreenshotPreviewsPerPass
                              : videoPreviews >= VideoSyncConfig.maxPreviewsPerPass { continue }
                    var verdict = VideoCaptureMatcher.evaluate(item.candidate, photos: photos, acquisitions: acquisitions)
                    var terms: [String]? = nil
                    if isShot, !verdict.isMatch, !ledger.isOCRChecked(item.candidate.assetKey),
                       ocrRuns < VideoSyncConfig.maxScreenshotOCRPerPass {
                        ocrRuns += 1
                        if let result = await ocr(item.asset) {
                            if let hit = result {
                                verdict = .matched(vehicleID: nil, rule: .onDeviceText, anchors: 0)
                                terms = hit.classes
                            } else {
                                ledger.markOCRChecked(item.candidate.assetKey)
                                persist()
                            }
                        }
                    }
                    guard case .matched(let vehicleID, let rule, let anchorCount) = verdict else { continue }
                    do {
                        try await stagePreview(item, vehicleID: vehicleID, rule: rule, anchors: anchorCount, terms: terms, userId: userId)
                        matched += 1
                        if isShot { shotPreviews += 1 } else { videoPreviews += 1 }
                    } catch {
                        failed += 1
                        NSLog("NukeCapture media: preview not staged (%@)", String(describing: error))
                    }
                }
            } catch {
                NSLog("NukeCapture media: anchors unavailable (%@)", ReadFailure.text(error))
                failed += 1
            }
        }
        await resumePending(token: token, userId: userId)
        await requestAttributedFullFiles(token: token, userId: userId)
        let stayed = max(0, found.count - matched - failed)
        lastSummary = "media: \(matched) matched a vehicle, \(stayed) stayed on the phone" + (failed > 0 ? ", \(failed) failed" : "")
        NSLog("NukeCapture media: %d matched, %d left on phone, %d failed", matched, stayed, failed)
    }

    /// Wi-Fi only (default), not hot, not Low Power Mode.
    private func gatesAllow() -> Bool {
        if VideoSyncConfig.wifiOnly() && !NetworkMonitor.shared.isUnmetered { return false }
        if SyncEngine.deviceTooHot || SyncEngine.lowPowerHolds { return false }
        return true
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
    /// writes RPReplay_*). When unsure the stricter rule applies: it is treated as a screen recording.
    nonisolated static func isScreenRecording(subtypes: PHAssetMediaSubtype, originalFilename: String?) -> Bool {
        if subtypes.contains(.videoScreenRecording) { return true }
        return (originalFilename ?? "").uppercased().hasPrefix("RPREPLAY")
    }

    private func candidates(userId: String) -> [Found] {
        let since = Date(timeIntervalSinceNow: -VideoSyncConfig.lookback)
        var out: [Found] = []

        let videoOptions = PHFetchOptions()
        videoOptions.predicate = NSPredicate(format: "mediaType == %d AND creationDate > %@",
                                             PHAssetMediaType.video.rawValue, since as NSDate)
        videoOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        videoOptions.fetchLimit = VideoSyncConfig.maxAssetsPerPass
        PHAsset.fetchAssets(with: videoOptions).enumerateObjects { asset, _, _ in
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

        // Screenshots: the photo sync skips them (PHAssetMediaSubtype.photoScreenshot); this reads only
        // their metadata until a rule matches.
        let shotOptions = PHFetchOptions()
        shotOptions.predicate = NSPredicate(format: "mediaType == %d AND (mediaSubtypes & %d) != 0 AND creationDate > %@",
                                            PHAssetMediaType.image.rawValue, PHAssetMediaSubtype.photoScreenshot.rawValue,
                                            since as NSDate)
        shotOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        shotOptions.fetchLimit = VideoSyncConfig.maxAssetsPerPass
        PHAsset.fetchAssets(with: shotOptions).enumerateObjects { asset, _, _ in
            guard let taken = asset.creationDate else { return }
            let key = Self.assetKey(userId: userId, localIdentifier: asset.localIdentifier)
            guard !self.ledger.isKnown(key) else { return }
            let coordinate = asset.location?.coordinate
            out.append(Found(candidate: VideoCandidate(
                assetKey: key, kind: .screenshot, startedAt: taken, duration: 0,
                latitude: coordinate?.latitude, longitude: coordinate?.longitude),
                             asset: asset))
        }
        return out
    }

    // ─── 2. Anchors (server reads, owner-scoped by RLS and by eq(user_id)) ───

    private struct PhotoAnchorRow: Decodable {
        let vehicle_id: String
        let taken_at: String
        let latitude: Double?
        let longitude: Double?
        let source: String?
        let is_video: Bool?
    }
    private struct VehicleDayRow: Decodable {
        let id: String
        let purchase_date: String
    }

    private static func parseInstant(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    private static func parseDay(_ s: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.date(from: s)
    }

    private func anchors(for items: [VideoCandidate], userId: String) async throws -> ([FiledPhotoAnchor], [AcquisitionAnchor]) {
        var photos: [FiledPhotoAnchor] = []
        // Filed photos matter to a camera video with GPS and to any screenshot.
        let needsPhotos = items.filter { ($0.kind == .cameraVideo && $0.latitude != nil) || $0.kind == .screenshot }
        if let first = needsPhotos.map(\.startedAt).min(), let last = needsPhotos.map(\.endedAt).max() {
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
            photos = rows.compactMap { r in
                // Only real photos anchor: never a clip or screenshot this feature filed itself.
                guard r.source != VideoSyncConfig.rowSource, r.is_video != true else { return nil }
                guard let t = Self.parseInstant(r.taken_at), let la = r.latitude, let lo = r.longitude else { return nil }
                return FiledPhotoAnchor(vehicleID: r.vehicle_id, takenAt: t, latitude: la, longitude: lo)
            }
        }
        var acquisitions: [AcquisitionAnchor] = []
        if items.contains(where: { $0.kind == .screenRecording || $0.kind == .screenshot }) {
            let rows: [VehicleDayRow] = try await SupabaseService.client.from("vehicles")
                .select("id, purchase_date")
                .eq("owner_id", value: userId)
                .not("purchase_date", operator: .is, value: "null")
                .limit(500)
                .execute().value
            acquisitions = rows.compactMap { r in
                Self.parseDay(r.purchase_date).map { AcquisitionAnchor(vehicleID: r.id, purchaseDay: $0) }
            }
        }
        return (photos, acquisitions)
    }

    // ─── 3. On-device text recognition (screenshots only; nothing leaves the phone) ──

    /// nil = could not read the image (iCloud-only or unreadable): not marked as checked.
    /// .some(nil) = read, no vehicle terms. .some(hit) = vehicle terms. The text is never kept.
    private func ocr(_ asset: PHAsset) async -> ScreenshotVehicleTerms.Hit?? {
        guard let image = try? await requestImage(asset, longEdge: VideoSyncConfig.ocrLongEdge),
              let cg = image.cgImage else { return nil }
        let text: String = await Task.detached(priority: .utility) { () -> String in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            let handler = VNImageRequestHandler(cgImage: cg, options: [:])
            do { try handler.perform([request]) } catch { return "" }
            let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            return lines.joined(separator: "\n")
        }.value
        return .some(ScreenshotVehicleTerms.hit(in: text))
    }

    private func requestImage(_ asset: PHAsset, longEdge: CGFloat) async throws -> UIImage {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<UIImage, Error>) in
            let o = PHImageRequestOptions()
            o.isNetworkAccessAllowed = false            // never pull an iCloud original for this
            o.deliveryMode = .highQualityFormat
            o.resizeMode = .exact
            var finished = false
            PHImageManager.default().requestImage(
                for: asset, targetSize: CGSize(width: longEdge, height: longEdge), contentMode: .aspectFit, options: o
            ) { image, info in
                if finished { return }
                if image != nil, (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
                finished = true
                if let image { cont.resume(returning: image) } else { cont.resume(throwing: VideoSyncError.unavailableOnDevice) }
            }
        }
    }

    // ─── 4. Previews (low-res; the full file stays on the phone) ─────────────

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
    /// Returns the SOURCE track's codec (e.g. "hvc1"), for vehicle_images.video_codec.
    private func exportVideoPreview(_ asset: PHAsset, to out: URL) async throws -> String? {
        let avAsset = try await loadAVAsset(asset)
        let composition = AVMutableComposition()
        guard let source = try await avAsset.loadTracks(withMediaType: .video).first,
              let target = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw VideoSyncError.exportFailed }
        let total = try await avAsset.load(.duration)
        let cut = CMTimeMinimum(total, CMTime(seconds: VideoSyncConfig.previewMaxSeconds, preferredTimescale: 600))
        try target.insertTimeRange(CMTimeRange(start: .zero, duration: cut), of: source, at: .zero)
        target.preferredTransform = try await source.load(.preferredTransform)
        var codec: String? = nil
        if let desc = try await source.load(.formatDescriptions).first {
            let n = UInt32(CMFormatDescriptionGetMediaSubType(desc))
            let bytes = [UInt8((n >> 24) & 255), UInt8((n >> 16) & 255), UInt8((n >> 8) & 255), UInt8(n & 255)]
            codec = String(bytes: bytes, encoding: .ascii)
        }
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
        return codec
    }

    /// A JPEG of at most 1280 px on the long edge. Re-encoding a UIImage drops EXIF and GPS.
    private func exportScreenshotPreview(_ asset: PHAsset, to out: URL) async throws {
        let image = try await requestImage(asset, longEdge: VideoSyncConfig.screenshotPreviewLongEdge)
        guard let data = image.jpegData(compressionQuality: VideoSyncConfig.screenshotPreviewQuality),
              data.count > 0, data.count <= VideoSyncConfig.screenshotPreviewMaxBytes else {
            throw VideoSyncError.previewTooLarge
        }
        try? fm.removeItem(at: out)
        try data.write(to: out, options: .atomic)
    }

    private static func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { (raw: UnsafeRawBufferPointer) -> String in
            let bytes = raw.prefix(while: { (b: UInt8) -> Bool in b != 0 })
            return String(decoding: bytes, as: UTF8.self)
        }
    }

    private func stagePreview(_ item: Found, vehicleID: String?, rule: VideoMatchRule, anchors: Int,
                              terms: [String]?, userId: String) async throws {
        let c = item.candidate
        let isShot = c.kind == .screenshot
        let ext = isShot ? "jpg" : "mp4"
        let contentType = isShot ? "image/jpeg" : "video/mp4"
        let fileName = "\(c.assetKey)-preview.\(ext)"
        let file = directory.appendingPathComponent(fileName)
        var codec: String? = nil
        if isShot { try await exportScreenshotPreview(item.asset, to: file) }
        else { codec = try await exportVideoPreview(item.asset, to: file) }
        let size = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
        let path = VideoSyncConfig.previewPath(userID: userId, assetKey: c.assetKey, fileExtension: ext)
        let basis: MediaMatchBasis
        switch rule {
        case .filedPhotoTimeAndPlace:
            basis = .init(rule: rule.rawValue, anchors: anchors, window_seconds: Int(VideoSyncConfig.photoTimeWindow),
                          radius_m: VideoSyncConfig.photoRadiusMeters, days_before: nil, days_after: nil, terms: nil)
        case .filedPhotoTime:
            basis = .init(rule: rule.rawValue, anchors: anchors, window_seconds: Int(VideoSyncConfig.photoTimeWindow),
                          radius_m: nil, days_before: nil, days_after: nil, terms: nil)
        case .acquisitionWindow:
            basis = .init(rule: rule.rawValue, anchors: anchors, window_seconds: nil, radius_m: nil,
                          days_before: VideoSyncConfig.acquisitionDaysBefore, days_after: VideoSyncConfig.acquisitionDaysAfter, terms: nil)
        case .onDeviceText:
            basis = .init(rule: rule.rawValue, anchors: 0, window_seconds: nil, radius_m: nil,
                          days_before: nil, days_after: nil, terms: terms)
        }
        let rowID = UUID().uuidString.lowercased()
        let w = item.asset.pixelWidth, h = item.asset.pixelHeight
        let row = MediaImageRow(
            id: rowID, user_id: userId, image_url: "", storage_path: path, file_name: fileName,
            mime_type: contentType, file_size: size, is_video: c.kind.isVideo,
            duration_seconds: c.kind.isVideo ? c.duration : nil, video_codec: codec,
            video_resolution: c.kind.isVideo ? "\(w)x\(h)" : nil,
            taken_at: ISO8601DateFormatter().string(from: c.startedAt),
            latitude: c.latitude, longitude: c.longitude,
            source: VideoSyncConfig.rowSource,
            image_medium: c.kind == .cameraVideo ? "camera" : (isShot ? "screenshot" : "other"),
            ai_processing_status: "skipped",
            // A screen capture is private until a person says otherwise: even filed to a public vehicle
            // the public read policy skips is_sensitive rows.
            is_sensitive: c.kind != .cameraVideo, ingest_kind: "live",
            auto_suggested_vehicle_id: vehicleID, auto_suggestion_reasons: [rule.rawValue],
            exif_data: MediaExif(synced_by: "capture-relay-ios", asset_key: c.assetKey, media: .init(
                kind: c.kind.rawValue, bucket: VideoSyncConfig.bucket, preview_path: path, preview_bytes: size,
                full_state: "held_on_phone", device_model: Self.deviceModel(), device_os: UIDevice.current.systemVersion,
                width: w, height: h, match: basis)))
        let record = VideoUploadRecord(
            assetKey: c.assetKey, localID: item.asset.localIdentifier, kind: c.kind, stage: .preview,
            objectName: path, fileName: fileName, contentType: contentType,
            rowJSON: try JSONEncoder().encode(row), rowID: rowID)
        guard ledger.enqueue(record) else { try? fm.removeItem(at: file); return }
        persist()
    }

    // ─── 5. Transfers (resumable) ─────────────────────────────────────────────

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

    private struct IDRow: Decodable { let id: String }

    private struct FullPatch: Encodable, Sendable {
        let storage_path: String
        let file_size: Int64
        let mime_type: String
    }

    /// The bytes are complete: a preview inserts its vehicle_images row; a full file points the row at it.
    private func finish(_ record: VideoUploadRecord, file: URL, userId: String) async throws {
        switch record.stage {
        case .preview:
            if let json = record.rowJSON {
                // Best-effort: after a reinstall the ledger is gone, so look for this asset's row first.
                let existing: [IDRow] = (try? await SupabaseService.client.from(VideoSyncConfig.table)
                    .select("id")
                    .eq("user_id", value: userId)
                    .eq("source", value: VideoSyncConfig.rowSource)
                    .eq("exif_data->>asset_key", value: record.assetKey)
                    .limit(1)
                    .execute().value) ?? []
                if existing.isEmpty {
                    let value = try JSONDecoder().decode(AnyJSON.self, from: json)
                    do {
                        try await SupabaseService.client.from(VideoSyncConfig.table).insert(value).execute()
                    } catch {
                        let msg = String(describing: error).lowercased()
                        guard msg.contains("duplicate") || msg.contains("unique") else { throw error }
                    }
                }
            }
            ledger.completePreview(key: record.key)
        case .full:
            if let id = record.rowID {
                let size = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
                try await SupabaseService.client.from(VideoSyncConfig.table)
                    .update(FullPatch(storage_path: record.objectName, file_size: size, mime_type: record.contentType))
                    .eq("id", value: id)
                    .eq("user_id", value: userId)
                    .execute()
            }
            ledger.completeFull(key: record.key)
        }
        persist()
    }

    // ─── 6. Full file, only after a person attributed the row ─────────────────

    private struct AttributedRow: Decodable {
        struct Exif: Decodable { let asset_key: String? }
        let id: String
        let storage_path: String?
        let exif_data: Exif?
    }

    private func requestAttributedFullFiles(token: String, userId: String) async {
        guard !ledger.previewed.isEmpty, gatesAllow() else { return }
        let rows: [AttributedRow]
        do {
            // "Attributed" = a vehicle on the row AND the owner's confirmation. A vehicle alone is not enough:
            // automatic attribution also sets vehicle_id.
            rows = try await SupabaseService.client.from(VideoSyncConfig.table)
                .select("id, storage_path, exif_data")
                .eq("user_id", value: userId)
                .eq("source", value: VideoSyncConfig.rowSource)
                .not("vehicle_id", operator: .is, value: "null")
                .eq("user_confirmed_vehicle", value: true)
                .like("storage_path", pattern: "%/previews/%")
                .limit(50)
                .execute().value
        } catch { return }
        for row in rows where !Task.isCancelled {
            guard let assetKey = row.exif_data?.asset_key,
                  !ledger.fullUploaded.contains(assetKey),
                  let localID = ledger.previewed[assetKey],
                  !ledger.pending.contains(where: { $0.assetKey == assetKey && $0.stage == .full }) else { continue }
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localID], options: nil).firstObject else { continue }
            let isVideo = asset.mediaType == .video
            let resources = PHAssetResource.assetResources(for: asset)
            guard let resource = resources.first(where: { isVideo ? ($0.type == .video || $0.type == .fullSizeVideo) : ($0.type == .photo) })
                    ?? resources.first(where: { $0.type == .fullSizePhoto && !isVideo })
            else { continue }
            let fallback = isVideo ? "mov" : "png"
            let name = resource.originalFilename as NSString
            let ext = (name.pathExtension.isEmpty ? fallback : name.pathExtension).lowercased()
            let fileName = "\(assetKey)-full.\(ext)"
            let file = directory.appendingPathComponent(fileName)
            do { try await copyOriginal(resource, to: file) } catch { continue }
            let type = UTType(filenameExtension: ext)?.preferredMIMEType ?? (isVideo ? "video/quicktime" : "image/png")
            let kind: VideoKind = isVideo ? .cameraVideo : .screenshot
            let record = VideoUploadRecord(
                assetKey: assetKey, localID: localID, kind: kind, stage: .full,
                objectName: VideoSyncConfig.fullPath(userID: userId, rowID: row.id, fileExtension: ext),
                fileName: fileName, contentType: type, rowID: row.id)
            if ledger.enqueue(record) { persist() } else { try? fm.removeItem(at: file) }
        }
        await resumePending(token: token, userId: userId)
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
