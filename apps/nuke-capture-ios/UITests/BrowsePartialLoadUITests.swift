import XCTest

/// The fixture backend answers all requests locally; no listing or social action is written.
final class BrowsePartialLoadUITests: XCTestCase {
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

    func testClassifiedFailureKeepsAuctionAndRetryRestoresBoth() {
        let app = open("browse-partial-ask")
        XCTAssertTrue(app.staticTexts["Classified listings couldn't load."].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertEqual(app.staticTexts["browse-source-failure-detail"].label, "No network connection.")
        XCTAssertTrue(app.staticTexts["Fixture auction"].exists)
        let endLine = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "End of these results")).firstMatch
        XCTAssertFalse(endLine.exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "browse-partial-source"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["Retry Browse"].tap()
        XCTAssertTrue(app.staticTexts["Fixture classified"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Classified listings couldn't load."].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testAuctionFailureKeepsClassifiedAndRetryRestoresBoth() {
        let app = open("browse-partial-live")
        XCTAssertTrue(app.staticTexts["Auction listings couldn't load."].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Fixture classified"].exists)
        app.buttons["Retry Browse"].tap()
        XCTAssertTrue(app.staticTexts["Fixture auction"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Auction listings couldn't load."].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testEmptySuccessfulSourceDoesNotPretendTheFailedSourceIsEmpty() {
        let app = open("browse-partial-empty")
        XCTAssertTrue(app.staticTexts["Some cars couldn't load"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Auction listings couldn't load.")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts["No cars to show yet"].exists)
        app.buttons["Try again"].tap()
        XCTAssertTrue(app.staticTexts["Fixture auction"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testBothFailuresKeepTheExistingRetryState() {
        let app = open("browse-both-fail")
        XCTAssertTrue(app.staticTexts["We couldn't load cars"].waitForExistence(timeout: 20), app.debugDescription)
        app.buttons["Try again"].tap()
        XCTAssertTrue(app.staticTexts["Fixture auction"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testTuningDoesNotMislabelAFailedSourceAsNoMatches() {
        let app = open("browse-partial-empty-persistent")
        XCTAssertTrue(app.staticTexts["Some cars couldn't load"].waitForExistence(timeout: 20), app.debugDescription)
        app.buttons["Tune Browse"].tap()
        let toggle = app.switches["Limit model years"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10), app.debugDescription); toggle.tap()
        app.buttons["Apply"].tap()
        XCTAssertTrue(app.staticTexts["Some cars couldn't load"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Auction listings couldn't load.")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts["Nothing matches your tuning"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }
}
