import XCTest

final class LaborPhotoEvidenceUITests: XCTestCase {
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        for _ in 0..<18 {
            if element.exists && element.isHittable { return true }
            app.swipeUp()
        }
        return element.exists && element.isHittable
    }

    func testReassemblyPhotoUsesVehicleGateAndHandlesWithdrawal() {
        for mode in ["available", "withdrawn", "account_changed", "superseded_before_open", "superseded_on_return"] {
            let app = XCUIApplication()
            app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
            app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "navigation-garage", "NUKE_FIXTURE_LABOR_STATE": "photos",
                                     "NUKE_FIXTURE_LABOR_PHOTO": mode,
                                     "NUKE_FIXTURE_SUPERSEDE_LABOR": mode.hasPrefix("superseded") ? "1" : "0",
                                     "NUKE_FIXTURE_SWITCH_ACCOUNT": mode == "account_changed" ? "1" : "0",
                                     "NUKE_DEBUG_VEHICLE_ID": "00000000-0000-4000-8000-00000000c001"]
            app.launch()
            let segment = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "reassembly")).firstMatch
            XCTAssertTrue(segment.waitForExistence(timeout: 20))
            guard reveal(segment, in: app) else { XCTFail("Reassembly is not reachable"); return }
            segment.tap()
            let photos = app.buttons["labor-photos-reassembly"].firstMatch
            guard reveal(photos, in: app) else { XCTFail("Photo links are not reachable"); return }
            photos.tap()
            XCTAssertTrue(app.navigationBars["Photo links"].waitForExistence(timeout: 15))
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "does not confirm installation")).firstMatch.waitForExistence(timeout: 15))
            let carpet = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Fixture carpet")).firstMatch
            XCTAssertTrue(carpet.waitForExistence(timeout: 10))
            if mode == "superseded_before_open" { app.buttons["fixture.supersede-labor"].tap() }
            carpet.tap()
            if mode == "account_changed" {
                XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15), app.debugDescription)
                let switchAccount = app.buttons["fixture.switch-account"]
                XCTAssertTrue(switchAccount.waitForExistence(timeout: 5)); switchAccount.tap()
                let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "00000000-0000-4000-8000-0000000000d3"), object: switchAccount)
                XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed)
                let refused = app.staticTexts["Your account changed. Return to the vehicle and reopen the photo links."]
                XCTAssertTrue(refused.waitForExistence(timeout: 5), app.debugDescription)
                XCTAssertFalse(app.buttons["Close"].exists, "A prior account's photo must not remain visible")
            } else if mode == "superseded_on_return" {
                XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15), app.debugDescription)
                app.buttons["fixture.supersede-labor"].tap()
                XCUIDevice.shared.press(.home)
                app.activate()
                XCTAssertTrue(app.staticTexts["Photo unavailable"].waitForExistence(timeout: 15), app.debugDescription)
                XCTAssertFalse(app.buttons["Close"].exists, "A superseded association must not remain visible")
                app.navigationBars["Photo source"].buttons.firstMatch.tap()
            } else if mode == "available" {
                XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15), app.debugDescription)
                XCUIDevice.shared.press(.home)
                app.activate()
                XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15), app.debugDescription)
                app.buttons["Close"].tap()
            } else {
                XCTAssertTrue(app.staticTexts["Photo unavailable"].waitForExistence(timeout: 15), app.debugDescription)
                app.navigationBars["Photo source"].buttons.firstMatch.tap()
            }
            if mode != "account_changed" { XCTAssertTrue(app.navigationBars["Photo links"].waitForExistence(timeout: 5)) }
            XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
            app.terminate()
        }
    }

    func testWorkLaborPhotoSurvivesReturnAndRechecksAccess() {
        for mode in ["available", "superseded_on_return", "account_changed"] {
            let app = XCUIApplication()
            app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
            app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "navigation-garage", "NUKE_FIXTURE_LABOR_STATE": "photos",
                                     "NUKE_FIXTURE_LABOR_PHOTO": mode,
                                     "NUKE_FIXTURE_SUPERSEDE_LABOR": mode == "superseded_on_return" ? "1" : "0",
                                     "NUKE_FIXTURE_SWITCH_ACCOUNT": mode == "account_changed" ? "1" : "0",
                                     "NUKE_DEBUG_VEHICLE_ID": "00000000-0000-4000-8000-00000000c001"]
            app.launch()
            let shortcut = app.buttons["vehicle.work-labor"].firstMatch
            XCTAssertTrue(shortcut.waitForExistence(timeout: 20), app.debugDescription)
            guard reveal(shortcut, in: app) else { XCTFail("Work & labor is not reachable"); return }
            shortcut.tap()
            XCTAssertTrue(app.navigationBars["Work & labor"].waitForExistence(timeout: 10), app.debugDescription)
            let segment = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "reassembly")).firstMatch
            guard reveal(segment, in: app) else { XCTFail("Reassembly is not reachable"); return }
            segment.tap()
            let photos = app.buttons["labor-photos-reassembly"].firstMatch
            guard reveal(photos, in: app) else { XCTFail("Photo links are not reachable"); return }
            photos.tap()
            let carpet = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Fixture carpet")).firstMatch
            XCTAssertTrue(carpet.waitForExistence(timeout: 15), app.debugDescription); carpet.tap()
            XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15), app.debugDescription)
            if mode == "account_changed" {
                let switchAccount = app.buttons["fixture.switch-account"]
                XCTAssertTrue(switchAccount.waitForExistence(timeout: 5)); switchAccount.tap()
                let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "00000000-0000-4000-8000-0000000000d3"), object: switchAccount)
                XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed)
                XCTAssertTrue(app.staticTexts["Your account changed. Return to the vehicle and reopen the photo links."].waitForExistence(timeout: 10), app.debugDescription)
                XCTAssertFalse(app.buttons["Close"].exists)
            } else {
                if mode == "superseded_on_return" { app.buttons["fixture.supersede-labor"].tap() }
                XCUIDevice.shared.press(.home)
                app.activate()
                if mode == "available" {
                    XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 15), app.debugDescription)
                    app.buttons["Close"].tap()
                } else {
                    XCTAssertTrue(app.staticTexts["Photo unavailable"].waitForExistence(timeout: 15), app.debugDescription)
                    XCTAssertFalse(app.buttons["Close"].exists)
                    app.navigationBars["Photo source"].buttons.firstMatch.tap()
                }
                XCTAssertTrue(app.navigationBars["Photo links"].waitForExistence(timeout: 5), app.debugDescription)
            }
            XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
            app.terminate()
        }
    }
}
