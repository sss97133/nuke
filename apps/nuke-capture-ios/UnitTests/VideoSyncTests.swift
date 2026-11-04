// VideoSyncTests.swift — the switch, the ledger, the resumable-upload requests and the privacy defaults.

import Photos
import XCTest
@testable import NukeCapture

final class VideoSyncTests: XCTestCase {
    private func freshDefaults() -> UserDefaults {
        let name = "VideoSyncTests-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        d.removePersistentDomain(forName: name)
        return d
    }

    // ─── The switch ──────────────────────────────────────────────────────────

    func testVideoSyncIsOffByDefaultAndWiFiOnly() {
        let d = freshDefaults()
        XCTAssertFalse(VideoSyncConfig.isEnabled(d), "no key written = OFF")
        XCTAssertTrue(VideoSyncConfig.wifiOnly(d), "no key written = Wi-Fi only")
        d.set(true, forKey: VideoSyncConfig.enabledKey)
        XCTAssertTrue(VideoSyncConfig.isEnabled(d))
        d.set(false, forKey: VideoSyncConfig.wifiOnlyKey)
        XCTAssertFalse(VideoSyncConfig.wifiOnly(d))
    }

    func testTheNumbersMatchTheOwnerScope() {
        XCTAssertEqual(VideoSyncConfig.photoTimeWindow, 30 * 60)
        XCTAssertEqual(VideoSyncConfig.photoRadiusMeters, 150)
        XCTAssertEqual(VideoSyncConfig.acquisitionDaysBefore, 7)
        XCTAssertEqual(VideoSyncConfig.acquisitionDaysAfter, 2)
        XCTAssertEqual(VideoSyncConfig.lookback, 14 * 24 * 3600, "no history: two weeks, not the library")
        XCTAssertEqual(VideoSyncConfig.tusChunkBytes, 6 * 1024 * 1024, "Supabase's resumable endpoint requires 6 MiB chunks")
    }

    // ─── Storage targets are private and keyed by the asset ───────────────────

    func testMediaNeverGoesToThePublicBuckets() {
        XCTAssertNotEqual(VideoSyncConfig.bucket, Config.storageBucket)
        XCTAssertNotEqual(VideoSyncConfig.bucket, "vehicle-images", "vehicle-images is public and image-only")
        XCTAssertEqual(VideoSyncConfig.bucket, "capture-media")
        XCTAssertEqual(VideoSyncConfig.table, "vehicle_images", "the existing video columns are the record")
        XCTAssertEqual(VideoSyncConfig.rowSource, "capture_relay_ios_media")
        XCTAssertNotEqual(VideoSyncConfig.rowSource, Config.sourceTag, "the photo triggers key on capture_relay_ios")
        XCTAssertEqual(VideoSyncConfig.previewPath(userID: "u", assetKey: "abc"), "users/u/previews/abc.mp4")
        XCTAssertEqual(VideoSyncConfig.previewPath(userID: "u", assetKey: "abc", fileExtension: "JPG"), "users/u/previews/abc.jpg")
        XCTAssertEqual(VideoSyncConfig.fullPath(userID: "u", rowID: "ABC-1", fileExtension: "MOV"), "users/u/full/abc-1.mov",
                       "keyed by the row id, so the storage policy finds the row by primary key")
    }

    func testAssetKeyHidesThePhotoKitIdentifier() {
        let k = VideoSyncEngine.assetKey(userId: "u", localIdentifier: "ABC-123/L0/001")
        XCTAssertEqual(k.count, 64)
        XCTAssertFalse(k.contains("ABC"))
        XCTAssertEqual(k, VideoSyncEngine.assetKey(userId: "u", localIdentifier: "ABC-123/L0/001"))
        XCTAssertNotEqual(k, VideoSyncEngine.assetKey(userId: "v", localIdentifier: "ABC-123/L0/001"))
    }

    // ─── Resumable upload requests ────────────────────────────────────────────

