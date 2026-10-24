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

    func testEmptyReadsGiveAnEmptyFeed() {
        XCTAssertTrue(ExploreFeedItem.interleave(live: [], classified: []).isEmpty)
    }
}
