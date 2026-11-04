// DesignSystemTests.swift — the shared display helpers never invent a value: missing, blank or
// non-positive input yields nil (hidden in the UI), and counts read as plain English.

import XCTest
@testable import NukeCapture

final class DesignSystemTests: XCTestCase {
    func testTextTrimsAndRejectsBlank() {
        XCTAssertNil(NukeDisplay.text(nil))
        XCTAssertNil(NukeDisplay.text("   \n"))
        XCTAssertEqual(NukeDisplay.text("  Ford "), "Ford")
    }

    func testJoinedKeepsOnlyPresentParts() {
        XCTAssertEqual(NukeDisplay.joined(["Austin, TX", nil, "  ", "No reserve"]), "Austin, TX · No reserve")
        XCTAssertNil(NukeDisplay.joined([nil, "", " "]))
    }

    func testMoneyIsNilForMissingOrNonPositive() {
        XCTAssertNil(NukeDisplay.money(nil))
        XCTAssertNil(NukeDisplay.money(0))
        XCTAssertNil(NukeDisplay.money(-5))
        XCTAssertNil(NukeDisplay.money(Double.infinity))
        XCTAssertEqual(NukeDisplay.money(12_500), "$12,500")
    }

    func testCountPluralises() {
        XCTAssertEqual(NukeDisplay.count(1, "photo"), "1 photo")
        XCTAssertEqual(NukeDisplay.count(12, "photo"), "12 photos")
        XCTAssertEqual(NukeDisplay.count(0, "car"), "0 cars")
        XCTAssertEqual(NukeDisplay.count(2, "person", "people"), "2 people")
    }

    func testVehicleNameSkipsMissingParts() {
        XCTAssertEqual(NukeDisplay.vehicleName(year: 1973, make: "Ford", model: "Mustang"), "1973 Ford Mustang")
        XCTAssertEqual(NukeDisplay.vehicleName(year: nil, make: "Ford", model: nil), "Ford")
        XCTAssertNil(NukeDisplay.vehicleName(year: nil, make: " ", model: nil))
    }

    func testTapTargetAndSpacingScale() {
        XCTAssertGreaterThanOrEqual(NukeSize.minTap, 44)
        XCTAssertLessThan(NukeSpace.sm, NukeSpace.md)
        XCTAssertLessThan(NukeSpace.md, NukeSpace.lg)
        XCTAssertLessThan(NukeRadius.small, NukeRadius.card)
        XCTAssertLessThan(NukeRadius.card, NukeRadius.hero)
    }

    func testExploreSubtitleShowsOnlyWhatTheRecordCarries() {
        let none = ExploreFeedItem(id: "a", kind: .live, title: "a", image: "https://x/y.jpg", amount: nil,
                                   amountLabel: "Asking", endsAt: nil, source: "S", location: nil, facts: nil,
                                   seen: nil, vehicleId: nil, year: nil, make: nil, model: nil, link: nil)
        XCTAssertNil(none.subtitle)
        XCTAssertNil(none.timeLeft(now: Date()))
        let some = ExploreFeedItem(id: "b", kind: .classified, title: "b", image: "https://x/y.jpg", amount: 1,
                                   amountLabel: "Asking", endsAt: nil, source: "S", location: "Reno, NV",
                                   facts: nil, seen: "Seen today", vehicleId: nil, year: nil, make: nil,
                                   model: nil, link: nil)
        XCTAssertEqual(some.subtitle, "Reno, NV · Seen today")
    }
}
