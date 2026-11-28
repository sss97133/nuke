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
        XCTAssertTrue(app.navigationBars["Price details"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["No fresh projection for this lot"].exists, app.debugDescription)
        XCTAssertFalse(app.navigationBars["Why this range"].exists)
        XCTAssertFalse(app.staticTexts["A projection from comparable finished lots. It is not a guarantee."].exists)
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

    func testEmptyPartialFeedCanContinueLookingForClassifieds() {
        let app = open("browse-paging-live-failed-deep")
        XCTAssertTrue(app.staticTexts["Some cars couldn't load"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Auction listings couldn't load.")).firstMatch.exists)
        let more = app.buttons["Search more"]
        XCTAssertTrue(more.exists, app.debugDescription); more.tap()
        XCTAssertTrue(app.staticTexts["Fixture page 240"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Auction listings couldn't load."].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testEmptyPartialFeedCanRetryAFailedClassifiedPage() {
        let app = open("browse-paging-live-failed-more")
        XCTAssertTrue(app.staticTexts["Some cars couldn't load"].waitForExistence(timeout: 20), app.debugDescription)
        let retry = app.buttons["Retry more"]
        XCTAssertTrue(retry.exists, app.debugDescription); retry.tap()
        XCTAssertTrue(app.staticTexts["Fixture page 80"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testClosingRefreshKeepsMissingLotRecoverableAndRestoresIt() {
        let app = open("browse-closing-refresh")
        let closing = app.staticTexts["Fixture closing"]
        XCTAssertTrue(closing.waitForExistence(timeout: 20), app.debugDescription)
        let unavailable = app.staticTexts["Status unavailable"]
        XCTAssertTrue(unavailable.waitForExistence(timeout: 45), app.debugDescription)
        XCTAssertTrue(closing.exists, app.debugDescription)
        let recorded = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Bid on record")).firstMatch
        XCTAssertTrue(recorded.exists, app.debugDescription)
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Bid on record")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Fixture extended"].exists, app.debugDescription)
        XCTAssertTrue(unavailable.waitForNonExistence(timeout: 35), app.debugDescription)
        XCTAssertTrue(closing.exists, app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testClockDoesNotClaimClosureAtTheRecordedEnd() {
        let app = open("browse-closing-refresh")
        let clock = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Time left")).firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 20), app.debugDescription); clock.tap()
        XCTAssertTrue(app.navigationBars["Auction clock"].waitForExistence(timeout: 10), app.debugDescription)
        let closing = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ AND label CONTAINS[c] %@", "remaining", "closing")).firstMatch
        XCTAssertTrue(closing.waitForExistence(timeout: 25), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testOpenClockReflectsAnExtendedAuction() {
        let app = open("browse-clock-extended")
        let clock = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Time left")).firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 20), app.debugDescription); clock.tap()
        XCTAssertTrue(app.navigationBars["Auction clock"].waitForExistence(timeout: 10), app.debugDescription)
        let closing = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ AND label CONTAINS[c] %@", "remaining", "closing")).firstMatch
        XCTAssertTrue(closing.waitForExistence(timeout: 25), app.debugDescription)
        let resumed = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ AND label CONTAINS %@", "remaining", "1m")).firstMatch
        XCTAssertTrue(resumed.waitForExistence(timeout: 35), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testOpenClockRecoversAfterMissingBoardThenExtension() {
        let app = open("browse-clock-missing-then-extended")
        let clock = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Time left")).firstMatch
        XCTAssertTrue(clock.waitForExistence(timeout: 20), app.debugDescription); clock.tap()
        XCTAssertTrue(app.navigationBars["Auction clock"].waitForExistence(timeout: 10), app.debugDescription)
        let unavailable = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "status unavailable")).firstMatch
        XCTAssertTrue(unavailable.waitForExistence(timeout: 40), app.debugDescription)
        let resumed = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@ AND label CONTAINS %@", "remaining", "1m")).firstMatch
        XCTAssertTrue(resumed.waitForExistence(timeout: 35), app.debugDescription)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }
}
