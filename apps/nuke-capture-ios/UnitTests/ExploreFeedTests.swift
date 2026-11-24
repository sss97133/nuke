// ExploreFeedTests.swift — the Explore feed merges the two reads fairly, drops photo-less rows,
// and never duplicates a card.

import XCTest
@testable import NukeCapture

final class ExploreFeedTests: XCTestCase {
    private func item(_ id: String, _ kind: ExploreFeedItem.Kind, image: String? = "https://x/y.jpg") -> ExploreFeedItem {
        ExploreFeedItem(id: id, kind: kind, title: id, image: image, amount: 1000, amountLabel: "Asking",
                        endsAt: nil, source: "S", location: nil, facts: nil, seen: nil, vehicleId: nil,
                        year: nil, make: nil, model: nil, link: nil)
    }

    func testInterleavesAlternatelyAndKeepsTheLongerTail() {
        let out = ExploreFeedItem.interleave(live: [item("l1", .live), item("l2", .live)],
                                             classified: [item("c1", .classified), item("c2", .classified), item("c3", .classified)])
        XCTAssertEqual(out.map(\.id), ["l1", "c1", "l2", "c2", "c3"])
    }

    func testDropsRowsWithoutPhotosAndDuplicates() {
        let out = ExploreFeedItem.interleave(live: [item("l1", .live, image: nil), item("d", .live)],
                                             classified: [item("c1", .classified, image: ""), item("d", .classified)])
        XCTAssertEqual(out.map(\.id), ["d"])
    }

    func testKnownSourcesUseTheHostedMarkAndOthersKeepTheTextPill() {
        func source(_ name: String) -> ExploreFeedItem {
            ExploreFeedItem(id: name, kind: .live, title: name, image: "https://x/y.jpg", amount: nil, amountLabel: "Current bid",
                            endsAt: nil, source: name, location: nil, facts: nil, seen: nil, vehicleId: nil,
                            year: nil, make: nil, model: nil, link: nil)
        }
        XCTAssertEqual(source("Bring a Trailer").sourceLogoURL?.absoluteString, "https://nuke.ag/source-logos/bat.png")
        XCTAssertEqual(source("Craigslist").sourceLogoURL?.absoluteString, "https://nuke.ag/source-logos/craigslist.png")
        XCTAssertNil(source("some_unmapped_source").sourceLogoURL)
    }

    func testEmptyReadsGiveAnEmptyFeed() {
        XCTAssertTrue(ExploreFeedItem.interleave(live: [], classified: []).isEmpty)
    }
    // MARK: Paging (the feed used to stop at 40 lots + 40 asks out of ~1,000 lots and ~1,600 asks)

    func testNextPageStartsNearTheEnd() {
        XCTAssertFalse(ExploreFeedPaging.shouldLoadMore(appeared: 0, count: 80))
        XCTAssertFalse(ExploreFeedPaging.shouldLoadMore(appeared: 73, count: 80))
        XCTAssertTrue(ExploreFeedPaging.shouldLoadMore(appeared: 74, count: 80))
        XCTAssertTrue(ExploreFeedPaging.shouldLoadMore(appeared: 0, count: 3))
        XCTAssertFalse(ExploreFeedPaging.shouldLoadMore(appeared: 0, count: 0))
    }

    func testAskBoardIsExhaustedOnlyWhenItReturnsLessThanAsked() {
        XCTAssertFalse(ExploreFeedPaging.exhausted(read: 40, asked: 40))
        XCTAssertTrue(ExploreFeedPaging.exhausted(read: 12, asked: 40))
        XCTAssertTrue(ExploreFeedPaging.exhausted(read: 0, asked: 40))
    }

    func testNextPageNeverRepeatsACardAndKeepsHiddenOnesOut() {
        var prefs = ExplorePreferences()
        prefs.hide("c2")
        let out = ExploreFeedPaging.nextCards(live: [item("l1", .live), item("l2", .live)],
                                              classified: [item("c1", .classified), item("c2", .classified)],
                                              existing: ["l1"], prefs: prefs)
        XCTAssertEqual(out.map(\.id), ["c1", "l2"])
    }

    func testEndLineSaysWhatTheFeedCovered() {
        XCTAssertTrue(ExploreFeedPaging.endLine(tuned: false).contains("last 72 hours"))
        XCTAssertTrue(ExploreFeedPaging.endLine(tuned: true).contains("tuning"))
    }

    // MARK: Clock

    func testCountdownReadsSecondsInTheLastHourAndClosingAtTheEnd() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(ExploreClock.text(ends: now.addingTimeInterval(2 * 86_400 + 4 * 3600 + 59), now: now), "2d 4h")
        XCTAssertEqual(ExploreClock.text(ends: now.addingTimeInterval(3 * 3600 + 12 * 60 + 30), now: now), "3h 12m")
        XCTAssertEqual(ExploreClock.text(ends: now.addingTimeInterval(12 * 60 + 7), now: now), "12:07")
        XCTAssertEqual(ExploreClock.text(ends: now.addingTimeInterval(59), now: now), "0:59")
        XCTAssertEqual(ExploreClock.text(ends: now, now: now), "Closing")
        XCTAssertEqual(ExploreClock.text(ends: now.addingTimeInterval(-30), now: now), "Closing")
        XCTAssertEqual(ExploreClock.tick(ends: now.addingTimeInterval(600), now: now), 1)
        XCTAssertEqual(ExploreClock.tick(ends: now.addingTimeInterval(7200), now: now), 30)
    }

    func testBoardIsReReadOnlyAroundALotsEnd() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        func lot(_ left: TimeInterval) -> ExploreFeedItem {
            ExploreFeedItem(id: "live:\(left)", kind: .live, title: "t", image: "https://x/y.jpg", amount: 1000,
                            amountLabel: "Current bid", endsAt: now.addingTimeInterval(left), source: "Bring a Trailer",
                            location: nil, facts: nil, seen: nil, vehicleId: nil, year: nil, make: nil, model: nil, link: nil)
        }
        XCTAssertFalse(ExploreClock.needsRefresh([lot(3600), item("c1", .classified)], now: now))
        XCTAssertTrue(ExploreClock.needsRefresh([lot(3600), lot(120)], now: now))
        XCTAssertTrue(ExploreClock.needsRefresh([lot(-60)], now: now))
        XCTAssertFalse(ExploreClock.needsRefresh([lot(-3600)], now: now))
    }

    func testServerClockReadsTheDateHeaderAndIgnoresSubSecondNoise() {
        let server = ServerClock.parse("Mon, 23 Nov 2026 23:53:34 GMT")
        XCTAssertNotNil(server)
        XCTAssertEqual(server?.timeIntervalSince1970, 1_795_478_014)
        let device = Date(timeIntervalSince1970: 1_795_478_000)
        XCTAssertEqual(ServerClock.measured(server: server!, device: device), 14)
        XCTAssertEqual(ServerClock.measured(server: device.addingTimeInterval(1), device: device), 0)
        XCTAssertNil(ServerClock.parse("not a date"))
    }
}
