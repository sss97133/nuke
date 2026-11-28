import XCTest

/// The backend is entirely in-process; these tests do not follow a real vehicle.
final class BrowseFollowUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func open(initial: String = "", read: String = "", write: String = "", switchAccount: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client"]
        app.launchEnvironment = ["NUKE_DEBUG_SCREEN": "explore", "NUKE_FIXTURE_SCENARIO": "social-follow",
                                 "NUKE_FIXTURE_FOLLOW_INITIAL": initial, "NUKE_FIXTURE_FOLLOW_READ": read,
                                 "NUKE_FIXTURE_FOLLOW_WRITE": write, "NUKE_FIXTURE_SWITCH_ACCOUNT": switchAccount ? "1" : "0"]
        app.launch()
        let follow = app.buttons["Follow"].firstMatch
        XCTAssertTrue(follow.waitForExistence(timeout: 20))
        for _ in 0..<4 where !follow.isHittable { app.swipeUp() }
        XCTAssertTrue(follow.isHittable)
        return app
    }

    private func log(_ app: XCUIApplication) -> String { app.descendants(matching: .any)["fixture.writes"].label }

    func testFailedReadNeverTogglesAndRetryOnlyChecks() {
        let app = open(read: "failure")
        app.buttons["Follow"].firstMatch.tap()
        let check = app.buttons["Check follow"].firstMatch
        XCTAssertTrue(check.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Couldn't check follow status. Tap Check follow to try again."].exists)
        XCTAssertEqual(log(app), "no writes")
        check.tap()
        XCTAssertTrue(app.staticTexts["Couldn't check follow status. Tap Check follow to try again."].waitForExistence(timeout: 10))
        XCTAssertEqual(log(app), "no writes")
    }

    func testAnExistingFollowIsShownBeforeThePersonCanUnfollow() {
        let app = open(initial: "following")
        app.buttons["Follow"].firstMatch.tap()
        let following = app.buttons["Following"].firstMatch
        XCTAssertTrue(following.waitForExistence(timeout: 10))
        XCTAssertEqual(log(app), "no writes")
        following.tap()
        XCTAssertTrue(app.buttons["Follow"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(log(app).components(separatedBy: "\n").count, 1)
        XCTAssertTrue(log(app).contains("record_interaction"))
    }

    func testUnconfirmedToggleRequiresAReadOnlyCheck() {
        let app = open(write: "uncertain")
        app.buttons["Follow"].firstMatch.tap()
        let check = app.buttons["Check follow"].firstMatch
        XCTAssertTrue(check.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Couldn't confirm the follow change. Tap Check follow to see its current status."].exists)
        let before = log(app)
        XCTAssertTrue(before.contains("record_interaction"))
        check.tap()
        XCTAssertTrue(app.buttons["Following"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(log(app), before)
    }

    func testRefusedToggleDoesNotClaimSuccess() {
        let app = open(write: "refused")
        app.buttons["Follow"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Nuke didn't change follow. Try again."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Follow"].firstMatch.exists)
        XCTAssertFalse(app.buttons["Following"].exists)
        XCTAssertTrue(log(app).contains("record_interaction"))
    }

    func testAccountSwitchDropsThePreviousFollowState() {
        let app = open(initial: "following", switchAccount: true)
        app.buttons["Follow"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Following"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(log(app), "no writes")
        app.buttons["fixture.switch-account"].tap()
        let follow = app.buttons["Follow"].firstMatch
        XCTAssertTrue(follow.waitForExistence(timeout: 10))
        follow.tap()
        XCTAssertTrue(app.buttons["Following"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(log(app).contains("record_interaction"))
    }
}
