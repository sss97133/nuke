// VideoSyncEngine.swift — videos and screen recordings that belong to a vehicle, and only those.
//
// OFF by default (VideoSyncConfig.isEnabled). When on, after each photo sync pass:
//   1. Read the owner's recent videos (last 14 days, newest first, 60 at most) from PhotoKit
//      metadata only: no bytes are read for a clip that does not match.
//   2. Ask the server which photos are already filed to a vehicle near each clip in time and place,
//      and which vehicles have a purchase date around a screen recording (VideoCaptureMatcher).
//   3. A clip with no match stays on the phone. Nothing about it is sent, not even a row.
//   4. A matching clip gets a low-resolution, silent, 60-second PREVIEW and a metadata row, uploaded
//      over Wi-Fi to the private `capture-video` bucket by a resumable (TUS) transfer.
//   5. The full file stays on the phone until the server says the clip is attributed to a vehicle
//      (capture_video_assets.state = 'attributed'). A screen recording additionally needs the
//      owner's explicit confirmation (owner_confirmed_full). The database enforces both.
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
}

/// The row that tells the server a preview landed. `user_id` defaults to auth.uid() in the table and the
/// insert policy requires them to agree. Nothing here is a vehicle claim: `suggested_vehicle_id` is the
/// phone's guess; `vehicle_id` is set only by the server's attribution.
struct VideoAssetRow: Codable, Equatable, Sendable {
    struct Basis: Codable, Equatable, Sendable {
        let rule: String
        let anchors: Int
        let window_seconds: Int?
        let radius_m: Double?
        let days_before: Int?
        let days_after: Int?
    }
    let user_id: String
    let asset_key: String
    let kind: String
    let taken_at: String
    let duration_seconds: Double
    let latitude: Double?
    let longitude: Double?
    let device_model: String
    let device_os: String
    let width: Int
    let height: Int
    let preview_path: String
    let preview_size_bytes: Int64
    let match_rule: String
    let suggested_vehicle_id: String
    let match_basis: Basis
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

