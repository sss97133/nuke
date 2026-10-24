import XCTest
@testable import NukeCapture

@MainActor
final class LiveHeroTests: XCTestCase {
    func testBaTHeroAsksForAFullWidthImage() {
        let raw = "https://bringatrailer.com/wp-content/uploads/2026/10/a.jpg?w=470&h=318&crop=1"
        XCTAssertEqual(LiveBoardView.heroURL(raw)?.absoluteString,
                       "https://bringatrailer.com/wp-content/uploads/2026/10/a.jpg?w=1080")
        XCTAssertNil(LiveBoardView.heroURL(nil))
    }

    func testHeatVerdictStaysHidden() {
        XCTAssertFalse(LiveBoardView.showsHeatVerdict)
    }
}
