import XCTest

final class ReceiptEvidenceUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func open(_ scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": scenario,
            "NUKE_DEBUG_VEHICLE_ID": "00000000-0000-4000-8000-00000000c001"]
        app.launch()
        XCTAssertTrue(app.staticTexts["1973 FIXTURE COUPE"].firstMatch.waitForExistence(timeout: 15))
        let parts = app.descendants(matching: .any).matching(identifier: "investment-parts").firstMatch
        for _ in 0..<16 {
            if parts.exists && parts.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(parts.exists && parts.isHittable)
        parts.tap()
        let source = app.buttons.matching(identifier: "receipt-source-00000000-0000-4000-8000-00000000a001").firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 5))
        source.tap()
        return app
    }
    private func noWrites(_ app: XCUIApplication) {
        let log = app.descendants(matching: .any)["fixture.writes"]
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        XCTAssertEqual(log.label, "no writes", "A source drill must issue no testimony, payment, or confirmation write: \(log.label)")
    }
    func testPartsAuditOpensCanonicalReceiptLinesWithoutAnotherTotalPanel() {
        let app = open("receipt-depth")
        XCTAssertTrue(app.staticTexts["Corrected gasket reading"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Recorded zero charge"].exists)
        XCTAssertFalse(app.staticTexts["Fixture Parts Shop"].exists, "The detail adds line evidence instead of repeating the audit summary")
        let lines = XCTAttachment(screenshot: app.screenshot()); lines.name = "receipt-current-lines"; lines.lifetime = .keepAlways; add(lines)
        for _ in 0..<3 { app.swipeUp() }
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "do not establish payment")).firstMatch.exists)
        noWrites(app)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.lifetime = .keepAlways; add(screenshot)
    }
    func testWithdrawnCanonicalReceiptShowsUnavailableAndDoesNotSubstituteOldItems() {
        let app = open("receipt-withdrawn")
        XCTAssertTrue(app.staticTexts["Receipt detail unavailable"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Corrected gasket reading"].exists)
        XCTAssertTrue(app.buttons["Retry"].exists)
        noWrites(app)
        let back = app.navigationBars.buttons["Parts"].firstMatch
        XCTAssertTrue(back.exists); back.tap()
        XCTAssertTrue(app.staticTexts["Source detail unavailable"].waitForExistence(timeout: 5))
    }
}
