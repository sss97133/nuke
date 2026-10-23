// MarketMapCountsTests.swift — the fast map-coloring path (map_zip_counts) and its read/projection pacing.

import XCTest
@testable import NukeCapture

final class MarketMapCountsTests: XCTestCase {
    private let crosswalk = ["89501": "32031", "89502": "32031", "96161": "06057"]

    func testCountsFoldMatchesMakeCaseInsensitivelyAndSumsMakes() {
        let rows = [
            ZIPCountRow(county_fips: "32031", zip: "89501", make: "Porsche", vehicles: 3),
            ZIPCountRow(county_fips: "32031", zip: "89501", make: "Ford", vehicles: 2),
            ZIPCountRow(county_fips: "32031", zip: "89502", make: " porsche ", vehicles: 1)
        ]
        XCTAssertEqual(ZIPCountFold.counts(rows, make: nil, crosswalk: crosswalk, countyZIPs: [:]), ["89501": 5, "89502": 1])
        XCTAssertEqual(ZIPCountFold.counts(rows, make: "PORSCHE", crosswalk: crosswalk, countyZIPs: [:]), ["89501": 3, "89502": 1])
    }

    func testCountsFoldDropsZIPsOutsideThePartition() {
        let rows = [
            ZIPCountRow(county_fips: "32031", zip: "96161", make: "Ford", vehicles: 4), // crosswalk says 06057
            ZIPCountRow(county_fips: "32031", zip: "00000", make: "Ford", vehicles: 9)  // unresolved
        ]
        XCTAssertEqual(ZIPCountFold.counts(rows, make: nil, crosswalk: crosswalk, countyZIPs: [:]), [:])
        // ZCTA membership, once loaded, overrides the single-county crosswalk.
        XCTAssertEqual(ZIPCountFold.counts(rows, make: nil, crosswalk: crosswalk, countyZIPs: ["32031": ["96161"]]), ["96161": 4])
    }

    func testMakeCountsOnlyVisibleZIPs() {
        let rows = [
            ZIPCountRow(county_fips: "32031", zip: "89501", make: "Ford", vehicles: 2),
            ZIPCountRow(county_fips: "32031", zip: "89502", make: "ford", vehicles: 5),
            ZIPCountRow(county_fips: "32031", zip: "89502", make: nil, vehicles: 7)
        ]
        let makes = ZIPCountFold.makeCounts(rows, visible: ["89501"])
        XCTAssertEqual(makes.map(\.id), ["ford"]); XCTAssertEqual(makes.first?.count, 2)
    }

    func testDecodesRPCRow() throws {
        let json = #"[{"county_fips":"32031","zip":"89501","make":null,"vehicles":12}]"#
        let rows = try JSONDecoder().decode([ZIPCountRow].self, from: Data(json.utf8))
        XCTAssertEqual(rows, [ZIPCountRow(county_fips: "32031", zip: "89501", make: nil, vehicles: 12)])
    }

    func testMissingFunctionDetection() {
        struct Fake: Error, CustomStringConvertible { let description: String }
        XCTAssertTrue(ZIPCountFold.isMissingFunction(Fake(description: "PostgrestError(code: PGRST202, message: Could not find the function public.map_zip_counts)")))
        XCTAssertFalse(ZIPCountFold.isMissingFunction(Fake(description: "timeout")))
    }

    func testThrottleCoalescesToOncePerInterval() {
        var throttle = ReprojectThrottle(interval: 1)
        let t0 = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(throttle.delay(now: t0), 0)
        XCTAssertEqual(throttle.delay(now: t0.addingTimeInterval(0.25)), 0.75, accuracy: 0.001)
        XCTAssertEqual(throttle.delay(now: t0.addingTimeInterval(1.5)), 0)
    }

    private func row(_ id: String) throws -> CountyLocationRow {
        let json = """
        {"id":"\(id)","postal_code":"89501","county_fips":"32031","confidence":0.9,
         "vehicles":{"id":"\(id)","make":"Ford","status":null,"deleted_at":null}}
        """
        return try JSONDecoder().decode(CountyLocationRow.self, from: Data(json.utf8))
    }

    @MainActor func testShortPageFinishesWithoutAnEmptyRoundTrip() async throws {
        let ids = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002",
                   "00000000-0000-0000-0000-000000000003"]
        let all = try ids.map(row)
        var calls = 0
        var published = 0
        try await CountyEvidenceBatch.readAll(after: nil, fetch: { after, size in
            calls += 1
            let start = after.map { a in all.firstIndex { $0.id.uuidString.lowercased() == a }! + 1 } ?? 0
            return Array(all[start..<min(start + 2, all.count)]) // server caps at 2 here; we ask for 1000
        }, publish: { batch in published += batch.rows.count })
        XCTAssertEqual(published, 2)
        XCTAssertEqual(calls, 1, "a page shorter than requested is final")
        let full = try await CountyEvidenceBatch.read(after: nil, size: 2, fetch: { _, _ in Array(all[0..<2]) })
        XCTAssertFalse(full.complete)
        let short = try await CountyEvidenceBatch.read(after: nil, size: 2, fetch: { _, _ in [all[2]] })
        XCTAssertTrue(short.complete)
    }
}
