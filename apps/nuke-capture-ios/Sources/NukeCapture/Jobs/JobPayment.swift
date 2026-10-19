// JobPayment.swift — pay an invoice through Stripe Checkout from a server-offered pay_invoice action.
//
// The phone composes no amount and decides no eligibility: the job path offers pay_invoice to the
// work order customer while a balance is due (work_order_customer_payment_actions), and
// create-work-order-invoice-checkout opens a hosted Stripe page for exactly that balance. Nothing is
// charged until the customer finishes on Stripe's page; the payment then reaches the job through
// stripe-webhook. Collection only: no payout or release to the provider.

import Foundation
import Supabase

extension JobReaders {
    static let invoiceCheckoutFunction = "create-work-order-invoice-checkout"

    struct InvoiceCheckout: Decodable {
        let checkout_url: String?
        let refused: String?
    }

    /// The work order the server offered payment for, when the action names the checkout function.
    static func payArguments(_ action: JobAction) -> String? {
        guard action.kind == "pay_invoice",
              (action.raw["function"]?.stringValue ?? invoiceCheckoutFunction) == invoiceCheckoutFunction,
              let id = action.args["work_order_id"]?.stringValue, !id.isEmpty else { return nil }
        return id
    }

    /// The amount line the server stated for this action ("USD 80.25"), or nil.
    static func payAmountText(_ action: JobAction) -> String? {
        guard case .number(let amount)? = action.raw["amount"], amount.isFinite, amount > 0,
              let currency = action.raw["currency"]?.stringValue else { return nil }
        return "\(currency) \(String(format: "%.2f", amount))"
    }

    /// Only an https page on stripe.com is opened.
    static func checkoutURL(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw), url.scheme == "https",
              let host = url.host, host == "stripe.com" || host.hasSuffix(".stripe.com") else { return nil }
        return url
    }

    static func payRefusalText(_ code: String?) -> String {
        switch code {
        case "not_the_customer": return "Only the customer on this job can pay its invoice."
        case "no_invoice": return "There is no invoice to pay yet."
        case "nothing_due": return "This invoice is already paid."
        case "currency_not_supported": return "This invoice's currency can't be paid by card yet."
        case "below_processor_minimum": return "The balance is below the card payment minimum."
        default: return "Payment isn't available right now. Refresh the job and try again."
        }
    }

    /// Opens Checkout for the balance the server offered. Called only from the Pay invoice button.
    static func invoiceCheckout(_ action: JobAction) async -> Result<URL, JobSignFailure> {
        guard let workOrderId = payArguments(action) else {
            return .failure(JobSignFailure(text: payRefusalText(nil)))
        }
        struct Body: Encodable { let work_order_id: String }
        do {
            let r: InvoiceCheckout = try await SupabaseService.client.functions.invoke(
                invoiceCheckoutFunction, options: FunctionInvokeOptions(body: Body(work_order_id: workOrderId)))
            if let url = checkoutURL(r.checkout_url) { return .success(url) }
            return .failure(JobSignFailure(text: payRefusalText(r.refused)))
        } catch FunctionsError.httpError(let code, let data) {
            let r = try? JSONDecoder().decode(InvoiceCheckout.self, from: data)
            if code == 401 { return .failure(JobSignFailure(text: "Sign in to pay this invoice.")) }
            return .failure(JobSignFailure(text: payRefusalText(r?.refused)))
        } catch {
            NSLog("NukeCapture %@ failed: %@", invoiceCheckoutFunction, String(describing: error))
            return .failure(JobSignFailure(text: payRefusalText(nil)))
        }
    }
}
