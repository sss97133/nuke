import XCTest

final class AllocationEvidenceUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func open(withheld: Bool = false, legacyWithheld: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": legacyWithheld ? "financial-evidence-withheld" : "financial-qualification",
                                 "NUKE_DEBUG_VEHICLE_ID": "00000000-0000-4000-8000-00000000c001",
                                 "NUKE_FIXTURE_ALLOCATION_SOURCE_WITHHELD": withheld ? "1" : "0"]
        app.launch()
        XCTAssertTrue(app.staticTexts["1973 FIXTURE COUPE"].firstMatch.waitForExistence(timeout: 15))
        let door = app.buttons["vehicle-book-allocations"]
        for _ in 0..<22 {
            if door.exists && door.isHittable { break }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65)).press(forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)))
        }
        XCTAssertTrue(door.exists && door.isHittable); door.tap()
        let record = app.buttons["allocation-record-00000000-0000-4000-8000-00000000a201-1"]
        XCTAssertTrue(record.waitForExistence(timeout: 10)); record.tap()
        XCTAssertTrue(app.staticTexts["9007199254740993.000001 USD"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["Current bank source"].tap()
        return app
    }
    private func noWrites(_ app: XCUIApplication) {
        let log = app.descendants(matching: .any)["fixture.writes"]
        XCTAssertTrue(log.waitForExistence(timeout: 5)); XCTAssertEqual(log.label, "no writes")
    }
    func testAllocationOpensExactRevisedBankSourceUsingItsOwnUnit() {
        let app = open()
        XCTAssertTrue(app.staticTexts["42.123456 EUR"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["42.123456 USD"].exists)
        XCTAssertFalse(app.staticTexts["9007199254740993.000001 USD"].exists)
        XCTAssertFalse(app.staticTexts["allocation-source-reference"].exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "allocation-current-bank-source"; image.lifetime = .keepAlways; add(image)
        app.buttons["Record references"].tap()
        XCTAssertTrue(app.staticTexts["allocation-source-reference"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Identifiers only; these references do not open source files."].exists)
        noWrites(app)
    }
    func testWithheldExactSourceNeverSubstitutesAllocationOrLegacyEvidence() {
        let app = open(withheld: true)
        XCTAssertTrue(app.staticTexts["Allocation detail unavailable"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["42.123456 EUR"].exists)
        XCTAssertFalse(app.staticTexts["9007199254740993.000001 USD"].exists)
        app.navigationBars.buttons["Allocation record"].firstMatch.tap()
        // Returning revalidates the canonical allocation independently. Its current
        // attributed amount may still be readable when the separate source is withheld.
        XCTAssertTrue(app.staticTexts["9007199254740993.000001 USD"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["42.123456 EUR"].exists)
        noWrites(app)
    }
    func testCanonicalEntryWorksWhenLegacyAuditAndOwnerFlagAreWithheld() {
        let app = open(legacyWithheld: true)
        XCTAssertTrue(app.staticTexts["42.123456 EUR"].firstMatch.waitForExistence(timeout: 10))
        noWrites(app)
    }
}
