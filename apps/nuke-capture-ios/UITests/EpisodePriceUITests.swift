import XCTest

final class EpisodePriceUITests: XCTestCase {
    private func open(_ mode: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor",
                               "-explore.tuning.v1", "reset", "-explore.preferences.v1", "reset",
                               "-explore.signals.upload", "NO"]
        app.launchEnvironment = ["NUKE_DEBUG_SCREEN": "explore", "NUKE_FIXTURE_SCENARIO": "social-browse",
                                 "NUKE_FIXTURE_EPISODE": mode]
        app.launch()
        let price = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Current bid")).firstMatch
        XCTAssertTrue(price.waitForExistence(timeout: 20), app.debugDescription); price.tap()
        XCTAssertTrue(app.navigationBars["Price details"].waitForExistence(timeout: 10), app.debugDescription)
        return app
    }

    func testExactEpisodeShowsProjectionAndComparable() {
        let app = open("present")
        XCTAssertTrue(app.staticTexts["$7,200"].waitForExistence(timeout: 15), app.debugDescription)
        let comparable = app.staticTexts["Fixture comparable"]
        for _ in 0..<4 where !comparable.isHittable { app.swipeUp() }
        XCTAssertTrue(comparable.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.staticTexts["No fresh projection was returned for this lot"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testOtherListingCannotAppearAsThisProjection() {
        let app = open("mismatch")
        XCTAssertTrue(app.staticTexts["Couldn't load price context."].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["$7,200"].exists)
        XCTAssertFalse(app.staticTexts["Fixture comparable"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testEpisodeReadFailureCanRetry() {
        let app = open("failure")
        XCTAssertTrue(app.staticTexts["Couldn't load price context."].waitForExistence(timeout: 15), app.debugDescription)
        let retry = app.buttons["Retry price context"]
        for _ in 0..<3 where !retry.isHittable { app.swipeUp() }
        XCTAssertTrue(retry.isHittable, app.debugDescription); retry.tap()
        XCTAssertTrue(app.staticTexts["$7,200"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testNoExactEpisodeDoesNotShowVehicleOnlyComparables() {
        let app = open("empty-legacy-leak")
        XCTAssertTrue(app.staticTexts["No comparable lots were returned for this one."].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Wrong auction comparable"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testOpenPriceSheetWithholdsAndRecoversEpisodeAfterBoardGap() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor", "-explore.signals.upload", "NO"]
        app.launchEnvironment = ["NUKE_DEBUG_SCREEN": "explore", "NUKE_FIXTURE_SCENARIO": "browse-episode-gap"]
        app.launch()
        let price = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Current bid")).firstMatch
        XCTAssertTrue(price.waitForExistence(timeout: 20), app.debugDescription); price.tap()
        let projection = app.staticTexts["$7,200"]
        XCTAssertTrue(projection.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Auction status unavailable"].waitForExistence(timeout: 40), app.debugDescription)
        XCTAssertFalse(projection.exists)
        XCTAssertTrue(projection.waitForExistence(timeout: 35), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }
}