        var matched = 0, leftOnPhone = 0, failed = 0
        let found = candidates(userId: userId)
        if !found.isEmpty {
            do {
                let (photos, acquisitions) = try await anchors(for: found.map(\.candidate), userId: userId)
                for item in found where !Task.isCancelled && matched < VideoSyncConfig.maxPreviewsPerPass {
                    let verdict = VideoCaptureMatcher.evaluate(item.candidate, photos: photos, acquisitions: acquisitions)
                    guard case .matched(let vehicleID, let rule, let anchorCount) = verdict else { leftOnPhone += 1; continue }
                    do {
                        try await stagePreview(item, vehicleID: vehicleID, rule: rule, anchors: anchorCount, userId: userId)
                        matched += 1
                    } catch {
                        failed += 1
                        NSLog("NukeCapture video: preview not staged (%@)", String(describing: error))
                    }
                }
                leftOnPhone += max(0, found.count - matched - leftOnPhone - failed)
            } catch {
                NSLog("NukeCapture video: anchors unavailable (%@)", ReadFailure.text(error))
                failed += 1
            }
        }
        await resumePending(token: token, userId: userId)
        await requestAttributedFullFiles(token: token, userId: userId)
        lastSummary = "videos: \(matched) matched a vehicle, \(leftOnPhone) stayed on the phone" + (failed > 0 ? ", \(failed) failed" : "")
        NSLog("NukeCapture video: %d matched, %d left on phone, %d failed", matched, leftOnPhone, failed)
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
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "mediaType == %d AND creationDate > %@",
                                        PHAssetMediaType.video.rawValue, since as NSDate)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = VideoSyncConfig.maxAssetsPerPass
        let result = PHAsset.fetchAssets(with: options)
        var out: [Found] = []
        result.enumerateObjects { asset, _, _ in
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

    // ─── 2. Anchors (server reads, owner-scoped by RLS and by eq(user_id)) ───

    private struct PhotoAnchorRow: Decodable {
        let vehicle_id: String
        let taken_at: String
        let latitude: Double?
        let longitude: Double?
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

    private func anchors(for videos: [VideoCandidate], userId: String) async throws -> ([FiledPhotoAnchor], [AcquisitionAnchor]) {
        var photos: [FiledPhotoAnchor] = []
        if let first = videos.filter({ $0.kind == .cameraVideo && $0.latitude != nil }).map(\.startedAt).min(),
           let last = videos.filter({ $0.kind == .cameraVideo && $0.latitude != nil }).map(\.endedAt).max() {
            let iso = ISO8601DateFormatter()
            let rows: [PhotoAnchorRow] = try await SupabaseService.client.from("vehicle_images")
                .select("vehicle_id, taken_at, latitude, longitude")
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
                guard let t = Self.parseInstant(r.taken_at), let la = r.latitude, let lo = r.longitude else { return nil }
                return FiledPhotoAnchor(vehicleID: r.vehicle_id, takenAt: t, latitude: la, longitude: lo)
            }
        }
        var acquisitions: [AcquisitionAnchor] = []
        if videos.contains(where: { $0.kind == .screenRecording }) {
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

    // ─── 3. Preview (low-res, silent, first minute) ──────────────────────────

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
    private func exportPreview(_ asset: PHAsset, to out: URL) async throws {
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
    }

    private static func deviceModel() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { (raw: UnsafeRawBufferPointer) -> String in
            let bytes = raw.prefix(while: { (b: UInt8) -> Bool in b != 0 })
            return String(decoding: bytes, as: UTF8.self)
        }
    }

    private func stagePreview(_ item: Found, vehicleID: String, rule: VideoMatchRule, anchors: Int, userId: String) async throws {
        let c = item.candidate
        let fileName = "\(c.assetKey)-preview.mp4"
        let file = directory.appendingPathComponent(fileName)
        try await exportPreview(item.asset, to: file)
        let size = (try? fm.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
        let path = VideoSyncConfig.previewPath(userID: userId, assetKey: c.assetKey)
        let basis: VideoAssetRow.Basis = rule == .filedPhotoTimeAndPlace
            ? .init(rule: rule.rawValue, anchors: anchors, window_seconds: Int(VideoSyncConfig.photoTimeWindow),
                    radius_m: VideoSyncConfig.photoRadiusMeters, days_before: nil, days_after: nil)
            : .init(rule: rule.rawValue, anchors: anchors, window_seconds: nil, radius_m: nil,
                    days_before: VideoSyncConfig.acquisitionDaysBefore, days_after: VideoSyncConfig.acquisitionDaysAfter)
        let row = VideoAssetRow(
            user_id: userId, asset_key: c.assetKey, kind: c.kind.rawValue,
            taken_at: ISO8601DateFormatter().string(from: c.startedAt), duration_seconds: c.duration,
            latitude: c.latitude, longitude: c.longitude,
            device_model: Self.deviceModel(), device_os: UIDevice.current.systemVersion,
            width: item.asset.pixelWidth, height: item.asset.pixelHeight,
            preview_path: path, preview_size_bytes: size, match_rule: rule.rawValue,
            suggested_vehicle_id: vehicleID, match_basis: basis)
        let record = VideoUploadRecord(
            assetKey: c.assetKey, localID: item.asset.localIdentifier, kind: c.kind, stage: .preview,
            objectName: path, fileName: fileName, contentType: "video/mp4",
            rowJSON: try JSONEncoder().encode(row))
        guard ledger.enqueue(record) else { try? fm.removeItem(at: file); return }
        persist()
    }

    // ─── 4. Transfers (resumable) ─────────────────────────────────────────────

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
                try await finish(record)
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

    private struct MarkFull: Encodable, Sendable {
        let p_id: String
        let p_path: String
    }

    /// The bytes are complete: tell the server. A preview inserts its row; a full file marks the row.
    private func finish(_ record: VideoUploadRecord) async throws {
        switch record.stage {
        case .preview:
            if let json = record.rowJSON {
                let value = try JSONDecoder().decode(AnyJSON.self, from: json)
                do {
                    try await SupabaseService.client.from(VideoSyncConfig.table).insert(value).execute()
                } catch {
                    let msg = String(describing: error).lowercased()
                    guard msg.contains("duplicate") || msg.contains("unique") else { throw error }
                }
            }
            ledger.completePreview(key: record.key)
        case .full:
            if let id = record.rowID {
                try await SupabaseService.client.rpc("capture_video_mark_full_uploaded",
                                                     params: MarkFull(p_id: id, p_path: record.objectName)).execute()
            }
            ledger.completeFull(key: record.key)
        }
        persist()
    }

    // ─── 5. Full file, only after the server attributed the clip ──────────────

    private struct AttributedRow: Decodable {
        let id: String
        let asset_key: String
        let kind: String
        let owner_confirmed_full: Bool
    }

    private func requestAttributedFullFiles(token: String, userId: String) async {
        guard !ledger.previewed.isEmpty, gatesAllow() else { return }
        let rows: [AttributedRow]
        do {
            rows = try await SupabaseService.client.from(VideoSyncConfig.table)
                .select("id, asset_key, kind, owner_confirmed_full")
                .eq("user_id", value: userId)
                .eq("state", value: "attributed")
                .is("full_path", value: nil)
                .limit(20)
                .execute().value
        } catch { return }
        for row in rows where !Task.isCancelled {
            guard !ledger.fullUploaded.contains(row.asset_key),
                  let localID = ledger.previewed[row.asset_key],
                  !ledger.pending.contains(where: { $0.assetKey == row.asset_key && $0.stage == .full }) else { continue }
            // A screen recording needs the owner's explicit confirmation on the server row; the phone checks
            // it too, and the storage policy refuses the object without it.
            guard row.kind == VideoKind.cameraVideo.rawValue || row.owner_confirmed_full else { continue }
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [localID], options: nil).firstObject,
                  let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type == .video || $0.type == .fullSizeVideo })
            else { continue }
            let ext = (resource.originalFilename as NSString).pathExtension.isEmpty ? "mov" : (resource.originalFilename as NSString).pathExtension
            let fileName = "\(row.asset_key)-full.\(ext.lowercased())"
            let file = directory.appendingPathComponent(fileName)
            do {
                try await copyOriginal(resource, to: file)
            } catch { continue }
            let type = UTType(filenameExtension: ext)?.preferredMIMEType ?? "video/quicktime"
            let kind = VideoKind(rawValue: row.kind) ?? .cameraVideo
            let record = VideoUploadRecord(
                assetKey: row.asset_key, localID: localID, kind: kind, stage: .full,
                objectName: VideoSyncConfig.fullPath(userID: userId, assetKey: row.asset_key, fileExtension: ext),
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
            NSLog("NukeCapture video: ledger not saved (%@)", error.localizedDescription)
            return false
        }
    }
}
