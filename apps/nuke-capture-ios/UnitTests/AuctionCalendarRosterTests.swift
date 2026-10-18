import XCTest
@testable import NukeCapture

final class AuctionCalendarRosterTests: XCTestCase {
    private let build = "2026-10-18T12:07:00.123456+00:00"

    // Synthetic RPC-shaped pages. No retained customer or market records are bundled.
    private func page(_ ids: [String], offset: Int = 0, total: Int = 205,
                      builtAt: String? = "2026-10-18T12:07:00.123456+00:00",
                      house: String = "gooding", key: String = "fixture-2027") throws -> AuctionCalendar {
        let rows: [[String: Any]] = ids.map { id in
            ["event_id": id, "vehicle_id": "00000000-0000-4000-8000-000000000001",
             "run_on": "2027-01-08", "year": 1967, "make": "Fixturemake", "model": id,
             "vin_present": true, "has_reserve": false, "prior": []]
        }
        var population: [String: Any] = ["lots": total, "sales": 1, "houses": 1,
                                             "seen_before": 0, "no_reserve": total, "first_seen_7d": 0]
        if let builtAt { population["lots_built_at"] = builtAt }
        let value: [String: Any] = ["as_of": "2026-10-18T12:30:00Z", "horizon_days": 200,
            "population": population, "sales": [], "unplaced": [],
            "roster": ["house": house, "sale_key": key, "offset": offset, "lots": total, "rows": rows]]
        return try JSONDecoder().decode(AuctionCalendar.self, from: JSONSerialization.data(withJSONObject: value))
    }

