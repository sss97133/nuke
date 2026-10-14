// MarketContractTests.swift — the contracts the phone shares with the web's Market tab.
//
// 1. The hot/cold verdict (#1088): the fixture is the web's own file (nuke_frontend/src/pages/market/
//    __fixtures__/heat-fixture-20261013T2300Z.json, a test resource here), its expected verdicts produced by
//    the web's heatOf and checked there by heat-fixture.contract.test.ts. Each lot goes through the phone as
//    the board sends it, a positional row decoded by LiveAuction, then LiveAuction.heat. Every state and every
//    ratio must match; the thresholds must be the ones the fixture states.
// 2. The board's named slots (#1092): BoardContract reads a v1 payload as before, accepts the 17 slots in
//    order with anything appended, and refuses a moved or renamed slot.

import XCTest
@testable import NukeCapture

final class MarketContractTests: XCTestCase {
    private struct Fixture: Decodable {
        struct Lot: Decodable {
            struct Band: Decodable { let p10: Double; let p50: Double; let p90: Double; let tier: String; let comps: Double }
            let id: String
            let currentBid: Double?
            let endsAt: String?
            let band: Band?
        }
        struct Expected: Decodable { let id: String; let state: String?; let ratio: Double? }
        struct Thresholds: Decodable { let hot: Double; let cold: Double; let max_hours: Double }
        let now_ms: Double
        let thresholds: Thresholds
        let curve: BidCurve
        let lots: [Lot]
        let expected: [Expected]
        let counts: [String: Int]
    }

    private static func name(_ s: LiveAuction.Heat.State) -> String {
        switch s { case .hot: return "hot"; case .cold: return "cold"; case .inLine: return "in line" }
    }

    func testThePhoneReproducesEveryVerdictInTheSharedFixture() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "heat-fixture-20261013T2300Z", withExtension: "json"),
                                "the web's fixture must be bundled as a test resource (project.yml)")
        let fx = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        XCTAssertEqual(fx.thresholds.hot, LiveAuction.hotAt)
        XCTAssertEqual(fx.thresholds.cold, LiveAuction.coldAt)
        XCTAssertEqual(fx.thresholds.max_hours, LiveAuction.heatMaxHours)
        XCTAssertEqual(fx.lots.count, fx.expected.count)
        let now = Date(timeIntervalSince1970: fx.now_ms / 1000)
        func v(_ x: Any?) -> Any { x ?? NSNull() }
        var byState: [String: Int] = [:]
        for (lot, exp) in zip(fx.lots, fx.expected) {
            XCTAssertEqual(lot.id, exp.id)
            // The lot as the board sends it (useMarketPulse.ts slots 0 to 16); identity and clocks the verdict does not read are null.
            let row: [Any] = [lot.id, NSNull(), NSNull(), NSNull(), v(lot.currentBid), v(lot.endsAt), NSNull(), NSNull(), NSNull(), false,
                              NSNull(), NSNull(), v(lot.band?.p10), v(lot.band?.p50), v(lot.band?.p90), v(lot.band?.tier), v(lot.band?.comps)]
            let auction = try JSONDecoder().decode(LiveAuction.self, from: JSONSerialization.data(withJSONObject: row))
            let heat = auction.heat(curve: fx.curve, at: now)
            guard let state = exp.state else {
                XCTAssertNil(heat, "\(lot.id): the web gives no verdict")
                byState["none", default: 0] += 1
                continue
            }
            let got = try XCTUnwrap(heat, "\(lot.id): the web says \(state)")
            XCTAssertEqual(Self.name(got.state), state, lot.id)
            XCTAssertEqual(got.ratio, try XCTUnwrap(exp.ratio), accuracy: 1e-6, lot.id)
            byState[state, default: 0] += 1
        }
        XCTAssertEqual(byState, fx.counts, "the phone's tally must equal the fixture's")
    }

    func testTheBoardHeaderIsReadAsTheContractSays() throws {
        func payload(_ columns: [String]?) -> Data {
            var p: [String: Any] = ["synced_at": "2026-10-13T23:00:00+00:00", "source": "t", "auctions": []]
            if let columns { p["v"] = 2; p["columns"] = columns }
            return try! JSONSerialization.data(withJSONObject: p)
        }
        XCTAssertNoThrow(try BoardContract.check(payload(nil)))                                    // v1: no header, read as before
        XCTAssertNoThrow(try BoardContract.check(payload(BoardContract.columns)))                  // v2: the 17 slots in order
        XCTAssertNoThrow(try BoardContract.check(payload(BoardContract.columns + ["heat_state"]))) // a later slot appended
        var moved = BoardContract.columns; moved.swapAt(4, 5)
        XCTAssertThrowsError(try BoardContract.check(payload(moved)))                               // a moved slot stops the read
        XCTAssertThrowsError(try BoardContract.check(payload(Array(BoardContract.columns.dropLast()))))
        XCTAssertEqual(BoardContract.columns.count, 17)
    }
}
