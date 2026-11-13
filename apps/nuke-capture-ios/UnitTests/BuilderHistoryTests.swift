// BuilderHistoryTests.swift — the builder history rows say what the read functions computed, no more.
//
// Fixtures mirror the readers' prod payloads for the owner on 2026-11-12 (profile_labor_read_v1,
// profile_money_read_v1 with evidence ids stripped) and a synthetic vehicle list in the reader's shape.

import XCTest
@testable import NukeCapture

final class BuilderHistoryTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private let labor = """
    {"function":"profile_labor_read","version":1,"unit":"minutes","evidence_visible":true,
     "inferred":{"hours":1444.8,"minutes":86687,"last_day":"2026-06-20","sessions":1910,"vehicles":111,
       "by_status":{"derived":{"minutes":75325,"sessions":561},"completed":{"minutes":2976,"sessions":1249},
                    "auto_inferred":{"minutes":8386,"sessions":100}},
       "first_day":"1978-01-01","confidence":0.063,"evidence_table":"work_sessions","sessions_without_duration":1501},
     "owner_confirmed":{"hours":1.4,"minutes":81,"last_day":"2026-04-24","sessions":4,"vehicles":3,
       "by_status":{"completed":{"minutes":81,"sessions":4}},"first_day":"2018-01-19","confidence":null,
       "evidence_table":"work_sessions","sessions_without_duration":1},
     "rule":"owner_confirmed = work_sessions.owner_confirmed_at is set; everything else is inferred."}
    """

    func testHoursReadInferredApartFromConfirmedNeverProven() throws {
        let r = try decode(LaborRead.self, labor)
        let headline = try XCTUnwrap(LaborCopy.inferredHeadline(r))
        XCTAssertEqual(headline, "\(1445.formatted())h inferred")
        XCTAssertEqual(LaborCopy.inferredDetail(r), "\(1910.formatted()) sessions · 111 vehicles · last 2026-06-20")
        let own = try XCTUnwrap(LaborCopy.confirmedLine(r, isOwn: true))
        XCTAssertEqual(own, "\(LaborCopy.hours(1.4)) confirmed by you · 4 sessions")
        XCTAssertEqual(LaborCopy.confirmedLine(r, isOwn: false), "\(LaborCopy.hours(1.4)) owner-confirmed · 4 sessions")
        for line in [headline, own] { XCTAssertFalse(line.localizedCaseInsensitiveContains("proven"), line) }
    }

    func testNoSessionsMeansNoLaborLine() throws {
        let r = try decode(LaborRead.self, #"{"inferred":null,"owner_confirmed":null}"#)
        XCTAssertNil(LaborCopy.inferredHeadline(r))
        XCTAssertNil(LaborCopy.confirmedLine(r, isOwn: true))
    }

    private let money = """
    {"function":"profile_money_read","version":1,"visible":true,"rule":"r","totals":[
     {"basis":"sale_buyer_paid","scope":"organization","currency":null,"direction":"in","flagged_count":24,"trusted_count":0,"flagged_amount":710410.22,"trusted_amount":null},
     {"basis":"sale_net_proceeds","scope":"organization","currency":null,"direction":"in","flagged_count":2,"trusted_count":0,"flagged_amount":23615,"trusted_amount":null},
     {"basis":"gross_profit","scope":"organization","currency":null,"direction":"not_a_flow","flagged_count":19,"trusted_count":0,"flagged_amount":123808.9,"trusted_amount":null},
     {"basis":"acquisition_cost","scope":"organization","currency":null,"direction":"out","flagged_count":19,"trusted_count":0,"flagged_amount":314403.14,"trusted_amount":null},
     {"basis":"payment","scope":"personal","currency":"USD","direction":"in","flagged_count":7,"trusted_count":8,"flagged_amount":118116.73,"trusted_amount":273650.3},
     {"basis":"sale_document_total","scope":"personal","currency":"USD","direction":"in","flagged_count":0,"trusted_count":1,"flagged_amount":null,"trusted_amount":75000},
     {"basis":"sale_document_total","scope":"personal","currency":null,"direction":"in","flagged_count":3,"trusted_count":0,"flagged_amount":26263.66,"trusted_amount":null},
     {"basis":"receipt_total","scope":"personal","currency":"USD","direction":"not_a_flow","flagged_count":2,"trusted_count":7,"flagged_amount":19183.54,"trusted_amount":9564.21},
     {"basis":"receipt_total","scope":"personal","currency":null,"direction":"not_a_flow","flagged_count":70,"trusted_count":0,"flagged_amount":267520.29,"trusted_amount":null},
     {"basis":"payment","scope":"personal","currency":"USD","direction":"out","flagged_count":1,"trusted_count":1,"flagged_amount":0,"trusted_amount":75000},
     {"basis":"receipt_total","scope":"personal","currency":"EUR","direction":"out","flagged_count":0,"trusted_count":1,"flagged_amount":null,"trusted_amount":18000},
     {"basis":"receipt_total","scope":"personal","currency":"USD","direction":"out","flagged_count":122,"trusted_count":201,"flagged_amount":-71348.18,"trusted_amount":192098.3},
     {"basis":"receipt_total","scope":"personal","currency":null,"direction":"out","flagged_count":1708,"trusted_count":0,"flagged_amount":1849306.77,"trusted_amount":null},
     {"basis":"receipt_total","scope":"personal","currency":"USD","direction":"unknown","flagged_count":1,"trusted_count":3,"flagged_amount":null,"trusted_amount":59252.86},
     {"basis":"receipt_total","scope":"personal","currency":null,"direction":"unknown","flagged_count":34,"trusted_count":0,"flagged_amount":111987.52,"trusted_amount":null}]}
    """

    func testMoneyIsPersonalTrustedUSDWithFlaggedRowsCountedNotSummed() throws {
        let s = try XCTUnwrap(MoneyCopy.summary(try decode(MoneyRead.self, money)))
        XCTAssertEqual(s.receipts, 2_149)
        XCTAssertEqual(s.payments, 17)
        XCTAssertEqual(try XCTUnwrap(s.inUSD), 348_650.3, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(s.outUSD), 267_098.3, accuracy: 0.001, "EUR and unrecorded currency never join a dollar sum")
        XCTAssertEqual(s.heldBack, 2_012)
        XCTAssertEqual(MoneyCopy.countsLine(s), "\(2149.formatted()) receipts · 17 payments")
    }

    func testMoneyIsTheAccountsOwn() throws {
        let hidden = try decode(MoneyRead.self, #"{"visible":false,"reason":"money is shown only to the account itself"}"#)
        XCTAssertNil(MoneyCopy.summary(hidden))
    }

    private func vehicles(_ firsts: [String?], counts: String) -> String {
        let rows = firsts.enumerated().map { i, f -> String in
            let roles = f.map { #"[{"role":"contributor","first_at":"\#($0)","last_at":"\#($0)"}]"# } ?? "null"
            return #"{"vehicle_id":"00000000-0000-4000-8000-\#(String(format: "%012d", i))","year":1970,"make":"Chevrolet","model":"K10","ownership_class":"contributor","roles":\#(roles)}"#
        }
        return #"{"evidence_visible":true,"class_counts":\#(counts),"vehicles":[\#(rows.joined(separator: ","))]}"#
    }

    func testVehicleTimelineCountsByFirstEvidenceAndSaysUndated() throws {
        var firsts: [String?] = ["1985-05-01T00:00:00+00:00"]
        firsts += Array(repeating: "2017-03-01T00:00:00+00:00", count: 99)
        firsts += Array(repeating: "2019-03-01T00:00:00+00:00", count: 100)
        firsts += [nil, nil]
        let read = try decode(VehicleRelationshipsRead.self,
                              vehicles(firsts, counts: #"{"owner":4,"ambiguous":39,"contributor":95,"no_evidence":44,"unresolved":20}"#))
        let t = try XCTUnwrap(VehicleTimeline(read))
        XCTAssertEqual(t.total, 202)
        XCTAssertEqual(t.undated, 2)
        XCTAssertEqual(t.earlier, 1, "the 1985 outlier is counted, outside the strip")
        XCTAssertEqual(t.perYear.map(\.year), [2017, 2018, 2019])
        XCTAssertEqual(t.perYear.map(\.n), [99, 0, 100])
        XCTAssertEqual(t.headline, "202 vehicles")
        XCTAssertEqual(t.detail, "4 owned · 95 contributed · 59 unresolved · 44 no evidence yet")
        XCTAssertEqual(t.spanLine, "First evidence 2017 · 2 undated")
    }

    func testNoVehicleListIsUnknownNotZero() throws {
        XCTAssertNil(VehicleTimeline(try decode(VehicleRelationshipsRead.self, #"{"class_counts":null,"vehicles":null}"#)))
    }
}
