import XCTest
@testable import NukeCapture

final class ListingSubmissionTests: XCTestCase {
    private let account = "11111111-1111-4111-8111-111111111111"
    private let other = "22222222-2222-4222-8222-222222222222"
    private func payload(owner: String? = nil, status: String = "submitted", stage: String? = "draft_pending_approval", url: String = "https://example.test/listing") throws -> Data {
        try JSONSerialization.data(withJSONObject: [["id": "33333333-3333-4333-8333-333333333333",
            "user_id": owner ?? account, "vehicle_id": "44444444-4444-4444-8444-444444444444",
            "platform": "bat", "title": "Synthetic listing", "status": status,
            "metadata": ["stage": stage as Any? ?? NSNull(), "stage_since": "2026-11-03T21:44:33Z"],
            "external_listing_url": url, "updated_at": "2026-11-06T16:53:47Z"]])
    }
    func testSubmittedDraftRemainsPendingApprovalWithRecordedClockAndLink() throws {
        let page = try ListingSubmissionPage.decode(payload(), account: account, total: 1)
        let row = try XCTUnwrap(page.rows.first)
        XCTAssertEqual(row.status, "submitted")
        XCTAssertEqual(row.stageLabel, "Draft awaiting seller approval")
        XCTAssertEqual(row.metadata?.stage_since, "2026-11-03T21:44:33Z")
        XCTAssertEqual(row.recordedClock, "2026-11-06T16:53:47Z")
        XCTAssertEqual(row.url?.absoluteString, "https://example.test/listing")
        XCTAssertEqual(page.total, 1)
    }
    func testAnotherAccountAndCompletedAuctionsAreRefused() throws {
        XCTAssertThrowsError(try ListingSubmissionPage.decode(payload(owner: other), account: account, total: 1))
        XCTAssertThrowsError(try ListingSubmissionPage.decode(payload(status: "active"), account: account, total: 1))
        XCTAssertThrowsError(try ListingSubmissionPage.decode(payload(), account: "", total: 1))
    }
    func testNoRecordIsAnEmptyReadAndMissingStageStaysUnknown() throws {
        XCTAssertTrue(try ListingSubmissionPage.decode(Data("[]".utf8), account: account, total: 0).rows.isEmpty)
        let page = try ListingSubmissionPage.decode(payload(stage: nil, url: "javascript:alert(1)"), account: account, total: nil)
        XCTAssertEqual(page.rows[0].stageLabel, "Submitted · next step unknown")
        XCTAssertNil(page.rows[0].url)
        XCTAssertTrue(page.coverage.contains("total unknown"))
    }
}
