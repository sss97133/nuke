import XCTest
import GRDB
#if canImport(NukeCapture)
@testable import NukeCapture
#else
@testable import NukeAlbumLedger
#endif

final class SourceInboxTests: XCTestCase {
    private let owner = "11111111-1111-4111-8111-111111111111"
    private let other = "22222222-2222-4222-8222-222222222222"
    private let photoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private let clock = "2026-10-18T01:00:00.123456Z"
    private func wire(state: String = "ready", hasReading: Bool = false) -> [String: Any] {
        let hash = String(repeating: "a", count: 64)
        let readings: [[String: Any]] = hasReading ? [[
            "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "input_key": String(repeating: "b", count: 32),
            "provider": "offline-fixture", "model": "offline-fixture", "read_at": clock, "observed_at": clock,
            "input": ["source_sha256": hash, "input_sha256": String(repeating: "c", count: 64), "representation": "derivative"],
            "frame": ["medium": "photograph", "primary_subject": "unknown", "view": "detail", "bbox": NSNull()],
            "unresolved_reasons": ["primary_subject_unqualified"]
        ]] : []
        return ["photos": [["id": photoId, "grain": "source_photo", "identity": NSNull(), "grouping_asserted": false,
            "source_state": state, "source_reason": state == "metadata_only" ? "pixels_not_retained_reason_unknown" as Any : NSNull(),
            "image_url": state == "ready" ? "https://example.test/source.jpg" as Any : NSNull(),
            "source_sha256": state == "ready" ? hash as Any : NSNull(), "created_at": clock, "taken_at": NSNull(),
            "attached_vehicle_id_context": NSNull(), "subject_analysis_state": hasReading ? "current_readings" : "not_read",
            "readings": readings, "reading_context_coverage": ["grain": "terminal_reading_heads", "assessed": readings.count,
                "qualified": readings.count, "withdrawn": 0, "unqualified_or_conflicting": 0, "complete": true], "membership_state": "none_recorded"]],
            "coverage": ["grain": "owner_source_page", "assessed": 1, "returned": 1, "displayable": state == "ready" ? 1 : 0,
                "without_displayable_pixels": state == "ready" ? 0 : 1, "ambiguous_source_rows": 0, "as_of": clock,
                "truncated": true, "account_total": NSNull(), "accessible_device_library_total": NSNull(), "inference_started": false],
            "next_cursor": NSNull()]
    }
    private func decode(_ value: [String: Any]) throws -> SourceInboxRead {
        try JSONDecoder().decode(SourceInboxRead.self, from: JSONSerialization.data(withJSONObject: value))
    }

    func testSingleUnreadSourcePreservesUnknownIdentityAndPageCoverage() throws {
        let read = try decode(wire())
        XCTAssertTrue(read.isQualified)
        XCTAssertNil(read.photos[0].identity)
        XCTAssertFalse(read.photos[0].grouping_asserted)
        XCTAssertEqual(read.photos[0].subject_analysis_state, "not_read")
        XCTAssertNil(read.photos[0].taken_at)
        XCTAssertNil(read.coverage.account_total)
        XCTAssertTrue(read.coverage.truncated)
        XCTAssertFalse(read.coverage.inference_started)
    }

    func testUnknownRetainedInterpretationPreservesConsumedAndSourceHashes() throws {
        let read = try decode(wire(hasReading: true)), reading = try XCTUnwrap(read.photos[0].readings.first)
        XCTAssertTrue(read.isQualified)
        XCTAssertEqual(reading.frame?.primary_subject, "unknown")
        XCTAssertEqual(reading.frame?.view, "detail")
        XCTAssertNotEqual(reading.input.source_sha256, reading.input.input_sha256)
        XCTAssertEqual(reading.read_at, clock)
        XCTAssertEqual(reading.unresolved_reasons, ["primary_subject_unqualified"])
    }

    func testMetadataOnlyProvenanceRemainsUnknownAndCannotCarryPixelsOrProfileClaims() throws {
        var value = wire(state: "metadata_only")
        let read = try decode(value)
        XCTAssertTrue(read.isQualified)
        XCTAssertEqual(read.photos[0].source_reason, "pixels_not_retained_reason_unknown")
        XCTAssertNil(read.photos[0].image_url)
        var photos = try XCTUnwrap(value["photos"] as? [[String: Any]])
        photos[0]["image_url"] = "https://example.test/must-not-show.jpg"; value["photos"] = photos
        XCTAssertFalse(try decode(value).isQualified)
        photos[0]["image_url"] = NSNull(); photos[0]["grouping_asserted"] = true; value["photos"] = photos
        XCTAssertFalse(try decode(value).isQualified)
    }

    func testSourceCacheIsOwnAccountOnlyAndStoresTheExactBackendReading() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue()), read = try decode(wire(hasReading: true))
        let now = Date(timeIntervalSince1970: 1000)
        try store.cacheSourceInbox(userId: owner.uppercased(), activeUserId: owner, read: read, now: now)
        let saved = try XCTUnwrap(store.cachedSourceInbox(userId: owner, activeUserId: owner))
        XCTAssertEqual(saved.read, read); XCTAssertEqual(saved.cachedAt, now)
        XCTAssertNil(try store.cachedSourceInbox(userId: owner, activeUserId: nil))
        XCTAssertNil(try store.cachedSourceInbox(userId: owner, activeUserId: other))
        XCTAssertNil(try store.cachedSourceInbox(userId: other, activeUserId: other))
        XCTAssertThrowsError(try store.cacheSourceInbox(userId: owner, activeUserId: other, read: read))
    }

    func testLiveHistoryRefreshInvalidatesOldPagesAndExactPhotoFallbacks() throws {
        let store = try LocalStore(databaseQueue: DatabaseQueue()), read = try decode(wire()), imageId = try XCTUnwrap(UUID(uuidString: photoId))
        try store.cacheSourceInbox(userId: owner, activeUserId: owner, read: read)
        try store.cacheSourceInbox(userId: owner, activeUserId: owner, imageId: imageId, read: read)
        try store.cacheSourceInbox(userId: owner, activeUserId: owner, page: 1, read: read)
        var emptyWire = wire(); emptyWire["photos"] = []
        var coverage = try XCTUnwrap(emptyWire["coverage"] as? [String: Any])
        for key in ["assessed", "returned", "displayable", "without_displayable_pixels"] { coverage[key] = 0 }
        emptyWire["coverage"] = coverage
        let empty = try decode(emptyWire)
        try store.cacheSourceInbox(userId: owner, activeUserId: owner, read: empty)
        XCTAssertEqual(try store.cachedSourceInbox(userId: owner, activeUserId: owner)?.read.photos, [])
        XCTAssertNil(try store.cachedSourceInbox(userId: owner, activeUserId: owner, page: 1))
        XCTAssertNil(try store.cachedSourceInbox(userId: owner, activeUserId: owner, imageId: imageId))
        XCTAssertThrowsError(try store.cacheSourceInbox(userId: owner, activeUserId: owner, imageId: UUID(), read: read))
    }
}
