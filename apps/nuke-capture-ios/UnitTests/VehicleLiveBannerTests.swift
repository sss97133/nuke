// VehicleLiveBannerTests.swift — the vehicle page's LIVE banner: the countdown carries days and
// hours (two days out never reads "2880:00") and a missing bid reads "unknown", not a dash.

import XCTest
@testable import NukeCapture

final class VehicleLiveBannerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    func testTwoDaysOutCarriesDaysNotMinutes() {
        let twoDays: TimeInterval = 2 * 86_400
        let text = VehicleLiveBanner.countdown(now.addingTimeInterval(twoDays), now: now)
        XCTAssertEqual(text, "2d 00h 00m 00s")
        XCTAssertFalse(text.contains("2880"))
    }

    func testCountdownSteps() {
        let hour: TimeInterval = 3600, minute: TimeInterval = 60
        let mixed: TimeInterval = 86_400 + 2 * hour + 3 * minute + 4
        XCTAssertEqual(VehicleLiveBanner.countdown(now.addingTimeInterval(mixed), now: now), "1d 02h 03m 04s")
        XCTAssertEqual(VehicleLiveBanner.countdown(now.addingTimeInterval(5 * hour + 7), now: now), "5h 00m 07s")
        XCTAssertEqual(VehicleLiveBanner.countdown(now.addingTimeInterval(59 * minute + 59), now: now), "59m 59s")
        XCTAssertEqual(VehicleLiveBanner.countdown(now.addingTimeInterval(30), now: now), "0m 30s")
    }

    func testCountdownSaysClosedOncePassed() {
        XCTAssertEqual(VehicleLiveBanner.countdown(now, now: now), "closed")
        XCTAssertEqual(VehicleLiveBanner.countdown(now.addingTimeInterval(-5), now: now), "closed")
    }

    func testBidReadsUnknownWhenMissing() {
        XCTAssertEqual(VehicleLiveBanner.bid(nil), "unknown")
        XCTAssertEqual(VehicleLiveBanner.bid(0), "unknown")
        XCTAssertEqual(VehicleLiveBanner.bid(45_000), "$45,000")
    }
}
