// CloseoutTests.swift — completion, invoices, payments, evidence and the widened signature queue.
// No writer is called; every request body is built and checked locally.

import XCTest
import Supabase
@testable import NukeCapture

final class CloseoutTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    func testCompletionStatesInPlainWords() throws {
        let none = try XCTUnwrap(CompletionState(path: decode(JobPath.self, CloseoutFixtures.jobPath(attested: false, accepted: false, customer: true))))
        XCTAssertNil(none.attestation)
        XCTAssertEqual(none.scopeHash, CloseoutFixtures.scopeHash)
        XCTAssertEqual(CloseoutCopy.completion(none, isCustomer: true).text, "Not marked done yet")
        let waiting = try XCTUnwrap(CompletionState(path: decode(JobPath.self, CloseoutFixtures.jobPath(attested: true, accepted: false, customer: true))))
        XCTAssertEqual(waiting.attestation?.completionId, CloseoutFixtures.completionId)
        XCTAssertEqual(CloseoutCopy.completion(waiting, isCustomer: true).text, "Technician says it's done — waiting for you")
        XCTAssertEqual(CloseoutCopy.completion(waiting, isCustomer: false).text, "Technician says it's done — waiting for the customer")
        let done = try XCTUnwrap(CompletionState(path: decode(JobPath.self, CloseoutFixtures.jobPath(attested: true, accepted: true, customer: true))))
        XCTAssertEqual(CloseoutCopy.completion(done, isCustomer: true).text, "You confirmed it's done")
        XCTAssertEqual(CloseoutCopy.completion(done, isCustomer: true).status, .proven)
        let path = try decode(JobPath.self, CloseoutFixtures.jobPath(attested: true, accepted: false, customer: true))
        let shown = JobPathContent.visibleFacts(try XCTUnwrap(path.stages[.completion]).facts).map(\.key)
        XCTAssertFalse(shown.contains("provider_attestation"))                  // hashes and ids stay out of the fact rows
        XCTAssertFalse(shown.contains("scope_basis"))
        XCTAssertEqual(JobCopy.gap("no_customer_completion_acceptance"), "Customer hasn't confirmed it's done")
    }

    func testCompletionBodiesArePinned() throws {
        let waiting = try XCTUnwrap(CompletionState(path: decode(JobPath.self, CloseoutFixtures.jobPath(attested: true, accepted: false, customer: true))))
        let accept = try XCTUnwrap(CloseoutDrafting.accept(workOrderId: CloseoutFixtures.workOrderId, state: waiting))
        XCTAssertEqual(accept, .init(p_work_order_id: CloseoutFixtures.workOrderId, p_completion_id: CloseoutFixtures.completionId,
                                     p_completion_hash: CloseoutFixtures.completionHash))
        guard case .success(let attest) = CloseoutDrafting.attest(workOrderId: CloseoutFixtures.workOrderId, state: waiting, note: "  ") else {
            return XCTFail("attest refused")
        }
        XCTAssertEqual(attest.p_scope_hash, CloseoutFixtures.scopeHash)
        XCTAssertNil(attest.p_note)
        let none = try XCTUnwrap(CompletionState(path: decode(JobPath.self, CloseoutFixtures.jobPath(attested: false, accepted: false, customer: true))))
        XCTAssertNil(CloseoutDrafting.accept(workOrderId: CloseoutFixtures.workOrderId, state: none))
        XCTAssertEqual(MarkDoneSheet.doesNotSay, ["That the customer agrees", "Any payment", "The job's status changes"])
    }

    func testInvoiceForAPartyShowsPaymentsBalanceAndRelease() throws {
        let r = try decode(WorkOrderInvoices.self, CloseoutFixtures.invoices(party: true))
        XCTAssertTrue(r.isParty)
        let inv = try XCTUnwrap(r.current)
        XCTAssertEqual(inv.version, 2)
        XCTAssertEqual(inv.lines.count, 3)
        XCTAssertEqual(CloseoutCopy.linePrice(inv.lines[1], currency: inv.currency), "$100.00 / hour × 1.5 = $150.00")
        XCTAssertEqual(CloseoutCopy.change(inv.lines[1].change), "changed from the quote")
        XCTAssertEqual(CloseoutCopy.change(inv.lines[2].change), "not in the quote")
        XCTAssertEqual(CloseoutCopy.differences(inv.changes, total: inv.total, currency: inv.currency),
                       ["1 line changed", "1 line added", "Quote $440.00 → invoice $500.00 (+$60.00)"])
        XCTAssertEqual(CloseoutCopy.reconciliation(r.reconciliation, currency: "USD"), "Partly paid — $200.00 still due")
        XCTAssertEqual(r.payments?.map { CloseoutCopy.witness($0.side) }, ["Paid (reported by the customer)", "Received (confirmed by the shop)"])
        XCTAssertEqual(r.release?.met, false)
        XCTAssertEqual(r.release?.conditions.filter { !$0.met }.map { CloseoutCopy.releaseCondition($0.key) },
                       ["Customer confirmed it's done", "The shop confirmed the payment"])
        XCTAssertEqual(r.paymentAction?.asText, "payer")
        XCTAssertNil(r.issueAction)
        let shop = try decode(WorkOrderInvoices.self, CloseoutFixtures.invoices(party: true, asPayer: false))
        XCTAssertEqual(shop.paymentAction?.asText, "payee")
        XCTAssertNotNil(shop.issueAction)
        XCTAssertEqual(CloseoutCopy.moneyNote, "Nuke records payments; it doesn't move money.")
    }

    func testInvoiceForAVisitorWithholdsPayments() throws {
        let r = try decode(WorkOrderInvoices.self, CloseoutFixtures.invoices(party: false))
        XCTAssertFalse(r.isParty)
        XCTAssertNil(r.reconciliation)
        XCTAssertNil(r.release)
        XCTAssertNil(r.paymentAction)
        XCTAssertEqual(r.current?.total, 500)                                   // prices stay open
    }

    func testInvoiceBodyStartsFromTheAcceptedQuoteAndValidates() throws {
        let quote = try XCTUnwrap(decode(JobQuotes.self, JobFixtures.quotesForCustomer).currentQuote)
        let lines = CloseoutDrafting.linesFromQuote(quote)
        XCTAssertEqual(lines.map(\.quoteLine), [0, 1, 2, 3])
        XCTAssertEqual(lines[1].amount, "160")
        XCTAssertEqual(lines[1].quantity, "3")
        if case .success = CloseoutDrafting.invoice(workOrderId: "w", lines: lines, currency: "USD", quoteId: quote.quoteId, due: nil) {
            XCTFail("a day-rate line with no quantity must be refused")
        }
        var fixed = lines
        fixed[2].quantity = "1"
        fixed[3].amount = "25"
        fixed[3].quantity = "2"
        guard case .success(let p) = CloseoutDrafting.invoice(workOrderId: "w", lines: fixed, currency: "usd", quoteId: quote.quoteId, due: nil) else {
            return XCTFail("valid invoice refused")
        }
        XCTAssertEqual(p.p_lines.count, 4)
        XCTAssertEqual(p.p_lines[0], .init(quote_line: 0, description: "Fabricate exhaust", pricing_basis: "flat", amount: 1200, currency: "USD", unit: nil, quantity: nil))
        XCTAssertEqual(p.p_lines[1].unit, "hour")
        XCTAssertEqual(p.p_quote_id, quote.quoteId)
        var dup = fixed
        dup[1].quoteLine = 0
        if case .failure(let f) = CloseoutDrafting.invoice(workOrderId: "w", lines: dup, currency: "USD", quoteId: nil, due: nil) {
            XCTAssertEqual(f.text, "Each quote line can be invoiced once.")
        } else { XCTFail("duplicate quote line accepted") }
    }

    func testPaymentBodyRecordsNeverMoves() throws {
        let r = try decode(WorkOrderInvoices.self, CloseoutFixtures.invoices(party: true))
        let inv = try XCTUnwrap(r.current), action = try XCTUnwrap(r.paymentAction)
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        guard case .success(let p) = CloseoutDrafting.payment(action: action, invoice: inv, amount: "200", method: "zelle",
                                                              paidAt: now.addingTimeInterval(-3600), reference: "", now: now) else {
            return XCTFail("valid payment refused")
        }
        XCTAssertEqual(p.p_invoice_id, CloseoutFixtures.invoiceId)
        XCTAssertEqual(p.p_currency, "USD")
        XCTAssertNil(p.p_reference)
        func refused(_ amount: String, _ method: String = "cash", _ at: Date? = nil) -> String? {
            if case .failure(let f) = CloseoutDrafting.payment(action: action, invoice: inv, amount: amount, method: method,
                                                                paidAt: at ?? now, reference: "", now: now) { return f.text }
            return nil
        }
        XCTAssertEqual(refused("0"), "Enter the amount.")
        XCTAssertEqual(refused("10", "bitcoin"), "Pick how it was paid.")
        XCTAssertEqual(refused("10", "cash", now.addingTimeInterval(86_400)), "The payment date can't be in the future.")
        XCTAssertEqual(RecordPaymentSheet.payerDoesNotSay, ["Nuke moved any money", "The shop has confirmed it yet"])
    }

    func testEvidenceAttachesOnlyEligiblePhotos() throws {
        let c = try decode(EvidenceCandidates.self, CloseoutFixtures.evidence)
        XCTAssertEqual(c.workOrders.count, 2)
        XCTAssertEqual(c.items(for: CloseoutFixtures.workOrderId).count, 2)
        XCTAssertEqual(c.notAttachable, 4)
        XCTAssertEqual(c.doesNotBind.map(JobCopy.signDoesNotBind), ["Who can see the photos or who owns them", "That the work is done", "Any payment"])
        guard case .success(let p) = CloseoutDrafting.evidence(workOrderId: CloseoutFixtures.workOrderId,
                                                              imageIds: ["img-2", "img-3", "img-1", "img-2"], candidates: c) else {
            return XCTFail("eligible photos refused")
        }
        XCTAssertEqual(p.p_image_ids, ["img-2", "img-1"])                       // other jobs' and repeated photos drop out
        if case .success = CloseoutDrafting.evidence(workOrderId: CloseoutFixtures.workOrderId, imageIds: ["img-3"], candidates: c) {
            XCTFail("a photo from another job must not attach")
        }
        let job = c.workOrders[0]
        XCTAssertEqual(JobAttachChooser.fitting(job: job, candidates: c, uploaded: ["lid-a": "img-1", "lid-b": "img-9"]), ["img-1"])
        XCTAssertEqual(JobAttachChooser.footer(selected: 3, uploaded: 2, excluded: 4),
                       "1 selected photo isn't uploaded to Nuke, so it can't be filed. Personal or sensitive photos can't be attached. Only photos from a job's dates fit it.")
    }

    func testSignatureQueueRendersEveryKindOrAsksForAnUpdate() throws {
        let q = try decode(SignatureQueue.self, CloseoutFixtures.queue)
        XCTAssertEqual(q.items.count, 5)
        XCTAssertEqual(q.items.map { SignatureKinds.isKnown($0.kind) }, [true, true, true, true, false])
        XCTAssertEqual(q.items.prefix(4).map { JobCopy.action($0.kind) },
                       ["Confirm the work is done", "Confirm a payment you received", "Contact request", "Confirm work day"])
        XCTAssertEqual(["quote_to_accept", "offer_to_accept", "change_order_to_accept", "inspection_access_request", "cosign_request"].map(JobCopy.action),
                       ["Accept quote", "Accept offer", "Accept change order", "Let an inspector see your car", "Co-sign a technician"])
        let first = q.items[0]
        XCTAssertEqual(first.displayTitle, "Brake service")
        XCTAssertEqual(first.vehicle?.text, "1983 GMC K2500 Sierra Classic")
        XCTAssertEqual(first.summary, "@fixture_tech marked the work done.")
        XCTAssertEqual(first.sign?.bindsList, ["you agree the work is done as attested"])
        XCTAssertEqual(JobCopy.signBinds(first.sign?.binds), "You agree the work is done as attested")
        XCTAssertEqual(first.sign?.doesNotBind.map(JobCopy.signDoesNotBind), ["Any payment", "Paying anyone out"])
        XCTAssertEqual(q.items[3].sign?.binds, "self-confirmation of a photo-derived work day")   // the single-sentence form still reads
        XCTAssertEqual(JobCopy.state(.unknown("teleport_request")), "Needs a newer app version")
    }

    func testCloseoutFailureWords() {
        func text(_ m: String) -> String { CloseoutCopy.failure(PostgrestError(code: "23514", message: m)) }
        XCTAssertEqual(text("Scope hash does not match the current accepted quote or scope"), "The job changed since you opened it. Refresh and try again.")
        XCTAssertEqual(text("Completion is withheld: its quote or scope is no longer current"),
                       "The work changed since it was marked done. Ask the technician to mark it done again.")
        XCTAssertEqual(text("Personal, sensitive, misattributed or superseded images cannot be attached"), "Personal or sensitive photos can't be attached.")
        XCTAssertEqual(text("Payment currency must match the invoice currency"), "Use the invoice's currency.")
        XCTAssertEqual(text("Work order unavailable for completion"), "Only the job's technician or shop can do this.")
    }
}
