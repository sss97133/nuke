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
        XCTAssertEqual(VideoSyncConfig.framesPerClip, 12)
        XCTAssertEqual(MediaAttributionGate.confidenceFloor, 0.9, "the server's floor for vin_ocr / serial_ocr")
        XCTAssertEqual(MediaAttributionGate.fullVINConfidence, 0.99)
        XCTAssertEqual(MediaAttributionGate.classicSerialConfidence, 0.97)
        XCTAssertEqual(VideoSyncConfig.lookback, 14 * 24 * 3600, "no history: two weeks, not the library")
        XCTAssertEqual(VideoSyncConfig.tusChunkBytes, 6 * 1024 * 1024, "Supabase's resumable endpoint requires 6 MiB chunks")
    }

    // ─── Storage targets are private and keyed by the row ───────────────────

    func testMediaNeverGoesToThePublicBuckets() {
        XCTAssertNotEqual(VideoSyncConfig.bucket, Config.storageBucket)
        XCTAssertNotEqual(VideoSyncConfig.bucket, "vehicle-images", "vehicle-images is public and image-only")
        XCTAssertEqual(VideoSyncConfig.bucket, "capture-media")
        XCTAssertEqual(VideoSyncConfig.table, "vehicle_images", "the existing video columns are the record")
        XCTAssertEqual(VideoSyncConfig.rowSource, "capture_relay_ios_media")
        XCTAssertNotEqual(VideoSyncConfig.rowSource, Config.sourceTag, "the photo triggers key on capture_relay_ios")
        XCTAssertEqual(VideoSyncConfig.previewPath(userID: "u", rowID: "ABC-1"), "users/u/previews/abc-1.mp4")
        XCTAssertEqual(VideoSyncConfig.fullPath(userID: "u", rowID: "ABC-1", fileExtension: "MOV"), "users/u/full/abc-1.mov",
                       "both objects are keyed by the row id, so the storage policy finds the row by primary key")
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

    private func filing(_ key: String) -> VideoFiling {
        VideoFiling(assetKey: key, localID: "L-\(key)", rowID: "row-\(key)", vehicleID: "V1", method: "vin_ocr",
                    confidence: 0.99, rowJSON: Data("{}".utf8))
    }
    private func record(_ key: String, stage: VideoUploadRecord.Stage) -> VideoUploadRecord {
        VideoUploadRecord(assetKey: key, rowID: "row-\(key)", stage: stage,
                          objectName: "users/u/\(stage.rawValue)/row-\(key).mp4", fileName: "\(key).mp4", contentType: "video/mp4")
    }

    func testARefusedClipIsRememberedAsAWordNotContent() {
        var l = VideoLedger()
        XCTAssertFalse(l.isKnown("a"))
        l.markChecked("a", outcome: "refused:no_identifier_read")
        XCTAssertTrue(l.isKnown("a"), "a clip that was read once is not read again")
        XCTAssertTrue(l.filings.isEmpty)
        XCTAssertTrue(l.pending.isEmpty, "nothing is queued for a clip that stays on the phone")
    }

    func testAClearedClipMovesThroughRowFilingThenTransfers() {
        var l = VideoLedger()
        l.recordCleared(filing("a"))
        XCTAssertEqual(l.filings["a"]?.state, .cleared)
        XCTAssertTrue(l.isKnown("a"))
        l.setState("a", .rowInserted)
        XCTAssertNil(l.checked["a"], "not filed yet")
        l.setState("a", .filed)
        XCTAssertEqual(l.checked["a"], "filed")
        XCTAssertTrue(l.enqueue(record("a", stage: .preview)))
        XCTAssertFalse(l.enqueue(record("a", stage: .preview)))
        l.completePreview(key: "a|preview")
        XCTAssertEqual(l.filings["a"]?.previewDone, true)
        XCTAssertNotNil(l.filings["a"], "the full file is still owed")
        XCTAssertTrue(l.enqueue(record("a", stage: .full)))
        l.completeFull(key: "a|full")
        XCTAssertNil(l.filings["a"], "both objects landed")
        XCTAssertTrue(l.isKnown("a"))
    }

    func testAServerRefusalLeavesNothingToUpload() {
        var l = VideoLedger()
        l.recordCleared(filing("a"))
        l.setState("a", .rowInserted)
        l.serverRefused("a", status: "not_associated")
        XCTAssertNil(l.filings["a"])
        XCTAssertEqual(l.checked["a"], "refused:server_not_associated")
        XCTAssertTrue(l.pending.isEmpty)
    }

    func testDeferredFilingGivesUpAfterTooManyAttemptsWithoutUploading() {
        var l = VideoLedger()
        l.recordCleared(filing("a"))
        l.setState("a", .rowInserted)
        l.noteFilingAttempt("a", maxAttempts: 2)
        XCTAssertNotNil(l.filings["a"])
        l.noteFilingAttempt("a", maxAttempts: 2)
        XCTAssertNil(l.filings["a"])
        XCTAssertEqual(l.checked["a"], "refused:server")
    }

    func testLedgerKeepsTheResumeOffsetAndForgetsAfterTooManyFailures() {
        var l = VideoLedger()
        l.recordCleared(filing("a"))
        l.enqueue(record("a", stage: .preview))
        l.updateTus(key: "a|preview", TusProgress(uploadURL: "https://x.test/u/1", offset: 6_291_456))
        XCTAssertEqual(l.pending.first?.tus.offset, 6_291_456)
        l.noteFailure(key: "a|preview", error: "e", maxAttempts: 2)
        XCTAssertEqual(l.pending.count, 1)
        l.noteFailure(key: "a|preview", error: "e", maxAttempts: 2)
        XCTAssertTrue(l.pending.isEmpty)
    }

    func testLedgerSurvivesARelaunch() throws {
        var l = VideoLedger()
        l.recordCleared(filing("a"))
        l.setState("a", .filed)
        l.enqueue(record("a", stage: .preview))
        l.markChecked("b", outcome: "refused:privacy")
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

    private func row(vehicle: String? = "V1") -> MediaImageRow {
        MediaImageRow(
            id: "r1", user_id: "u", image_url: "", file_name: "x-preview.mp4", mime_type: "video/mp4",
            is_video: true, duration_seconds: 30, video_codec: "hvc1", video_resolution: "1920x1080",
            taken_at: "2026-11-04T12:00:00Z", latitude: 35.9, longitude: -114.8,
            source: VideoSyncConfig.rowSource, image_medium: "other", ai_processing_status: "skipped",
            is_sensitive: false, ingest_kind: "live", auto_suggested_vehicle_id: vehicle,
            auto_suggestion_reasons: [VideoSyncConfig.gateVersion],
            exif_data: MediaExif(synced_by: "capture-relay-ios", asset_key: String(repeating: "a", count: 64), media: .init(
                kind: "camera_video", bucket: "capture-media", preview_path: "users/u/previews/r1.mp4",
                full_state: "held_on_phone", device_model: "iPhone17,1", device_os: "26.0", width: 1920, height: 1080,
                match: .init(rule: "media_gate_v1", method: "vin_ocr", confidence: 0.99, frames_sampled: 12, frames_exact: 2,
                             candidates: 2, anchors: 3, window_seconds: 1800, radius_m: 150))))
    }

    func testTheInsertFillsTheExistingVideoColumnsAndIsMetadataOnly() throws {
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(row()), encoding: .utf8))
        for column in ["\"is_video\":true", "\"duration_seconds\":30", "\"video_codec\":\"hvc1\"",
                       "\"video_resolution\":\"1920x1080\"", "\"mime_type\":\"video\/mp4\""] {
            XCTAssertTrue(json.contains(column), column)
        }
        XCTAssertTrue(json.contains("\"image_url\":\"\""), "private bucket: no public URL")
        XCTAssertFalse(json.contains("\"storage_path\""), "no object yet: nothing has been uploaded")
        XCTAssertFalse(json.contains("\"file_size\""))
        XCTAssertTrue(json.contains("held_on_phone"))
    }

    func testTheInsertNeverSetsTheVehicleTheServersGateDoes() throws {
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(row()), encoding: .utf8))
        XCTAssertFalse(json.contains("\"vehicle_id\""), "device_file_images sets vehicle_id after its own checks")
        XCTAssertFalse(json.contains("user_confirmed_vehicle"), "there is no confirm tap")
        XCTAssertTrue(json.contains("\"ai_processing_status\":\"skipped\""))
        XCTAssertTrue(json.contains("\"auto_suggested_vehicle_id\":\"V1\""))
    }

    func testTheMatchBasisIsNumbersAndFixedWordsOnly() throws {
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(row()), encoding: .utf8))
        for k in ["media_gate_v1", "vin_ocr", "frames_sampled", "frames_exact", "candidates", "anchors", "radius_m"] {
            XCTAssertTrue(json.contains(k), k)
        }
        XCTAssertFalse(json.contains("\"text\""), "OCR text is never stored")
        XCTAssertFalse(json.contains("\"vin\""), "the identifier read is not stored")
    }

    func testNoVehicleSuggestionIsOmittedNotNull() throws {
        let json = try XCTUnwrap(String(data: JSONEncoder().encode(row(vehicle: nil)), encoding: .utf8))
        XCTAssertFalse(json.contains("auto_suggested_vehicle_id"))
    }

    func testTheRowCarriesNoPixelsAndNoOCRText() throws {
        let data = try JSONEncoder().encode(row())
        XCTAssertLessThan(data.count, 4_000, "metadata only")
    }

    func testStorageAvailabilityCheckFailsClosed() {
        XCTAssertFalse(VideoSyncEngine.hasRoom(for: URL(fileURLWithPath: "/definitely/not/here"), minimumBytes: Int64.max))
    }
}
