import XCTest
@testable import NukeCapture

final class EpisodeFinishTests: XCTestCase {
    private let vehicle = "00000000-0000-4000-8000-000000000101"
    private let listing = "https://bringatrailer.com/listing/fixture-relisted-car"
    private var payload: String {
        """
        {"fresh":true,"rows":[{"vehicle_id":"\(vehicle)","listing_url":"\(listing)",
        "auction_event_id":"00000000-0000-4000-8000-000000000201","estimate":40000,"low":35000,"high":50000,
        "grade":"A","coverage":0.8,"sentence":"Measured range","estimated_at":"2026-11-28T10:00:00Z",
        "bid_at_estimate":30000,"comps_through":"2026-11-20","model":32,
        "analogs":[{"title":"Comparable","url":"https://bringatrailer.com/listing/example","final":39000}]}]}
        """
    }

    func testExactEpisodeReadsProjectionAndComparable() throws {
        let result = try XCTUnwrap(EpisodeFinish.decode(Data(payload.utf8), vehicleId: vehicle, listingURL: listing + "/"))
        XCTAssertEqual(result.estimate.estimate, 40000)
        XCTAssertEqual(result.estimate.model, "32")
        XCTAssertEqual(result.analogs.first?.title, "Comparable")
        XCTAssertEqual(result.analogs.first?.finalPrice, 39000)
    }

    func testWrongVehicleListingOrInvalidEventCannotDisplay() throws {
        XCTAssertNil(EpisodeFinish.decode(Data(payload.utf8), vehicleId: UUID().uuidString, listingURL: listing))
        XCTAssertNil(EpisodeFinish.decode(Data(payload.utf8), vehicleId: vehicle, listingURL: "https://bringatrailer.com/listing/another"))
        XCTAssertNil(EpisodeFinish.decode(Data(payload.replacingOccurrences(of: "00000000-0000-4000-8000-000000000201", with: "bad").utf8), vehicleId: vehicle, listingURL: listing))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any])
        let rows = try XCTUnwrap(object["rows"] as? [[String: Any]])
        var duplicate = object
        duplicate["rows"] = rows + rows
        XCTAssertNil(EpisodeFinish.decode(try JSONSerialization.data(withJSONObject: duplicate), vehicleId: vehicle, listingURL: listing))
    }

    func testStaleOrInvalidRangeCannotDisplay() {
        XCTAssertNil(EpisodeFinish.decode(Data(payload.replacingOccurrences(of: "\"fresh\":true", with: "\"fresh\":false").utf8), vehicleId: vehicle, listingURL: listing))
        XCTAssertNil(EpisodeFinish.decode(Data(payload.replacingOccurrences(of: "\"low\":35000", with: "\"low\":45000").utf8), vehicleId: vehicle, listingURL: listing))
        XCTAssertNil(EpisodeFinish.decode(Data(payload.replacingOccurrences(of: "\"low\":35000", with: "\"low\":true").utf8), vehicleId: vehicle, listingURL: listing))
    }

    func testOnlyExactHTTPSListingURLIsEligible() {
        XCTAssertEqual(EpisodeFinish.canonicalListing(listing + "/"), listing)
        XCTAssertNil(EpisodeFinish.canonicalListing("https://bringatrailer.com.evil.test/listing/fixture"))
        XCTAssertNil(EpisodeFinish.canonicalListing("http://bringatrailer.com/listing/fixture"))
        XCTAssertNil(EpisodeFinish.canonicalListing(listing + "?ref=other"))
        XCTAssertNil(EpisodeFinish.canonicalListing(listing + "/other"))
    }
}
