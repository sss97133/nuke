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
