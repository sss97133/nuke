import XCTest
@testable import NukeCapture

final class TreemapCleanTests: XCTestCase {
    private func node(_ name: String, _ n: Int) -> TreemapNode {
        TreemapNode(name: name, count: n, value: n, median_price: nil, sold_count: nil,
                    avg_year: nil, image_url: nil, sell_through: nil)
    }

    func testUnresolvedIsCountedNotDrawnAndCaseDuplicatesMerge() {
        let (nodes, unresolved) = MarketTreemapView.clean([
            node("Unresolved", 500), node("Red", 30), node("red", 1), node("Black", 20), node(" ", 4)])
        XCTAssertEqual(unresolved, 504)
        XCTAssertEqual(nodes.map(\.name), ["Red", "Black"])
        XCTAssertEqual(nodes.first?.count, 31)
    }
}
