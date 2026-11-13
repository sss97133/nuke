// ProfileServeOnceTests.swift — the profile says each fact once: one photo line (with its drill) and one
// line of garage relationship counts. Counts are the owner's own reads on 2026-11-09 (get_user_sync_status,
// get_user_producer_signals, get_user_garage), with fixture vehicles.

import XCTest
@testable import NukeCapture

final class ProfileServeOnceTests: XCTestCase {
    private let sync = """
    {"is_owner_view":true,"synced_total":6931,"analyzed_total":185,"pending_total":0,"filed_total":1083,
     "all_sources_total":29749,"last_synced_at":"2026-11-04T06:20:00+00:00","last_taken_at":null}
    """

    func testOwnPhotoLineComesFromTheSyncLedger() throws {
        let s = try JSONDecoder().decode(SyncStatus.self, from: Data(sync.utf8))
        XCTAssertEqual(ProfilePhotoLine.text(sync: s, producer: nil),
                       "\(29749.formatted()) photos · \(1083.formatted()) filed · 185 analyzed")
    }

    func testVisitorPhotoLineFallsBackToSignalsAndSaysUnknown() throws {
        let both = try JSONDecoder().decode(ProducerSignals.self, from: Data(#"{"images_total":29749,"images_analyzed":185}"#.utf8))
        XCTAssertEqual(ProfilePhotoLine.text(sync: nil, producer: both), "\(29749.formatted()) photos · 185 analyzed")
        let noTotal = try JSONDecoder().decode(ProducerSignals.self, from: Data(#"{"images_analyzed":185}"#.utf8))
        XCTAssertEqual(ProfilePhotoLine.text(sync: nil, producer: noTotal), "photo total unknown · 185 analyzed")
        let none = try JSONDecoder().decode(ProducerSignals.self, from: Data("{}".utf8))
        XCTAssertNil(ProfilePhotoLine.text(sync: nil, producer: none), "no reader answered: no line, never a zero")
        XCTAssertNil(ProfilePhotoLine.text(sync: nil, producer: nil))
    }

    func testPhotoRecordWithoutEvidenceIsADoorNotAZero() {
        XCTAssertEqual(ProfilePhotoRecordView.recordLines(nil), ["Albums and source photos"])
    }

    func testGarageCountsAreOneLineOverTheServersRelationships() throws {
        let rows = try JSONDecoder().decode([GarageVehicle].self, from: Data(GarageFixtures.garage.utf8))
        let s = GarageSections(rows)
        XCTAssertEqual(ProfileGarageCounts.headline(s), "3 vehicles")
        XCTAssertEqual(ProfileGarageCounts.detail(s, unresolved: 0), "1 owned · 1 previously owned · 1 contributed")
        XCTAssertEqual(ProfileGarageCounts.detail(s, unresolved: 2), "1 owned · 1 previously owned · 1 contributed · 2 identity pending")
        XCTAssertEqual(ProfileGarageCounts.headline(GarageSections(Array(rows.prefix(1)))), "1 vehicle")
    }
}
