// ParityUITests.swift — technician setup, publish controls, plan-B suppliers, business claims and supplier invites,
// driven through the real screens over the in-process fixture backend (-NukeFixtureBackend 1; never production).

import XCTest

final class ParityUITests: XCTestCase {
    let jobId = "00000000-0000-4000-8000-000000000001"
    let orgId = "00000000-0000-4000-8000-0000000000f1"
    let actorId = "00000000-0000-4000-8000-0000000000a7"
    let contributionId = "00000000-0000-4000-8000-00000000b001"
    let toolRequirementId = "00000000-0000-4000-8000-0000000000d2"

    override func setUp() { continueAfterFailure = false }

    private func launch(_ persona: String, scenario: String, _ env: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-NukeFixtureBackend", "1", "-NukeFixturePersona", persona]
        app.launchEnvironment = env.merging(["NUKE_FIXTURE_SCENARIO": scenario]) { $1 }
        app.launch()
        return app
    }

    private func writes(_ app: XCUIApplication) -> [[String: Any]] {
        let el = app.descendants(matching: .any)["fixture.writes"]
        XCTAssertTrue(el.waitForExistence(timeout: 5))
        return el.label.split(separator: "\n").compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    }

    private func call(_ app: XCUIApplication, _ rpc: String) -> [String: Any]? {
        writes(app).last { $0["rpc"] as? String == rpc }?["args"] as? [String: Any]
    }

    @discardableResult
    private func reveal(_ el: XCUIElement, in app: XCUIApplication, up: Bool = true, tries: Int = 16) -> XCUIElement {
        // Scroll in short drags so a List row is not flung past (and recycled away) between checks;
        // if it still overshoots, come back the other way before giving up.
        func drag(_ forward: Bool) {
            let a = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: forward ? 0.62 : 0.38))
            let b = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: forward ? 0.38 : 0.62))
            a.press(forDuration: 0.05, thenDragTo: b)
        }
        var n = 0
        while !(el.exists && el.isHittable) && n < tries * 2 { drag(up); n += 1 }
        n = 0
        while !(el.exists && el.isHittable) && n < tries * 2 { drag(!up); n += 1 }
        XCTAssertTrue(el.exists, "not found: \(el)")
        return el
    }

    private func sign(_ app: XCUIApplication) {
        reveal(app.buttons["sign.confirm"].firstMatch, in: app).tap()
        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 8), "the Sign step didn't finish")
        done.tap()
    }

    private func type(_ app: XCUIApplication, into placeholder: String, _ value: String) {
        let f = app.textFields.matching(NSPredicate(format: "placeholderValue == %@", placeholder)).firstMatch
        reveal(f, in: app).tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 4) { f.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 6), "the field never took focus")
        f.typeText(value + "\n")      // Return closes the keyboard so the next field can be reached
    }

    private func text(_ app: XCUIApplication, contains s: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    // MARK: Technician setup

    func testTechnicianSetupClaimsConfirmsAndSetsWhereAndWhen() {
        let app = launch("provider", scenario: "setup", ["NUKE_DEBUG_SCREEN": "provider-setup"])
        XCTAssertTrue(app.staticTexts["Your page"].waitForExistence(timeout: 10))
        reveal(app.buttons["Claim this record"].firstMatch, in: app).tap()
        XCTAssertTrue(app.staticTexts["This technician record is you."].waitForExistence(timeout: 5))
        sign(app)
        let claim = call(app, "insert account_link_claims")
        XCTAssertEqual(claim?["actor_id"] as? String, actorId)
        XCTAssertEqual(claim?["verification_method"] as? String, "self_claim")

        reveal(app.buttons["Confirm this record"].firstMatch, in: app).tap()
        sign(app)
        let confirmed = call(app, "confirm_provider_record")
        XCTAssertEqual(confirmed?["p_source_kind"] as? String, "contractor_work_contribution")
        XCTAssertEqual(confirmed?["p_source_id"] as? String, contributionId)

        type(app, into: "City", "Boulder City")
        type(app, into: "State (two letters)", "nv")
        reveal(app.buttons["Set service area"].firstMatch, in: app).tap()
        sign(app)
        let area = call(app, "set_provider_service_area")
        XCTAssertEqual(area?["p_city"] as? String, "Boulder City")
        XCTAssertEqual(area?["p_state"] as? String, "NV")
        XCTAssertEqual(area?["p_radius_miles"] as? Int, 25)
        XCTAssertEqual(area?["p_mobile"] as? Bool, false)

        reveal(app.buttons["Set availability"].firstMatch, in: app).tap()
        sign(app)
        let windows = call(app, "set_provider_availability")?["p_windows"] as? [String: Any]
        XCTAssertEqual((windows?["weekly"] as? [[String: Any]])?.count, 5, "Mon–Fri by default")
        XCTAssertFalse((windows?["timezone"] as? String ?? "").isEmpty)
    }

    // MARK: Publish controls and supplier invites (the job's customer)

    func testCustomerPublishesTheJobAndInvitesASupplier() {
        let app = launch("client", scenario: "publish", ["NUKE_DEBUG_JOB_ID": jobId])
        XCTAssertTrue(app.staticTexts["Stages"].waitForExistence(timeout: 10))
        sleep(2)
        reveal(app.buttons["Open it to technicians"].firstMatch, in: app).tap()
        XCTAssertTrue(app.staticTexts["It does not say"].waitForExistence(timeout: 5) || reveal(app.staticTexts["It does not say"], in: app).exists)
        sign(app)
        let pub = call(app, "publish_work_order")
        XCTAssertEqual(pub?["p_work_order_id"] as? String, jobId)
        XCTAssertEqual(pub?["p_visibility"] as? String, "open")

        reveal(app.buttons["Not on Nuke yet — invite them"].firstMatch, in: app).tap()
        reveal(app.buttons["sign.confirm"].firstMatch, in: app).tap()
        XCTAssertTrue(app.descendants(matching: .any)["invite.share"].waitForExistence(timeout: 8), "no share sheet entry for the link")
        app.buttons["Done"].firstMatch.tap()
        let invite = call(app, "create_supplier_invite")
        XCTAssertEqual(invite?["p_organization_id"] as? String, orgId)
        XCTAssertEqual(invite?["p_requirement_id"] as? String, toolRequirementId)
        XCTAssertEqual(writes(app).filter { ($0["rpc"] as? String)?.contains("contact") == true }.count, 0, "Nuke sends nothing")
    }

    // MARK: Businesses

    func testOwnerClaimsABusinessWithTheirWorkEmail() {
        let app = launch("client", scenario: "org", ["NUKE_DEBUG_ORG": orgId])
        reveal(text(app, contains: "Brake parts · 3 times"), in: app)
        reveal(app.buttons["Is this your business? Claim it"].firstMatch, in: app).tap()
        sign(app)
        let claim = call(app, "claim_organization")
        XCTAssertEqual(claim?["p_organization_id"] as? String, orgId)
        XCTAssertEqual(claim?["p_method"] as? String, "domain_email")
        XCTAssertNil(claim?["p_evidence"] as? [String: Any])
    }

    func testOpenRequestsShowPlanBSuppliers() {
        let app = launch("provider", scenario: "offer", ["NUKE_DEBUG_JOBS_LOOKING": "1"])
        XCTAssertTrue(text(app, contains: "Paid for this before on Nuke (3 times) · Not on Nuke yet").waitForExistence(timeout: 10))
        XCTAssertTrue(text(app, contains: "Claimed Parts Co").exists)
    }
}
