/** Stripe Checkout parameters for paying a work order invoice balance, from work_order_invoice_checkout's terms. */

export interface CheckoutTerms {
  work_order_id: string;
  vehicle_id: string | null;
  invoice_id: string;
  invoice_version: number;
  invoice_hash: string;
  currency: string;
  balance_due: number;
  amount_minor: number;
}

export function checkoutParams(terms: CheckoutTerms, userId: string, frontendUrl: string) {
  const back = terms.vehicle_id ? `${frontendUrl}/vehicle/${terms.vehicle_id}` : frontendUrl;
  const metadata = {
    purchase_type: "work_order_invoice",
    work_order_id: terms.work_order_id,
    invoice_id: terms.invoice_id,
    invoice_hash: terms.invoice_hash,
    invoice_version: String(terms.invoice_version),
    payer_user_id: userId,
  };
  return {
    params: {
      mode: "payment" as const,
      line_items: [{
        // No work order title or names: only the invoice version reaches Stripe.
        price_data: {
          currency: terms.currency.toLowerCase(),
          unit_amount: terms.amount_minor,
          product_data: { name: `Work order invoice, version ${terms.invoice_version}` },
        },
        quantity: 1,
      }],
      client_reference_id: userId,
      metadata,
      payment_intent_data: { metadata },
      success_url: `${back}?payment=received&work_order=${terms.work_order_id}`,
      cancel_url: back,
    },
    idempotencyKey: `wo-invoice:${terms.invoice_id}:${terms.invoice_hash}:${userId}:${terms.amount_minor}`,
  };
}
