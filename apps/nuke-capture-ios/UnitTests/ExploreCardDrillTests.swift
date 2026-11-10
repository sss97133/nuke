// ExploreCardDrillTests.swift — the words the Explore card's three doors put in their sheets:
// the absolute close in the reader's zone, time left to the second, the auction's length,
// the listing's host, and what VoiceOver says for each door.

import XCTest
@testable import NukeCapture

final class ExploreCardDrillTests: XCTestCase {
    private func item(kind: ExploreFeedItem.Kind = .live, amount: Double? = 45_000, endsAt: Date? = nil,
                      link: URL? = nil, listedAt: Date? = nil) -> ExploreFeedItem {
        ExploreFeedItem(id: "live:1", kind: kind, title: "1967 Chevrolet C10", image: "https://x/y.jpg", amount: amount,
                        amountLabel: "Current bid", endsAt: endsAt, source: "Bring a Trailer", location: nil, facts: nil,
                        seen: nil, vehicleId: nil, year: 1967, make: "Chevrolet", model: "C10", link: link, listedAt: listedAt)
    }

    func testPreciseRemainingCountsDownToTheSecondAndSaysClosedAfter() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let day: TimeInterval = 86_400, hour: TimeInterval = 3600, minute: TimeInterval = 60
        let twoDays: TimeInterval = 2 * day + 3 * hour + 4 * minute + 5
        let threeHours: TimeInterval = 3 * hour + 4 * minute + 5
        let fourMinutes: TimeInterval = 4 * minute + 5
        XCTAssertEqual(ExploreCardDrill.preciseRemaining(now.addingTimeInterval(twoDays), now: now), "2d 03h 04m 05s")
        XCTAssertEqual(ExploreCardDrill.preciseRemaining(now.addingTimeInterval(threeHours), now: now), "3h 04m 05s")
        XCTAssertEqual(ExploreCardDrill.preciseRemaining(now.addingTimeInterval(fourMinutes), now: now), "4m 05s")
        XCTAssertEqual(ExploreCardDrill.preciseRemaining(now.addingTimeInterval(9), now: now), "0m 09s")
        XCTAssertEqual(ExploreCardDrill.preciseRemaining(now, now: now), "closed")
        XCTAssertEqual(ExploreCardDrill.preciseRemaining(now.addingTimeInterval(-60), now: now), "closed")
    }

    func testRunLengthNeedsBothEndsInOrder() {
        let listed = Date(timeIntervalSince1970: 0)
        let week: TimeInterval = 604_800, dayAndHour: TimeInterval = 90_000, fiveHours: TimeInterval = 18_000
        XCTAssertEqual(ExploreCardDrill.runLength(listed: listed, ends: listed.addingTimeInterval(week)), "7 days")
        XCTAssertEqual(ExploreCardDrill.runLength(listed: listed, ends: listed.addingTimeInterval(dayAndHour)), "1 day 1 hour")
        XCTAssertEqual(ExploreCardDrill.runLength(listed: listed, ends: listed.addingTimeInterval(fiveHours)), "5 hours")
        XCTAssertNil(ExploreCardDrill.runLength(listed: nil, ends: listed))
        XCTAssertNil(ExploreCardDrill.runLength(listed: listed, ends: nil))
        XCTAssertNil(ExploreCardDrill.runLength(listed: listed.addingTimeInterval(10), ends: listed))
    }

    func testAbsoluteCloseIsInTheGivenZone() {
        // 2026-11-10T19:45:00Z is 2:45 PM in New York (EST).
        let date = Date(timeIntervalSince1970: 1_794_339_900)
        let s = ExploreCardDrill.absolute(date, timeZone: TimeZone(identifier: "America/New_York")!,
                                          locale: Locale(identifier: "en_US"))
        XCTAssertTrue(s.contains("Nov 10"), s)
        XCTAssertTrue(s.contains("2026"), s)
        XCTAssertTrue(s.contains("2:45"), s)
        XCTAssertTrue(s.contains("PM"), s)
        XCTAssertTrue(s.contains("EST"), s)
    }

    func testHostDropsWwwAndNeedsALink() {
        XCTAssertEqual(ExploreCardDrill.host(URL(string: "https://www.BringATrailer.com/listing/x/")), "bringatrailer.com")
        XCTAssertEqual(ExploreCardDrill.host(URL(string: "https://sfbay.craigslist.org/a")), "sfbay.craigslist.org")
        XCTAssertNil(ExploreCardDrill.host(nil))
    }

    func testEachDoorHasItsOwnIdentityAndVoiceOverLabel() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let threeHoursFour: TimeInterval = 11_040
        let it = item(endsAt: now.addingTimeInterval(threeHoursFour))
        let ids = Set([ExploreCardDrill.Kind.source, .clock, .bid].map { ExploreCardDrill(kind: $0, item: it).id })
        XCTAssertEqual(ids.count, 3)
        XCTAssertEqual(ExploreCardDrill.accessibilityLabel(.source, item: it, now: now), "Source, Bring a Trailer")
        XCTAssertEqual(ExploreCardDrill.accessibilityLabel(.clock, item: it, now: now), "Time left, 3h 4m left")
        XCTAssertEqual(ExploreCardDrill.accessibilityLabel(.bid, item: it, now: now), "Current bid, $45,000")
        XCTAssertEqual(ExploreCardDrill.accessibilityLabel(.clock, item: item(), now: now), "Time left, close time unknown")
    }

    func testLiveItemCarriesItsListingTimeAndClassifiedsDoNot() {
        let listed = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(item(listedAt: listed).listedAt, listed)
        XCTAssertNil(item(kind: .classified).listedAt)
    }
}
