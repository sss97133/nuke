// JobFlowUITests.swift — the techs-to-jobs flows driven through the real SwiftUI screens.
//
// Every launch passes -NukeFixtureBackend 1: the app's Supabase client then talks only to the in-process
// fixture backend (Sources/NukeCapture/Debug/FixtureBackend.swift, DEBUG-only) on a fake host, so nothing
// reaches production. Each test picks a persona and a scenario, enters through a DEBUG host, taps through
// the screens and asserts the exact writer calls the backend recorded (the `fixture.writes` element).

import XCTest

final class JobFlowUITests: XCTestCase {
    // Ids and hashes the fixture readers offer (Sources/NukeCapture/Debug/Fixtures).
    let jobId = "00000000-0000-4000-8000-000000000001"
    let vehicleId = "00000000-0000-4000-8000-0000000000a1"
    let quoteId = "00000000-0000-4000-8000-0000000000f2"
    let quoteHash = String(repeating: "ab", count: 32)
    let startTermsHash = String(repeating: "7b", count: 32)
    let scopeHash = String(repeating: "12", count: 32)
    let toolRequirementId = "00000000-0000-4000-8000-0000000000d2"
    let cosignedOfferId = "00000000-0000-4000-8000-0000000000e9"
    let cosignedTermsHash = String(repeating: "9f", count: 32)
    let rawOfferHash = String(repeating: "cd", count: 32)
    let contactProfileId = "00000000-0000-4000-8000-0000000000c1"
    let pendingRequestId = "00000000-0000-4000-8000-00000000c001"
    let acceptedRequestId = "00000000-0000-4000-8000-00000000c002"

    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: Helpers

    private func launch(_ persona: String, scenario: String, _ env: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-NukeFixtureBackend", "1", "-NukeFixturePersona", persona]
        app.launchEnvironment = env.merging(["NUKE_FIXTURE_SCENARIO": scenario]) { $1 }
        app.launch()
        return app
    }

