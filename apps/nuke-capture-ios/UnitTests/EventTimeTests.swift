// EventTimeTests.swift — event time (taken_at / occurred_at) orders and labels; upload time doesn't.

import XCTest
@testable import NukeCapture

final class EventTimeTests: XCTestCase {
    func testClockNeverFallsBackToUploadTime() {
        XCTAssertNil(EventTime.clock(takenAt: nil, occurredAt: nil))
        XCTAssertNotNil(EventTime.clock(takenAt: nil, occurredAt: "2026-06-20T21:55:41+00:00"))
        XCTAssertEqual(EventTime.clock(takenAt: "2026-06-20T21:55:41Z", occurredAt: "2026-10-01T00:00:00Z"),
                       ProfileClock.date("2026-06-20T21:55:41Z"))
    }

    func testNewestFirstPutsUndatedLast() {
        let rows: [(String, String?)] = [("u", nil), ("old", "2026-06-20T10:00:00Z"), ("new", "2026-10-15T10:00:00Z")]
        let sorted = rows.sorted { EventTime.newestFirst(EventTime.clock(takenAt: $0.1), EventTime.clock(takenAt: $1.1), tie: ($0.0, $1.0)) }
        XCTAssertEqual(sorted.map(\.0), ["new", "old", "u"])
    }

    func testOldestFirstPutsUndatedLast() {
        let rows: [(String, String?)] = [("u", nil), ("new", "2026-10-15T10:00:00Z"), ("old", "2026-06-20T10:00:00Z")]
        let sorted = rows.sorted { EventTime.oldestFirst(EventTime.clock(takenAt: $0.1), EventTime.clock(takenAt: $1.1), tie: ($0.0, $1.0)) }
        XCTAssertEqual(sorted.map(\.0), ["old", "new", "u"])
    }

    func testUndatedIsLabelledUndated() {
        XCTAssertEqual(EventTime.label(nil), "Undated")
        XCTAssertTrue(EventTime.label(ProfileClock.date("2026-06-20T21:55:41Z")).hasPrefix("Taken "))
    }

    func testPostJobPhotoUsesTakenAtNotUploadTime() throws {
        let photos = try JobReaders.decode([PostJobPhoto].self, from: Data(PostJobFixtures.photos.utf8))
        XCTAssertEqual(photos[0].capturedAt, "2026-10-10T10:00:00Z")
        XCTAssertNil(photos[1].capturedAt, "an undated photo must not borrow its upload time")
    }
}
