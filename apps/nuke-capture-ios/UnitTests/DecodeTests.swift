// DecodeTests.swift — the payload shapes the phone reads, decoded the way the server sends them.
//
// Every reader the app calls returns JSON the server can change; a struct that throws on a null
// the server started sending (CalendarDay.work_cost after #1048) silently took every non-owner's
// calendar down. These tests pin the shapes: a document with a section the app does not know, a
// claim with a source kind it does not know, a board with a drifted and a broken row, a masked
// calendar day. They run on every iOS pull request (.github/workflows/ios-build.yml).

import XCTest
@testable import NukeCapture

final class DecodeTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    func testProfileReadDecodesSectionsAndToleratesAnUnknownKind() throws {
        let json = """
        {"vehicle_id":"e08bf694-970f-4cbe-8a74-8715158a0f2e","viewer":"anon","read_at":"2026-10-13T16:14:39.360102+00:00",
         "sections":[
          {"kind":"masthead","identity_source":{"year":1977,"make":"Chevrolet","model":"Blazer","normalized_model":"K5 Blazer","series":"K5","trim":"Cheyenne","transmission":"Automatic","transmission_model":"6L90"},
           "year":1977,"make":"Chevrolet","model":"Blazer","price":null,"priceLabel":null},
          {"kind":"strip","coverage":{"n":1,"of":5,"grain":"facts attributed","as_of":"2026-06-23T22:24:03.266022+00:00"},
           "facets":[{"dimension":"engine","label":"6.2L V8","member":{"value":"6.2L V8","source":{"kind":"image","label":"ls3 documentation corpus pixel verified","method":"ls3_documentation_corpus_pixel_verified"},"observed_at":"2026-06-23T22:24:03.266022+00:00","trust":0.95}},
                     {"dimension":"body_style","label":"SUV","member":{"value":"SUV","source":{"kind":"legacy","label":"vehicle record"},"observed_at":null,"trust":0.3}}],
           "odometer":null},
          {"kind":"timeline","coverage":{"n":257,"of":257,"grain":"events dated","as_of":"2026-06-01T01:13:32.823938+00:00"},
           "days":[{"day":"2026-02-01","kinds":{"service":10,"modification":1}}]},
          {"kind":"hologram","anything":true}
         ]}
        """
        let read = try decode(ProfileRead.self, json)
        XCTAssertEqual(read.viewer, .anon)
        XCTAssertEqual(read.sections.count, 4)
        XCTAssertNotNil(read.masthead)
        XCTAssertEqual(read.strip?.facets.count, 2)
        XCTAssertEqual(read.strip?.coverage.sentence, "1 of 5 facts attributed · as of Jun 23, 2026")
        XCTAssertEqual(read.timeline?.days.first?.kinds["service"], 10)
        if case .unknown(let kind) = read.sections[3] { XCTAssertEqual(kind, "hologram") } else { XCTFail("unknown section must decode as .unknown") }
        let legacy = try XCTUnwrap(read.strip?.facets[1].member)
        XCTAssertEqual(legacy.rootStatus, .recorded)
        XCTAssertEqual(legacy.decayLine, "vehicle record · trust 30%")
    }

    func testClaimWithAnUnknownSourceKindOrViewerDecodes() throws {
        let claim = try decode(Claim.self, #"{"value":12.5,"unit":"mi","source":{"kind":"sensor","label":"obd"},"observed_at":"2026-10-13T00:00:00+00:00","trust":0.5}"#)
        XCTAssertEqual(claim.source.kind, .legacy)   // an unknown class is read as the record, never as a crash
        XCTAssertEqual(claim.value.text, "12.5")
        let read = try decode(ProfileRead.self, #"{"vehicle_id":"x","viewer":"auditor","read_at":"t","sections":[]}"#)
        XCTAssertEqual(read.viewer, .anon)           // an unknown viewer fails closed
    }

    func testClaimValueTextDoesNotTrapOnLargeNumbers() throws {
        let big = try decode(Claim.self, #"{"value":1e30,"source":{"kind":"model"},"observed_at":null,"trust":0.4}"#)
        XCTAssertFalse(big.value.text.isEmpty)
        let whole = try decode(Claim.self, #"{"value":24000,"source":{"kind":"listing"},"observed_at":null,"trust":0.9}"#)
        XCTAssertEqual(whole.value.text, "24000")
    }

    func testLiveBoardSkipsBrokenRowsAndReadsDriftedValuesAsMissing() throws {
        let json = """
        {"synced_at":"2026-10-13T16:40:00.496962+00:00","source":"test","auctions":[
          ["69c01291-6232-4df8-ad9e-82eaac792462",1989,"LAMBORGHINI","Countach",576000,"2026-10-13T17:00:00+00:00","2026-10-13T16:40:00+00:00","2026-10-02T00:30:08+00:00","https://bringatrailer.com/x.jpg",false,"https://bringatrailer.com/listing/x","Countach",450000,605000,938000,"d",41],
          ["11111111-1111-1111-1111-111111111111","1990","PORSCHE",null,"not-a-number",null,null,null,null,"yes",null,null,null,null,null,null,null],
          {"kind":"object row"},
          ["not-a-uuid",2001,"FORD","F-150",1000,"2026-10-13T18:00:00+00:00",null,null,null,false,null,null,null,null,null,null,null]
        ]}
        """
        let board = try decode(LiveBoard.self, json)
        XCTAssertEqual(board.auctions.count, 3)
        XCTAssertEqual(board.skippedRows, 1)
        XCTAssertEqual(board.auctions[0].currentBid, 576000)
        XCTAssertNotNil(board.auctions[0].endsAtDate)
        XCTAssertEqual(board.auctions[1].year, 1990)        // a numeric string is read
        XCTAssertNil(board.auctions[1].currentBid)           // a non-number is missing, not fatal
        XCTAssertFalse(board.auctions[1].noReserve)
        XCTAssertNil(board.auctions[2].vehicleUUID)          // a bad id opens nothing
        XCTAssertEqual(board.open(at: Date(timeIntervalSince1970: 1_792_000_000)).count, 0)
    }

    func testLiveBoardReadsTheBandCurveAndBaselineAndGradesHeatAsTheWebDoes() throws {
        let json = """
        {"synced_at":"2026-10-13T22:00:00+00:00","source":"test",
         "curve":{"d":[[168,0.4505],[120,0.6076],[96,0.6392],[72,0.6632],[48,0.6902],[24,0.70],[12,0.75],[1,0.80]]},
         "baseline":{"week_ago":{"n":1100,"at":"2026-10-06T21:00:00+00:00","bids":37600000,"source":"live"}},
         "auctions":[
          ["69c01291-6232-4df8-ad9e-82eaac792462",2023,"PORSCHE","911",650000,"2026-10-14T16:45:00+00:00",null,null,null,false,null,"Sport Classic",478000,552000,700000,"d",15],
          ["11111111-1111-1111-1111-111111111111",1953,"ALFA ROMEO","1900C",40000,"2026-10-14T16:50:00+00:00",null,null,null,false,null,null,null,null,null,null,null],
          ["22222222-2222-2222-2222-222222222222",1990,"BMW","M3",30000,"2026-10-21T00:00:00+00:00",null,null,null,false,null,null,20000,30000,40000,"d",9]
        ]}
        """
        let board = try decode(LiveBoard.self, json)
        let now = try XCTUnwrap(ProfileClock.date("2026-10-13T22:06:40+00:00"))
        XCTAssertEqual(board.auctions[0].band?.p50, 552000)        // after three nulls and a false: every position still its own
        XCTAssertEqual(board.auctions[0].title, "Sport Classic")
        XCTAssertEqual(board.auctions[0].band?.comps, 15)
        XCTAssertNil(board.auctions[1].band)                       // no p10/p50/p90: no band, as useMarketPulse maps it
        XCTAssertEqual(board.weekAgo?.bids, 37_600_000)
        let hot = try XCTUnwrap(board.auctions[0].heat(curve: board.curve, at: now))
        XCTAssertEqual(hot.state, .hot)
        XCTAssertEqual(hot.hoursLeft, 18.64, accuracy: 0.01)
        // 18.64 h sits between the 24 h (0.70) and 12 h (0.75) marks: 0.70 + 0.05 × (24 − 18.64) / 12
        XCTAssertEqual(hot.share, 0.7223, accuracy: 0.001)
        XCTAssertEqual(hot.ratio, 650000 / (552000 * 0.7223), accuracy: 0.01)
        XCTAssertNil(board.auctions[1].heat(curve: board.curve, at: now))   // no band, no verdict
        XCTAssertNil(board.auctions[2].heat(curve: board.curve, at: now))   // 170 h left: past the 120 h ceiling, no verdict
        XCTAssertEqual(LiveBoardView.multiple(1.602), "1.6×")
        XCTAssertEqual(LiveBoardView.multiple(3.4), "3×+")
        XCTAssertEqual(LiveBoardView.bidNumber(650000), "$650,000")
        XCTAssertEqual(LiveBoardView.bidNumber(37_600_000, compact: true), "$37.6M")
        XCTAssertEqual(LiveBoardView.about(405_720), 406_000)
        let broken = try decode(LiveBoard.self, #"{"synced_at":null,"source":"t","curve":{"d":"not points"},"baseline":{"week_ago":{"bids":"x"}},"auctions":[]}"#)
        XCTAssertEqual(broken.curve?.tiers.isEmpty, true)          // a malformed curve reads as absent, never as a crash
        XCTAssertNil(broken.weekAgo)
    }

    func testLedgerMapRowsDecodeAtEveryLevelAndFormatAsTheWebDoes() throws {
        // treemap_by_brand carries min and max; treemap_years does not. Both decode to the same node.
        let brand = try decode([LedgerNode].self, #"[{"name":"CHEVROLET","count":151479,"value":5400000000,"median_price":36000,"min_price":100,"max_price":3500000,"sold_count":40000,"auction_count":9000,"avg_bids":12,"avg_watchers":400}]"#)
        XCTAssertEqual(brand.first?.median_price, 36000)
        let year = try decode([LedgerNode].self, #"[{"name":"1969","count":812,"value":40600000,"median_price":50000,"sold_count":300,"auction_count":100,"avg_bids":10,"avg_watchers":200}]"#)
        XCTAssertNil(year.first?.min_price)
        XCTAssertEqual(year.first?.count, 812)
        // The leaf: a recorded sale price wins, else the sold price, as the web's useTreemapVehicles maps it.
        let leaf = try decode([LedgerVehicle].self, #"[{"id":"e08bf694-970f-4cbe-8a74-8715158a0f2e","year":1977,"make":"Chevrolet","model":"Blazer","listing_title":null,"bat_listing_title":null,"sale_price":null,"sold_price":42000,"primary_image_url":null,"mileage":null}]"#)
        XCTAssertEqual(leaf.first?.price, 42000)
        XCTAssertEqual(leaf.first?.name, "1977 Chevrolet Blazer")
        XCTAssertEqual(LedgerMap.money(36_000), "$36K")
        XCTAssertEqual(LedgerMap.money(1_250_000), "$1.3M")
        XCTAssertEqual(LedgerMap.money(0), "--")
    }

    func testCalendarDayDecodesTheMaskedShapeFor1048() throws {
        let day = try decode(CalendarDay.self, #"{"day":"2026-02-02","photos":3,"events":0,"work":2,"work_minutes":120,"work_cost":null,"money_masked":true}"#)
        XCTAssertNil(day.work_cost)
        XCTAssertEqual(day.money_masked, true)
        let owner = try decode(CalendarDay.self, #"{"day":"2026-02-02","photos":3,"events":0,"work":2,"work_minutes":120,"work_cost":410}"#)
        XCTAssertEqual(owner.work_cost, 410)
    }

    func testDayReceiptDecodesWithoutMoneyForNonOwners() throws {
        let receipt = try decode(DayReceipt.self, #"{"date":"2026-02-02","is_owner_view":false,"photos":[],"work_sessions":[{"id":"6a4f3b2e-0000-4000-8000-000000000001","title":"Dash","duration_minutes":60,"total_job_cost":null}],"receipts":[]}"#)
        XCTAssertEqual(receipt.is_owner_view, false)
        XCTAssertNil(receipt.work_sessions.first?.total_job_cost)
    }
}
