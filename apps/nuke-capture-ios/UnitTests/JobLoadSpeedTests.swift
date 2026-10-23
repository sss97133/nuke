// JobLoadSpeedTests.swift — the job screen reads one job's requirements (server-side, with a device-side
// fallback) and the live screen backs off while nothing changes.

import XCTest
import Supabase
@testable import NukeCapture

final class JobLoadSpeedTests: XCTestCase {
    func testBackoffDoublesToCap() {
        XCTAssertEqual(ActivityCopy.backoffInterval(15, idlePolls: 0), 15)
        XCTAssertEqual(ActivityCopy.backoffInterval(15, idlePolls: 1), 30)
        XCTAssertEqual(ActivityCopy.backoffInterval(15, idlePolls: 3), 120)
        XCTAssertEqual(ActivityCopy.backoffInterval(15, idlePolls: 6), 600)
        XCTAssertEqual(ActivityCopy.backoffInterval(15, idlePolls: 1000), 600)
        XCTAssertEqual(ActivityCopy.backoffInterval(600, idlePolls: 2), 600)
        XCTAssertEqual(ActivityCopy.backoffInterval(60, idlePolls: -1), 60)
    }

    func testFallbackKeepsOnlyThisJob() throws {
        let page = try JobReaders.decode(OpenRequirements.self, from: Data(OfferFixtures.open(signedIn: true).utf8))
        guard let id = page.rows.first?.workOrderId else { return XCTFail("fixture has rows") }
        let only = OfferReaders.onlyWorkOrder(page, id)
        XCTAssertFalse(only.rows.isEmpty)
        XCTAssertTrue(only.rows.allSatisfy { $0.workOrderId == id })
        XCTAssertEqual(only.rows.count, page.rows.filter { $0.workOrderId == id }.count)
        XCTAssertTrue(OfferReaders.onlyWorkOrder(page, "no-such-job").rows.isEmpty)
    }
}
