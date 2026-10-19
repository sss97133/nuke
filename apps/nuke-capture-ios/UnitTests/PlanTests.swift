// PlanTests.swift — the buying plan, the order-inspection Sign body and inspection findings.
// No test calls request_inspection; the body is built and checked locally.

import XCTest
import Supabase
@testable import NukeCapture

final class PlanTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testPlanDecodesTheBuyingPlanShape() throws {
        let p = try decode(WorkPlan.self, PlanFixtures.plan)
        XCTAssertEqual(p.schemaVersion, "buying_plan_v1")
        XCTAssertEqual(p.vehicleLabel?.text, "1997 Fixture LX450")
        XCTAssertEqual(p.claims.count, 2)                                       // a broken claim is skipped
        XCTAssertEqual(p.operations.first?.targets.count, 2)
        XCTAssertEqual(p.checklist.count, 3)
        XCTAssertEqual(p.rateValue, 160)
        XCTAssertNil(p.reportedRate)                                             // spitball: never shown as dollars
        XCTAssertEqual(PlanCopy.noShopRate, "No shop rate on record yet — a technician's quote sets the price.")
        XCTAssertEqual(p.modelCalls, 0)
        XCTAssertEqual(p.databaseWrites, 0)
        XCTAssertEqual(p.pricedParts.map(\.name), ["Timing belt kit"])
        XCTAssertEqual(p.excludedCount, 3)
        XCTAssertEqual(p.paraphrasedCount, 1)
    }

    func testIdentityChecksReadPlainly() throws {
        let p = try decode(WorkPlan.self, PlanFixtures.plan)
        let checks = p.identityChecks
        XCTAssertEqual(checks.map(\.field), ["model", "engine_displacement_l", "transmission"])
        XCTAssertEqual(checks[1].line, "The record says 4.5; the listing says 4.7L")       // numeric readings decode
        XCTAssertEqual(PlanCopy.field("engine_displacement_l"), "Engine size")
        XCTAssertEqual(checks[0].line, "The record says LX450; the VIN decodes as LX")
        XCTAssertEqual(PlanCopy.identityStatus(checks[0].status), "One source is more specific")
        XCTAssertEqual(checks[2].line, "The record says Automatic; the listing says 5-speed manual")   // duplicates collapse
        XCTAssertEqual(PlanCopy.identityStatus(checks[2].status), "Records disagree")
        XCTAssertEqual(p.agreeingFields, 2)
    }

    func testClaimsCarrySourceDateAndConfidenceHonestly() throws {
        let p = try decode(WorkPlan.self, PlanFixtures.plan)
        XCTAssertTrue(p.claims[0].isExactQuote)
        XCTAssertEqual(p.claims[0].quote, "Surface rust is visible on the rear quarter.")
        XCTAssertEqual(PlanCopy.claimSource(p.claims[0]), "quoted from example-auctions.test · date not read · not scored")
        XCTAssertFalse(p.claims[1].isExactQuote)
        XCTAssertEqual(PlanCopy.claimSource(p.claims[1]), "paraphrased from example-auctions.test · May 1, 2022 · confidence 80%")
        XCTAssertEqual(PlanCopy.claimKind("reported_completed_work"), "Work reported done")
        XCTAssertEqual(WorkPlanEstimateView.claimsFooter(p),
                       "2 claims read · 1 paraphrased (no exact quote) · 3 left out or couldn't be read. What the seller says, not checked.")
    }

    func testHoursAreRoughGuides() throws {
        let p = try decode(WorkPlan.self, PlanFixtures.plan)
        let t = p.operations[0].targets
        XCTAssertEqual(PlanCopy.hours(t[0]), "about 4 h")
        XCTAssertEqual(PlanCopy.hours(t[1]), "2–6.5 h")
        XCTAssertEqual(t[0].label, "seed_uncalibrated")
        XCTAssertEqual(PlanCopy.roughGuide, "rough guide, not calibrated")
        XCTAssertEqual(PlanCopy.headline, "This is what checking this car would cover — not a restoration price.")
    }

    func testOrderBodyPassesTheScopeThroughUnchanged() throws {
        let p = try decode(WorkPlan.self, PlanFixtures.plan)
        let params = try XCTUnwrap(PlanReaders.orderParams(vehicleId: PlanFixtures.vehicleId, plan: p))
        XCTAssertEqual(params.p_vehicle_id, PlanFixtures.vehicleId)
        guard case .object(let sent) = params.p_scope, case .object(let original)? = p.inspectionScope else { return XCTFail("scope") }
        XCTAssertEqual(sent["request_source"], .string("ios"))
        var withoutChannel = sent
        withoutChannel.removeValue(forKey: "request_source")
        XCTAssertEqual(withoutChannel, original)                                // the checklist goes as the reader wrote it
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(params)) as? [String: Any])
        XCTAssertEqual(((json["p_scope"] as? [String: Any])?["ppi_checklist"] as? [Any])?.count, 3)
        XCTAssertEqual(OrderInspectionSheet.notSaid,
                       ["No access to the car is granted", "The seller must agree before anyone inspects it", "No payment is made"])
        let noScope = try decode(WorkPlan.self, #"{"schema_version":"buying_plan_v1","inspection_scope":{"ppi_checklist":[]}}"#)
        XCTAssertNil(PlanReaders.orderParams(vehicleId: "v", plan: noScope))
    }

    func testInspectionFindingsAndSellerPermission() throws {
        let r = try decode(InspectionRead.self, PlanFixtures.inspection)
        let doc = try XCTUnwrap(r.inspections.first)
        XCTAssertEqual(doc.state, "findings_recorded")
        XCTAssertEqual(doc.currentReport?.recordedBy?.text, "@fixture_inspector")
        XCTAssertEqual(doc.findings(for: "ppi:c1").first?.verdict, "supports")
        XCTAssertEqual(doc.findings(for: "ppi:c2").count, 0)
        XCTAssertEqual(doc.looseFindings.count, 1)
        XCTAssertNil(doc.checklist[2].question)                                 // wording hidden by the reader
        XCTAssertEqual(PlanCopy.permission(doc.sellerPermission).text, "Seller agreed for Oct 20, 2026 – Oct 22, 2026")
        XCTAssertEqual(PlanCopy.permission(doc.sellerPermission).status, .proven)
        XCTAssertEqual(PlanCopy.verdict("contradicts").text, "Doesn't match the listing")
        XCTAssertEqual(PlanCopy.severity("monitor"), "keep an eye on it")
        XCTAssertFalse(r.canRecordFindings)
        let requested = try decode(InspectionRead.self, PlanFixtures.inspectionRequested)
        XCTAssertEqual(PlanCopy.permission(requested.inspections[0].sellerPermission).text, "Seller hasn't agreed yet")
        XCTAssertTrue(requested.canRecordFindings)
        XCTAssertEqual(PlanCopy.permission(.init(state: "expired")).text, "The seller's permission has expired")
    }

    func testOrderReceiptAndFailureWords() throws {
        let r = try decode(InspectionRequestReceipt.self, PlanFixtures.orderReceipt)
        XCTAssertEqual(r.checklistItems, 3)
        XCTAssertFalse(r.duplicate)
        func text(_ m: String) -> String { PlanCopy.orderFailure(PostgrestError(code: "42501", message: m)) }
        XCTAssertEqual(text("Vehicle unavailable"), "This vehicle isn't open for inspection requests.")
        XCTAssertEqual(text("Checklist item 3 needs an item_id and a one-line question"),
                       "The checklist couldn't be sent as it is. Refresh the plan and try again.")
        XCTAssertEqual(text("Authentication required"), "Sign in to order an inspection.")
    }
}
