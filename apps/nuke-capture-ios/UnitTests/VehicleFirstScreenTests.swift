// VehicleFirstScreenTests.swift — the vehicle page's first screen: the price's age, the one-line
// title split around the make's wordmark, and the one source-mark table Explore shares.

import XCTest
@testable import NukeCapture

final class VehicleFirstScreenTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-11-11T12:00:00Z")!

    func testAgeSteps() {
        XCTAssertEqual(VehicleFirstScreen.age("2026-11-11T11:59:30Z", now: now), "just now")
        XCTAssertEqual(VehicleFirstScreen.age("2026-11-11T11:48:00Z", now: now), "12m ago")
        XCTAssertEqual(VehicleFirstScreen.age("2026-11-11T07:00:00Z", now: now), "5h ago")
        XCTAssertEqual(VehicleFirstScreen.age("2026-11-08T12:00:00Z", now: now), "3d ago")
        XCTAssertEqual(VehicleFirstScreen.age("2026-07-11T12:00:00Z", now: now), "4mo ago")
        XCTAssertEqual(VehicleFirstScreen.age("2024-11-01T12:00:00Z", now: now), "2y ago")
    }

    func testAgeReadsPostgresAndDayOnlyClocks() {
        XCTAssertEqual(VehicleFirstScreen.age("2026-11-08 12:00:00+00:00", now: now), "3d ago")
        XCTAssertEqual(VehicleFirstScreen.age("2026-11-08T12:00:00.123456+00:00", now: now), "3d ago")
        XCTAssertEqual(VehicleFirstScreen.age("2026-11-01", now: now), "10d ago")
    }

    func testAgeIsHiddenWhenUnknown() {
        XCTAssertNil(VehicleFirstScreen.age(nil, now: now))
        XCTAssertNil(VehicleFirstScreen.age("", now: now))
        XCTAssertNil(VehicleFirstScreen.age("not a date", now: now))
        XCTAssertNil(VehicleFirstScreen.age("2026-11-12T12:00:00Z", now: now))   // future
    }

    func testTitleWordsPreferTokensThenRowFields() {
        XCTAssertEqual(VehicleFirstScreen.titleWords(year: 1967, make: "Chevrolet", model: "C10", trim: nil,
                                                     tokens: ["1967", "Chevrolet", "C10", "Custom"]),
                       ["1967", "Chevrolet", "C10", "Custom"])
        XCTAssertEqual(VehicleFirstScreen.titleWords(year: 1977, make: "Ford", model: "F-250", trim: " ", tokens: nil),
                       ["1977", "Ford", "F-250"])
        XCTAssertEqual(VehicleFirstScreen.titleWords(year: 1977, make: "Ford", model: nil, trim: nil, tokens: []),
                       ["1977", "Ford"])
    }

    func testSplitTitleAroundTheMake() {
        let s = VehicleFirstScreen.splitTitle(["1967", "chevrolet", "C10", "Custom"], make: "Chevrolet")
        XCTAssertEqual(s.before, "1967")
        XCTAssertEqual(s.make, "chevrolet")
        XCTAssertEqual(s.after, "C10 Custom")

        let last = VehicleFirstScreen.splitTitle(["1967", "Chevrolet"], make: "Chevrolet")
        XCTAssertEqual(last.after, "")

        let none = VehicleFirstScreen.splitTitle(["1967", "C10"], make: "Ford")
        XCTAssertEqual(none.before, "1967 C10")
        XCTAssertNil(none.make)
        XCTAssertEqual(none.after, "")
    }

    func testSourceMarkTableMatchesLooselyAndPrefersTheClaimsOwnLogo() {
        let bat = "https://nuke.ag/source-logos/bat.png"
        XCTAssertEqual(VehicleFirstScreen.sourceMarkURL(label: "Bring a Trailer")?.absoluteString, bat)
        XCTAssertEqual(VehicleFirstScreen.sourceMarkURL(label: "bat")?.absoluteString, bat)
        XCTAssertEqual(VehicleFirstScreen.sourceMarkURL(label: "BringATrailer")?.absoluteString, bat)
        XCTAssertEqual(VehicleFirstScreen.sourceMarkURL(label: "Cars & Bids")?.absoluteString,
                       "https://nuke.ag/source-logos/cars-and-bids.png")
        XCTAssertEqual(VehicleFirstScreen.sourceMarkURL(label: "Barrett-Jackson")?.absoluteString,
                       "https://nuke.ag/source-logos/barrett-jackson.png")
        XCTAssertNil(VehicleFirstScreen.sourceMarkURL(label: "Some Dealer"))
        XCTAssertNil(VehicleFirstScreen.sourceMarkURL(label: nil))
        XCTAssertEqual(VehicleFirstScreen.sourceMarkURL(label: "Some Dealer", logoUrl: "https://x.test/m.png")?.absoluteString,
                       "https://x.test/m.png")
        // A non-https logo is not loaded; the table decides.
        XCTAssertEqual(VehicleFirstScreen.sourceMarkURL(label: "bat", logoUrl: "http://x.test/m.png")?.absoluteString, bat)
    }
}
