// ParityTests.swift — technician setup, publication, plan-B suppliers, business claims and invites. No writer is called.

import XCTest
import Supabase
@testable import NukeCapture

final class ParityTests: XCTestCase {
    private func json(_ s: String) throws -> JobJSON { try JobReaders.decode(JobJSON.self, from: Data(s.utf8)) }
    private func decode<T: Decodable>(_ t: T.Type, _ s: String) throws -> T { try JobReaders.decode(T.self, from: Data(s.utf8)) }

    func testSuggestionsReadPlainly() throws {
        let s = ProviderSuggestions(json: try json(ParityFixtures.suggestions))
        XCTAssertEqual(s.actors.first?.name, "Unnamed mechanic record")
        XCTAssertEqual(s.actors.first?.id, ParityFixtures.actorId)
        XCTAssertEqual(s.actors.first?.evidence, "2 direct, 35 corroborating — 35 photos or records of yours, 2 work days of yours")
        XCTAssertEqual(s.actors.first?.claimRow?["verification_method"], .string("self_claim"))
        XCTAssertEqual(s.shops.first?.evidence, "120 of your photos on 9 days within 150 m · Sep 1, 2026 – Oct 15, 2026")
        XCTAssertEqual(s.records.first?.detail, "Fixture Garage · Oct 1, 2026 · 3 h recorded · verified by the shop")
        XCTAssertEqual(ProviderSuggestions.confirmation("changed_since_confirmed"), "Changed since you confirmed it")
    }

    func testChecklistAndBuilders() throws {
        let own = try decode(OwnProviderRow.self, ParityFixtures.ownRow)
        let items = ProviderSetupDrafting.checklist(ProviderSetupProfile(json: try json(ParityFixtures.selfProfile)), own: own)
        XCTAssertEqual(items.first { $0.key == "public" }?.state, .done)
        XCTAssertEqual(items.first { $0.key == "trade" }?.state, .done)
        XCTAssertEqual(items.first { $0.key == "area" }?.state, .missing)
        XCTAssertEqual(items.first { $0.key == "vouches" }?.state == .optional || items.first { $0.key == "vouches" }?.state == .done, true)
        guard case .success(let a) = ProviderSetupDrafting.area(city: "  Boulder   City ", state: "nv", radius: "30", mobile: true) else { return XCTFail() }
        XCTAssertEqual(a, .init(p_city: "Boulder City", p_state: "NV", p_radius_miles: 30, p_mobile: true))
        if case .success = ProviderSetupDrafting.area(city: "123 Main St", state: "NV", radius: "30", mobile: false) { XCTFail("street accepted") }
        let days = (0..<7).map { ProviderSetupDrafting.DayDraft(on: $0 == 1, start: "08:00", end: "17:00") }
        guard case .success(let w) = ProviderSetupDrafting.availability(timezone: "America/Los_Angeles", days: days, keep: []) else { return XCTFail() }
        XCTAssertEqual(w.p_windows, .object(["timezone": .string("America/Los_Angeles"),
                                             "weekly": .array([.object(["dow": .number(1), "start": .string("08:00"), "end": .string("17:00")])]),
                                             "exceptions": .array([])]))
        var bad = days; bad[1].end = "07:00"
        if case .failure(let f) = ProviderSetupDrafting.availability(timezone: "UTC", days: bad, keep: []) {
            XCTAssertEqual(f.text, "Mon: start before end, as HH:MM.")
        } else { XCTFail("end before start accepted") }
        if case .failure(let f) = ProviderSetupDrafting.trade(profession: "mechanic", expertise: "call 702-555-0101") {
            XCTAssertEqual(f.text, "Take out phone numbers and emails.")
        } else { XCTFail("contact accepted") }
        let keys = try decode([ToolKey].self, ParityFixtures.toolKeys)
        XCTAssertEqual(ProviderSetupDrafting.keys(keys, description: "Miller MIG welder", category: "lift"), ["facility.lift", "welding.mig"])
        XCTAssertEqual(ProviderSetupDrafting.keyWords("welding.mig"), "welding · mig")
    }

    func testPublicationActionsAndRefusal() throws {
        let p = try decode(WorkOrderPublication.self, ParityFixtures.publication(visibility: "not_published"))
        XCTAssertTrue(p.party)
        XCTAssertEqual(p.actions.map(PublicationCopy.button), ["Open it to technicians", "Publish invite only"])
        XCTAssertEqual(PublicationCopy.params(p.actions[0], workOrderId: JobFixtures.workOrderId), .init(p_work_order_id: JobFixtures.workOrderId, p_visibility: "open"))
        XCTAssertNil(PublicationCopy.params(p.actions[0], workOrderId: "another-job"))
        XCTAssertEqual(PublicationCopy.doesNotSay(p.actions[0]).last, "Your contact details — people reach you through Nuke")
        let refused = try decode(WorkOrderPublication.self, ParityFixtures.publication(visibility: "invite_only", personal: true))
        XCTAssertNotNil(PublicationCopy.refusal(refused.actions[0]))
        XCTAssertNil(PublicationCopy.params(refused.actions[0], workOrderId: JobFixtures.workOrderId))     // never sent while refused
        let open = try decode(WorkOrderPublication.self, ParityFixtures.publication(visibility: "open"))
        XCTAssertEqual(open.actions.map(PublicationCopy.button), ["Stop listing it"])
        XCTAssertEqual(PublicationCopy.visibility("invite_only"), "Invite only: its needs are recorded but not listed")
    }

    func testPlanBSuppliersAndBusinesses() throws {
        let page = try decode(OpenRequirements.self, ParityFixtures.openWithPlanB(signedIn: true))
        let tool = try XCTUnwrap(page.rows.first { $0.kind == "tool" })
        XCTAssertEqual(tool.planB.map(\.line), ["Fixture Welding Supply · Paid for this before on Nuke (3 times) · Not on Nuke yet",
                                                "Claimed Parts Co · Paid for this before on Nuke (1 time) · Claimed on Nuke"])
        let s = try decode(OrgSupply.self, ParityFixtures.supply)
        XCTAssertFalse(s.onNuke.claimed)
        XCTAssertEqual(s.onNuke.methods, ["domain_email", "document"])
        XCTAssertEqual(s.kinds.map(OrgSupplyCopy.kind), ["Brake parts · 3 times · Mar 1, 2026 – Oct 2, 2026", "Fluids · 1 time · Sep 10, 2026"])
        guard case .success(let doc) = ClaimDrafting.params(orgId: "o", method: "document", documentType: "tax_id", documentURL: " https://x.com/a.pdf ") else { return XCTFail() }
        XCTAssertEqual(doc.p_evidence, ["verification_type": "tax_id", "document_url": "https://x.com/a.pdf"])
        if case .success = ClaimDrafting.params(orgId: "o", method: "document", documentType: "tax_id", documentURL: "http://x.com") { XCTFail("http accepted") }
        let inv = try decode(SupplierInvite.self, ParityFixtures.invite)
        XCTAssertEqual(inv.url?.absoluteString, "https://nuke.ag/supplier-invite/" + String(repeating: "7c", count: 32))
        XCTAssertEqual(OrgSupplyCopy.failure(PostgrestError(code: "54000", message: "Invite limit reached (20 per day)")), "You've sent 20 invites today; try again tomorrow.")
        XCTAssertEqual(OrgSupplyCopy.failure(PostgrestError(code: "22023", message: "A free e-mail domain cannot prove a business; claim with a document")),
                       "A free e-mail address can't prove a business; claim it with a document.")
    }
}
