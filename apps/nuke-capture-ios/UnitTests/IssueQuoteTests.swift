// IssueQuoteTests.swift — the quoting side's Issue quote / Revise quote. No writer is called.

import XCTest
import Supabase
@testable import NukeCapture

final class IssueQuoteTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    private func scope() throws -> QuoteScope {
        try decode(WorkOrderOperations.self, IssueQuoteFixtures.operationsRead).scope
    }

    func testOfferedOnlyFromTheIssuerAction() throws {
        let q = try decode(JobQuotes.self, IssueQuoteFixtures.noQuote)
        let a = try XCTUnwrap(q.issueQuoteAction)
        XCTAssertNil(IssueQuoteDrafting.supersedes(a))
        XCTAssertEqual(IssueQuoteCopy.title(a, current: nil), "Issue quote")
        XCTAssertEqual(IssueQuoteDrafting.vocabulary(a).map(\.kind),
                       ["customer_completion_sign", "inspector_attestation", "installed_parts_witness", "photos_in_window", "days_signed"])
        XCTAssertEqual(IssueQuoteDrafting.vocabulary(a).filter(\.takesDays).map(\.kind), ["days_signed"])
        let mine = try decode(JobQuotes.self, IssueQuoteFixtures.withQuote)
        let revise = try XCTUnwrap(mine.issueQuoteAction)
        XCTAssertEqual(IssueQuoteDrafting.supersedes(revise), "q1")
        XCTAssertEqual(mine.currentQuote?.issuedByViewer, true)
        XCTAssertEqual(IssueQuoteCopy.title(revise, current: mine.currentQuote), "Revise quote")
        let others = try decode(JobQuotes.self, IssueQuoteFixtures.withOthersQuote)
        XCTAssertEqual(others.currentQuote?.issuedByViewer, false)
        XCTAssertEqual(IssueQuoteCopy.title(try XCTUnwrap(others.issueQuoteAction), current: others.currentQuote), "Issue a new version")
        XCTAssertNil(try decode(JobQuotes.self, JobFixtures.quotesForCustomer).issueQuoteAction)    // customers are never offered it
    }

    func testLinesStartFromTheJobsOwnWork() throws {
        let s = try scope()
        XCTAssertEqual(s.operations.map(\.refId), ["op1", "op2"])                    // a withheld description is skipped
        XCTAssertEqual(s.requirements.map(\.refId), ["rq1", "rq2"])                  // a blank need is skipped
        XCTAssertEqual(s.parts.map(\.refId), ["pt1", "pt2"])
        XCTAssertEqual(s.parts[0].amount, 170)                                       // 2 × $85 recorded, as a flat starting price
        XCTAssertNil(s.parts[1].amount)                                              // comped: no starting price
        XCTAssertEqual(s.labor.map(\.refId), ["lb1"])
        let seeded = IssueQuoteDrafting.seed(scope: s, current: nil)
        XCTAssertEqual(seeded.map(\.refKind), ["operation", "operation", "part", "part", "labor", "requirement", "requirement"])
        XCTAssertEqual(seeded.map(\.included), [true, true, false, false, false, false, false])   // the rest start off when operations cover the work
        XCTAssertEqual(seeded[4].basis, .hourly)
        XCTAssertEqual(seeded[4].amount, "140")
        XCTAssertEqual(seeded[4].quantity, "2.5")
        XCTAssertEqual(IssueQuoteDrafting.seed(scope: .empty, current: nil).map(\.refKind), ["fee"])
        let current = try XCTUnwrap(decode(JobQuotes.self, IssueQuoteFixtures.withQuote).currentQuote)
        let revision = IssueQuoteDrafting.seed(scope: s, current: current)
        XCTAssertEqual(revision.map(\.refKind), ["operation", "fee", "requirement"])
        XCTAssertEqual(revision[1].refId, nil)
        XCTAssertEqual(revision[2].basis, .hourly)
        XCTAssertEqual(revision[2].quantity, "0.5")
        XCTAssertEqual(revision[0].amount, "420")
    }

    func testQuoteBodyFollowsTheLineRules() throws {
        let q = try decode(JobQuotes.self, IssueQuoteFixtures.withQuote)
        let action = try XCTUnwrap(q.issueQuoteAction)
        var lines = IssueQuoteDrafting.seed(scope: try scope(), current: q.currentQuote)
        lines[0].amount = "450"
        lines.append(IssueQuoteDrafting.LineDraft(refKind: "fee", refId: nil, description: "Disposal"))   // unpriced fee line
        let now = try XCTUnwrap(FacilityCopy.date("2026-10-19T12:00:00Z"))
        guard case .success(let p) = IssueQuoteDrafting.params(action: action, lines: lines, deposit: ("100", "usd"),
                                                               validUntil: now.addingTimeInterval(7 * 86_400),
                                                               conditions: ["customer_completion_sign", "days_signed", "bogus"], days: 7,
                                                               now: now) else { return XCTFail("refused") }
        XCTAssertEqual(p.p_work_order_id, IssueQuoteFixtures.workOrderId)
        XCTAssertEqual(p.p_supersedes_quote_id, "q1")
        XCTAssertEqual(p.p_deposit, .init(amount: 100, currency: "USD"))
        XCTAssertEqual(p.p_valid_until, "2026-10-26T12:00:00Z")
        XCTAssertEqual(p.p_lines[0], .object(["ref_kind": .string("operation"), "ref_id": .string("op1"), "description": .string("Replace front pads and rotors"),
                                               "pricing_basis": .string("flat"), "amount": .number(450), "currency": .string("USD")]))
        XCTAssertEqual(p.p_lines[1], .object(["ref_kind": .string("fee"), "description": .string("Shop supplies"), "pricing_basis": .string("flat"),
                                               "amount": .number(25), "currency": .string("USD")]))               // a fee has no ref_id
        XCTAssertEqual(p.p_lines[2], .object(["ref_kind": .string("requirement"), "ref_id": .string("rq2"), "description": .string("Road test"),
                                               "pricing_basis": .string("hourly"), "unit": .string("hour"), "amount": .number(160),
                                               "currency": .string("USD"), "quantity": .number(0.5)]))
        XCTAssertEqual(p.p_lines[3], .object(["ref_kind": .string("fee"), "description": .string("Disposal"), "pricing_basis": .string("flat")]))
        XCTAssertEqual(p.p_release_conditions, [.object(["kind": .string("customer_completion_sign")]),
                                                .object(["kind": .string("days_signed"), "days": .number(7)])])
        func refusal(_ ls: [IssueQuoteDrafting.LineDraft]) -> String? {
            if case .failure(let f) = IssueQuoteDrafting.params(action: action, lines: ls, deposit: nil, validUntil: nil, conditions: [], days: 7, now: now) {
                return f.text
            }
            return nil
        }
        var unpriced = lines
        for i in unpriced.indices { unpriced[i].amount = "" }
        XCTAssertEqual(refusal(unpriced), "Price at least one line — without prices it's an estimate, not a quote.")
        var flatQty = lines
        flatQty[0].quantity = "2"
        XCTAssertEqual(refusal(flatQty), "Line 1: a flat price has no quantity.")
        var badCur = lines
        badCur[0].currency = "dollars"
        XCTAssertEqual(refusal(badCur), "Line 1: currency is a 3-letter code, like USD.")
        var none = lines
        for i in none.indices { none[i].included = false }
        XCTAssertEqual(refusal(none), "A quote has 1 to 200 lines.")
        if case .success = IssueQuoteDrafting.params(action: action, lines: lines, deposit: nil, validUntil: now.addingTimeInterval(-60),
                                                     conditions: [], days: 7, now: now) { XCTFail("past validity accepted") }
        guard case .success(let bare) = IssueQuoteDrafting.params(action: action, lines: lines, deposit: nil, validUntil: nil, conditions: [], days: 7,
                                                                  now: now) else { return XCTFail("refused") }
        let body = try XCTUnwrap(String(data: JSONEncoder().encode(bare), encoding: .utf8))
        XCTAssertFalse(body.contains("p_deposit"))
        XCTAssertFalse(body.contains("p_release_conditions"))                        // none chosen: the platform standard
    }

    func testIssuedQuoteAndRefusalsReadPlainly() throws {
        let i = try decode(IssuedQuote.self, IssueQuoteFixtures.issued)
        XCTAssertEqual(i.line, "Version 2 · 3f9a1c0e")
        func words(_ m: String) -> String { IssueQuoteCopy.failure(PostgrestError(code: "23514", message: m)) }
        XCTAssertEqual(words("The customer cannot quote their own job"), "You're the customer on this job, so you can't quote it.")
        XCTAssertEqual(words("Work order unavailable for quoting"), "Only the shop's owner, an accepted technician or the job's technician can quote it.")
        XCTAssertEqual(words("Quote scope snapshot must equal the current work order scope"), "The job's work changed while you were quoting. Refresh and try again.")
        XCTAssertEqual(words("A quote prices at least one line; an unpriced scope is an estimate"),
                       "Price at least one line — without prices it's an estimate, not a quote.")
        XCTAssertEqual(words("Invalid quote line: {}"), "One of the lines isn't valid. Check its price, currency and quantity.")
        XCTAssertEqual(IssueQuoteCopy.doesNotSay.last, "That this is final — a new version replaces this one")
    }
}

