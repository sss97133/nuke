// CaptureLedgerTests.swift — the phone's end of the capture ledger: the words it shares with the website, the skip
// queue's dedupe (one decision per asset until the reason changes), and the payload decoders. Pure model tests.

import XCTest
@testable import NukeCapture

final class CaptureLedgerTests: XCTestCase {
    func testSkipWordsMatchTheWebsite() {
        XCTAssertEqual(CaptureLedgerWords.skip("no_location"), "no location on the photo")
        XCTAssertEqual(CaptureLedgerWords.skip("off_site"), "outside a work site")
        XCTAssertEqual(CaptureLedgerWords.skip("not_own_camera"), "not from this phone's camera")
        XCTAssertEqual(CaptureLedgerWords.skip("something_new"), "something new")
    }

    func testSummaryLineDropsZeroPartsExceptTheFirst() {
        let totals = CaptureLedgerTotals(taken: 949, on_vehicle: 924, unverified: 0, waiting: 9, held: 14, pulled: 0, private: 1, unsorted: 0, failed: 1, skipped: 16)
        let vehicles = [CaptureLedgerVehicle(vehicle_id: "b1", name: "1973 Pontiac Firebird", n: 417),
                        CaptureLedgerVehicle(vehicle_id: "k2", name: "1983 GMC K2500", n: 507)]
        XCTAssertEqual(CaptureLedgerWords.summary(totals: totals, vehicles: vehicles),
                       "949 photos · 507 on 1983 GMC K2500 · 417 on 1973 Pontiac Firebird · 9 waiting on a check · 14 held · 1 kept private · 16 skipped on the phone · 1 failed")
        XCTAssertEqual(CaptureLedgerWords.summary(totals: CaptureLedgerTotals(taken: 1), vehicles: []), "1 photo")
    }

    func testSummaryLineCountsAThirdVehicleAsOthers() {
        let totals = CaptureLedgerTotals(taken: 30, on_vehicle: 30)
        let vehicles = [CaptureLedgerVehicle(vehicle_id: "a", name: "A", n: 20), CaptureLedgerVehicle(vehicle_id: "b", name: "B", n: 6), CaptureLedgerVehicle(vehicle_id: "c", name: "C", n: 4)]
        XCTAssertEqual(CaptureLedgerWords.summary(totals: totals, vehicles: vehicles), "30 photos · 20 on A · 6 on B · 4 on other vehicles")
    }

    @MainActor
    func testRecordQueuesOneDecisionPerAssetUntilTheReasonChanges() {
        let reporter = CaptureLedgerReporter()
        reporter.record(assetId: "A", reason: "no_location", takenAt: Date(timeIntervalSince1970: 1_700_000_000))
        reporter.record(assetId: "A", reason: "no_location", takenAt: nil)
        reporter.record(assetId: "B", reason: "off_site", takenAt: nil)
        reporter.record(assetId: "C", reason: "because", takenAt: nil)          // not a reason the server takes
        XCTAssertEqual(reporter.pending.map(\.asset_id), ["A", "B"])
        XCTAssertEqual(reporter.pending[0].taken_at, "2023-11-14T22:13:20Z")
        XCTAssertNil(reporter.pending[1].taken_at)
        reporter.record(assetId: "A", reason: "off_site", takenAt: nil)          // the decision changed: reported again
        XCTAssertEqual(reporter.pending.map { "\($0.asset_id):\($0.reason)" }, ["A:no_location", "B:off_site", "A:off_site"])
        XCTAssertFalse(reporter.pending[0].device?.isEmpty ?? true)
    }

    func testLedgerPayloadDecodesAndRollsVehiclesUp() throws {
        let json = """
        {"generated_at":"2026-11-07T20:00:00Z","tz":"UTC","days_total":2,"rescan":null,"last_rescan":null,
         "totals":{"taken":5,"on_vehicle":3,"unverified":0,"waiting":0,"held":1,"pulled":0,"private":1,"unsorted":0,"failed":0,"skipped":2},
         "days":[{"day":"2026-11-04","taken":4,"vehicles":[{"vehicle_id":"b1","name":"1973 Pontiac Firebird","n":2}],"held_reasons":{"no_clear_lead":1},"skip_reasons":{"no_location":2}},
                 {"day":"2026-11-01","taken":1,"vehicles":[{"vehicle_id":"b1","name":"1973 Pontiac Firebird","n":1}],"held_reasons":{},"skip_reasons":{}}]}
        """
        let payload = try JSONDecoder().decode(CaptureLedgerPayload.self, from: Data(json.utf8))
        XCTAssertEqual(payload.totals.taken, 5)
        XCTAssertEqual(payload.vehicles, [CaptureLedgerVehicle(vehicle_id: "b1", name: "1973 Pontiac Firebird", n: 3)])
        XCTAssertEqual(CaptureLedgerWords.summary(totals: payload.totals, vehicles: payload.vehicles),
                       "5 photos · 3 on 1973 Pontiac Firebird · 1 held · 1 kept private · 2 skipped on the phone")
    }

    func testAJsonbNullDecodesToNothing() {
        XCTAssertNil(CaptureLedgerReporter.decodeOptional(CaptureRescanRequest.self, from: Data("null".utf8)))
        let row = CaptureLedgerReporter.decodeOptional(CaptureRescanRequest.self,
            from: Data(#"{"id":"r1","user_id":"u","requested_at":"2026-11-07T20:30:00Z","source":"web","from_date":null,"acked_at":"2026-11-07T20:31:00Z","device":"iPhone","finished_at":null,"result":null}"#.utf8))
        XCTAssertEqual(row?.id, "r1")
        XCTAssertNil(row?.from_date)
    }
}
