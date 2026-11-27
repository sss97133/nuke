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
    func testEarlierReadingIsLabeledAndOpensItsPhoto() {
        let app = open("receipt-depth")
        XCTAssertTrue(app.staticTexts["Corrected gasket reading"].waitForExistence(timeout: 10))
        let context = app.buttons["Proposed work context"].firstMatch
        for _ in 0..<6 {
            if context.exists && context.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(context.exists && context.isHittable)
        context.tap()
        let earlier = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "photo context has since changed")).firstMatch
        for _ in 0..<8 {
            if earlier.exists && earlier.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(earlier.exists)
        let photo = app.buttons["View photo from earlier reading"]
        for _ in 0..<4 {
            if photo.exists && photo.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(photo.exists && photo.isHittable)
        photo.tap()
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5))
        app.buttons["Close"].tap()
        noWrites(app)
    }
    func testCurrentReadingOpensItsCitedPhoto() {
        let app = open("receipt-depth")
        XCTAssertTrue(app.staticTexts["Corrected gasket reading"].waitForExistence(timeout: 10))
        let context = app.buttons["Proposed work context"].firstMatch
        for _ in 0..<6 {
            if context.exists && context.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(context.exists && context.isHittable)
        context.tap()
        let photo = app.buttons["View photo cited by reading"]
        for _ in 0..<8 {
            if photo.exists && photo.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(photo.exists && photo.isHittable)
        photo.tap()
        XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 5))
        app.buttons["Close"].tap()
        noWrites(app)
    }
    func testCitedPhotoOpensItsOwnSession() {
        let app = open("receipt-depth")
        XCTAssertTrue(app.staticTexts["Corrected gasket reading"].waitForExistence(timeout: 10))
        let context = app.buttons["Proposed work context"].firstMatch
        for _ in 0..<6 {
            if context.exists && context.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(context.exists && context.isHittable)
        context.tap()
        let session = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Photo's linked session")).firstMatch
        for _ in 0..<8 {
            if session.exists && session.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(session.exists && session.isHittable)
        session.tap()
        XCTAssertTrue(app.staticTexts["Fixture photo session"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["2026-03-12"].exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "do not establish the part's installation date")).firstMatch.exists)
        noWrites(app)
    }
    func testWithdrawnCanonicalReceiptShowsUnavailableAndDoesNotSubstituteOldItems() {
        let app = open("receipt-withdrawn")
        XCTAssertTrue(app.staticTexts["Receipt detail unavailable"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Corrected gasket reading"].exists)
        XCTAssertTrue(app.buttons["Retry"].exists)
        noWrites(app)
        let back = app.navigationBars.buttons["Receipt sources"].firstMatch
        XCTAssertTrue(back.exists); back.tap()
        XCTAssertTrue(app.staticTexts["Source detail unavailable"].waitForExistence(timeout: 5))
    }
}
