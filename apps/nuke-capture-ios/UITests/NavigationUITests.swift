import XCTest

/// Technical UI fixtures only: every request stays on fixture.nuke.invalid.
final class NavigationUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testSessionReviewInspectsSourceWithoutSelectingOrFiling() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "source-inspection"
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let organize = app.buttons["Organize photos"].firstMatch
        XCTAssertTrue(organize.waitForExistence(timeout: 10)); organize.tap()
        let day = app.staticTexts["2026-10-31"].firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 10)); day.tap()
        let inspect = app.buttons["session.source.inspect.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(inspect.waitForExistence(timeout: 10)); inspect.tap()
        XCTAssertTrue(app.staticTexts["This reading remains unresolved."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Retained interpretations · this read does not establish identity"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "session-source-inspection"; shot.lifetime = .keepAlways; add(shot)
        app.navigationBars.buttons["Which vehicle?"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["0 selected · 1 shown of 1 session photos"].waitForExistence(timeout: 5))
        let log = app.descendants(matching: .any)["fixture.writes"]
        XCTAssertTrue(log.waitForExistence(timeout: 5))
        XCTAssertEqual(log.label, "no writes", "Inspecting a source must not assert identity or file a photo")
    }

    func testSessionReviewKeepsConflictingLocalReadingsByteUnbound() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "source-inspection", "NUKE_FIXTURE_NATIVE_REVIEW": "conflict"]
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let organize = app.buttons["Organize photos"].firstMatch
        XCTAssertTrue(organize.waitForExistence(timeout: 10)); organize.tap()
        let day = app.staticTexts["2026-10-31"].firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 10)); day.tap()
        let inspect = app.buttons["session.source.inspect.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(inspect.waitForExistence(timeout: 10)); inspect.tap()
        let local = app.staticTexts["Local native reading"]
        XCTAssertTrue(local.waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Multiple identifier-shaped readings remain; none is selected."].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100001"].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100009"].exists)
        XCTAssertTrue(app.staticTexts["Earlier native reading"].exists)
        XCTAssertTrue(app.staticTexts["Native reading pass"].exists)
        XCTAssertTrue(app.staticTexts["This reading matches the current Photos source. Uploaded byte identity is not bound because its source hash is unavailable."].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "local-native-reading-conflict"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testSessionReviewShowsReadyBoundCloseupAsTextOnly() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": "source-inspection", "NUKE_FIXTURE_NATIVE_REVIEW": "nonvehicle"]
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12)); garage.tap()
        let organize = app.buttons["Organize photos"].firstMatch
        XCTAssertTrue(organize.waitForExistence(timeout: 10)); organize.tap()
        let day = app.staticTexts["2026-10-31"].firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 10)); day.tap()
        let inspect = app.buttons["session.source.inspect.00000000-0000-4000-8000-00000000e001"]
        XCTAssertTrue(inspect.waitForExistence(timeout: 10)); inspect.tap()
        let local = app.staticTexts["Local native reading"]
        XCTAssertTrue(local.waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Multiple identifier-shaped readings remain; none is selected."].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100001"].exists)
        XCTAssertTrue(app.staticTexts["2S87R3N100009"].exists)
        XCTAssertTrue(app.staticTexts["Earlier native reading"].exists)
        XCTAssertTrue(app.staticTexts["Native reading pass"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Classification unresolved · text only.")).firstMatch.exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "local-native-reading-closeup"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertEqual(app.descendants(matching: .any)["fixture.writes"].label, "no writes")
    }

    func testGarageTabFindsAZeroPhotoRecordAndOpensTheActualProfile() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client", "-ignitionComplete", "YES"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "navigation-garage"
        app.launch()
        let garage = app.tabBars.buttons["Garage"].firstMatch
        XCTAssertTrue(garage.waitForExistence(timeout: 12), "finding your vehicles must not require hunting through Profile or granting full Photos access")
        garage.tap()
        let row = app.staticTexts["1973 Fixture Coupe"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "a created record must be findable without photos or an ownership claim")
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("1234567\n")
        XCTAssertTrue(row.waitForExistence(timeout: 5), "stored VIN suffix must find the existing record")
        row.tap()
        let profile = app.descendants(matching: .any).matching(identifier: "garage.vehicle.profile.00000000-0000-4000-8000-00000000c001").firstMatch
        XCTAssertTrue(profile.waitForExistence(timeout: 10), "the primary row must open the actual vehicle profile")
        XCTAssertTrue(app.staticTexts["1973 FIXTURE COUPE"].firstMatch.waitForExistence(timeout: 10), "the profile must load the vehicle identity, not only mount its destination")
        XCTAssertTrue(app.staticTexts["No photos available on this profile"].waitForExistence(timeout: 5), "a successful empty gallery must explain why uploaded photos may not appear here yet")
        XCTAssertFalse(app.staticTexts["Couldn't load photos"].exists, "an empty gallery is a successful read, not a load failure")
        XCTAssertFalse(app.buttons["Open the vehicle profile"].exists, "the Garage must not insert a jobs screen before the profile")
        let back = app.navigationBars.buttons["Garage"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue((search.value as? String)?.contains("1234567") == true, "returning must retain the Garage search")
    }

    func testSellerSourceSheetShowsConfigurationLimits() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "navigation-garage"
        app.launchEnvironment["NUKE_DEBUG_VEHICLE_ID"] = "00000000-0000-4000-8000-00000000c001"
        app.launch()
        let engine = app.staticTexts["350 V8 Crate"].firstMatch
        XCTAssertTrue(engine.waitForExistence(timeout: 15))
        engine.tap()
        XCTAssertTrue(app.staticTexts["What this establishes"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Source, Dealer seller listing · dealer_microdata_v2"].exists)
        app.swipeUp()
        for (label, expected) in [("Claim basis", "Seller Claim"), ("Factory configuration", "Unknown"), ("Current configuration", "Unknown")] {
            let row = app.descendants(matching: .any).matching(identifier: "claim.qualification.\(label)").firstMatch
            XCTAssertTrue(row.exists)
            let accessibleText = row.label + " " + (row.value as? String ?? "")
            XCTAssertTrue(accessibleText.contains(expected), "\(label) must retain \(expected): \(accessibleText)")
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testExploreShowsPeopleWithoutRequiringVehicleResults() {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "visitor"]
        app.launchEnvironment["NUKE_FIXTURE_SCENARIO"] = "navigation-actors"
        app.launchEnvironment["NUKE_DEBUG_SCREEN"] = "explore"
        app.launchEnvironment["NUKE_DEBUG_EXPLORE_QUERY"] = "fixture person"
        app.launch()
        let person = app.staticTexts["Fixture Person"].firstMatch
        XCTAssertTrue(person.waitForExistence(timeout: 12), "a people-only search was incorrectly hidden by the vehicle empty state")
        XCTAssertFalse(app.staticTexts["No matches"].exists)
        person.tap()
        let back = app.navigationBars.buttons["Explore"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10), "a person must open within Explore's navigation stack")
        back.tap()
        XCTAssertTrue(person.waitForExistence(timeout: 5), "returning must preserve the search results")
    }
}
