import XCTest

/// Exercises the real Browse screen against deterministic, read-only local fixtures.
final class BrowsePagingUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }

    private func open(_ scenario: String, analogs: String = "") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor",
                               "-explore.tuning.v1", "reset", "-explore.preferences.v1", "reset",
                               "-explore.signals.upload", "NO"]
        app.launchEnvironment = ["NUKE_DEBUG_SCREEN": "explore", "NUKE_FIXTURE_SCENARIO": scenario,
                                 "NUKE_FIXTURE_ANALOGS": analogs]
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

    func testComparableReadFailureIsRetryableAndNotReportedAsNoRecords() {
        let app = open("social-browse", analogs: "failure")
        let price = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Current bid")).firstMatch
        XCTAssertTrue(price.waitForExistence(timeout: 20), app.debugDescription); price.tap()
        XCTAssertTrue(app.staticTexts["Couldn't load comparable lots."].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.staticTexts["comparable-read-failure"].label, "No network connection.")
        XCTAssertFalse(app.staticTexts["No comparable lots were returned for this one."].exists)
        let retry = app.buttons["Retry comparable lots"]
        for _ in 0..<3 where !retry.isHittable { app.swipeUp() }
        XCTAssertTrue(retry.isHittable, app.debugDescription); retry.tap()
        XCTAssertTrue(app.staticTexts["No comparable lots were returned for this one."].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testBrowseSearchesPastPagesWithoutDisplayableCars() {
        let app = open("browse-paging-empty")
        XCTAssertTrue(app.staticTexts["Fixture page 80"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(app.staticTexts["No cars to show yet"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testSparseResultsOfferAnotherBoundedSearch() {
        let app = open("browse-paging-deep")
        XCTAssertTrue(app.staticTexts["More listings to check"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(app.staticTexts["No cars to show yet"].exists)
        app.buttons["Search more"].tap()
        XCTAssertTrue(app.staticTexts["Fixture page 240"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testExistingCardsOfferAnotherBoundedSearch() {
        let app = open("browse-paging-deep-visible")
        XCTAssertTrue(app.staticTexts["Fixture page 0"].waitForExistence(timeout: 20), app.debugDescription)
        let more = app.buttons["Search more"]
        for _ in 0..<4 where !more.isHittable { app.swipeUp() }
        XCTAssertTrue(more.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(more.isHittable, app.debugDescription); more.tap()
        XCTAssertTrue(app.staticTexts["Fixture page 240"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testEmptyFeedCanRetryAFailedLaterPage() {
        let app = open("browse-paging-fail-more")
        XCTAssertTrue(app.staticTexts["Couldn't load more cars"].waitForExistence(timeout: 20), app.debugDescription)
        app.buttons["Try again"].tap()
        XCTAssertTrue(app.staticTexts["Fixture page 80"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testCachedAuctionsContinueWhenClassifiedPageFails() {
        let app = open("browse-paging-auction-failure")
        XCTAssertTrue(app.staticTexts["Fixture auction 0"].waitForExistence(timeout: 20), app.debugDescription)
        let later = app.staticTexts["Fixture auction 40"]
        for _ in 0..<4 where !later.exists { app.swipeUp() }
        XCTAssertTrue(later.waitForExistence(timeout: 15), app.debugDescription)
        let retry = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Couldn't load more classified listings")).firstMatch
        for _ in 0..<3 where !retry.exists { app.swipeUp() }
        XCTAssertTrue(retry.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }
}
