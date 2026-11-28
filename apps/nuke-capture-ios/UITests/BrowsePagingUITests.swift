import XCTest

/// Exercises the real Browse screen against deterministic, read-only local fixtures.
final class BrowsePagingUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }

    private func open(_ scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor",
                               "-explore.tuning.v1", "reset", "-explore.preferences.v1", "reset",
                               "-explore.signals.upload", "NO"]
        app.launchEnvironment = ["NUKE_DEBUG_SCREEN": "explore", "NUKE_FIXTURE_SCENARIO": scenario]
        app.launch()
        return app
    }

    func testBrowseContinuesBeyondEightyReturnedListings() {
        let app = open("browse-paging")
        XCTAssertTrue(app.staticTexts["Fixture page 0"].waitForExistence(timeout: 20), app.debugDescription)
        let later = app.staticTexts["Fixture page 80"]
        for _ in 0..<4 where !later.exists { app.swipeUp() }
        XCTAssertTrue(later.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertLessThanOrEqual(app.staticTexts.matching(identifier: "Fixture page 0").count, 1)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testAuctionPriceOpensItsEvidenceAndReturns() {
        let app = open("social-browse")
        let price = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Current bid")).firstMatch
        XCTAssertTrue(price.waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(price.isHittable); price.tap()
        XCTAssertTrue(app.navigationBars["Why this range"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Fixture Coupe"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }
}
