// PrioritiesTests.swift — shop_priorities_read rows decode and read in plain words.

import XCTest
@testable import NukeCapture

final class PrioritiesTests: XCTestCase {
    func testRowsDecodeAndSortByRank() throws {
        let json = """
        [{"vehicle_id":"b","year":null,"make":"Porsche","model":"356C","score":1,"reasons":["photographed_this_fortnight:21"],
          "details":{"presence":{"status":"departed","confidence":"medium"}},"last_seen":null,"rank":2,"assumptions":{}},
         {"vehicle_id":"a","year":1966,"make":"Ford","model":"Mustang","score":4,"reasons":["photographed_this_fortnight:263","in_progress_idle_days:3"],
          "details":null,"last_seen":"2026-10-15T17:55:31+00:00","rank":1,"assumptions":{}}]
        """
        let list = try JobReaders.decode(PriorityList.self, from: Data(json.utf8))
        XCTAssertEqual(list.rows.map(\.vehicleId), ["a", "b"])
        XCTAssertEqual(list.rows[0].title, "1966 Ford Mustang")
        XCTAssertEqual(list.rows[1].title, "Porsche 356C")
    }

    func testReasonsReadPlainly() {
        XCTAssertEqual(PriorityCopy.reasons(["photographed_recent:1", "in_progress_idle_days:3"]),
                       "Photographed at the lot in the last 3 days (1 photo) · In progress, no update for 3 days")
        XCTAssertEqual(PriorityCopy.reason("needs_service_order"), "Needs a service order")
        XCTAssertEqual(PriorityCopy.reason("not_listed_photos_ready:38"), "Not listed yet, 38 photos ready")
        XCTAssertEqual(PriorityCopy.reason("held_days:140"), "Held 140 days")
        XCTAssertEqual(PriorityCopy.reason("unfulfilled_requirements:1"), "1 part or tool still needed")
        XCTAssertTrue(PriorityCopy.reason("carrying_cost_assumed_rate:1142")?.contains("assumed rate") == true)
        XCTAssertNil(PriorityCopy.reason("something_new:3"))
    }

    func testEmptyListDecodes() throws {
        XCTAssertEqual(try JobReaders.decode(PriorityList.self, from: Data("[]".utf8)).rows, [])
    }

    func testMissingReaderIsNotAvailableYet() {
        let r = JobReaders.pending(PriorityReaders.name)
        XCTAssertEqual(r.kind, .readerPending)
        XCTAssertEqual(r.title, "Not available yet")
    }
}
