// CosignTests.swift — the co-signed accept fix, co-signs, vouches and change orders.
// No writer is called; bodies are built and checked locally.

import XCTest
import Supabase
@testable import NukeCapture

final class CosignTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testAcceptingACoSignedOfferSendsTheTermsHash() throws {
        let o = try decode(WorkOrderOffers.self, CosignFixtures.offers(customer: true))
        let offer = try XCTUnwrap(o.requirements.first?.offers.first)
        XCTAssertEqual(offer.offerHash, CosignFixtures.offerHash)
        XCTAssertEqual(offer.termsHash, CosignFixtures.termsHash)
        XCTAssertNotEqual(offer.offerHash, offer.termsHash)
        let action = try XCTUnwrap(o.acceptAction(for: offer))               // found by offer id, not by offer_hash
        let args = try XCTUnwrap(OfferDrafting.acceptArguments(action, offer: offer))
        XCTAssertEqual(args.hash, CosignFixtures.termsHash)                   // the server pins the terms hash
        let stale = JobAction(kind: "accept_offer", rpc: "accept_offer",
                              args: ["p_offer_id": .string(CosignFixtures.offerId), "p_offer_hash": .string(CosignFixtures.offerHash)])
        XCTAssertNil(OfferDrafting.acceptArguments(stale, offer: offer))      // the bare offer_hash is refused before sending
        let plain = try XCTUnwrap(decode(WorkOrderOffers.self, OfferFixtures.offers).requirements.first?.offers.first)
        XCTAssertEqual(plain.acceptHash, plain.offerHash)                     // no co-signs: the offer hash is the terms hash
        XCTAssertEqual(OfferCopy.acceptFailure(PostgrestError(code: "23514", message: "Offer hash does not match this offer and its current co-signs")),
                       "This offer or its co-signs changed since you opened it. Refresh and review it again.")
    }

    func testCoSignsReadPlainly() throws {
        let offer = try XCTUnwrap(decode(WorkOrderOffers.self, CosignFixtures.offers(customer: true)).requirements.first?.offers.first)
        XCTAssertEqual(offer.coSigns.map(CosignCopy.line), [
            "Co-signed by Fixture Garage: permission, supervision · cut 10% of labor",
            "Co-signed by Unnamed party: availability · cut $40.00 per day",
        ])
        XCTAssertEqual(CosignCopy.cut(.init(basis: "flat", percentage: nil, amount: 50, currency: "USD")), "cut $50.00 flat")
    }

    func testCosignBodyFromTheServersAction() throws {
        let o = try decode(WorkOrderOffers.self, CosignFixtures.offers(customer: false))
        let offer = try XCTUnwrap(o.requirements.first?.offers.first)
        let action = try XCTUnwrap(o.cosignAction(for: offer))
        XCTAssertNil(o.acceptAction(for: offer))
        XCTAssertEqual(action.actingFor.map(\.title), ["Fixture Garage", "Second Shop", "Yourself"])
        guard case .success(let p) = CosignDrafting.cosign(action: action, kinds: ["supervision", "permission", "bogus"], scope: " Our booth ",
                                                           cutBasis: .share_of_labor_line, value: "10", currency: "USD",
                                                           actingFor: action.actingFor[1].cut) else {
            return XCTFail("valid co-sign refused")
        }
        XCTAssertEqual(p.p_work_order_id, CosignFixtures.workOrderId)
        XCTAssertEqual(p.p_offer_id, CosignFixtures.offerId)
        XCTAssertEqual(p.p_kinds, ["permission", "supervision"])
        XCTAssertEqual(p.p_scope, "Our booth")
        XCTAssertEqual(p.p_cut, .object(["basis": .string("share_of_labor_line"), "percentage": .number(10), "organization_id": .string("o2")]))
        guard case .success(let noCut) = CosignDrafting.cosign(action: action, kinds: ["permission"], scope: "Booth", cutBasis: .none, value: "",
                                                               currency: "USD", actingFor: action.actingFor[0].cut) else { return XCTFail("refused") }
        XCTAssertEqual(noCut.p_cut, .object(["organization_id": .string("o1")]))       // the capacity is sent even without a cut
        guard case .success(let day) = CosignDrafting.cosign(action: action, kinds: ["availability"], scope: "Sat", cutBasis: .day_rate,
                                                             value: "40", currency: "usd", actingFor: action.actingFor[2].cut) else { return XCTFail("day rate refused") }
        XCTAssertEqual(day.p_cut, .object(["basis": .string("day_rate"), "amount": .number(40), "currency": .string("USD"),
                                           "unit": .string("day"), "as": .string("self")]))
        if case .failure(let f) = CosignDrafting.cosign(action: action, kinds: ["supervision"], scope: "x", cutBasis: .share_of_labor_line,
                                                        value: "150", currency: "USD") {
            XCTAssertEqual(f.text, "The cut is a percentage between 0 and 100.")
        } else { XCTFail("over 100% accepted") }
        XCTAssertEqual(CosignCopy.cosignDoesNotSay.count, 3)
    }

    func testVouchesShowApartFromSkills() throws {
        let p = try decode(ProviderProfile.self, CosignFixtures.vouches)
        XCTAssertEqual(p.vouches.count, 2)
        XCTAssertTrue(p.capabilities.isEmpty)
        XCTAssertEqual(ProviderFaceContent.vouchLine(p.vouches[0]), "Fixture Garage: suitability, supervision")
        XCTAssertEqual(ProviderFaceContent.vouchLine(p.vouches[1]), "Unnamed party: availability")
        XCTAssertEqual(p.tools?.authenticatedAttestations, 2)
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        guard case .success(let v) = CosignDrafting.vouch(subjectUserId: "p1", kinds: ["suitability"], scope: " K5 wiring ",
                                                          expires: now.addingTimeInterval(86_400), now: now) else { return XCTFail("vouch refused") }
        XCTAssertEqual(v.p_kinds, ["suitability"])
        XCTAssertEqual(v.p_scope, "K5 wiring")
        XCTAssertNotNil(v.p_expires_at)
        if case .success = CosignDrafting.vouch(subjectUserId: "p1", kinds: ["suitability"], scope: "x", expires: now, now: now) {
            XCTFail("past expiry accepted")
        }
        XCTAssertEqual(CosignCopy.failure(PostgrestError(code: "42501", message: "Cannot vouch for oneself")), "You can't vouch for yourself.")
    }

    func testChangeOrderReadsLineByLine() throws {
        let q = try decode(JobQuotes.self, CosignFixtures.changeOrderQuotes)
        let quote = try XCTUnwrap(q.currentQuote)
        XCTAssertTrue(quote.isChangeOrder)
        let co = try XCTUnwrap(quote.changeOrder)
        XCTAssertEqual(co.reason, "Stainless was back-ordered; customer asked for mild steel.")
        XCTAssertEqual(co.changes.map { ChangeOrderCopy.line($0, currency: "USD") }, [
            "Substituted material: 304 stainless TIG → mild steel MIG ($1,200.00 → $900.00)",
            "Changed: Labor: $160.00 / hour × 3 → $160.00 / hour × 4",
            "Removed: Road test",
            "Added: Heat shields — $120.00",
        ])
        let action = try XCTUnwrap(q.acceptAction)                           // accepted like any quote version
        XCTAssertNotNil(AcceptQuoteSheet.self)
        XCTAssertNotNil(JobReaders.acceptArguments(action, quote: quote))
        XCTAssertNil(q.changeOrderAction)
    }

    func testChangeOrderBodyFromTheAcceptedQuote() throws {
        let q = try decode(JobQuotes.self, CosignFixtures.acceptedForIssuer)
        let quote = try XCTUnwrap(q.currentQuote)
        let action = try XCTUnwrap(q.changeOrderAction)
        var lines = quote.lines.map(ChangeOrderDrafting.BaseLine.init)
        lines[1].state = .modify
        lines[1].quantity = "4"
        lines[2].state = .remove
        let added = [CloseoutDrafting.InvoiceLineDraft(description: "Heat shields", amount: "120")]
        let subs = [ChangeOrderDrafting.Substitution(specId: "sp1", field: "material", toKey: "Mild_Steel", toLabel: "mild steel MIG")]
        guard case .success(let p) = ChangeOrderDrafting.params(action: action, quote: quote, lines: lines, added: added,
                                                                substitutions: subs, reason: " Back-ordered ") else { return XCTFail("refused") }
        XCTAssertEqual(p.p_base_quote_id, "q2")
        XCTAssertEqual(p.p_reason, "Back-ordered")
        XCTAssertEqual(p.p_changes.count, 4)
        guard case .object(let modify) = p.p_changes[0], case .object(let line)? = modify["line"] else { return XCTFail("modify shape") }
        XCTAssertEqual(modify["action"], .string("modify"))
        XCTAssertEqual(modify["line_index"], .number(1))
        XCTAssertEqual(line["ref_kind"], .string("labor"))
        XCTAssertEqual(line["ref_id"], .string("l1"))
        XCTAssertEqual(line["quantity"], .number(4))
        XCTAssertEqual(p.p_changes[1], .object(["action": .string("remove"), "line_index": .number(2)]))
        guard case .object(let add) = p.p_changes[2], case .object(let addLine)? = add["line"] else { return XCTFail("add shape") }
        XCTAssertEqual(addLine["ref_kind"], .string("fee"))
        XCTAssertEqual(addLine["ref_id"], .null)
        XCTAssertEqual(p.p_changes[3], .object(["action": .string("substitute"), "specification_id": .string("sp1"), "field": .string("material"),
                                                "from_key": .string("stainless_304"), "to_key": .string("mild_steel"),
                                                "to_label": .string("mild steel MIG")]))
        if case .failure(let f) = ChangeOrderDrafting.params(action: action, quote: quote, lines: lines, added: [], substitutions: [], reason: "") {
            XCTAssertEqual(f.text, "Say why the work changed.")
        } else { XCTFail("missing reason accepted") }
        if case .failure(let f) = ChangeOrderDrafting.params(action: action, quote: quote, lines: quote.lines.map(ChangeOrderDrafting.BaseLine.init),
                                                             added: [], substitutions: [], reason: "x") {
            XCTAssertEqual(f.text, "Change at least one thing.")
        } else { XCTFail("no-op change order accepted") }
    }
}
