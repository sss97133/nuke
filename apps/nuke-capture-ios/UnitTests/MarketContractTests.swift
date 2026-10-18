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
    func testCurrentBidRangesMatchTheWebBoundariesAndKeepZeroRecorded() {
        // The exact values in MarketPulse.test.tsx's bid distribution contract, plus nonfinite inputs.
        let examples: [(Double?, LiveBidRange)] = [
            (nil, .unrecorded), (0, .under10k), (9_999, .under10k),
            (10_000, .from10kTo25k), (24_999, .from10kTo25k),
            (25_000, .from25kTo50k), (49_999, .from25kTo50k),
            (50_000, .from50kTo100k), (99_999, .from50kTo100k), (100_000, .over100k),
            (.nan, .unrecorded), (-1, .unrecorded), (.infinity, .unrecorded), (-.infinity, .unrecorded)
        ]
        for (bid, expected) in examples {
            XCTAssertEqual(LiveBidRange.bucket(bid), expected, "bid: \(String(describing: bid))")
        }
        XCTAssertEqual(LiveBidRange.allCases.map(\.label), ["Any current bid", "Under $10,000", "$10,000–24,999",
            "$25,000–49,999", "$50,000–99,999", "$100,000+", "Unrecorded"])
    }

    func testBidSelectionUsesDecodedBoardRowsWithoutLosingWindowOrMakeScope() throws {
        // Includes numeric strings, malformed/missing bids, closed lots and a second make. The denominator
        // is the chosen make/window before the bid lens, not all loaded rows or only recorded bids.
        let board = try JSONDecoder().decode(LiveBoard.self, from: Data(#"{"synced_at":null,"source":"test","auctions":[["zero",1966,"FORD","Mustang",0,"2026-10-18T12:30:00Z"],["nine",1966,"FORD","Mustang",9999,"2026-10-18T12:30:00Z"],["ten",1966,"FORD","Mustang","10000","2026-10-18T12:30:00Z"],["quarter",1966,"FORD","Mustang",25000,"2026-10-18T12:30:00Z"],["fifty",1966,"FORD","Mustang",50000,"2026-10-18T12:30:00Z"],["hundred",1966,"FORD","Mustang",100000,"2026-10-18T12:30:00Z"],["missing",1966,"FORD","Mustang",null,"2026-10-18T12:30:00Z"],["negative",1966,"FORD","Mustang",-1,"2026-10-18T12:30:00Z"],["nonfinite",1966,"FORD","Mustang","NaN","2026-10-18T12:30:00Z"],["later",1966,"FORD","Mustang",100,"2026-10-18T13:00:00Z"],["closed",1966,"FORD","Mustang",200,"2026-10-18T11:59:59Z"],["other-make",1972,"PORSCHE","911",500,"2026-10-18T12:30:00Z"]]}"#.utf8))
        let now = try XCTUnwrap(ProfileClock.date("2026-10-18T12:00:00Z"))
        let open = board.open(at: now)
        let windowed = open.filter { $0.make == "FORD" && LiveAuctionWindow.hour.includes($0, at: now) }
        XCTAssertEqual(board.auctions.count, 12)
        XCTAssertEqual(open.count, 11)
        XCTAssertEqual(windowed.count, 9)
        func ids(_ range: LiveBidRange) -> [String] { windowed.filter(range.includes).map(\.id) }
        XCTAssertEqual(ids(.all), ["zero", "nine", "ten", "quarter", "fifty", "hundred", "missing", "negative", "nonfinite"])
        XCTAssertEqual(ids(.under10k), ["zero", "nine"])
        XCTAssertEqual(ids(.from10kTo25k), ["ten"])
        XCTAssertEqual(ids(.from25kTo50k), ["quarter"])
        XCTAssertEqual(ids(.from50kTo100k), ["fifty"])
        XCTAssertEqual(ids(.over100k), ["hundred"])
        XCTAssertEqual(ids(.unrecorded), ["missing", "negative", "nonfinite"])
        XCTAssertEqual(LiveAuctionOrder.bid.sorted(windowed.filter(LiveBidRange.under10k.includes)).map(\.id), ["nine", "zero"])
        XCTAssertEqual(LiveBidRange.allCases.filter { $0 != .all }.reduce(0) { $0 + ids($1).count }, windowed.count)
        // The map keeps other makes selectable but applies the identical clock and bid lens.
        XCTAssertEqual(open.filter { LiveAuctionWindow.hour.includes($0, at: now) && LiveBidRange.under10k.includes($0) }.map(\.id),
                       ["zero", "nine", "other-make"])
        let unknownOnly = windowed.filter(LiveBidRange.unrecorded.includes)
        XCTAssertTrue(unknownOnly.filter(LiveBidRange.under10k.includes).isEmpty, "an empty selection is not a zero bid")
        XCTAssertEqual(unknownOnly.filter(LiveBidRange.all.includes).count, 3, "Any current bid restores unrecorded rows too")
    }

    func testLiveWindowsAndSortsUseTheWebClockAndPopulation() throws {
        let board = try JSONDecoder().decode(LiveBoard.self, from: Data(#"{"synced_at":null,"source":"test","auctions":[["a",1966,"FORD","Mustang",100,"2026-10-18T12:30:00Z",null,"2026-10-18T11:00:00Z",null,true],["b",1967,"FORD","Mustang",300,"2026-10-18T13:00:00Z",null,"2026-10-17T12:00:00Z",null,false],["c",1968,"FORD","Mustang",null,"2026-10-19T12:00:00Z",null,null,null,false],["closed",1969,"FORD","Mustang",900,"2026-10-18T11:59:59Z",null,"2026-10-18T11:59:00Z",null,true]]}"#.utf8))
        let now = try XCTUnwrap(ProfileClock.date("2026-10-18T12:00:00Z"))
        let open = board.open(at: now)
        XCTAssertEqual(open.count, 3)
        func ids(_ window: LiveAuctionWindow) -> [String] { open.filter { window.includes($0, at: now) }.map(\.id) }
        XCTAssertEqual(ids(.all), ["a", "b", "c"])
        XCTAssertEqual(ids(.noReserve), ["a"])
        XCTAssertEqual(ids(.hour), ["a"])       // the web uses <, not <=
        XCTAssertEqual(ids(.day), ["a", "b"])
        XCTAssertEqual(ids(.new), ["a"])        // absent listing clocks are unknown
        XCTAssertEqual(LiveAuctionOrder.ending.sorted(open).map(\.id), ["a", "b", "c"])
        XCTAssertEqual(LiveAuctionOrder.bid.sorted(open).map(\.id), ["b", "a", "c"])
        XCTAssertEqual(LiveAuctionOrder.newest.sorted(open).map(\.id), ["a", "b", "c"])
    }

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