    func testCreateRequestCarriesTusHeadersAndNeverUpserts() throws {
        let r = Tus.createRequest(endpoint: Tus.endpoint, accessToken: "tok", length: 1234,
                                  bucket: "capture-video", objectName: "users/u/previews/a.mp4", contentType: "video/mp4")
        XCTAssertEqual(r.httpMethod, "POST")
        XCTAssertEqual(r.url?.path, "/storage/v1/upload/resumable")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Tus-Resumable"), "1.0.0")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Upload-Length"), "1234")
        XCTAssertEqual(r.value(forHTTPHeaderField: "x-upsert"), "false")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        let meta = try XCTUnwrap(r.value(forHTTPHeaderField: "Upload-Metadata"))
        XCTAssertTrue(meta.contains("bucketName \(Tus.b64("capture-video"))"))
        XCTAssertTrue(meta.contains("objectName \(Tus.b64("users/u/previews/a.mp4"))"))
        XCTAssertTrue(meta.contains("contentType \(Tus.b64("video/mp4"))"))
    }

    func testPatchRequestNamesTheOffset() {
        let r = Tus.patchRequest(url: URL(string: "https://x.test/u/1")!, accessToken: "t", offset: 6_291_456)
        XCTAssertEqual(r.httpMethod, "PATCH")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Upload-Offset"), "6291456")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/offset+octet-stream")
    }

    func testChunksAreSixMiBAndTheLastIsShort() {
        let mib = Int64(1024 * 1024)
        let total = 14 * mib
        XCTAssertEqual(Tus.nextChunk(offset: 0, total: total), 0..<(6 * mib))
        XCTAssertEqual(Tus.nextChunk(offset: 6 * mib, total: total), (6 * mib)..<(12 * mib))
        XCTAssertEqual(Tus.nextChunk(offset: 12 * mib, total: total), (12 * mib)..<total)
        XCTAssertNil(Tus.nextChunk(offset: total, total: total), "complete")
        XCTAssertNil(Tus.nextChunk(offset: -1, total: total))
    }

    func testTheUploadURLMayBeRelative() {
        let resp = HTTPURLResponse(url: Tus.endpoint, statusCode: 201, httpVersion: nil,
                                   headerFields: ["Location": "/storage/v1/upload/resumable/abc"])!
        XCTAssertEqual(Tus.uploadURL(from: resp, endpoint: Tus.endpoint)?.path, "/storage/v1/upload/resumable/abc")
        let off = HTTPURLResponse(url: Tus.endpoint, statusCode: 204, httpVersion: nil, headerFields: ["Upload-Offset": "42"])!
        XCTAssertEqual(Tus.offset(from: off), 42)
    }

    func testTheSessionIsWiFiOnlyWhenAsked() {
        let on = Tus.makeSession(wifiOnly: true).configuration
        XCTAssertFalse(on.allowsCellularAccess)
        XCTAssertFalse(on.allowsExpensiveNetworkAccess)
        XCTAssertFalse(on.allowsConstrainedNetworkAccess)
        let off = Tus.makeSession(wifiOnly: false).configuration
        XCTAssertTrue(off.allowsCellularAccess)
    }

    // ─── The ledger ───────────────────────────────────────────────────────────

    private func record(_ key: String, stage: VideoUploadRecord.Stage = .preview) -> VideoUploadRecord {
        VideoUploadRecord(assetKey: key, localID: "L-\(key)", kind: .cameraVideo, stage: stage,
                          objectName: "users/u/previews/\(key).mp4", fileName: "\(key).mp4", contentType: "video/mp4")
    }

    func testLedgerQueuesOncePerAssetAndStage() {
        var l = VideoLedger()
        XCTAssertTrue(l.enqueue(record("a")))
        XCTAssertFalse(l.enqueue(record("a")))
        XCTAssertTrue(l.enqueue(record("a", stage: .full)))
        XCTAssertTrue(l.isKnown("a"))
        XCTAssertFalse(l.isKnown("b"))
    }

    func testLedgerKeepsTheResumeOffsetAndForgetsAfterTooManyFailures() {
        var l = VideoLedger()
        l.enqueue(record("a"))
        l.updateTus(key: "a|preview", TusProgress(uploadURL: "https://x.test/u/1", offset: 6_291_456))
        XCTAssertEqual(l.pending.first?.tus.offset, 6_291_456)
        l.noteFailure(key: "a|preview", error: "e", maxAttempts: 2)
        XCTAssertEqual(l.pending.count, 1)
        l.noteFailure(key: "a|preview", error: "e", maxAttempts: 2)
        XCTAssertTrue(l.pending.isEmpty)
    }

    func testCompletedPreviewRemembersTheLocalIDForTheFullFileStep() {
        var l = VideoLedger()
        l.enqueue(record("a"))
        l.completePreview(key: "a|preview")
        XCTAssertEqual(l.previewed["a"], "L-a")
        XCTAssertTrue(l.pending.isEmpty)
        XCTAssertTrue(l.isKnown("a"), "a clip whose preview landed is never previewed twice")
        l.enqueue(record("a", stage: .full))
        l.completeFull(key: "a|full")
        XCTAssertTrue(l.fullUploaded.contains("a"))
    }

    func testLedgerSurvivesARelaunch() throws {
        var l = VideoLedger()
        l.enqueue(record("a"))
        l.completePreview(key: "a|preview")
        let again = try JSONDecoder().decode(VideoLedger.self, from: JSONEncoder().encode(l))
        XCTAssertEqual(again, l)
    }

    // ─── Screen recording detection ───────────────────────────────────────────

    func testScreenRecordingIsTheSubtypeOrAReplayKitName() {
        XCTAssertTrue(VideoSyncEngine.isScreenRecording(subtypes: .videoScreenRecording, originalFilename: nil))
        XCTAssertTrue(VideoSyncEngine.isScreenRecording(subtypes: [], originalFilename: "RPReplay_Final1700000000.MP4"))
        XCTAssertFalse(VideoSyncEngine.isScreenRecording(subtypes: [], originalFilename: "IMG_0001.MOV"))
        XCTAssertFalse(VideoSyncEngine.isScreenRecording(subtypes: [], originalFilename: nil))
    }

    // ─── What the server is told ──────────────────────────────────────────────

    func testOCRCheckedScreenshotsAreRemembered() {
        var l = VideoLedger()
        XCTAssertFalse(l.isOCRChecked("a"))
        l.markOCRChecked("a")
        XCTAssertTrue(l.isOCRChecked("a"))
        XCTAssertFalse(l.isKnown("a"), "OCR-checked is not 'previewed': a later filed photo may still match it by time")
    }

    // ─── What the server is told ──────────────────────────────────────────────

    private func row(kind: String = "screen_recording", sensitive: Bool = true, vehicle: String? = "V1") -> MediaImageRow {
        MediaImageRow(
            id: "r1", user_id: "u", image_url: "", storage_path: "users/u/previews/x.mp4", file_name: "x-preview.mp4",
            mime_type: "video/mp4", file_size: 1000, is_video: true, duration_seconds: 30, video_codec: "hvc1",
            video_resolution: "1170x2532", taken_at: "2026-11-04T12:00:00Z", latitude: nil, longitude: nil,
            source: VideoSyncConfig.rowSource, image_medium: "other", ai_processing_status: "skipped",
            is_sensitive: sensitive, ingest_kind: "live", auto_suggested_vehicle_id: vehicle,
            auto_suggestion_reasons: ["acquisition_window_v1"],
            exif_data: MediaExif(synced_by: "capture-relay-ios", asset_key: String(repeating: "a", count: 64), media: .init(
                kind: kind, bucket: "capture-media", preview_path: "users/u/previews/x.mp4", preview_bytes: 1000,
                full_state: "held_on_phone", device_model: "iPhone17,1", device_os: "26.0", width: 1170, height: 2532,
                match: .init(rule: "acquisition_window_v1", anchors: 1, window_seconds: nil, radius_m: nil,
                             days_before: 7, days_after: 2, terms: nil))))
    }

    func testThePreviewRowFillsTheExistingVideoColumnsAndFilesNoVehicle() throws {
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(row()), encoding: .utf8))
        for column in ["\"is_video\":true", "\"duration_seconds\":30", "\"video_codec\":\"hvc1\"",
                       "\"video_resolution\":\"1170x2532\"", "\"mime_type\":\"video\\/mp4\""] {
            XCTAssertTrue(json.contains(column), column)
        }
        XCTAssertFalse(json.contains("\"vehicle_id\""), "the phone suggests; a person files")
        XCTAssertFalse(json.contains("user_confirmed_vehicle"))
        XCTAssertTrue(json.contains("\"image_url\":\"\""), "private bucket: no public URL")
        XCTAssertTrue(json.contains("auto_suggested_vehicle_id"))
        XCTAssertFalse(json.contains("full_path"))
        XCTAssertTrue(json.contains("held_on_phone"))
    }

    func testNoVehicleSuggestionIsOmittedNotNull() throws {
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(row(vehicle: nil)), encoding: .utf8))
        XCTAssertFalse(json.contains("auto_suggested_vehicle_id"))
    }

    func testTheRowCarriesNoPixelsAndNoOCRText() throws {
        let data = try JSONEncoder().encode(row())
        XCTAssertLessThan(data.count, 4_000, "metadata only")
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertFalse(json.contains("\"text\""))
    }
}
