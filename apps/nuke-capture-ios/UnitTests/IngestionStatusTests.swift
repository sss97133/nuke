// IngestionStatusTests.swift — the profile ingestion card's state derivation.

import XCTest
@testable import NukeCapture

final class IngestionStatusTests: XCTestCase {
    private func state(_ edit: (inout IngestionSnapshot) -> Void) -> IngestionState {
        var s = IngestionSnapshot(); s.serverSynced = 10; edit(&s); return IngestionState.derive(s)
    }

    func testUpToDateWhenNothingIsLeft() { XCTAssertEqual(state { _ in }, .upToDate) }

    func testBlockersWinOverWork() {
        XCTAssertEqual(state { $0.authProblem = "expired"; $0.isSyncing = true }, .signInNeeded)
        XCTAssertEqual(state { $0.isPaused = true; $0.uploadsPending = 5 }, .paused)
        XCTAssertEqual(state { $0.thermalHold = true; $0.uploadsPending = 5 }, .pausedHot)
    }

    func testThermalHoldWithoutWorkIsNotAPause() {
        XCTAssertEqual(state { $0.thermalHold = true }, .upToDate)
    }

    func testUploadingBeforeScanningBeforeServer() {
        XCTAssertEqual(state { $0.uploadsPending = 12; $0.scanning = true; $0.serverPending = 3 }, .uploading(12))
        XCTAssertEqual(state { $0.scanning = true; $0.scanned = 4; $0.scanTarget = 9; $0.serverPending = 3 }, .scanning(done: 4, total: 9))
        XCTAssertEqual(state { $0.serverPending = 3; $0.suggested = 2 }, .analyzing(3))
    }

    func testNeedsReviewCountsSuggestedAndUnresolved() {
        XCTAssertEqual(state { $0.suggested = 2; $0.unresolved = 1; $0.matched = 40 }, .needsReview(3))
    }

    func testUnknownOnlyWhenServerNeverLoaded() {
        XCTAssertEqual(state { $0.serverSynced = nil; $0.serverError = true }, .unknown)
        XCTAssertEqual(state { $0.serverError = true }, .upToDate)
    }

    func testTitles() {
        XCTAssertEqual(IngestionState.uploading(0).title, "Uploading")
        XCTAssertEqual(IngestionState.pausedHot.title, "Paused · phone hot or Low Power Mode")
        XCTAssertTrue(IngestionState.uploading(1_200).title.hasPrefix("Uploading 1"))
    }

    func testLastSyncIsTheLatestClockAndRefreshSpeedsUpWhileActive() {
        var s = IngestionSnapshot()
        s.lastDeviceSync = Date(timeIntervalSince1970: 100); s.lastServerSync = Date(timeIntervalSince1970: 200)
        XCTAssertEqual(s.lastSync, Date(timeIntervalSince1970: 200))
        XCTAssertEqual(IngestionRefresh.next(for: .uploading(1)), IngestionRefresh.activeInterval)
        XCTAssertEqual(IngestionRefresh.next(for: .upToDate), IngestionRefresh.interval)
    }

    func testParsesServerTimestamps() {
        XCTAssertNotNil(IngestionRefresh.parse("2026-10-22T20:01:02.123Z"))
        XCTAssertNotNil(IngestionRefresh.parse("2026-10-22T20:01:02+00:00"))
        XCTAssertNil(IngestionRefresh.parse(nil))
    }
}
