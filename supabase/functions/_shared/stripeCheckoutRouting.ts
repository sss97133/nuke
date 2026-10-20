/**
 * Decide what a completed Stripe Checkout session pays for.
 *
 * Before 2026-10-19 stripe-webhook credited the AI wallet for every completed session, so any checkout that was not a
 * credit purchase (the vehicle facilitation fee, a work-order invoice) would also have landed in the payer's wallet.
 * Sessions now carry `metadata.purchase_type`:
 *   - `work_order_invoice` -> record_work_order_processor_payment (create-work-order-invoice-checkout opens these);
 *   - `ai_wallet_topup` / `api_access_subscription`, or no purchase_type at all (create-checkout deposits) -> AI credit,
 *     exactly as before;
 *   - any other purchase_type -> ignored with a reason, never credited.
 */

export const CREDIT_PURCHASE_TYPES = new Set(["ai_wallet_topup", "api_access_subscription"]);

export interface CheckoutSessionLike {
  id: string;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
}

export type CheckoutRoute =
  | { kind: "work_order_invoice"; payload: Record<string, unknown> }
  | { kind: "ai_credit"; userId: string }
  | { kind: "ignore"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function routeCheckoutSession(
  event: { id: string; created: number; livemode: boolean },
  session: CheckoutSessionLike,
): CheckoutRoute {
  const meta = session.metadata ?? {};
  const purchaseType = meta.purchase_type ?? null;

  if (purchaseType === "work_order_invoice") {
    for (const k of ["work_order_id", "invoice_id", "payer_user_id"]) {
      if (!UUID.test(meta[k] ?? "")) return { kind: "ignore", reason: `work_order_invoice session without a valid ${k}` };
    }
    if (!meta.invoice_hash) return { kind: "ignore", reason: "work_order_invoice session without invoice_hash" };
    if (session.client_reference_id && session.client_reference_id !== meta.payer_user_id) {
      return { kind: "ignore", reason: "client_reference_id differs from payer_user_id" };
    }
    if (session.payment_status !== "paid") return { kind: "ignore", reason: `session payment_status ${session.payment_status}` };
    if (!Number.isInteger(session.amount_total) || (session.amount_total ?? 0) <= 0 || !session.currency) {
      return { kind: "ignore", reason: "session without a positive amount_total and currency" };
    }
    const pi = session.payment_intent;
    return {
      kind: "work_order_invoice",
      payload: {
        event_id: event.id,
        session_id: session.id,
        payment_intent_id: typeof pi === "string" ? pi : pi?.id ?? null,
        payment_status: session.payment_status,
        amount_minor: session.amount_total,
        currency: session.currency,
        livemode: event.livemode,
        created: event.created,
        work_order_id: meta.work_order_id,
        invoice_id: meta.invoice_id,
        invoice_hash: meta.invoice_hash,
        payer_user_id: meta.payer_user_id,
      },
    };
  }

  if (purchaseType !== null && !CREDIT_PURCHASE_TYPES.has(purchaseType)) {
    return { kind: "ignore", reason: `purchase_type ${purchaseType} is not a credit purchase` };
  }
  const userId = meta.user_id ?? session.client_reference_id ?? null;
  if (!userId) return { kind: "ignore", reason: "credit session without a user" };
  return { kind: "ai_credit", userId };
}
