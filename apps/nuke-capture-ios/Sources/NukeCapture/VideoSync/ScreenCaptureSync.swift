// ScreenCaptureSync.swift — screen recordings and screenshots as acquisition DOCUMENTS (rule screen_text_v1).
//
// A screen capture is not a photo of a vehicle: it is a record about one (a Marketplace listing, a bill of sale, a
// text thread). The photo gate holds a document's pixels and never reads an identifier off one, so these take their
// own path, still entirely on the phone and still behind VideoSyncConfig.isEnabled:
//
//   1. NARROW by acquisition context: only captures made inside a vehicle's acquisition window are listed (PhotoKit
//      metadata only): 21 days before to 2 days after its anchor, the anchor being purchase_date, else the
//      vehicle's first filed photo. created_at is never used. No window, nothing listed, no bulk history.
//   2. READ on the phone: Vision OCR over the screenshot, or 12 frames from the first 60 s of the recording. The
//      recognised text is held in memory for one evaluation and is never stored, logged or sent.
//   3. DECIDE (ScreenCaptureEvidence): year + make + model, or the vehicle's own VIN, AND a price or seller line, for
//      exactly one of the owner's vehicles; a face or private text refuses the capture. Below that, it stays on the
//      phone, nothing is sent, and the user is never prompted.
//   4. FILE: a metadata-only vehicle_images row, then device_file_media_document (migration 20261109100100), which
//      revalidates what it can and attaches the capture as an `acquisition_document` with the price and date cited
//      to frames. Then ONLY a private preview uploads (a 1600 px JPEG, or the first 60 s as MP4). The original never
//      does: the storage policy opens full/ for camera clips only.
//
// Time and context narrow; only the capture's own text attributes.

import AVFoundation
import Foundation
import Photos
import Supabase
import UIKit
import Vision

struct ScreenTally: Equatable {
    var read = 0, attributed = 0, stayed = 0, unreadable = 0
}

/// One screen capture awaiting evaluation.
struct ScreenItem {
    let asset: PHAsset
    let key: String
    let kind: ScreenCaptureKind
    let capturedAt: Date
    let duration: TimeInterval
}

enum ScreenOutcome: Equatable {
    case unreadable
    case refused(ScreenRefusal)
    case attributed
}

/// Vision OCR over one image. Fails closed: a request that did not answer is nil, never "no text".
enum ScreenTextReader {
    static func read(_ cg: CGImage) -> (lines: [String], face: Bool)? {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false          // VINs, prices and model codes are not words
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([request]) } catch { return nil }
        guard let results = request.results else { return nil }
        let lines = results.compactMap { $0.topCandidates(1).first?.string }
        guard let face = try? VisionEngine.detectProminentFace(cg) else { return nil }
        return (lines, face)
    }
}

/// Resumes a continuation at most once (PhotoKit can call a handler more than once).
private final class ResumeOnce: @unchecked Sendable {
    private var done = false
    func take() -> Bool { if done { return false }; done = true; return true }
}

extension VideoSyncEngine {

    // ─── Entry (called from runAfterPhotoPass) ───────────────────────────────

    func runScreenCaptures(userId: String) async -> ScreenTally {
        var tally = ScreenTally()
        guard !Task.isCancelled, readingAllowed() else { return tally }
        do {
            var roster = try await fetchScreenRoster()
            guard !roster.isEmpty else { return tally }
            await resolveAnchors(&roster)
            let items = screenItems(roster: roster, userId: userId)
            for item in items where !Task.isCancelled {
                guard tally.read < VideoSyncConfig.maxScreenReadsPerPass, readingAllowed() else { break }
                if item.kind == .screenRecording, item.duration <= 0 || item.duration > VideoSyncConfig.maxScreenRecordingSeconds {
                    ledger.markChecked(item.key, outcome: "refused:screen_length")
                    persist()
                    tally.stayed += 1
                    continue
                }
                tally.read += 1
                switch await evaluateScreen(item, roster: roster, userId: userId) {
                case .unreadable: tally.unreadable += 1              // not marked: tried again on a later pass
                case .refused(let why):
                    ledger.markChecked(item.key, outcome: "refused:screen_\(why.rawValue)")
                    persist()
                    tally.stayed += 1
                case .attributed: tally.attributed += 1
                }
            }
        } catch {
            NSLog("NukeCapture screen: not run (%@)", ReadFailure.text(error))
        }
        return tally
    }

