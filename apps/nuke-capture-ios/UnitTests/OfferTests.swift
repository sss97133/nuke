// OfferTests.swift — jobs looking for someone, the match table, offers and their Sign steps.
// No test calls offer_on_requirement, withdraw_offer or accept_offer; bodies are built locally.

import XCTest
import Supabase
@testable import NukeCapture

final class OfferTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testOpenRequirementsSignedOutCarryNoMatch() throws {
        let page = try decode(OpenRequirements.self, OfferFixtures.open(signedIn: false))
        XCTAssertFalse(page.signedIn)
        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(page.unreadableRows, 1)
        XCTAssertNil(page.rows[0].match)
        XCTAssertEqual(page.sentence, "2 open requests on 1 job on Nuke right now")
        XCTAssertEqual(page.rows[0].place, "Fixture City, NV")
        XCTAssertEqual(OpenRequirementRow.detail(page.rows[0]),
                       "1983 GMC K2500 Sierra Classic · Fixture City, NV · No quote yet · 0 candidates listed")
        XCTAssertEqual(OpenRequirementRow.detail(page.rows[1]),
                       "1983 GMC K2500 Sierra Classic · Oct 25, 2026 – Nov 1, 2026 · Quoted · 1 candidate listed")
        XCTAssertFalse(page.contact(for: page.rows[0])?.canRequest == true)
    }

    func testMatchTableReadsPlainly() throws {
        let page = try decode(OpenRequirements.self, OfferFixtures.open(signedIn: true))
        XCTAssertTrue(page.signedIn)
        let skill = try XCTUnwrap(page.rows[0].match)
        XCTAssertEqual(skill.map { "\(OfferCopy.input($0.input)) — \(OfferCopy.reason($0))" }, [
            "Skill — Not shown in your record yet",
            "Tools — Not needed for this",
            "Shop space — Not needed for this",
            "Area — Same city",
            "Availability — You haven't set availability yet",
            "Technician profile — Linked by you — not yet backed by work",
        ])
        let tool = try XCTUnwrap(page.rows[1].match)
        XCTAssertEqual(OfferCopy.reason(tool[1]), "You said you own: welder")
        XCTAssertEqual(OfferCopy.reason(tool[3]), "Your profile doesn't list an area")
        XCTAssertEqual(OfferCopy.next(tool[5].next), "link your technician profile")
        XCTAssertEqual(OfferCopy.next("plan_b_supplier_needed"), "needs a backup supplier")
        XCTAssertEqual(OfferCopy.symbol("fail").name, "minus.circle")          // a missing input is not a rejection
        let pinned = try XCTUnwrap(page.contact(for: page.rows[0]))
        XCTAssertTrue(pinned.canRequest)
        XCTAssertEqual(pinned.contextKind, "requirement")
        XCTAssertEqual(pinned.contextId, OfferFixtures.reqSkill)
    }

    func testOffersDecodeWithActionsAndAcceptedProvider() throws {
        let o = try decode(WorkOrderOffers.self, OfferFixtures.offers)
        XCTAssertEqual(o.requirements.count, 2)
        XCTAssertEqual(o.offerCount, 1)                                        // a broken offer is skipped
        let offer = o.requirements[0].offers[0]
        XCTAssertEqual(offer.who, "@fixture_painter")
        XCTAssertEqual(OfferCopy.rung(offer.offerRung), "Linked by them — not yet backed by work")
        XCTAssertEqual(offer.lines.map(JobCopy.linePrice), ["$380.00", "$95.00 / hour × 2"])
        XCTAssertEqual(OfferCopy.window(offer.availableFrom, offer.availableUntil), "Oct 25, 2026 – Nov 1, 2026")
        XCTAssertEqual(OfferCopy.acceptance(offer.acceptanceState), "Not accepted yet")
        XCTAssertNotNil(o.acceptAction(for: offer))
        XCTAssertNil(o.withdrawAction(for: offer.offerId))                     // the customer can't withdraw someone's offer
        let mine = try decode(WorkOrderOffers.self, OfferFixtures.offersView(provider: true))
        XCTAssertNotNil(mine.withdrawAction(for: offer.offerId))
        XCTAssertNil(mine.acceptAction(for: mine.requirements[0].offers[0]))
        XCTAssertNil(o.offerAction(for: OfferFixtures.reqSkill))
        let offerAction = try XCTUnwrap(o.offerAction(for: OfferFixtures.reqTool))
        XCTAssertEqual(OfferCopy.yourRung(offerAction.asFields["offer_rung"]?.stringValue), "Linked by you — not yet backed by work")
        XCTAssertEqual(o.acceptedProviders.first?.who, "@fixture_tech")
        XCTAssertEqual(JobOffersSection.title(o.requirements[1]), "Tool: MIG welder for exhaust hangers")
    }

    func testOfferBodyIsValidatedAndShapedForTheWriter() throws {
        let o = try decode(WorkOrderOffers.self, OfferFixtures.offers)
        let action = try XCTUnwrap(o.offerAction(for: OfferFixtures.reqTool))
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let lines = [OfferLineDraft(description: "Weld hangers", pricingBasis: "hourly", amount: "120", currency: "usd", quantity: "3"),
                     OfferLineDraft(description: "Travel", pricingBasis: "flat", amount: "40", currency: "USD", quantity: "9")]
        let from = now.addingTimeInterval(86_400), until = now.addingTimeInterval(86_400 * 3)
        guard case .success(let params) = OfferDrafting.params(action: action, lines: lines, window: (from, until), note: " Mobile ", now: now) else {
            return XCTFail("valid offer refused")
        }
        XCTAssertEqual(params.p_requirement_id, OfferFixtures.reqTool)
        XCTAssertEqual(params.p_terms.lines[0], .init(description: "Weld hangers", pricing_basis: "hourly", amount: 120, currency: "USD", unit: "hour", quantity: 3))
        XCTAssertEqual(params.p_terms.lines[1], .init(description: "Travel", pricing_basis: "flat", amount: 40, currency: "USD", unit: nil, quantity: nil))
        XCTAssertEqual(params.p_note, "Mobile")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(params.p_terms)) as? [String: Any])
        let first = try XCTUnwrap((json["lines"] as? [[String: Any]])?.last)
        XCTAssertNil(first["unit"])                                            // flat lines carry no unit or quantity
        XCTAssertNil(first["quantity"])

        func refused(_ lines: [OfferLineDraft], window: (Date, Date)? = nil, note: String = "") -> String? {
            if case .failure(let f) = OfferDrafting.params(action: action, lines: lines, window: window, note: note, now: now) { return f.text }
            return nil
        }
        XCTAssertEqual(refused([OfferLineDraft(description: "x", amount: "")]), "Each line needs an amount.")
        XCTAssertEqual(refused([OfferLineDraft(description: "x", amount: "10", currency: "US")]), "Each line needs a three-letter currency, like USD.")
        XCTAssertEqual(refused([OfferLineDraft(description: " ", amount: "10")]), "Each line needs a short description.")
        XCTAssertEqual(refused([OfferLineDraft(description: "x", amount: "10")], window: (until, from)),
                       "Pick a window in the future that starts before it ends.")
        XCTAssertEqual(refused([OfferLineDraft(description: "x", amount: "10")], note: "two\nlines"), "Keep the note to one line.")
        if case .success = OfferDrafting.params(action: JobAction(kind: "accept_offer"), lines: lines, window: nil, note: "", now: now) {
            XCTFail("a non-offer action must not build an offer")
        }
    }

    func testAcceptIsPinnedToTheOfferAndHash() throws {
        let o = try decode(WorkOrderOffers.self, OfferFixtures.offers)
        let offer = o.requirements[0].offers[0]
        let action = try XCTUnwrap(o.acceptAction(for: offer))
        let args = try XCTUnwrap(OfferDrafting.acceptArguments(action, offer: offer))
        XCTAssertEqual(args.id, OfferFixtures.offerId)
        XCTAssertEqual(args.hash, OfferFixtures.offerHash)
        let stale = JobAction(kind: "accept_offer", rpc: "accept_offer",
                              args: ["p_offer_id": .string(OfferFixtures.offerId), "p_offer_hash": .string("00")])
        XCTAssertNil(OfferDrafting.acceptArguments(stale, offer: offer))
        XCTAssertEqual(AcceptOfferSheet.notSaid, ["No payment is made", "The work isn't marked as started", "Other offers stay on record"])
        XCTAssertEqual(OfferSheet.notSaid, ["Nothing is booked until the customer accepts", "No payment is made", "Your contact details are not shared"])
    }

    func testFailureWords() throws {
        func offer(_ m: String) -> String { OfferCopy.offerFailure(PostgrestError(code: "42501", message: m)) }
        func accept(_ m: String) -> String { OfferCopy.acceptFailure(PostgrestError(code: "42501", message: m)) }
        XCTAssertEqual(offer("Offer unavailable: no_actor_link"), "Link your technician profile first (Account → Technician profile).")
        XCTAssertEqual(offer("Offer unavailable: individual_offers_cover_skill_and_inspection"),
                       "You can offer on skill and inspection needs. Tools and shop space are offered by a shop.")
        XCTAssertEqual(offer("Offer unavailable: customer_cannot_offer"), "You're the customer on this job.")
        XCTAssertEqual(accept("Offer hash does not match this offer"), "This offer or its co-signs changed since you opened it. Refresh and review it again.")
        XCTAssertEqual(accept("Offer cannot be accepted: offer_window_closed"), "Their availability window has passed.")
        XCTAssertEqual(accept("Offer unavailable"), "Only the customer on this job can accept offers.")
        XCTAssertEqual(try decode(OfferReceipt.self, OfferFixtures.offerReceipt).offerRung, "self_claim")
        XCTAssertEqual(JobCopy.fact("accepted_providers"), "Providers accepted")
        XCTAssertEqual(JobCopy.gap("provider_acceptance_withheld"), "A provider acceptance is on hold")
    }
}