final class VehicleAccessTests: XCTestCase {
    private func page(_ access: String?) throws -> MyWorkOrders {
        let viewer = access.map { #"{"context":"self","slots":[],"vehicle_access":\#($0)}"# } ?? #"{"context":"self","slots":[]}"#
        return try JobReaders.decode(MyWorkOrders.self, from: Data(#"{"rows":[],"viewer":\#(viewer)}"#.utf8))
    }

    func testPostAJobFollowsTheReadersVehicleAccess() throws {
        let holder = try page(#"{"role":"access_holder","can_post_work_request":true}"#)
        XCTAssertEqual(holder.canPostWorkRequest, true)
        XCTAssertEqual(VehicleWorkSection.postEntry(signedIn: true, ownerContext: false, jobs: .loaded(holder)), .post)   // access holders too
        let stranger = try page(#"{"can_post_work_request":false}"#)
        XCTAssertEqual(VehicleWorkSection.postEntry(signedIn: true, ownerContext: true, jobs: .loaded(stranger)), .inspect)
        let unstated = try page(nil)
        XCTAssertNil(unstated.canPostWorkRequest)
        XCTAssertEqual(VehicleWorkSection.postEntry(signedIn: true, ownerContext: true, jobs: .loaded(unstated)), .post)  // owner fallback
        XCTAssertEqual(VehicleWorkSection.postEntry(signedIn: true, ownerContext: false, jobs: .loaded(unstated)), .inspect)
        XCTAssertEqual(VehicleWorkSection.postEntry(signedIn: false, ownerContext: true, jobs: .loaded(holder)), .none)
    }
}

final class OperationsReadTests: XCTestCase {
    func testOperationsReadPlainly() throws {
        let o = try JobReaders.decode(WorkOrderOperations.self, from: Data(IssueQuoteFixtures.operationsRead.utf8))
        XCTAssertEqual(o.operations.map(OperationsCopy.title),
                       ["1. Replace front pads and rotors", "2. Bleed the brake lines", "3. Description withheld (it named a person)"])
        XCTAssertEqual(OperationsCopy.detail(o.operations[0]), "asked for by the customer · needs: skill")
        XCTAssertEqual(OperationsCopy.detail(o.operations[1]), "added by the technician · needs: inspection, skill")
        XCTAssertEqual(OperationsCopy.detail(o.operations[2]), "read from the job's description")
        XCTAssertEqual(o.operations[0].quoteRef, .init(ref_kind: "operation", ref_id: "op1"))
    }
}
