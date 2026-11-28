import XCTest
@testable import NukeCapture

final class VehicleDiscussionTests: XCTestCase {
    private let vehicle = "00000000-0000-4000-8000-00000000c001"

    private func entry(vehicle: String, source: String, parent: String? = nil, status: String = "active") throws -> ListingDiscussionEntry {
        let data = """
        {"id":"00000000-0000-4000-8000-00000000b101","vehicle_id":"\(vehicle)","source_url":"\(source)",
         "posted_at":null,"author_username":null,"comment_text":"text","comment_type":"question","bid_amount":null,
         "vehicles":{"id":"\(parent ?? vehicle)","status":"\(status)","deleted_at":null}}
        """.data(using: .utf8)!
        return try JSONDecoder().decode(ListingDiscussionEntry.self, from: data)
    }

    func testScopeMatchesOnlyTheExactVehicleAndListing() throws {
        let scope = try XCTUnwrap(ListingDiscussionScope(vehicleId: vehicle,
            listingURL: URL(string: "https://bringatrailer.com/listing/fixture/?utm_source=test#comments")))
        XCTAssertTrue(scope.aliases.contains("https://bringatrailer.com/listing/fixture"))
        XCTAssertTrue(scope.aliases.contains("https://www.bringatrailer.com/listing/fixture/"))
        XCTAssertTrue(scope.aliases.allSatisfy { !$0.contains("utm_source") && !$0.contains("#") })
        XCTAssertTrue(scope.contains(try entry(vehicle: vehicle, source: "https://bringatrailer.com/listing/fixture/")))
        XCTAssertFalse(scope.contains(try entry(vehicle: vehicle, source: "https://bringatrailer.com/listing/other/")))
        XCTAssertFalse(scope.contains(try entry(vehicle: vehicle, source: "https://bringatrailer.com/listing/fixture/", status: "deleted")))
        XCTAssertFalse(scope.contains(try entry(vehicle: "00000000-0000-4000-8000-00000000c002",
                                                 source: "https://bringatrailer.com/listing/fixture/")))
        XCTAssertFalse(scope.contains(try entry(vehicle: vehicle, source: "https://bringatrailer.com/listing/fixture/",
                                                 parent: "00000000-0000-4000-8000-00000000c002")))
        XCTAssertNil(ListingDiscussionScope(vehicleId: vehicle, listingURL: URL(string: "https://user@bringatrailer.com/listing/fixture/")))
        XCTAssertNil(ListingDiscussionScope(vehicleId: vehicle, listingURL: URL(string: "javascript:alert(1)")))
    }

    func testOnlyAnExplicitCommentReceiptConfirmsPosting() throws {
        func reply(_ json: String) throws -> DiscussionPostReply {
            try JSONDecoder().decode(DiscussionPostReply.self, from: Data(json.utf8))
        }
        XCTAssertTrue(try reply(#"{"ok":true,"kind":"comment","comment_id":"00000000-0000-4000-8000-00000000b202"}"#).confirmed)
        XCTAssertFalse(try reply(#"{"ok":false,"error":"not_authorized"}"#).confirmed)
        XCTAssertFalse(try reply(#"{"ok":true,"kind":"comment"}"#).confirmed)
        XCTAssertFalse(try reply(#"{"ok":true,"kind":"follow","comment_id":"00000000-0000-4000-8000-00000000b202"}"#).confirmed)
    }
}
