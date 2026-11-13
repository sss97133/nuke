// UploadFailureTests.swift — which failures count against a photo. On 2026-10-28 a storage quota hold
// made every upload fail; three passes later the owner's 46 newest frames (the VIN plate among them)
// were "gave up" for good and never left the phone. Only the photo's own failures may count.

import Foundation
import Supabase
import XCTest
@testable import NukeCapture

final class UploadFailureTests: XCTestCase {
    private func http(_ status: Int, body: String = "") -> HTTPError {
        let url = URL(string: "https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/x")!
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
        return HTTPError(data: Data(body.utf8), response: response)
    }

    func testTheWorldsFailuresRetryFree() {
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(URLError(.notConnectedToInternet)))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(URLError(.timedOut)))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(URLError(.networkConnectionLost)))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(http(503)))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(http(429)))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(http(402, body: "{\"error\":\"exceed_storage_size_quota\"}")))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(OriginalInCloud()))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(CancellationError()))
        XCTAssertFalse(SyncEngine.countsAgainstThePhoto(PostgrestError(code: "57014", message: "canceling statement due to statement timeout")))
    }

    func testThePhotosOwnFailuresCount() {
        XCTAssertTrue(SyncEngine.countsAgainstThePhoto(http(400, body: "invalid mime type")))
        XCTAssertTrue(SyncEngine.countsAgainstThePhoto(http(413)))
        XCTAssertTrue(SyncEngine.countsAgainstThePhoto(VisionEngine.TriageFailure.imageUndecodable))
        XCTAssertTrue(SyncEngine.countsAgainstThePhoto(NSError(domain: "NukeCapture", code: 1,
                                                               userInfo: [NSLocalizedDescriptionKey: "no image data returned"])))
        XCTAssertTrue(SyncEngine.countsAgainstThePhoto(URLError(.badURL)))
    }

    func testTransientStatusRule() {
        XCTAssertTrue(SyncEngine.isTransientStatus(500, body: ""))
        XCTAssertTrue(SyncEngine.isTransientStatus(408, body: ""))
        XCTAssertTrue(SyncEngine.isTransientStatus(402, body: "Exceed storage size quota"))
        XCTAssertFalse(SyncEngine.isTransientStatus(402, body: "payment required"))
        XCTAssertFalse(SyncEngine.isTransientStatus(400, body: ""))
        XCTAssertFalse(SyncEngine.isTransientStatus(404, body: ""))
    }

    func testAttemptsCountedByAnOlderRuleStartOverOnce() {
        XCTAssertTrue(SyncEngine.failedAttemptsAreStale(stored: 0, current: Config.failedAttemptsEpoch), "a phone on build 33 has no epoch")
        XCTAssertTrue(SyncEngine.failedAttemptsAreStale(stored: 1, current: 2))
        XCTAssertFalse(SyncEngine.failedAttemptsAreStale(stored: 2, current: 2))
        XCTAssertFalse(SyncEngine.failedAttemptsAreStale(stored: 3, current: 2))
    }

    func testStorageRequestCarriesTheSessionNotTheServiceKey() {
        let request = SupabaseService.storageUploadRequest(path: "users/u/capture-relay/abc/IMG_1.HEIC",
                                                           mimeType: "image/heic", accessToken: "token-123")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/storage/v1/object/vehicle-photos/users/u/capture-relay/abc/IMG_1.HEIC")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-123")
        XCTAssertEqual(request.value(forHTTPHeaderField: "apikey"), Config.supabaseAnonKey)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "image/heic")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-upsert"), "false")
    }

    func testTheStagedRowIsTheInlineRow() throws {
        let meta = PhotoMeta(assetIdentifier: "asset-1", filename: "IMG_5176.HEIC",
                             creationDate: Date(timeIntervalSince1970: 1_793_000_000), exifCaptureDate: nil,
                             latitude: 36.0, longitude: -115.0, cameraMake: "Apple", cameraModel: "iPhone", sourceType: "user_library")
        let hash = String(repeating: "b", count: 64)
        let row = try SupabaseService.buildImageRow(meta: meta, userId: "user-1", byteCount: 1234, sha256: hash, appleMLLabels: ["car"])
        XCTAssertEqual(row.storage_path, "users/user-1/capture-relay/\(hash)/IMG_5176.HEIC")
        XCTAssertEqual(row.ai_processing_status, "pending")
        XCTAssertEqual(row.file_hash, hash)
        XCTAssertTrue(row.image_url.hasSuffix("/IMG_5176.HEIC"))
        let metadataOnly = try SupabaseService.buildImageRow(meta: meta, userId: "user-1", byteCount: 1234, sha256: nil, appleMLLabels: [])
        XCTAssertEqual(metadataOnly.image_url, "")
        XCTAssertNil(metadataOnly.storage_path)
        XCTAssertEqual(metadataOnly.ai_processing_status, "skipped")
        // The queue stages the encoded row and inserts it as JSON: the round trip keeps every key.
        let encoded = try JSONEncoder().encode(row)
        let json = try JSONDecoder().decode(AnyJSON.self, from: encoded)
        XCTAssertEqual(json.objectValue?["file_hash"]?.stringValue, hash)
        XCTAssertEqual(json.objectValue?["source"]?.stringValue, Config.sourceTag)
    }
}
