/**
 * Decide what a completed Stripe Checkout session pays for.
 *
 * Before 2026-10-19 stripe-webhook credited the AI wallet for every completed session, so any checkout that was not a
 * credit purchase (the vehicle facilitation fee, a work-order invoice) would also have landed in the payer's wallet.
 * Sessions now carry `metadata.purchase_type`:
 *   - `work_order_invoice` -> record_work_order_processor_payment (create-work-order-invoice-checkout opens these);
 *   - `source_refresh` -> stored source quote/payment receipt, never a personal wallet credit;
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
  mode?: string | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
}

export type CheckoutRoute =
  | { kind: "work_order_invoice"; payload: Record<string, unknown> }
  | { kind: "source_refresh"; payload: Record<string, unknown> }
  | { kind: "ai_credit"; userId: string }
  | { kind: "ignore"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refunds are incoming payer cash testimony, not a fabricated provider refill.
 * The webhook resolves the PaymentIntent using Stripe's server credential. */
export function sourceRefreshRefund(
  event: { id: string; created: number; livemode: boolean },
  refund: { id: string; status?: string | null; currency: string; amount: number },
  intent: { id: string; metadata: Record<string, string> | null },
): Record<string, unknown> | null {
  const meta = intent.metadata ?? {};
  if (meta.purchase_type !== "source_refresh" || !event.livemode || refund.status !== "succeeded" ||
      refund.currency !== "usd" || !Number.isSafeInteger(refund.amount) || refund.amount < 1 ||
      !UUID.test(meta.request_id ?? "") || !UUID.test(meta.user_id ?? "")) return null;
  return { request_id: meta.request_id, user_id: meta.user_id, payment_intent_id: intent.id,
    refund_id: refund.id, event_id: event.id, paid_at: event.created, livemode: event.livemode,
    amount_cents: refund.amount, currency: refund.currency, refund_status: refund.status };
}

export function sourceRefreshDispute(event: { id: string; created: number; livemode: boolean },
  dispute: { id: string; status: string }, intent: { id: string; metadata: Record<string, string> | null },
): Record<string, unknown> | null {
  const meta = intent.metadata ?? {};
  if (!event.livemode || meta.purchase_type !== "source_refresh" || !UUID.test(meta.request_id ?? "") || !UUID.test(meta.user_id ?? "")) return null;
  return { request_id: meta.request_id, user_id: meta.user_id, payment_intent_id: intent.id,
    dispute_id: dispute.id, dispute_status: dispute.status, event_id: event.id, event_created: event.created, livemode: true };
}

export function routeCheckoutSession(
  event: { id: string; created: number; livemode: boolean },
  session: CheckoutSessionLike,
): CheckoutRoute {
  const meta = session.metadata ?? {};
  const purchaseType = meta.purchase_type ?? null;

  if (purchaseType === "source_refresh") {
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? "";
    if (!UUID.test(meta.request_id ?? "") || !UUID.test(meta.user_id ?? "") ||
        session.client_reference_id !== meta.user_id || session.payment_status !== "paid" || session.mode !== "payment" || !event.livemode ||
        !/^pi_[A-Za-z0-9]+$/.test(pi) ||
        !Number.isSafeInteger(session.amount_total) || (session.amount_total ?? 0) <= 0 || session.currency !== "usd") {
      return { kind: "ignore", reason: "source refresh session is unpaid or invalid" };
    }
    return { kind: "source_refresh", payload: { request_id: meta.request_id, user_id: meta.user_id,
      session_id: session.id, event_id: event.id, paid_at: event.created, livemode: event.livemode,
      payment_intent_id: pi,
      amount_cents: session.amount_total, currency: session.currency, payment_status: session.payment_status } };
  }

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