    /// The writer calls the fixture backend recorded, in order.
    private func writes(_ app: XCUIApplication) -> [[String: Any]] {
        let el = app.descendants(matching: .any)["fixture.writes"]
        XCTAssertTrue(el.waitForExistence(timeout: 5), "fixture write log missing")
        return el.label.split(separator: "\n").compactMap {
            try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]
        }
    }

    private func call(_ app: XCUIApplication, _ rpc: String) -> [String: Any]? {
        writes(app).last { $0["rpc"] as? String == rpc }?["args"] as? [String: Any]
    }

    private func waitForWrite(_ app: XCUIApplication, _ rpc: String, timeout: TimeInterval = 10) {
        let deadline = Date().addingTimeInterval(timeout)
        while call(app, rpc) == nil && Date() < deadline { usleep(300_000) }
        XCTAssertNotNil(call(app, rpc), "\(rpc) was never called")
    }

    /// Scrolls until the element is on screen (lists render lazily).
    @discardableResult
    private func reveal(_ el: XCUIElement, in app: XCUIApplication, up: Bool = true, tries: Int = 14) -> XCUIElement {
        var n = 0
        while !(el.exists && el.isHittable) && n < tries {
            if up { app.swipeUp() } else { app.swipeDown() }
            n += 1
        }
        // Past it (a slow runner can overshoot)? Search back the other way once.
        n = 0
        while !(el.exists && el.isHittable) && n < tries {
            if up { app.swipeDown() } else { app.swipeUp() }
            n += 1
        }
        XCTAssertTrue(el.exists, "not found: \(el)")
        return el
    }

    private func tapConfirm(_ app: XCUIApplication, _ id: String = "sign.confirm") {
        let b = app.buttons[id].firstMatch
        reveal(b, in: app).tap()
    }

    private func dismissSheet(_ app: XCUIApplication) {
        let done = app.buttons["Done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 8), "the Sign step didn't finish")
        done.tap()
    }

    private func text(_ app: XCUIApplication, contains s: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    /// Types into the field with this placeholder (a text field, or a multi-line text view); "" means the first text view.
    private func type(_ app: XCUIApplication, into placeholder: String, _ value: String) {
        let byPlaceholder = NSPredicate(format: "placeholderValue == %@", placeholder)
        let field = app.textFields.matching(byPlaceholder).firstMatch
        let view = placeholder.isEmpty ? app.textViews.firstMatch : app.textViews.matching(byPlaceholder).firstMatch
        let deadline = Date().addingTimeInterval(8)
        while !field.exists && !view.exists && Date() < deadline { usleep(250_000) }
        let target = field.exists ? field : view
        reveal(target, in: app).tap()
        // Slow runners may not have focused the field yet: wait for the keyboard, tap again if it isn't up.
        if !app.keyboards.firstMatch.waitForExistence(timeout: 4) { target.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 6), "the field never took focus")
        target.typeText(value)
    }

    /// Every label on the screen, scrolled top to bottom.
    private func allLabels(_ app: XCUIApplication, pages: Int = 14) -> [String] {
        var seen: [String] = []
        for _ in 0..<pages {
            seen += app.staticTexts.allElementsBoundByIndex.map(\.label)
            seen += app.buttons.allElementsBoundByIndex.map(\.label)
            app.swipeUp()
        }
        return seen
    }

    // MARK: 1. Visitor: a listed vehicle → Plan the work

    func testVisitorPlansTheWorkOnAListedVehicle() {
        let app = launch("visitor", scenario: "listing", ["NUKE_DEBUG_VEHICLE_WORK": vehicleId, "NUKE_DEBUG_LISTING": "1"])
        let plan = app.buttons["Plan the work"].firstMatch
        XCTAssertTrue(plan.waitForExistence(timeout: 10))
        plan.tap()
        XCTAssertTrue(app.staticTexts["Check the identity first"].waitForExistence(timeout: 10))
        reveal(app.staticTexts["Likely work"], in: app)
        reveal(text(app, contains: "No shop rate on record yet"), in: app)
        reveal(text(app, contains: "Inspection checklist"), in: app)
        let labels = allLabels(app, pages: 6)
        XCTAssertFalse(labels.contains { $0.contains("$160") }, "a placeholder labor rate reached the screen")
        XCTAssertTrue(labels.contains { $0.hasSuffix(" h") || $0.contains(" h ") }, "no hours estimate shown")
        XCTAssertTrue(writes(app).isEmpty, "a visitor reading a plan must not write")
    }

    // MARK: 2. Client: Post a job → the job → Accept quote

    func testClientPostsAJobAndAcceptsTheQuote() {
        let app = launch("client", scenario: "post-job", ["NUKE_DEBUG_VEHICLE_WORK": vehicleId])
        let post = app.buttons["Post a job"].firstMatch
        XCTAssertTrue(post.waitForExistence(timeout: 10))
        post.tap()
        type(app, into: "Describe the work in your own words", "Replace the front brake pads. Bleed the lines.")
        reveal(app.buttons["postjob.post"], in: app).tap()
        let confirm = app.alerts["Post this job?"].buttons["Post the job"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "no explicit confirm before posting")
        XCTAssertTrue(writes(app).isEmpty, "nothing may be written before the explicit confirm")
        confirm.tap()
        waitForWrite(app, "post_work_request")
        reveal(text(app, contains: "Your job is posted"), in: app, up: false)
        let posted = call(app, "post_work_request")
        XCTAssertEqual(posted?["p_vehicle_id"] as? String, vehicleId)
        XCTAssertEqual(posted?["p_description"] as? String, "Replace the front brake pads. Bleed the lines.")
        XCTAssertEqual(posted?["p_visibility"] as? String, "open")
        XCTAssertNil(posted?["p_requested_operations"], "the server splits the client's words itself")

        reveal(app.buttons["Open the job"].firstMatch, in: app).tap()
        reveal(app.staticTexts["Request · Recorded"], in: app)
        app.swipeDown(); app.swipeDown(); app.swipeDown()
        reveal(app.buttons["Accept quote"].firstMatch, in: app).tap()
        XCTAssertTrue(app.navigationBars["Accept quote"].waitForExistence(timeout: 5))
        reveal(app.staticTexts["Accepting says"], in: app)
        reveal(app.staticTexts["It does not say"], in: app)
        tapConfirm(app)
        dismissSheet(app)
        let accepted = call(app, "accept_work_order_quote")
        XCTAssertEqual(accepted?["p_quote_id"] as? String, quoteId)
        XCTAssertEqual(accepted?["p_quote_hash"] as? String, quoteHash, "accept must send the server-offered hash")
    }

    // MARK: 3. Provider: Jobs looking for someone → Make an offer; Start work; Mark the work done

    func testProviderOffersOnAnOpenRequest() {
        let app = launch("provider", scenario: "offer", ["NUKE_DEBUG_JOBS_LOOKING": "1"])
        let row = app.staticTexts["Paint touch-up on the driver door"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        // Let the page fill in its later sections first: with the Offers header scrolled out of view, the sheet
        // must still open (regression: sheets hung off section headers did nothing once the header left the screen).
        XCTAssertTrue(app.staticTexts["Stages"].waitForExistence(timeout: 10))
        sleep(2)
        reveal(app.buttons["Make an offer"].firstMatch, in: app).tap()
        XCTAssertTrue(app.navigationBars["Make an offer"].waitForExistence(timeout: 6), "the offer sheet didn't open")
        type(app, into: "Amount", "450")
        tapConfirm(app)
        XCTAssertTrue(app.staticTexts["Offer sent"].waitForExistence(timeout: 8))
        dismissSheet(app)
        let offer = call(app, "offer_on_requirement")
        XCTAssertEqual(offer?["p_requirement_id"] as? String, toolRequirementId)
        let lines = ((offer?["p_terms"] as? [String: Any])?["lines"] as? [[String: Any]]) ?? []
        XCTAssertEqual(lines.first?["amount"] as? Double, 450)
        XCTAssertEqual(lines.first?["currency"] as? String, "USD")
    }

    func testProviderStartsWorkAndMarksItDone() {
        let app = launch("provider", scenario: "provider-start", ["NUKE_DEBUG_JOB_ID": jobId])
        let start = app.buttons["Start work"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        start.tap()
        XCTAssertTrue(app.staticTexts["Starting says"].waitForExistence(timeout: 5))
        tapConfirm(app)
        dismissSheet(app)
        let started = call(app, "start_work")
        XCTAssertEqual(started?["p_work_order_id"] as? String, jobId)
        XCTAssertEqual(started?["p_terms_hash"] as? String, startTermsHash, "start must be pinned to the accepted terms hash")

        reveal(app.buttons["Mark the work done"].firstMatch, in: app).tap()
        tapConfirm(app)
        dismissSheet(app)
        let attested = call(app, "attest_work_completion")
        XCTAssertEqual(attested?["p_work_order_id"] as? String, jobId)
        XCTAssertEqual(attested?["p_scope_hash"] as? String, scopeHash)
        XCTAssertEqual(writes(app).map { $0["rpc"] as? String }, ["start_work", "attest_work_completion"])
    }

    // MARK: 4. Accept offer on a co-signed offer sends the terms hash (regression for #2185)

    func testAcceptingACoSignedOfferSendsTheTermsHash() {
        let app = launch("client", scenario: "cosign", ["NUKE_DEBUG_JOB_ID": jobId])
        XCTAssertTrue(app.staticTexts["Stages"].waitForExistence(timeout: 20))
        sleep(2)
        let accept = app.buttons["Accept offer"].firstMatch
        reveal(accept, in: app).tap()
        reveal(text(app, contains: "Co-signed by Fixture Garage"), in: app)
        tapConfirm(app)
        dismissSheet(app)
        let args = call(app, "accept_offer")
        XCTAssertEqual(args?["p_offer_id"] as? String, cosignedOfferId)
        XCTAssertEqual(args?["p_offer_hash"] as? String, cosignedTermsHash)
        XCTAssertNotEqual(args?["p_offer_hash"] as? String, rawOfferHash, "the raw offer hash ignores co-signs")
    }

    // MARK: 5. Contact via Nuke: send, accept in the inbox, write in the thread

    func testContactRequestIsSentThroughNuke() {
        let app = launch("client", scenario: "contact-send", ["NUKE_DEBUG_PROVIDER": contactProfileId])
        reveal(app.buttons["Contact via Nuke"].firstMatch, in: app).tap()
        type(app, into: "", "Could you look at my exhaust hangers?")
        // Keyboard expansion changes the sheet detent. Scroll the form's margin,
        // rather than the nested TextEditor or the provider page behind it.
        let send = app.buttons["contact.send"].firstMatch
        XCTAssertTrue(send.waitForExistence(timeout: 10), "contact composer did not finish keyboard layout")
        XCTAssertGreaterThan(app.collectionViews.count, 0)
        let form = app.collectionViews.element(boundBy: app.collectionViews.count - 1)
        for _ in 0..<3 where !send.isHittable {
            form.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.5))
                .press(forDuration: 0.1, thenDragTo: form.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.2)))
        }
        XCTAssertTrue(send.isHittable, "contact Send row stayed behind the keyboard")
        send.tap()
        XCTAssertTrue(app.staticTexts["Sent"].waitForExistence(timeout: 8))
        dismissSheet(app)
        let args = call(app, "request_contact")
        XCTAssertEqual(args?["p_context_kind"] as? String, "profile")
        XCTAssertEqual(args?["p_context_id"] as? String, contactProfileId)
        XCTAssertEqual(args?["p_recipient_user_id"] as? String, contactProfileId)
        XCTAssertEqual(args?["p_message"] as? String, "Could you look at my exhaust hangers?")
        XCTAssertFalse(args?.keys.contains { $0.contains("email") || $0.contains("phone") } ?? true)
    }

    func testInboxAcceptAndThreadMessage() {
        let app = launch("provider", scenario: "contact-inbox", ["NUKE_DEBUG_SCREEN": "work"])
        let accept = app.buttons["Accept"].firstMatch
        reveal(accept, in: app).tap()
        let accepted = call(app, "respond_contact_request")
        XCTAssertEqual(accepted?["p_id"] as? String, pendingRequestId)
        XCTAssertEqual(accepted?["p_accept"] as? Bool, true)

        reveal(text(app, contains: "Do you take K5 wiring jobs?"), in: app).tap()
        type(app, into: "Write a message", "Yes, after the 25th works.")
        app.buttons["thread.send"].firstMatch.tap()
        waitForWrite(app, "post_contact_message")
        let posted = call(app, "post_contact_message")
        XCTAssertEqual(posted?["p_request_id"] as? String, acceptedRequestId)
        XCTAssertEqual(posted?["p_body"] as? String, "Yes, after the 25th works.")
    }

    // MARK: 6. Privacy: a visitor never sees payment amounts or contact fields

    private let planted = ["planted.person@example.com", "702-555-0199", "Planted Person", "1 Planted Street", "4,321.09", "4321.09"]

    private func assertNothingPlanted(_ labels: [String], _ screen: String) {
        for p in planted {
            XCTAssertFalse(labels.contains { $0.contains(p) }, "\(screen) showed \(p) to a visitor")
        }
    }

    func testVisitorJobPageWithholdsPaymentsAndContact() {
        let app = launch("visitor", scenario: "privacy-job", ["NUKE_DEBUG_JOB_ID": jobId])
        XCTAssertTrue(app.staticTexts["Stages"].waitForExistence(timeout: 10))
        let labels = allLabels(app, pages: 18)
        assertNothingPlanted(labels, "job page")
        XCTAssertTrue(labels.contains { $0.contains("Shown to the people on this job") }, "payment facts must be marked withheld")
        XCTAssertTrue(writes(app).isEmpty)
    }

    func testVisitorProfileWithholdsContact() {
        let app = launch("visitor", scenario: "privacy-profile", ["NUKE_DEBUG_PROVIDER": contactProfileId])
        XCTAssertTrue(app.staticTexts["@fixture_tech"].firstMatch.waitForExistence(timeout: 10))
        assertNothingPlanted(allLabels(app, pages: 12), "profile")
    }

    func testVisitorStatementWithholdsPayments() {
        let app = launch("visitor", scenario: "privacy-job", ["NUKE_DEBUG_STATEMENT_VEHICLE": vehicleId])
        XCTAssertTrue(app.staticTexts["Totals"].firstMatch.waitForExistence(timeout: 10))
        let labels = allLabels(app, pages: 8)
        assertNothingPlanted(labels, "statement")
        XCTAssertTrue(labels.contains { $0.contains("Payments are shown to the people on this job") })
    }
}