    // ─── Roster and anchors ───────────────────────────────────────────────────

    private struct ScreenRosterRow: Decodable {
        let id: String
        let vin: String?
        let year: Int?
        let make: String?
        let model: String?
        let purchase_date: String?
        let deleted_at: String?
    }

    /// "yyyy-MM-dd" as UTC midnight: the server reads the same date the same way.
    nonisolated static func parseDateOnly(_ s: String?) -> Date? {
        guard let s, s.count >= 10 else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.date(from: String(s.prefix(10)))
    }

    private func fetchScreenRoster() async throws -> [ScreenRosterVehicle] {
        struct Params: Encodable { let p_user: String }
        guard let userId = SupabaseService.currentUserId else { return [] }
        let ids: [String] = try await SupabaseService.client.rpc("user_associated_vehicle_ids",
            params: Params(p_user: userId)).execute().value
        var out: [ScreenRosterVehicle] = []
        for start in stride(from: 0, to: ids.count, by: 200) {
            let chunk = Array(ids[start..<min(start + 200, ids.count)])
            let rows: [ScreenRosterRow] = try await SupabaseService.client.from("vehicles")
                .select("id, vin, year, make, model, purchase_date, deleted_at")
                .in("id", values: chunk).execute().value
            for r in rows where r.deleted_at == nil {
                out.append(ScreenRosterVehicle(id: r.id, year: r.year, make: r.make, model: r.model, vin: r.vin,
                                               purchaseDate: Self.parseDateOnly(r.purchase_date), firstFiledPhoto: nil))
            }
        }
        return out
    }

    private struct FirstPhotoRow: Decodable {
        let taken_at: String
        let source: String?
        let is_video: Bool?
    }

    /// The vehicle's first filed PHOTO (never a clip this feature filed). Same filters as the server's anchor.
    private func firstFiledPhoto(vehicleID: String) async throws -> Date? {
        let rows: [FirstPhotoRow] = try await SupabaseService.client.from("vehicle_images")
            .select("taken_at, source, is_video")
            .eq("vehicle_id", value: vehicleID)
            .not("taken_at", operator: .is, value: "null")
            .not("is_sensitive", operator: .is, value: true)
            .not("is_superseded", operator: .is, value: true)
            .not("is_duplicate", operator: .is, value: true)
            .order("taken_at", ascending: true)
            .limit(8)
            .execute().value
        for r in rows where r.source != VideoSyncConfig.rowSource && r.is_video != true {
            if let t = Self.parseInstant(r.taken_at) { return t }
        }
        return nil
    }

    /// Fills `firstFiledPhoto` for vehicles with no purchase_date, from the phone's cache or a bounded number of
    /// lookups. A vehicle with no anchor is not a candidate for any capture.
    private func resolveAnchors(_ roster: inout [ScreenRosterVehicle]) async {
        let now = Date()
        var lookups = 0
        for i in roster.indices where roster[i].purchaseDate == nil {
            let id = roster[i].id
            let maxAge = ledger.anchorCache?[id]?.firstPhoto == nil ? 3600 : VideoSyncConfig.anchorCacheSeconds
            if let e = ledger.anchorEntry(id, now: now, maxAge: maxAge) {
                roster[i].firstFiledPhoto = e.firstPhoto.map { Date(timeIntervalSince1970: $0) }
                continue
            }
            guard lookups < VideoSyncConfig.maxAnchorLookupsPerPass, !Task.isCancelled else { continue }
            lookups += 1
            do {
                let t = try await firstFiledPhoto(vehicleID: id)
                ledger.setAnchor(id, firstPhoto: t, now: now)
                roster[i].firstFiledPhoto = t
            } catch {
                NSLog("NukeCapture screen: anchor lookup failed (%@)", ReadFailure.text(error))
            }
        }
        persist()
    }

    // ─── 1. Enumerate (PhotoKit metadata only, acquisition windows only) ─────

