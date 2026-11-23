// LibraryInventoryTests.swift — the whole-library inventory's pure rules: keyset paging never skips an asset
// at a page boundary or a timestamp tie, the gate verdict follows processAsset's order, coordinates leave the
// phone coarsened, run planning, and outcome mapping.

import XCTest
@testable import NukeCapture

final class LibraryInventoryTests: XCTestCase {
    private let t0 = Date(timeIntervalSinceReferenceDate: 800_000_000)
    private func d(_ s: TimeInterval) -> Date { t0.addingTimeInterval(s) }

    // MARK: paging

    func testShortPageEndsTheRun() {
        XCTAssertEqual(LibraryInventoryPlan.step(pageDates: [d(1), d(2)], pageSize: 500, cursor: d(0)), .done)
        XCTAssertEqual(LibraryInventoryPlan.step(pageDates: [], pageSize: 500, cursor: d(0)), .done)
    }

    func testFullPageAdvancesToItsLastDateInclusive() {
        let page = [d(1), d(2), d(3)]
        // Next fetch is creationDate >= d(3): ties at the boundary are re-read, never skipped.
        XCTAssertEqual(LibraryInventoryPlan.step(pageDates: page, pageSize: 3, cursor: d(0)), .advance(to: d(3)))
    }

    func testFullPageOfOneTimestampWidensInsteadOfStalling() {
        let page = [d(5), d(5), d(5)]
        XCTAssertEqual(LibraryInventoryPlan.step(pageDates: page, pageSize: 3, cursor: d(5)), .widen(at: d(5)))
    }

    /// Simulate the whole walk over a library with heavy ties; every asset must be seen exactly once or more.
    func testWalkSeesEveryAssetAcrossTiesAndBoundaries() {
        var library: [(id: Int, date: Date)] = []
        for i in 0..<57 { library.append((i, d(Double(i / 10)))) }   // 10 assets per timestamp
        let pageSize = 4
        var seen = Set<Int>()
        var cursor = Date.distantPast
        var guardCount = 0
        while guardCount < 500 {
            guardCount += 1
            let page = library.filter { $0.date >= cursor }.sorted { $0.date < $1.date }.prefix(pageSize)
            page.forEach { seen.insert($0.id) }
            switch LibraryInventoryPlan.step(pageDates: page.map(\.date), pageSize: pageSize, cursor: cursor) {
            case .done: XCTAssertEqual(seen.count, library.count); return
            case .advance(let to): cursor = to
            case .widen(let at):
                let end = at.addingTimeInterval(LibraryInventoryPlan.tieWindow)
                library.filter { $0.date >= at && $0.date < end }.forEach { seen.insert($0.id) }
                cursor = end
            }
        }
        XCTFail("walk did not terminate")
    }

    // MARK: gate verdict and privacy of the row

    private func facts(source: String = "user_library", screenshot: Bool = false, lat: Double? = 35.9771, lon: Double? = -114.8543) -> InventoryAssetFacts {
        InventoryAssetFacts(localIdentifier: "A/L0/001", creationDate: d(0), mediaSubtypesRaw: 0, sourceType: source,
                            isScreenshot: screenshot, pixelWidth: 4032, pixelHeight: 3024, latitude: lat, longitude: lon)
    }

    func testGateVerdictFollowsProcessAssetOrder() {
        let yes: (Double, Double) -> Bool = { _, _ in true }
        let no: (Double, Double) -> Bool = { _, _ in false }
        XCTAssertEqual(LibraryInventoryPlan.gateVerdict(facts: facts(source: "cloud_shared"), isAtSite: yes), "not_library")
        XCTAssertEqual(LibraryInventoryPlan.gateVerdict(facts: facts(screenshot: true), isAtSite: yes), "screenshot")
        XCTAssertEqual(LibraryInventoryPlan.gateVerdict(facts: facts(lat: nil, lon: nil), isAtSite: yes), "no_location")
        XCTAssertEqual(LibraryInventoryPlan.gateVerdict(facts: facts(), isAtSite: no), "off_site")
        XCTAssertEqual(LibraryInventoryPlan.gateVerdict(facts: facts(), isAtSite: yes), "at_site")
    }

    func testRowCarriesOnlyCoarseCoordinates() {
        let r = LibraryInventoryPlan.row(from: facts(), scope: "limited", deviceID: "dev") { _, _ in false }
        XCTAssertEqual(r.loc_lat_coarse, 35.98)
        XCTAssertEqual(r.loc_lon_coarse, -114.85)
        XCTAssertTrue(r.has_location)
        XCTAssertEqual(r.gate_verdict, "off_site")
        XCTAssertEqual(r.origin_scope, "limited")
    }

    func testRowWithoutLocationHasNoCoordinates() {
        let r = LibraryInventoryPlan.row(from: facts(lat: nil, lon: nil), scope: "full", deviceID: nil) { _, _ in true }
        XCTAssertFalse(r.has_location)
        XCTAssertNil(r.loc_lat_coarse)
        XCTAssertEqual(r.gate_verdict, "no_location")
    }

    // MARK: run planning

