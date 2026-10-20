// ClaimantsHealthLinksUITests.swift — the Work tab's market card, organization offers by verified claimants, Plan-B
// suppliers apart from performers, and nuke.ag links, through the real screens over the in-process fixture backend
// (-NukeFixtureBackend 1; never production). Nothing here signs: every test checks no writer was called.

import XCTest

final class ClaimantsHealthLinksUITests: XCTestCase {
    let jobId = "00000000-0000-4000-8000-000000000001"
    let matchesJobId = "00000000-0000-4000-8000-0000000000a1"
    let orgId = "00000000-0000-4000-8000-0000000000f1"

    override func setUp() { continueAfterFailure = false }

    private func launch(_ persona: String, scenario: String = "", _ env: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-NukeFixtureBackend", "1", "-NukeFixturePersona", persona]
        app.launchEnvironment = env.merging(["NUKE_FIXTURE_SCENARIO": scenario]) { $1 }
        app.launch()
        return app
    }

    private func writes(_ app: XCUIApplication) -> [String] {
        let el = app.descendants(matching: .any)["fixture.writes"]
        XCTAssertTrue(el.waitForExistence(timeout: 5))
        return el.label == "no writes" ? [] : el.label.split(separator: "\n").map(String.init)
    }

    @discardableResult
    private func reveal(_ el: XCUIElement, in app: XCUIApplication, tries: Int = 16) -> XCUIElement {
        var n = 0
        while !(el.exists && el.isHittable) && n < tries { app.swipeUp(); n += 1 }
        n = 0
        while !(el.exists && el.isHittable) && n < tries { app.swipeDown(); n += 1 }
        XCTAssertTrue(el.exists, "not found: \(el)")
        return el
    }

    private func text(_ app: XCUIApplication, contains s: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    private func any(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id].firstMatch }

    // MARK: Market health card

    func testWorkTabShowsHowTheJobMarketIsForming() {
        let app = launch("client", ["NUKE_DEBUG_SCREEN": "work"])
        XCTAssertTrue(app.navigationBars["Work"].waitForExistence(timeout: 10))
        sleep(2)
        let demand = reveal(any(app, "market.demand"), in: app)
        XCTAssertEqual(demand.label, "39 open requests · 4 jobs open to technicians · 4 jobs opened this week")
        XCTAssertTrue(any(app, "market.supply").label.contains("0 businesses claimed yet"))
        XCTAssertTrue(any(app, "market.matching").label.contains("23 requests have a backup supplier"))
        XCTAssertTrue(any(app, "market.flow").label.hasPrefix("No offers, quotes, starts, completions or invoices are on record yet."))
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "market.sparkline").count, 3, "demand, supply and matching trends")
        XCTAssertTrue(writes(app).isEmpty)
    }

    func testFirstDayOfHistoryDrawsNoTrendLine() {
        let app = launch("client", scenario: "market-first-day", ["NUKE_DEBUG_SCREEN": "work"])
        XCTAssertTrue(app.navigationBars["Work"].waitForExistence(timeout: 10))
        sleep(2)
        reveal(any(app, "market.demand"), in: app)
        XCTAssertFalse(any(app, "market.sparkline").exists)
        XCTAssertTrue(reveal(text(app, contains: "trend lines appear after the second day"), in: app).exists)
    }

    // MARK: Organization offers and Plan-B suppliers

    func testOrganizationOfferShowsTheBusinessItsBadgeAndRung() {
        let app = launch("client", scenario: "claimant", ["NUKE_DEBUG_JOB_ID": jobId])
        XCTAssertTrue(app.staticTexts["Stages"].waitForExistence(timeout: 10))
        sleep(2)
        reveal(text(app, contains: "Fixture Body Shop"), in: app)
        XCTAssertTrue(text(app, contains: "Offered by someone who claimed this business on Nuke").exists)
        let badge = reveal(any(app, "onNuke.badge"), in: app)
        XCTAssertEqual(badge.label, "Claimed on Nuke")
        XCTAssertTrue(writes(app).isEmpty)
    }

    func testProviderMatchesListSuppliersApartFromPerformers() {
        let app = launch("client", scenario: "claimant", ["NUKE_DEBUG_PROVIDER_MATCHES": matchesJobId])
        XCTAssertTrue(app.navigationBars["Choose who does it"].waitForExistence(timeout: 10))
        sleep(2)
        reveal(text(app, contains: "Offers as Fixture Body Shop"), in: app)
        reveal(text(app, contains: "has supplied this before — not evidence they can do the work"), in: app)
        reveal(text(app, contains: "Fixture Paint Supply"), in: app)
        XCTAssertTrue(text(app, contains: "Paid for this before on Nuke (3 times)").exists)
        XCTAssertTrue(reveal(text(app, contains: "isn't evidence of doing the work"), in: app).exists)
        XCTAssertTrue(writes(app).isEmpty)
    }

    // MARK: nuke.ag links

    func testJobLinkOpensTheJob() {
        let app = launch("visitor", ["NUKE_DEBUG_OPEN_URL": "https://nuke.ag/jobs/\(jobId)"])
        XCTAssertTrue(app.staticTexts["Stages"].waitForExistence(timeout: 12), "the job didn't open from its link")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertFalse(app.staticTexts["Stages"].waitForExistence(timeout: 2))
    }

    func testOrgLinkOpensTheBusiness() {
        let app = launch("visitor", scenario: "org", ["NUKE_DEBUG_OPEN_URL": "https://nuke.ag/org/\(orgId)"])
        XCTAssertTrue(text(app, contains: "Fixture Garage").waitForExistence(timeout: 12), "the business didn't open from its link")
        XCTAssertTrue(app.buttons["Done"].exists)
    }

    func testProviderLinkResolvesTheHandle() {
        let app = launch("visitor", ["NUKE_DEBUG_OPEN_URL": "https://nuke.ag/providers/fixture_tech"])
        XCTAssertTrue(app.navigationBars["@fixture_tech"].waitForExistence(timeout: 12))
        XCTAssertTrue(app.cells.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "fixture_tech")).firstMatch
            .waitForExistence(timeout: 8), "the provider page didn't load")
        XCTAssertFalse(text(app, contains: "No public profile on Nuke uses").exists)
    }
}
