import XCTest

final class PhotoLoadUITests: XCTestCase {
    func testFailedPhotoStopsLoadingAndNewPhotoCanLoad() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor"]
        app.launchEnvironment = ["NUKE_DEBUG_SCREEN": "photo-load"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Photo unavailable"].waitForExistence(timeout: 20), app.debugDescription)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "photo-unavailable"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["Use working photo"].tap()
        XCTAssertTrue(app.images["nuke-photo-loaded"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Photo unavailable"].exists)
        app.buttons["Use unavailable photo"].tap()
        XCTAssertTrue(app.staticTexts["Photo unavailable"].waitForExistence(timeout: 20), app.debugDescription)
        XCTAssertFalse(app.images["nuke-photo-loaded"].exists)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }
}