    func testContinuesPastTheFormerHundredLotCutoffWithoutInventingADenominator() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        try roster.accept(page((0..<100).map(String.init)), requestedOffset: 0)
        XCTAssertEqual(roster.nextOffset, 100)
        XCTAssertEqual(roster.total, 205)
        try roster.accept(page((100..<200).map(String.init), offset: 100), requestedOffset: 100)
        XCTAssertEqual(roster.nextOffset, 200)
        try roster.accept(page((200..<205).map(String.init), offset: 200), requestedOffset: 200)
        XCTAssertEqual(roster.rows.map(\.id), (0..<205).map(String.init))
        XCTAssertEqual(roster.total, 205)
        XCTAssertNil(roster.nextOffset)
        XCTAssertFalse(roster.continuationUnavailable)
        XCTAssertEqual(roster.builtAt, build)
    }

    func testWrongSaleOrOffsetCannotReplaceAVisibleRoster() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        try roster.accept(page(["first"]), requestedOffset: 0)
        for wrong in [try page(["wrong"], offset: 1, house: "mecum"),
                      try page(["wrong"], offset: 1, key: "another-sale"),
                      try page(["wrong"], offset: 2)] {
            XCTAssertThrowsError(try roster.accept(wrong, requestedOffset: 1))
            XCTAssertEqual(roster.rows.map(\.id), ["first"])
            XCTAssertEqual(roster.nextOffset, 1)
        }
    }

    func testRefusesMixedReadModelBuildsEvenInsideTheSameMillisecondThenAllowsRefresh() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        try roster.accept(page(["first"]), requestedOffset: 0)
        XCTAssertThrowsError(try roster.accept(page(["second"], offset: 1,
            builtAt: "2026-10-18T12:07:00.123457+00:00"), requestedOffset: 1)) { error in
            XCTAssertEqual(error as? AuctionCalendarRoster.ReceiptError, .changedRoster)
        }
        XCTAssertEqual(roster.rows.map(\.id), ["first"])
        try roster.accept(page(["replacement"], total: 1, builtAt: "2026-10-18T12:37:00Z"), requestedOffset: 0)
        XCTAssertEqual(roster.rows.map(\.id), ["replacement"])
        XCTAssertEqual(roster.total, 1)
        XCTAssertNil(roster.nextOffset)
    }

    func testRefusesChangedCountsOrRepeatedContributorsWithoutDroppingEarlierRows() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        try roster.accept(page(["first"]), requestedOffset: 0)
        XCTAssertThrowsError(try roster.accept(page(["second"], offset: 1, total: 206), requestedOffset: 1))
        XCTAssertThrowsError(try roster.accept(page(["first"], offset: 1), requestedOffset: 1))
        XCTAssertThrowsError(try roster.accept(page(["dup", "dup"]), requestedOffset: 0))
        XCTAssertEqual(roster.rows.map(\.id), ["first"])
        XCTAssertEqual(roster.total, 205)
    }

    func testServerDayRolloverCannotMixDifferentRollingCalendarWindows() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        try roster.accept(page(["first"]), requestedOffset: 0)
        let response = try page(["second"], offset: 1)
        let tomorrow = AuctionCalendar(as_of: "2026-10-19T00:00:01Z", horizon_days: response.horizon_days,
            population: response.population, sales: response.sales, unplaced: response.unplaced, roster: response.roster)
        XCTAssertThrowsError(try roster.accept(tomorrow, requestedOffset: 1))
        XCTAssertEqual(roster.rows.map(\.id), ["first"])
    }

    func testAnEmptyContinuationIsIncompleteRatherThanAFalseCompleteRoster() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        try roster.accept(page(["first"]), requestedOffset: 0)
        try roster.accept(page([], offset: 1), requestedOffset: 1)
        XCTAssertEqual(roster.rows.count, 1)
        XCTAssertEqual(roster.total, 205)
        XCTAssertTrue(roster.continuationUnavailable)
        XCTAssertNil(roster.nextOffset)
    }

    func testMissingBuildClockCanShowOnePageButCannotStitchAnUnqualifiedContinuation() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        try roster.accept(page(["first"], builtAt: nil), requestedOffset: 0)
        XCTAssertEqual(roster.rows.map(\.id), ["first"])
        XCTAssertTrue(roster.continuationUnavailable)
        XCTAssertNil(roster.nextOffset)
        XCTAssertThrowsError(try roster.accept(page(["second"], offset: 1, builtAt: nil), requestedOffset: 1))
    }

    func testNilOrImpossibleRosterReceiptIsAnErrorRatherThanZeroResults() throws {
        var roster = AuctionCalendarRoster(house: "gooding", saleKey: "fixture-2027")
        let value = try page(["first"])
        let missing = AuctionCalendar(as_of: value.as_of, horizon_days: value.horizon_days,
            population: value.population, sales: value.sales, unplaced: value.unplaced, roster: nil)
        XCTAssertThrowsError(try roster.accept(missing, requestedOffset: 0))
        XCTAssertNil(roster.total)
        XCTAssertThrowsError(try roster.accept(page(["first"], total: 0), requestedOffset: 0))
        XCTAssertThrowsError(try roster.accept(page((0...100).map(String.init)), requestedOffset: 0))
        try roster.accept(page([], total: 0), requestedOffset: 0)
        XCTAssertEqual(roster.total, 0)
        XCTAssertFalse(roster.continuationUnavailable)
    }

    private func prior(outcome: String = "sold", amount: Double? = 41000,
                       currency: String? = nil, house: String = "mecum", basis: String? = "source") -> AuctionCalendar.PriorResult {
        AuctionCalendar.PriorResult(house: house, on: nil, outcome: outcome, amount: amount,
                                   currency: currency, basis: basis, url: nil)
    }

    func testEarlierOutcomesKeepUnconfirmedResultsBidsAsksAndAmountsSeparate() {
        XCTAssertEqual(prior(basis: "unconfirmed").outcomeText, "$41,000 recorded, result unconfirmed")
        XCTAssertEqual(prior(basis: nil).outcomeText, "$41,000 recorded, result unconfirmed")
        XCTAssertEqual(prior(outcome: "not_sold").outcomeText, "not sold, high bid $41,000")
        XCTAssertEqual(prior(outcome: "listed").outcomeText, "listed at $41,000")
        XCTAssertEqual(prior(amount: nil).outcomeText, "sold, amount unrecorded")
        XCTAssertEqual(prior(currency: "CHF", house: "gooding").outcomeText, "sold CHF 41,000")
        XCTAssertEqual(prior(house: "gooding").outcomeText, "sold 41,000 (currency unrecorded)")
        XCTAssertEqual(AuctionCalendar.dayLabel(nil), "undated")
        XCTAssertNil(AuctionCalendar.money(nil, currency: "USD", house: "mecum"))
    }

    func testPartialHouseEstimateRetainsTheRecordedCurrencyAndDoesNotSubstituteZero() throws {
        let json = #"{"event_id":"e","vehicle_id":"v","run_on":"2027-01-08","estimate_low":null,"estimate_high":140000,"currency":"CHF","prior":[]}"#
        let lot = try JSONDecoder().decode(AuctionCalendar.RosterLot.self, from: Data(json.utf8))
        XCTAssertEqual(lot.estimateText(house: "gooding"), "up to CHF 140,000")
        XCTAssertNil(lot.vin_present)
        let low = try JSONDecoder().decode(AuctionCalendar.RosterLot.self, from: Data(json
            .replacingOccurrences(of: "\"estimate_low\":null,\"estimate_high\":140000", with: "\"estimate_low\":100000,\"estimate_high\":null").utf8))
        XCTAssertEqual(low.estimateText(house: "gooding"), "from CHF 100,000")
        let both = try JSONDecoder().decode(AuctionCalendar.RosterLot.self, from: Data(json
            .replacingOccurrences(of: "\"estimate_low\":null", with: "\"estimate_low\":100000").utf8))
        XCTAssertEqual(both.estimateText(house: "gooding"), "CHF 100,000 to CHF 140,000")
        let neither = try JSONDecoder().decode(AuctionCalendar.RosterLot.self, from: Data(json
            .replacingOccurrences(of: "\"estimate_high\":140000", with: "\"estimate_high\":null").utf8))
        XCTAssertNil(neither.estimateText(house: "gooding"))
    }

    func testSourceDrillsStayOnTheNamedHousesHTTPSHost() {
        XCTAssertNotNil(AuctionCalendar.houseLink(house: "mecum", value: "https://www.mecum.com/lots/1/fixture/"))
        for url in ["http://mecum.com/lots/1/", "https://mecum.com.evil.example/lots/1/",
                    "https://evil.example/lots/1/", "https://user:secret@mecum.com/lots/1/", "https://mecum.com:8443/lots/1/"] {
            XCTAssertNil(AuctionCalendar.houseLink(house: "mecum", value: url))
        }
        XCTAssertNil(AuctionCalendar.houseLink(house: "unknown-house", value: "https://mecum.com/lots/1/"))
    }

    func testRunDaysAndSourceWriteClocksUseTheWebPrecision() throws {
        let now = try XCTUnwrap(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: 15, hour: 12)))
        XCTAssertEqual(AuctionCalendar.saleTimer(startsOn: "2026-10-14", endsOn: "2026-10-17", now: now), "running · day 2 of 4")
        XCTAssertEqual(AuctionCalendar.runTimer("2026-10-16", now: now), "runs tomorrow")
        XCTAssertEqual(AuctionCalendar.runTimer("2027-01-08", now: now), "runs in 85 days")
        let sourceWrite = ISO8601DateFormatter().string(from: now.addingTimeInterval(-12 * 60))
        XCTAssertEqual(AuctionCalendar.updatedAgo(sourceWrite, now: now), "updated 12 min ago")
        XCTAssertEqual(AuctionCalendar.updatedAgo(nil, now: now), "update time unrecorded")
    }
}
