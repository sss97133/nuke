import XCTest

final class InvestmentEvidenceUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }
    private func launch(_ scenario: String = "financial-qualification") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-NukeFixtureBackend", "1", "-NukeFixturePersona", "client"]
        app.launchEnvironment = ["NUKE_FIXTURE_SCENARIO": scenario, "NUKE_DEBUG_VEHICLE_ID": "00000000-0000-4000-8000-00000000c001"]
        app.launch()
        XCTAssertTrue(app.staticTexts["1973 FIXTURE COUPE"].firstMatch.waitForExistence(timeout: 15))
        return app
    }
    private func reveal(_ element: XCUIElement, app: XCUIApplication) {
        for _ in 0..<20 {
            if element.exists && element.isHittable { return }
            app.coordinate(withNormalizedOffset: CGVector(dx:0.5,dy:0.65))
                .press(forDuration:0.05,thenDragTo:app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.35)))
        }
        XCTAssertTrue(element.exists && element.isHittable)
    }
    private func writes(_ app: XCUIApplication) -> [[String: Any]] {
        let log = app.descendants(matching:.any)["fixture.writes"]
        XCTAssertTrue(log.waitForExistence(timeout:5))
        let calls = log.label.split(separator:"\n").compactMap { try? JSONSerialization.jsonObject(with:Data($0.utf8)) as? [String:Any] }
        XCTAssertTrue(calls.allSatisfy { $0["rpc"] as? String == "confirm_work_session" }, "Unexpected writer calls: \(log.label)")
        return calls
    }
    private func reading(_ app: XCUIApplication, _ id: String) -> String {
        let row = app.descendants(matching:.any).matching(identifier:id).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout:5))
        return row.label + " " + (row.value as? String ?? "")
    }
    func testCombinedLegacyTotalsStaySuppressedAndSessionConfirmationRemainsTestimony() {
        let app = launch()
        let sessions = app.buttons["investment-sessions"]
        reveal(sessions,app:app)
        for label in ["PROVEN IN","Invested (proven)","ROI (proven)","Labor (confirmed)","Aggregate party must not be rendered","VALUE BUILT","bought"] {
            XCTAssertFalse(app.staticTexts[label].exists)
        }
        XCTAssertFalse(app.staticTexts["$987,654"].exists)
        XCTAssertTrue(writes(app).isEmpty)
        sessions.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format:"label CONTAINS %@","tool depreciation")).firstMatch.waitForExistence(timeout:5))
        XCTAssertTrue(reading(app,"session-value-00000000-0000-4000-8000-00000000f001").contains("600"))
        XCTAssertTrue(reading(app,"session-confirmation-00000000-0000-4000-8000-00000000f001").contains("Owner statement recorded"))
        XCTAssertFalse(app.staticTexts["Proven"].exists)
        XCTAssertFalse(app.staticTexts["$600"].exists)
        XCTAssertFalse(app.buttons["session-confirm-00000000-0000-4000-8000-00000000f003"].exists,"Missing confirmation is not false or an action grant")
        let confirm = app.buttons["session-confirm-00000000-0000-4000-8000-00000000f002"]
        reveal(confirm,app:app)
        confirm.tap()
        let statement = app.descendants(matching:.any).matching(identifier:"session-confirmation-00000000-0000-4000-8000-00000000f002").firstMatch
        XCTAssertTrue(statement.waitForExistence(timeout:5))
        let calls = writes(app)
        XCTAssertEqual(calls.count,1)
        XCTAssertEqual(calls[0]["rpc"] as? String,"confirm_work_session")
        let args = calls[0]["args"] as? [String:Any]
        XCTAssertEqual((args?["p_session_id"] as? String)?.lowercased(),"00000000-0000-4000-8000-00000000f002")
        XCTAssertEqual(args?["p_confirm"] as? Bool,true)
        let shot = XCTAttachment(screenshot:app.screenshot());shot.name="session-testimony-qualified";shot.lifetime = .keepAlways;add(shot)
    }
    func testPaymentReportsPreserveStatedValuesAndKnownZeroWithoutProvenCash() {
        let app = launch()
        let payments = app.buttons["investment-payments"];reveal(payments,app:app);payments.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format:"label CONTAINS %@","does not verify who paid")).firstMatch.waitForExistence(timeout:5))
        XCTAssertTrue(reading(app,"payment-value-00000000-0000-4000-8000-00000000a101").contains("90"))
        XCTAssertTrue(app.staticTexts["Stated value (USD)"].exists)
        XCTAssertTrue(app.staticTexts["Direction as recorded"].firstMatch.exists)
        XCTAssertTrue(reading(app,"payment-value-00000000-0000-4000-8000-00000000a102").contains("250"))
        let zero = reading(app,"payment-value-00000000-0000-4000-8000-00000000a103")
        XCTAssertTrue(zero.contains("0"));XCTAssertFalse(zero.contains("Not returned"))
        XCTAssertFalse(app.staticTexts["Proven"].exists)
        XCTAssertTrue(writes(app).isEmpty)
        let shot = XCTAttachment(screenshot:app.screenshot());shot.name="payment-report-qualification";shot.lifetime = .keepAlways;add(shot)
    }
    func testWithheldRowsDoNotBecomeZeroInvestmentOrActionAuthority() {
        let app = launch("financial-evidence-withheld")
        let evidence = app.staticTexts["FINANCIAL EVIDENCE"].firstMatch
        reveal(evidence,app:app)
        XCTAssertTrue(app.staticTexts["No backing rows returned. This does not establish zero spending or no work."].exists)
        XCTAssertFalse(app.buttons["investment-parts"].exists)
        XCTAssertFalse(app.buttons["investment-sessions"].exists)
        XCTAssertFalse(app.buttons["Add a contribution statement"].exists)
        XCTAssertFalse(app.staticTexts["$987,654"].exists)
        XCTAssertTrue(writes(app).isEmpty)
    }
    func testQualifiedMarketSaleAndCanonicalReceiptDoorsRemainAvailable() {
        let app = launch()
        let estimate = app.staticTexts["MARKET ESTIMATE"].firstMatch
        reveal(estimate,app:app)
        XCTAssertTrue(app.staticTexts["$12,000"].exists)
        let history = app.staticTexts["SALE HISTORY"].firstMatch
        reveal(history,app:app)
        XCTAssertTrue(app.staticTexts["BRING A TRAILER"].exists)
        XCTAssertTrue(app.staticTexts["2026-02-03"].exists)
        let parts = app.buttons["investment-parts"]
        reveal(parts,app:app)
        XCTAssertFalse(app.staticTexts["VALUE BUILT"].exists)
        let records = XCTAttachment(screenshot:app.screenshot());records.name="financial-record-doors";records.lifetime = .keepAlways;add(records)
        parts.tap()
        let source = app.buttons["receipt-source-00000000-0000-4000-8000-00000000a001"]
        XCTAssertTrue(source.waitForExistence(timeout:5));source.tap()
        XCTAssertTrue(app.staticTexts["Corrected gasket reading"].waitForExistence(timeout:10))
        XCTAssertTrue(app.staticTexts["Recorded zero charge"].exists)
        XCTAssertTrue(writes(app).isEmpty)
    }
}
