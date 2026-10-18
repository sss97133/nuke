import XCTest
@testable import NukeCapture

final class SourceConsumerContractTests: XCTestCase {
    private func source(_ fields: [String: Any]) throws -> SourcesBoardData.SourceRow {
        let row = ["source": "bat", "name": "Bring a Trailer", "held_lots": 256785] as [String: Any]
        let values = row.merging(fields) { _, new in new }
        let columns = values.keys.sorted()
        let payload: [String: Any] = ["as_of": "2026-10-18T21:31:03Z", "columns": columns,
                                      "rows": [columns.map { values[$0]! }]]
        return try XCTUnwrap(SourcesBoardData.parse(JSONSerialization.data(withJSONObject: payload))?.rows.first)
    }

    private func event(_ fields: [String: Any]) throws -> SourceLandingDetail.RecentEvent {
        let row: [String: Any] = ["id": "record-1", "source": "bat", "created_at": "2026-10-18T21:23:41.768274+00:00"]
        let payload: [String: Any] = ["as_of": "2026-10-18T21:31:03Z", "recent": [row.merging(fields) { _, new in new }]]
        return try XCTUnwrap(SourceLandingDetail.parse(JSONSerialization.data(withJSONObject: payload))?.recent.first)
    }

    func testSourceKindComesFromTheReaderAndKeepsItsRecordedArtwork() throws {
        let row = try source(["category": "auction", "business_type": "auction_house", "species": "timed_auction",
                              "species_label": "Timed with soft close", "counts_as_held": true,
                              "logo_url": "https://nuke.ag/source-logos/bat.png"])
        XCTAssertEqual(row.typeLabel, "Timed with soft close")
        XCTAssertEqual(row.logoUrl, "https://nuke.ag/source-logos/bat.png")
        XCTAssertEqual(row.countsAsHeld, true)
        XCTAssertEqual(row.held, 256785)
    }

    func testANameAloneCannotInventTheSourceKindOrListingPopulation() throws {
        XCTAssertNil(try source([:]).typeLabel)
        XCTAssertEqual(try source(["category": "auction"]).typeLabel, "Auction house")
        let aggregator = try source(["species": "aggregator", "species_label": "Aggregators", "counts_as_held": false])
        XCTAssertEqual(aggregator.typeLabel, "Aggregators")
        XCTAssertEqual(aggregator.countsAsHeld, false)
    }

    func testOlderRecordDateAndKnownVehicleSurviveNewIntake() throws {
        let id = "ad83f3ae-7546-4142-8a44-657188a902a2"
        let row = try event(["vehicle_id": id, "year": 1992, "make": "Land Rover", "model": "Defender 110",
                              "title": "Source listing headline", "record_date": "2014-01-24", "event_type": "auction_result"])
        XCTAssertEqual(row.vehicleUUID, UUID(uuidString: id))
        XCTAssertEqual(row.headline, "1992 Land Rover Defender 110")
        XCTAssertEqual(row.title, "Source listing headline")
        XCTAssertEqual(row.recordDateLabel, "Record date 2014-01-24")
        XCTAssertEqual(row.createdAt, "2026-10-18T21:23:41.768274+00:00")
    }

    func testMissingAndIntakeFallbackDatesStayUndated() throws {
        XCTAssertEqual(try event([:]).recordDateLabel, "Undated")
        XCTAssertEqual(try event(["record_date": "2026-10-18T21:23:41.768274+00:00"]).recordDateLabel, "Undated")
        XCTAssertEqual(try event(["record_date": "2026-10-18 21:23:41.768274+00"]).recordDateLabel, "Undated")
        XCTAssertEqual(try event(["record_date": "not a date"]).recordDateLabel, "Undated")
    }

    func testPartialDatesKeepTheirPrecisionAndAnAuctionClockDoesNotBecomeAPostingClock() throws {
        XCTAssertEqual(try event(["record_date": "2014"]).recordDateLabel, "Record date 2014")
        XCTAssertEqual(try event(["record_date": "2014-01"]).recordDateLabel, "Record date 2014-01")
        XCTAssertEqual(try event(["record_date": "2026-10-25 17:51:00+00", "event_status": "active"]).recordDateLabel,
                       "Record date 2026-10-25")
    }

    func testUnresolvedVehicleDoesNotBorrowItsEventIdOrSourceUrl() throws {
        let missing = try event(["title": "Unresolved vehicle", "source_url": "https://bringatrailer.com/listing/example"])
        XCTAssertNil(missing.vehicleUUID)
        XCTAssertEqual(missing.headline, "Unresolved vehicle")
        XCTAssertNotNil(missing.openableURL)
        XCTAssertNil(try event(["vehicle_id": "invalid"]).vehicleUUID)
        XCTAssertNil(try event(["source_url": "httpsjavascript://example.com"]).openableURL)
    }
}
