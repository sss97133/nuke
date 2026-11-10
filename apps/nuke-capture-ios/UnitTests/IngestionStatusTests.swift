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

    // MARK: Photo reading (the same reading the bar at the top shows)

    private let moving = PhotoReadingStatus(state: "moving", headline: "Reading your photos",
                                            summary: "12 read in the last hour", reasons: [], lines: ["12 read in the last hour."])
    private let stalled = PhotoReadingStatus(state: "stalled", headline: "Photo reading has stalled",
                                             reasons: ["The reader on the Mac has not checked in for about 3 hours.", "A second reason."])

    func testAMovingReadingReplacesAnalyzingAndUpToDate() {
        let expected = IngestionState.photoReading(headline: "Reading your photos", reason: nil, stalled: false)
        XCTAssertEqual(state { $0.photoReading = self.moving }, expected)
        XCTAssertEqual(state { $0.photoReading = self.moving; $0.serverPending = 3 }, expected)
        XCTAssertEqual(expected.title, "Reading your photos")
        XCTAssertNil(expected.detail)
        XCTAssertEqual(expected.systemImage, "eye")
    }

    func testAStalledReadingStatesItsFirstReason() {
        let expected = IngestionState.photoReading(headline: "Photo reading has stalled",
                                                   reason: "The reader on the Mac has not checked in for about 3 hours.", stalled: true)
        XCTAssertEqual(state { $0.photoReading = self.stalled }, expected)
        XCTAssertEqual(state { $0.photoReading = self.stalled; $0.serverPending = 3 }, expected)
        XCTAssertEqual(expected.title, "Photo reading has stalled")
        XCTAssertEqual(expected.detail, "The reader on the Mac has not checked in for about 3 hours.")
        XCTAssertEqual(expected.systemImage, "exclamationmark.triangle")
    }

    func testIdleOffAndAbsentReadingsLeaveTheCardAsItWas() {
        let idle = PhotoReadingStatus(state: "idle", headline: "Photo reading is waiting")
        let off = PhotoReadingStatus(state: "off", headline: "Photo reading is not switched on for this account")
        XCTAssertEqual(state { $0.photoReading = idle }, .upToDate)
        XCTAssertEqual(state { $0.photoReading = off; $0.serverPending = 3 }, .analyzing(3))
        XCTAssertEqual(state { $0.photoReading = PhotoReadingStatus() }, .upToDate)
        XCTAssertEqual(state { $0.photoReading = nil; $0.serverPending = 3 }, .analyzing(3))
        XCTAssertNil(IngestionState.upToDate.detail)
        XCTAssertNil(IngestionState.analyzing(3).detail)
    }

    func testAReadingNeverOutranksThePhoneOrWhatIsLeftForTheOwner() {
        XCTAssertEqual(state { $0.photoReading = self.stalled; $0.authProblem = "expired" }, .signInNeeded)
        XCTAssertEqual(state { $0.photoReading = self.stalled; $0.isPaused = true }, .paused)
        XCTAssertEqual(state { $0.photoReading = self.moving; $0.uploadsPending = 12 }, .uploading(12))
        XCTAssertEqual(state { $0.photoReading = self.moving; $0.scanning = true; $0.scanned = 4; $0.scanTarget = 9 }, .scanning(done: 4, total: 9))
        XCTAssertEqual(state { $0.photoReading = self.moving; $0.suggested = 2 }, .needsReview(2))
        XCTAssertEqual(state { $0.photoReading = self.moving; $0.serverSynced = nil; $0.serverError = true }, .unknown)
    }

    func testAReadingNeverSpeedsUpTheProfileRefresh() {
        let reading = IngestionState.photoReading(headline: "Reading your photos", reason: nil, stalled: false)
        XCTAssertFalse(reading.isActive)
        XCTAssertEqual(IngestionRefresh.next(for: reading), IngestionRefresh.interval)
    }

    func testParsesServerTimestamps() {
        XCTAssertNotNil(IngestionRefresh.parse("2026-10-22T20:01:02.123Z"))
        XCTAssertNotNil(IngestionRefresh.parse("2026-10-22T20:01:02+00:00"))
        XCTAssertNil(IngestionRefresh.parse(nil))
    }
}