    /// Merged acquisition windows, soonest first.
    nonisolated static func windows(for roster: [ScreenRosterVehicle], limit: Int) -> [(start: Date, end: Date)] {
        let raw = roster.compactMap { AcquisitionAnchor.of($0) }.map { (start: $0.start, end: $0.end) }.sorted { $0.start < $1.start }
        var merged: [(start: Date, end: Date)] = []
        for w in raw {
            if let last = merged.last, w.start <= last.end { merged[merged.count - 1].end = max(last.end, w.end) }
            else { merged.append(w) }
        }
        return Array(merged.suffix(limit))
    }

    private func screenItems(roster: [ScreenRosterVehicle], userId: String) -> [ScreenItem] {
        let windows = Self.windows(for: roster, limit: VideoSyncConfig.maxScreenWindows)
        guard !windows.isEmpty else { return [] }
        let ranges = windows.map {
            NSPredicate(format: "creationDate >= %@ AND creationDate < %@", $0.start as NSDate, $0.end as NSDate)
        }
        let inWindow = NSCompoundPredicate(orPredicateWithSubpredicates: ranges)
        var out: [ScreenItem] = []
        for type in [PHAssetMediaType.image, PHAssetMediaType.video] {
            let options = PHFetchOptions()
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
                NSPredicate(format: "mediaType == %d", type.rawValue), inWindow])
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            options.fetchLimit = 3000                  // metadata rows scanned; only screen subtypes are kept
            var kept = 0
            PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, stop in
                let isShot = type == .image && asset.mediaSubtypes.contains(.photoScreenshot)
                let isRec = type == .video && asset.mediaSubtypes.contains(.videoScreenRecording)
                guard isShot || isRec, let created = asset.creationDate else { return }
                let key = Self.assetKey(userId: userId, localIdentifier: asset.localIdentifier)
                guard !self.ledger.isKnown(key) else { return }
                // Context again, per capture: at least one vehicle's own window contains it.
                guard !ScreenCaptureEvidence.candidates(roster: roster, capturedAt: created).isEmpty else { return }
                out.append(ScreenItem(asset: asset, key: key, kind: isRec ? .screenRecording : .screenshot,
                                      capturedAt: created, duration: isRec ? asset.duration : 0))
                kept += 1
                if kept >= VideoSyncConfig.maxScreenAssetsPerPass { stop.pointee = true }
            }
        }
        return out.sorted { $0.capturedAt > $1.capturedAt }
    }

    // ─── 2 + 3. Read on the phone, decide ─────────────────────────────────────

    private func evaluateScreen(_ item: ScreenItem, roster: [ScreenRosterVehicle], userId: String) async -> ScreenOutcome {
        let frames: [ScreenFrameText]?
        let requested: Int
        switch item.kind {
        case .screenshot:
            requested = 1
            guard let cg = await requestUprightImage(item.asset, maxEdge: nil) else { return .unreadable }
            frames = await Task.detached(priority: .utility) { () -> [ScreenFrameText]? in
                guard let read = autoreleasepool(invoking: { ScreenTextReader.read(cg) }) else { return nil }
                return [ScreenFrameText(index: 1, seconds: 0, lines: read.lines, hasProminentFace: read.face)]
            }.value
        case .screenRecording:
            requested = VideoSyncConfig.screenFramesPerRecording
            guard let avAsset = try? await loadAVAsset(item.asset) else { return .unreadable }   // iCloud-only: not read
            let cut = min(item.duration, VideoSyncConfig.previewMaxSeconds)
            frames = await Task.detached(priority: .utility) {
                await Self.readRecordingFrames(avAsset, seconds: cut, count: requested)
            }.value
        }
        guard let frames else { return .unreadable }
        switch ScreenCaptureEvidence.evaluate(capturedAt: item.capturedAt, frames: frames, framesRequested: requested, roster: roster) {
        case .unreadable: return .unreadable
        case .refused(let why): return .refused(why)
        case .attribute(let a):
            do {
                let filing = try makeScreenFiling(item, attribution: a, roster: roster, userId: userId)
                ledger.recordCleared(filing)
                persist()
                await advance(assetKey: filing.assetKey, userId: userId)
                return .attributed
            } catch {
                NSLog("NukeCapture screen: filing not staged (%@)", String(describing: error))
                return .unreadable
            }
        }
    }

    /// Frames evenly spaced over the first `seconds` of the recording (the same span the preview carries), so every
    /// cited frame timestamp can be found in the uploaded preview. nil = a frame or the OCR did not answer.
    nonisolated static func readRecordingFrames(_ avAsset: AVAsset, seconds: TimeInterval, count: Int) async -> [ScreenFrameText]? {
        guard seconds > 0, count > 0 else { return nil }
        let generator = AVAssetImageGenerator(asset: avAsset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: NativeIdentityOCR.maxPixel, height: NativeIdentityOCR.maxPixel)
        generator.requestedTimeToleranceBefore = CMTime(seconds: 0.25, preferredTimescale: 600)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.25, preferredTimescale: 600)
        var out: [ScreenFrameText] = []
        for i in 0..<count {
            let at = (seconds * (Double(i) + 0.5) / Double(count) * 10).rounded() / 10
            guard let result = try? await generator.image(at: CMTime(seconds: at, preferredTimescale: 600)) else { return nil }
            guard let read = autoreleasepool(invoking: { ScreenTextReader.read(result.image) }) else { return nil }
            out.append(ScreenFrameText(index: i + 1, seconds: at, lines: read.lines, hasProminentFace: read.face))
        }
        return out
    }

    /// PhotoKit image, local only (never an iCloud download), upright. maxEdge nil = full size (for OCR).
    private func requestUprightImage(_ asset: PHAsset, maxEdge: CGFloat?) async -> CGImage? {
        let once = ResumeOnce()
        let ui: UIImage? = await withCheckedContinuation { (c: CheckedContinuation<UIImage?, Never>) in
            let o = PHImageRequestOptions()
            o.isNetworkAccessAllowed = false
            o.isSynchronous = false
            o.deliveryMode = .highQualityFormat
            o.resizeMode = maxEdge == nil ? .none : .exact
            var target = PHImageManagerMaximumSize
            if let maxEdge {
                let w = CGFloat(max(asset.pixelWidth, 1)), h = CGFloat(max(asset.pixelHeight, 1))
                let s = min(1, maxEdge / max(w, h))
                target = CGSize(width: (w * s).rounded(), height: (h * s).rounded())
            }
            PHImageManager.default().requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: o) { image, info in
                let cancelled = (info?[PHImageCancelledKey] as? Bool) ?? false
                let failed = info?[PHImageErrorKey] != nil
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                let inCloud = (info?[PHImageResultIsInCloudKey] as? Bool) ?? false
                if cancelled || failed || (degraded && inCloud) { if once.take() { c.resume(returning: nil) }; return }
                if degraded { return }                     // the final image follows
                if once.take() { c.resume(returning: image) }
            }
        }
        guard let ui else { return nil }
        return Self.upright(ui)
    }

    nonisolated static func upright(_ ui: UIImage) -> CGImage? {
        if ui.imageOrientation == .up, let cg = ui.cgImage { return cg }
        let format = UIGraphicsImageRendererFormat()
        format.scale = ui.scale
        return UIGraphicsImageRenderer(size: ui.size, format: format).image { _ in
            ui.draw(in: CGRect(origin: .zero, size: ui.size))
        }.cgImage
    }

    // ─── 4. Row, then the server attaches it as a document, then (only then) the preview ─

    private func makeScreenFiling(_ item: ScreenItem, attribution a: ScreenAttribution, roster: [ScreenRosterVehicle],
                                  userId: String) throws -> VideoFiling {
        let rowID = UUID().uuidString.lowercased()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isRecording = item.kind == .screenRecording
        let ext = isRecording ? "mp4" : "jpg"
        let mime = isRecording ? "video/mp4" : "image/jpeg"
        let payload = ScreenFilingPayload(kind: item.kind.rawValue, method: a.method, confidence: a.confidence,
                                          fields: a.fields, previewExtension: ext, contentType: mime)
        let basis = MediaMatchBasis(
            rule: ScreenCaptureEvidence.rule, method: a.method, confidence: a.confidence,
            frames_sampled: isRecording ? VideoSyncConfig.screenFramesPerRecording : 1,
            frames_exact: a.framesWithVehicleEvidence,
            candidates: ScreenCaptureEvidence.candidates(roster: roster, capturedAt: item.capturedAt).count, anchors: 0,
            window_seconds: Int((AcquisitionAnchor.daysBefore + AcquisitionAnchor.daysAfterInstant) * 86_400), radius_m: 0,
            anchor_source: a.anchorSource.rawValue)
        let row = MediaImageRow(
            id: rowID, user_id: userId, image_url: "", file_name: "\(item.key)-preview.\(ext)", mime_type: mime,
            is_video: isRecording, duration_seconds: isRecording ? item.duration : nil, video_codec: nil,
            video_resolution: nil, taken_at: iso.string(from: item.capturedAt), latitude: nil, longitude: nil,
            source: VideoSyncConfig.rowSource, image_medium: "other", ai_processing_status: "skipped",
            is_sensitive: false, ingest_kind: "live", auto_suggested_vehicle_id: a.vehicleID,
            auto_suggestion_reasons: [ScreenCaptureEvidence.rule],
            exif_data: MediaExif(synced_by: "capture-relay-ios", asset_key: item.key, media: .init(
                kind: item.kind.rawValue, bucket: VideoSyncConfig.bucket,
                preview_path: VideoSyncConfig.previewPath(userID: userId, rowID: rowID, fileExtension: ext),
                full_state: "never_uploaded", device_model: Self.deviceModel(), device_os: UIDevice.current.systemVersion,
                width: item.asset.pixelWidth, height: item.asset.pixelHeight, match: basis)))
        return VideoFiling(assetKey: item.key, localID: item.asset.localIdentifier, rowID: rowID, vehicleID: a.vehicleID,
                           method: a.method, confidence: a.confidence, rowJSON: try JSONEncoder().encode(row),
                           fullDone: true, screen: payload)
    }

    /// device_file_media_document: revalidates ownership, association, the acquisition window and the text-to-vehicle
    /// consistency of the cited fields, then attaches the capture as an acquisition document and sets vehicle_id.
    /// A refusal leaves the row metadata-only (no vehicle_id), so storage refuses the preview.
    func fileScreenDocument(_ filing: VideoFiling, _ screen: ScreenFilingPayload) async -> FilingResult {
        struct P: Encodable {
            let p_row_id: String
            let p_vehicle_id: String
            let p_method: String
            let p_confidence: Double
            let p_fields: [CitedField]
        }
        let params = P(p_row_id: filing.rowID, p_vehicle_id: filing.vehicleID, p_method: screen.method,
                       p_confidence: screen.confidence, p_fields: screen.fields)
        do {
            let res: AnyJSON = try await SupabaseService.client.rpc("device_file_media_document", params: params).execute().value
            switch AttributionEngine.statuses(from: res)[filing.rowID] {
            case "filed", "already": return .filed
            case "deferred", "busy", nil: return .retry
            case .some(let other): return .refused(other)
            }
        } catch {
            NSLog("NukeCapture screen: device_file_media_document failed (%@)", String(describing: error))
            return .retry
        }
    }

    // ─── Preview (the only thing that uploads) ────────────────────────────────

    func exportScreenPreview(_ asset: PHAsset, _ screen: ScreenFilingPayload, to out: URL) async throws -> Int {
        if screen.kind == ScreenCaptureKind.screenshot.rawValue {
            guard let cg = await requestUprightImage(asset, maxEdge: VideoSyncConfig.screenshotPreviewMaxEdge) else {
                throw VideoSyncError.unavailableOnDevice
            }
            let image = UIImage(cgImage: cg)
            for quality in [0.7, 0.55, 0.4] as [CGFloat] {
                if let data = image.jpegData(compressionQuality: quality), data.count <= VideoSyncConfig.screenshotPreviewMaxBytes {
                    try? fm.removeItem(at: out)
                    try data.write(to: out, options: .atomic)
                    return data.count
                }
            }
            throw VideoSyncError.previewTooLarge
        }
        do {
            return try await exportVideoPreview(asset, to: out, preset: VideoSyncConfig.screenRecordingPreviewPreset)
        } catch {
            return try await exportVideoPreview(asset, to: out)          // 640x480 when the larger one does not fit
        }
    }
}
