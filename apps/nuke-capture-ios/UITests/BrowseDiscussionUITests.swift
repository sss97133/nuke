import XCTest

/// All requests and writes in these tests stay in the in-process fixture backend.
final class BrowseDiscussionUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(persona: String = "visitor", native: String = "", source: String = "", post: String = "") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", persona]
        app.launchEnvironment = ["NUKE_DEBUG_SCREEN": "explore", "NUKE_FIXTURE_SCENARIO": "social-browse",
                                 "NUKE_FIXTURE_DISCUSSION_NATIVE": native, "NUKE_FIXTURE_DISCUSSION_SOURCE": source,
                                 "NUKE_FIXTURE_DISCUSSION_POST": post]
        app.launch()
        let comments = app.buttons["Comments"].firstMatch
        XCTAssertTrue(comments.waitForExistence(timeout: 20))
        for _ in 0..<4 where !comments.isHittable { app.swipeUp() }
        XCTAssertTrue(comments.isHittable); comments.tap()
        XCTAssertTrue(app.navigationBars["Discussion"].waitForExistence(timeout: 10))
        return app
    }

    func testFeedOpensExactListingDiscussionAndReturns() {
        let app = open()
        let row = app.buttons["listing-discussion-00000000-0000-4000-8000-00000000b101"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Must never be shown."].exists)
        XCTAssertFalse(app.staticTexts["Duplicate event must never be shown."].exists)
        row.tap()
        XCTAssertTrue(app.staticTexts["The original wheels are included."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.links["Open the Bring a Trailer listing"].exists)
        app.navigationBars.buttons["Discussion"].tap()
        app.segmentedControls.buttons["Nuke"].tap()
        XCTAssertTrue(app.staticTexts["A real Nuke fixture comment."].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["Comments"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testFailedReadsAreNotPresentedAsEmptyThreads() {
        let app = open(native: "failure", source: "failure")
        XCTAssertTrue(app.staticTexts["Couldn't load the listing discussion."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Retry listing discussion"].exists)
        app.segmentedControls.buttons["Nuke"].tap()
        XCTAssertTrue(app.staticTexts["Couldn't load Nuke comments."].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["No Nuke comments yet."].exists)
        XCTAssertFalse(app.staticTexts["No matching listing entries were returned."].exists)
        XCTAssertTrue(app.buttons["Retry Nuke comments"].exists)
    }

    func testARefusedPostKeepsTheDraft() {
        let app = open(persona: "client", native: "empty", post: "refused")
        app.segmentedControls.buttons["Nuke"].tap()
        XCTAssertTrue(app.staticTexts["No Nuke comments yet."].waitForExistence(timeout: 10))
        let field = app.textFields["discussion-composer"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("My fixture thought")
        app.buttons["Post Nuke comment"].tap()
        XCTAssertTrue(app.staticTexts["Nuke didn't accept that comment. Your draft is still here."].waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "My fixture thought")
        XCTAssertFalse(app.staticTexts["Posted to Nuke."].exists)
    }

    func testAcknowledgedPostClearsDraft() {
        let app = open(persona: "client", native: "empty")
        let field = app.textFields["discussion-composer"]
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText("Another fixture thought")
        app.buttons["Post Nuke comment"].tap()
        XCTAssertTrue(app.staticTexts["Posted to Nuke."].waitForExistence(timeout: 10))
        XCTAssertNotEqual(field.value as? String, "Another fixture thought")
    }

    func testMissingReceiptKeepsDraftAndDoesNotClaimSuccess() {
        let app = open(persona: "client", native: "empty", post: "uncertain")
        let field = app.textFields["discussion-composer"]
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText("Check this fixture thought")
        app.buttons["Post Nuke comment"].tap()
        XCTAssertTrue(app.staticTexts["We couldn't confirm the comment was posted. Check the discussion before retrying; your draft is still here."].waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "Check this fixture thought")
        XCTAssertFalse(app.staticTexts["Posted to Nuke."].exists)
    }

    func testClosingAndReopeningKeepsTheUnsentDraft() {
        let app = open(persona: "client", native: "empty")
        let field = app.textFields["discussion-composer"]
        XCTAssertTrue(field.waitForExistence(timeout: 10)); field.tap(); field.typeText("An unfinished fixture thought")
        app.buttons["Done"].tap()
        let comments = app.buttons["Comments"].firstMatch
        XCTAssertTrue(comments.waitForExistence(timeout: 5)); comments.tap()
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        XCTAssertEqual(field.value as? String, "An unfinished fixture thought")
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }
}
