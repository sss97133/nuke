// JobQuoteTests.swift — quotes, the accept Sign, vehicle work lists and statements.
//
// Prices are open; payments and balances only for parties; people by handle or "Unnamed party";
// accounting withheld from non-parties; the accept step passes back exactly what the server offered.

import XCTest
import Supabase
@testable import NukeCapture

final class JobQuoteTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JobReaders.decode(T.self, from: Data(json.utf8))
    }

    // MARK: Job path for a visitor

    func testAnonJobPathUsesOpenHeaderAndWithheldAccounting() throws {
        let p = try decode(JobPath.self, JobFixtures.anonJobPath)
        XCTAssertEqual(p.displayTitle, "Exhaust fabrication")
        XCTAssertEqual(p.displayTitleBasis, "title")
        XCTAssertEqual(p.vehicleLabel?.text, "1983 GMC K2500 Sierra Classic")
        XCTAssertEqual(p.requestSourceLabel, "Requested on the web")
        let accounting = try XCTUnwrap(p.stages[.accounting])
        XCTAssertEqual(accounting.state, .withheld)
        XCTAssertNil(JobRung.status(accounting))
        XCTAssertEqual(JobCopy.stateLine(.withheld), "Payments are shown to the people on this job")
        let rail = JobStageRail(path: p)
        XCTAssertEqual(JobStageRail.symbol(rail.dots.first { $0.key == .accounting }!), "lock.circle")
        XCTAssertEqual(p.viewer?.context, .visitor)
    }

    func testTermsQuoteFieldsNeverShowIdsOrHashes() throws {
        let terms = try XCTUnwrap(try decode(JobPath.self, JobFixtures.anonJobPath).stages[.terms])
        let shown = JobPathContent.visibleFacts(terms.facts).map(\.key)
        XCTAssertFalse(shown.contains("current_quote"))
        XCTAssertFalse(shown.contains("quote_clock_basis"))
        XCTAssertTrue(shown.contains("quote_versions"))
        XCTAssertEqual(JobCopy.fact("quote_versions"), "Quote versions")
        XCTAssertEqual(JobCopy.gap("acceptance_withheld_scope_changed_since_quote"),
                       "Acceptance on hold: the work changed since the quote")
        XCTAssertEqual(JobCopy.factValue("approval_signer", .null), "Not accepted yet")
        let signer = JobJSON.object(["role": .string("customer"), "acceptance_id": .string(JobFixtures.quoteId),
                                     "basis": .string("authenticated_sign")])
        XCTAssertEqual(JobCopy.factValue("approval_signer", signer), "The customer, signed through Nuke")
        XCTAssertEqual(JobCopy.factValue("customer_acceptance", .string("signed")), "Signed")
        XCTAssertEqual(JobCopy.value(.string(JobFixtures.quoteId)), "On record")
        XCTAssertEqual(JobCopy.value(.string(JobFixtures.quoteHash)), "On record")
        XCTAssertEqual(JobCopy.value(.object(["quote_id": .string("x"), "version": .number(2)])), "version 2")
    }

    // MARK: Quotes

    func testQuoteForTheCustomerDecodesLinesTotalsDepositAndTheOfferedSign() throws {
        let q = try decode(JobQuotes.self, JobFixtures.quotesForCustomer)
        let quote = try XCTUnwrap(q.currentQuote)
        XCTAssertEqual(quote.version, 2)
        XCTAssertEqual(quote.versionLine, "Version 2 · Revised once")
        XCTAssertEqual(quote.quotingParty?.text, "@fixture_shop")
        XCTAssertTrue(quote.quotingParty?.signedThroughNuke == true)
        XCTAssertEqual(quote.lines.count, 4)
        XCTAssertEqual(quote.lines.map(\.index), [0, 1, 2, 3])
        XCTAssertEqual(JobCopy.linePrice(quote.lines[0]), "$1,200.00")
        XCTAssertEqual(JobCopy.linePrice(quote.lines[1]), "$160.00 / hour × 3")
        XCTAssertEqual(JobCopy.linePrice(quote.lines[2]), "$400.00 / day")
        XCTAssertEqual(JobCopy.linePrice(quote.lines[3]), "Not priced")
        XCTAssertEqual(JobCopy.lineLabel(quote.lines[3]), "Line (details hidden to protect a name)")
        XCTAssertEqual(quote.unpricedLines, 1)
        let total = JobCopy.total(try XCTUnwrap(quote.totals.first))
        XCTAssertEqual(total.value, "$1,680.00")
        XCTAssertNotNil(total.note)
        XCTAssertEqual(quote.depositRequested, DepositRequest(amount: 300, currency: "USD"))
        XCTAssertEqual(JobCopy.day(quote.validUntil), "Nov 15, 2026")
        XCTAssertEqual(q.history.map(\.version), [1, 2])
        XCTAssertEqual(JobCopy.acceptance(q.acceptance), "Not accepted yet")
        let action = try XCTUnwrap(q.acceptAction)
        XCTAssertEqual(action.rpc, "accept_work_order_quote")
        let args = try XCTUnwrap(JobReaders.acceptArguments(action, quote: quote))
        XCTAssertEqual(args.id, JobFixtures.quoteId)
        XCTAssertEqual(args.hash, JobFixtures.quoteHash)
        XCTAssertEqual(q.vehicleLabel?.text, "1983 GMC K2500 Sierra Classic")
    }

    func testAcceptArgumentsMustNameThisExactVersion() throws {
        let q = try decode(JobQuotes.self, JobFixtures.quotesForCustomer)
        let quote = try XCTUnwrap(q.currentQuote)
        let stale = JobAction(kind: "accept_quote", rpc: "accept_work_order_quote",
                              args: ["p_quote_id": .string(JobFixtures.quoteId), "p_quote_hash": .string("00")])
        XCTAssertNil(JobReaders.acceptArguments(stale, quote: quote))
        let otherWriter = JobAction(kind: "accept_quote", rpc: "something_else",
                                    args: ["p_quote_id": .string(JobFixtures.quoteId), "p_quote_hash": .string(JobFixtures.quoteHash)])
        XCTAssertNil(JobReaders.acceptArguments(otherWriter, quote: quote))
        XCTAssertNil(JobReaders.acceptArguments(JobAction(kind: "accept_quote"), quote: quote))
    }

    func testAcceptedQuoteForAVisitorShowsNoSignAndNamesNoOne() throws {
        let q = try decode(JobQuotes.self, JobFixtures.quotesAcceptedForVisitor)
        XCTAssertNil(q.acceptAction)
        let quote = try XCTUnwrap(q.currentQuote)
        XCTAssertEqual(quote.quotingParty?.text, "Fixture Garage")
        XCTAssertFalse(quote.quotingParty?.signedThroughNuke == true)
        XCTAssertEqual(quote.lines.first?.amount, 450.5)                 // a numeric string is read
        XCTAssertEqual(quote.versionLine, "Version 1")
        XCTAssertEqual(q.acceptance?.signer?.text, "Unnamed party")
        XCTAssertEqual(JobCopy.acceptance(q.acceptance), "Accepted by the customer · Oct 18, 2026")
        XCTAssertEqual(q.history.count, 2)                                 // a withdrawn version still decodes
        XCTAssertNil(try decode(JobQuotes.self, JobFixtures.quotesNone).currentQuote)
    }

    func testAcceptReceiptAndFailureWords() throws {
        let r = try decode(QuoteAcceptanceReceipt.self, JobFixtures.acceptReceipt)
        XCTAssertFalse(r.duplicate)
        XCTAssertFalse(r.depositCollected)
        XCTAssertFalse(r.paymentAuthorized)
        XCTAssertEqual(r.quoteVersion, 2)
        func text(_ code: String, _ message: String) -> String {
            JobReaders.acceptFailureText(PostgrestError(code: code, message: message))
        }
        XCTAssertEqual(text("23514", "Quote hash does not match this quote version"),
                       "This quote changed since you opened it. Refresh and review it again.")
        XCTAssertEqual(text("42501", "Quote cannot be accepted: quote_expired"), "This quote has expired. Ask for a new one.")
        XCTAssertEqual(text("42501", "Quote cannot be accepted: scope_changed_since_quote"),
                       "The work changed since this quote. Ask for an updated quote.")
        XCTAssertEqual(text("42501", "Quote unavailable"), "Only the customer on this job can accept this quote.")
        XCTAssertEqual(AcceptQuoteSheet.notSaid, ["No payment is made", "No deposit is collected", "The work is not marked as started"])
    }

    func testPeopleLabels() throws {
        XCTAssertEqual(try decode(JobPerson.self, #"{"kind":"user","profile_id":"x","handle":"tech"}"#).text, "@tech")
        XCTAssertEqual(try decode(JobPerson.self, #"{"kind":"user","label":"unnamed party"}"#).text, "Unnamed party")
        XCTAssertEqual(try decode(JobPerson.self, #"{"kind":"organization","organization_id":"x","name":"Shop"}"#).text, "Shop")
        XCTAssertEqual(try decode(JobPerson.self, #"{"kind":"actor","actor_id":"x","role":"mechanic","label":"unnamed party"}"#).text, "Unnamed party")
    }

    // MARK: Vehicle work list

    func testVehicleWorkOrdersDecodeTheOpenList() throws {
        let page = try decode(MyWorkOrders.self, JobFixtures.vehicleWorkOrders)
        XCTAssertEqual(page.rows.count, 2)
        XCTAssertEqual(page.vehicleLabel?.text, "1983 GMC K2500 Sierra Classic")
        XCTAssertEqual(page.coverage?.totalForVehicle, 2)
        XCTAssertEqual(page.coverage?.sentence, "Showing 2 of 2 work orders")
        XCTAssertEqual(page.rows[0].stageStates[.accounting], .withheld)
        XCTAssertEqual(page.rows[0].headline, "Exhaust fabrication")
        XCTAssertEqual(page.rows[1].headline, "Work order on 1983 GMC K2500 Sierra Classic")
        XCTAssertEqual(page.rows[1].inconsistencyCount, 1)
        XCTAssertEqual(JobReaders.refusal("vehicle_work_orders_read", PostgrestError(code: "P0001", message: "Vehicle unavailable")).kind,
                       .unavailable)
    }

    // MARK: Statement

    func testStatementForAVisitorWithholdsPaymentsAndRendersNoContact() throws {
        let s = try decode(JobStatement.self, JobFixtures.statementVisitor)
        XCTAssertNil(s.error)
        XCTAssertEqual(s.vehicleLabel?.text, "1983 GMC K2500 Sierra Classic")
        XCTAssertEqual(s.shop?.name, "Fixture Garage")
        XCTAssertEqual(s.shop?.place, "Fixture City, NV")
        XCTAssertEqual(s.contact?.action, "contact_via_nuke")
        XCTAssertFalse(s.contact?.available == true)
        XCTAssertEqual(s.totals?.subtotal, 1211)
        XCTAssertNil(s.totals?.payments)
        XCTAssertNil(s.totals?.balance)
        let wo = try XCTUnwrap(s.workOrders.first)
        XCTAssertFalse(wo.moneyVisible)
        XCTAssertNil(wo.payments)
        XCTAssertNil(wo.balanceDue)
        XCTAssertEqual(wo.parts.count, 2)
        XCTAssertEqual(wo.parts[1].total, 40)                               // unit × quantity when no total
        XCTAssertTrue(wo.parts[1].comped)
        XCTAssertEqual(VehicleStatementContent.partLine(wo.parts[0]), "2 × $85.50 = $171.00")
        XCTAssertEqual(VehicleStatementContent.laborLine(wo.labor[0]), "6.5 h × $160.00 = $1,040.00")
        XCTAssertEqual(JobCopy.workStatus(wo.status), "Completed")
    }

    func testStatementForAPartyShowsPaymentsAndBalance() throws {
        let s = try decode(JobStatement.self, JobFixtures.statementParty)
        XCTAssertEqual(s.totals?.payments, 500)
        XCTAssertEqual(s.totals?.balance, 711)
        let wo = try XCTUnwrap(s.workOrders.first)
        XCTAssertTrue(wo.moneyVisible)
        XCTAssertEqual(wo.payments?.first?.amount, 500)
        XCTAssertEqual(wo.balanceDue, 711)
        XCTAssertEqual(try decode(JobStatement.self, JobFixtures.statementNoMatch).error, "no_match")
    }
}
