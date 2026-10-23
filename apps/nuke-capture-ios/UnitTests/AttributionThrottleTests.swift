// AttributionThrottleTests.swift — automatic attribution (foreground / post-sync) must not keep a
// warm phone busy: it skips when seriously hot or in Low Power Mode and runs at most every 15 min.

import XCTest
@testable import NukeCapture

final class AttributionThrottleTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testFirstRunAllowed() {
        XCTAssertTrue(AttributionEngine.shouldRunAutomatic(now: now, lastRun: nil, tooHot: false, lowPower: false))
    }

    func testWithinIntervalSkipped() {
        let last = now.addingTimeInterval(-14 * 60)
        XCTAssertFalse(AttributionEngine.shouldRunAutomatic(now: now, lastRun: last, tooHot: false, lowPower: false))
    }

    func testAfterIntervalAllowed() {
        let last = now.addingTimeInterval(-15 * 60)
        XCTAssertTrue(AttributionEngine.shouldRunAutomatic(now: now, lastRun: last, tooHot: false, lowPower: false))
    }

    func testClockMovedBackAllowed() {
        let last = now.addingTimeInterval(3600)
        XCTAssertTrue(AttributionEngine.shouldRunAutomatic(now: now, lastRun: last, tooHot: false, lowPower: false))
    }

    func testHotOrLowPowerSkipped() {
        XCTAssertFalse(AttributionEngine.shouldRunAutomatic(now: now, lastRun: nil, tooHot: true, lowPower: false))
        XCTAssertFalse(AttributionEngine.shouldRunAutomatic(now: now, lastRun: nil, tooHot: false, lowPower: true))
    }

    func testGlassesLanesDropWhenWarm() {
        XCTAssertEqual(LibraryOverlayStore.laneCount(thermal: .nominal, lowPower: false), 4)
        XCTAssertEqual(LibraryOverlayStore.laneCount(thermal: .fair, lowPower: false), 1)
        XCTAssertEqual(LibraryOverlayStore.laneCount(thermal: .critical, lowPower: false), 1)
        XCTAssertEqual(LibraryOverlayStore.laneCount(thermal: .nominal, lowPower: true), 1)
    }
}
