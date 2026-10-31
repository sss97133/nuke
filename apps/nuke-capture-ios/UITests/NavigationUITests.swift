import XCTest

/// Technical UI fixtures only: every request stays on fixture.nuke.invalid.
final class NavigationUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

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
        XCTAssertFalse(app.buttons["Open the vehicle profile"].exists, "the Garage must not insert a jobs screen before the profile")
        let back = app.navigationBars.buttons["Garage"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue((search.value as? String)?.contains("1234567") == true, "returning must retain the Garage search")
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