    func testPlanStartsFullWhenNeverRun() {
        XCTAssertEqual(LibraryInventoryPlan.plan(activeRun: false, lastFullAt: nil, lastCompletedAt: nil, now: d(0)), .full)
    }

    func testPlanResumesInFlightRunWithoutRestarting() {
        XCTAssertEqual(LibraryInventoryPlan.plan(activeRun: true, lastFullAt: nil, lastCompletedAt: nil, now: d(0)), .none)
    }

    func testPlanIncrementalThenWeeklyFull() {
        let full = d(0)
        let day: TimeInterval = 86_400
        XCTAssertEqual(LibraryInventoryPlan.plan(activeRun: false, lastFullAt: full, lastCompletedAt: full, now: d(3_600)), .none)
        XCTAssertEqual(LibraryInventoryPlan.plan(activeRun: false, lastFullAt: full, lastCompletedAt: full, now: d(day)),
                       .incremental(from: full.addingTimeInterval(-LibraryInventoryPlan.incrementalOverlap)))
        XCTAssertEqual(LibraryInventoryPlan.plan(activeRun: false, lastFullAt: full, lastCompletedAt: d(6 * day), now: d(8 * day)), .full)
    }

    // MARK: outcomes

    func testOutcomeMapping() {
        func s(_ o: SyncEngine.AssetOutcome) -> String? { LibraryInventoryPlan.outcomeState(o)?.state }
        XCTAssertEqual(s(.uploaded(pixels: true)), "uploaded")
        XCTAssertEqual(s(.queued), "uploaded")
        XCTAssertEqual(s(.heldPrivate), "held_private")
        XCTAssertEqual(s(.offSite(reason: "off_site")), "off_site")
        XCTAssertEqual(s(.failed(retry: true)), "retry")
        XCTAssertEqual(s(.failed(retry: false)), "gave_up")
        // Costs the photo nothing: stays pending without an attempt.
        XCTAssertNil(s(.deferred))
        XCTAssertNil(s(.authFailed))
    }

    func testRowEncodesColumnNames() throws {
        let r = LibraryInventoryPlan.row(from: facts(), scope: "full", deviceID: nil) { _, _ in true }
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(r)) as? [String: Any]
        XCTAssertEqual(json?["asset_local_id"] as? String, "A/L0/001")
        XCTAssertEqual(json?["gate_verdict"] as? String, "at_site")
        XCTAssertNil(json?["latitude"])   // exact coordinates have no field to travel in
    }
}

// MARK: census (the denominator)

final class LibraryCensusTests: XCTestCase {
    func testCensusCountsByLosAngelesMonthAndAddsUp() {
        let iso = ISO8601DateFormatter()
        let dates: [Date?] = [
            iso.date(from: "2017-03-10T18:00:00Z"),
            iso.date(from: "2017-03-31T23:00:00Z"),   // still March in LA
            iso.date(from: "2017-05-01T03:00:00Z"),   // April 30 in LA (server buckets the same way)
            iso.date(from: "2023-01-15T12:00:00Z"),
            nil,
        ]
        let c = LibraryInventoryPlan.censusCounts(dates)
        XCTAssertEqual(c.months, ["2017-03": 2, "2017-04": 1, "2023-01": 1])
        XCTAssertEqual(c.undated, 1)
        XCTAssertEqual(c.months.values.reduce(0, +) + c.undated, dates.count)
    }

    func testEmptyLibraryCensusIsZeroNotMissing() {
        let c = LibraryInventoryPlan.censusCounts([])
        XCTAssertTrue(c.months.isEmpty)
        XCTAssertEqual(c.undated, 0)
    }

    func testCensusEncodesTheServerFieldNames() throws {
        let census = LibraryCensus(run_id: "R", origin_device_id: nil, origin_scope: "full", total_count: 3,
                                   month_counts: ["2017-03": 2], undated_count: 1, month_tz: "America/Los_Angeles",
                                   started_at: Date(timeIntervalSince1970: 0), finished_at: Date(timeIntervalSince1970: 60),
                                   producer: "test")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(census)) as? [String: Any]
        for k in ["run_id", "origin_source", "origin_scope", "media_type", "total_count", "month_counts",
                  "undated_count", "month_tz", "started_at", "finished_at", "producer"] {
            XCTAssertNotNil(json?[k], k)
        }
        XCTAssertEqual(json?["origin_source"] as? String, "ios_photokit")
    }

    func testInventoryRowCarriesCloudIdentifierField() throws {
        var r = LibraryInventoryPlan.row(from: InventoryAssetFacts(localIdentifier: "A/L0/001", creationDate: nil,
            mediaSubtypesRaw: 0, sourceType: "user_library", isScreenshot: false, pixelWidth: 1, pixelHeight: 1,
            latitude: nil, longitude: nil), scope: "full", deviceID: nil) { _, _ in false }
        XCTAssertNil(r.cloud_identifier)
        r.cloud_identifier = "CLOUD-1"
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(r)) as? [String: Any]
        XCTAssertEqual(json?["cloud_identifier"] as? String, "CLOUD-1")
    }
}
