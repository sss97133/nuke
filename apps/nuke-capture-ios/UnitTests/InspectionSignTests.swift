// InspectionSignTests.swift — inspection steps appear only as offered, and drafts take the Signs' exact shape.

import XCTest
@testable import NukeCapture

final class InspectionSignTests: XCTestCase {
    private let readJSON = #"""
    {"inspections":[{"work_order_id":"i1","inspection_type":"pre_purchase","state":"requested",
      "checklist":[{"item_id":"c1","question":"Does the frame match the listing?"},{"item_id":"c2","question":"Any leaks?"}],
      "seller_permission":{"state":"not_established"}}],
     "viewer":{"context":"party","actions":[
       {"action":"grant_inspection_access","rpc":"grant_inspection_access","args":{"p_inspection_work_order_id":"i1"},
        "binds":["your permission"],"does_not_bind":["payment"]},
       {"action":"record_findings","rpc":"record_inspection_findings","args":{"p_inspection_work_order_id":"i9"}}]}}
    """#

    private func read() throws -> InspectionRead {
        try JobReaders.decode(InspectionRead.self, from: Data(readJSON.utf8))
    }

    func testStepsMatchTheirOwnInspection() throws {
        let r = try read()
        XCTAssertEqual(r.grantAction(for: "i1")?.rpc, "grant_inspection_access")
        XCTAssertNil(r.findingsAction(for: "i1"), "findings offered for a different inspection are not shown here")
        XCTAssertEqual(r.findingsAction(for: "i9")?.kind, "record_findings")
        XCTAssertNil(r.grantAction(for: "i9"))
    }

    func testFindingsDraftTakesTheSignShape() throws {
        var answered = InspectionDrafting.ItemDraft()
        answered.verdict = "contradicts"; answered.finding = "Frame rust\nat rear crossmember "; answered.severity = "concern"
        var extra = InspectionDrafting.ExtraDraft(); extra.finding = "Tires dated 2017"; extra.severity = "monitor"
        let f = try InspectionDrafting.findings(summary: "  Solid truck, rear frame needs work ",
                                                items: [("c1", answered), ("c2", .init())],
                                                extras: [extra, .init()], condition: "fair").get()
        XCTAssertEqual(f.summary, "Solid truck, rear frame needs work")
        XCTAssertEqual(f.findings, [
            .init(item_id: "c1", finding: "Frame rust at rear crossmember", severity: "concern", verdict: "contradicts"),
            .init(item_id: nil, finding: "Tires dated 2017", severity: "monitor", verdict: nil)])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(f)) as! [String: Any]
        let loose = (json["findings"] as! [[String: Any]])[1]
        XCTAssertNil(loose["item_id"]); XCTAssertNil(loose["verdict"], "verdict appears exactly when an item is answered")
        XCTAssertEqual(json["overall_condition"] as? String, "fair")
    }

    func testFindingsDraftRefusesIncompleteReports() {
        XCTAssertThrowsError(try InspectionDrafting.findings(summary: "", items: [], extras: [], condition: nil).get())
        var answered = InspectionDrafting.ItemDraft(); answered.verdict = "supports"
        XCTAssertThrowsError(try InspectionDrafting.findings(summary: "ok", items: [("c1", answered)], extras: [], condition: nil).get(),
                             "an answered item needs what was found")
        XCTAssertThrowsError(try InspectionDrafting.findings(summary: "ok", items: [("c1", .init())], extras: [], condition: nil).get(),
                             "at least one finding")
    }

    func testGrantDraftScopeAndWindow() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let open = try InspectionDrafting.grant(inspectionId: "i1", scope: " At my home, no test drive ", window: nil, now: now).get()
        XCTAssertEqual(open.p_scope, "At my home, no test drive")
        XCTAssertNil(open.p_window)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(open)) as! [String: Any]
        XCTAssertNil(json["p_window"], "no window sends none, so the server default applies")
        let windowed = try InspectionDrafting.grant(inspectionId: "i1", scope: "Lot", window: (now, now.addingTimeInterval(3600)), now: now).get()
        XCTAssertEqual(windowed.p_window?.from, InspectionDrafting.iso(now))
        XCTAssertThrowsError(try InspectionDrafting.grant(inspectionId: "i1", scope: "", window: nil, now: now).get())
        XCTAssertThrowsError(try InspectionDrafting.grant(inspectionId: "i1", scope: "Lot", window: (now, now), now: now).get())
        XCTAssertThrowsError(try InspectionDrafting.grant(inspectionId: "i1", scope: "Lot",
                                                          window: (now.addingTimeInterval(-7200), now.addingTimeInterval(-3600)), now: now).get())
    }
}
