// JobPaymentTests.swift — the Pay invoice step passes back exactly what the server offered and opens only Stripe.

import XCTest
@testable import NukeCapture

final class JobPaymentTests: XCTestCase {
    private func viewer(_ actions: String) throws -> JobViewer {
        try JobReaders.decode(JobViewer.self, from: Data(#"{"context":"party","actions":\#(actions)}"#.utf8))
    }

    private let payAction = #"""
    [{"action":"pay_invoice","kind":"pay_invoice","stage":"accounting","function":"create-work-order-invoice-checkout",
      "args":{"work_order_id":"e7400000-0000-0000-0000-000000000001"},"invoice_version":2,"amount":80.25,"currency":"USD",
      "binds":["a card payment through Stripe of the balance due on this invoice version"],
      "does_not_bind":["acceptance of the work","release of funds to the provider"]}]
    """#

    func testPayActionDecodesWithServerArgumentsAndAmount() throws {
        let a = try XCTUnwrap(try viewer(payAction).actions.first)
        XCTAssertEqual(a.kind, "pay_invoice")
        XCTAssertEqual(JobReaders.payArguments(a), "e7400000-0000-0000-0000-000000000001")
        XCTAssertEqual(JobReaders.payAmountText(a), "USD 80.25")
        XCTAssertEqual(a.doesNotBind, ["acceptance of the work", "release of funds to the provider"])
        XCTAssertEqual(a.title, "Pay invoice")
    }

    func testOtherActionsAreNotPayable() throws {
        let start = try XCTUnwrap(try viewer(#"[{"action":"start_work","rpc":"start_work","args":{"p_work_order_id":"x"}}]"#).actions.first)
        XCTAssertNil(JobReaders.payArguments(start))
        let foreign = try XCTUnwrap(try viewer(#"[{"kind":"pay_invoice","function":"something-else","args":{"work_order_id":"x"}}]"#).actions.first)
        XCTAssertNil(JobReaders.payArguments(foreign))
        let bare = try XCTUnwrap(try viewer(#"["pay_invoice"]"#).actions.first)
        XCTAssertNil(JobReaders.payArguments(bare))
    }

    func testOnlyStripeHttpsPagesOpen() {
        XCTAssertNotNil(JobReaders.checkoutURL("https://checkout.stripe.com/c/pay/cs_live_abc"))
        XCTAssertNil(JobReaders.checkoutURL("http://checkout.stripe.com/c/pay/cs_live_abc"))
        XCTAssertNil(JobReaders.checkoutURL("https://stripe.com.evil.example/pay"))
        XCTAssertNil(JobReaders.checkoutURL("https://evilstripe.com/pay"))
        XCTAssertNil(JobReaders.checkoutURL(nil))
    }

    func testRefusalsReadAsPlainWords() {
        XCTAssertEqual(JobReaders.payRefusalText("nothing_due"), "This invoice is already paid.")
        XCTAssertEqual(JobReaders.payRefusalText("not_the_customer"), "Only the customer on this job can pay its invoice.")
        XCTAssertEqual(JobReaders.payRefusalText("anything_else"), "Payment isn't available right now. Refresh the job and try again.")
    }
}
