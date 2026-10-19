import { assertEquals } from "jsr:@std/assert@1";
import { routeCheckoutSession } from "./stripeCheckoutRouting.ts";

const event = { id: "evt_1", created: 1760000000, livemode: true };
const wo = "e7400000-0000-0000-0000-000000000001";
const inv = "e7500000-0000-0000-0000-000000000001";
const user = "e7000000-0000-0000-0000-0000000000c1";
const invoiceSession = (meta: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  id: "cs_live_1", payment_status: "paid", amount_total: 8025, currency: "usd", client_reference_id: user,
  payment_intent: "pi_1",
  metadata: { purchase_type: "work_order_invoice", work_order_id: wo, invoice_id: inv, invoice_hash: "h1", payer_user_id: user, ...meta },
  ...extra,
});

Deno.test("work order invoice session routes to the recorder with its ids", () => {
  const r = routeCheckoutSession(event, invoiceSession());
  assertEquals(r.kind, "work_order_invoice");
  if (r.kind === "work_order_invoice") {
    assertEquals(r.payload, {
      event_id: "evt_1", session_id: "cs_live_1", payment_intent_id: "pi_1", payment_status: "paid", amount_minor: 8025,
      currency: "usd", livemode: true, created: 1760000000, work_order_id: wo, invoice_id: inv, invoice_hash: "h1", payer_user_id: user,
    });
  }
});

Deno.test("expanded payment_intent object yields its id", () => {
  const r = routeCheckoutSession(event, invoiceSession({}, { payment_intent: { id: "pi_2" } }));
  assertEquals(r.kind === "work_order_invoice" && r.payload.payment_intent_id, "pi_2");
});

Deno.test("an invoice session never credits the AI wallet, even when unpaid or malformed", () => {
  assertEquals(routeCheckoutSession(event, invoiceSession({}, { payment_status: "unpaid" })).kind, "ignore");
  assertEquals(routeCheckoutSession(event, invoiceSession({ invoice_id: "nope" })).kind, "ignore");
  assertEquals(routeCheckoutSession(event, invoiceSession({ invoice_hash: "" })).kind, "ignore");
  assertEquals(routeCheckoutSession(event, invoiceSession({}, { amount_total: 0 })).kind, "ignore");
  assertEquals(routeCheckoutSession(event, invoiceSession({}, { client_reference_id: "someone-else" })).kind, "ignore");
});

Deno.test("credit purchases credit exactly as before", () => {
  assertEquals(routeCheckoutSession(event, { id: "cs_1", metadata: { user_id: user, purchase_type: "ai_wallet_topup" } }),
    { kind: "ai_credit", userId: user });
  assertEquals(routeCheckoutSession(event, { id: "cs_2", metadata: { user_id: user, purchase_type: "api_access_subscription" } }),
    { kind: "ai_credit", userId: user });
  assertEquals(routeCheckoutSession(event, { id: "cs_3", metadata: { user_id: user, amount_cents: "500" } }),
    { kind: "ai_credit", userId: user });
  assertEquals(routeCheckoutSession(event, { id: "cs_4", client_reference_id: user, metadata: {} }),
    { kind: "ai_credit", userId: user });
});

Deno.test("other purchase types are not credited", () => {
  const r = routeCheckoutSession(event, { id: "cs_5", client_reference_id: user,
    metadata: { purchase_type: "vehicle_transaction", buyer_id: user } });
  assertEquals(r, { kind: "ignore", reason: "purchase_type vehicle_transaction is not a credit purchase" });
});

Deno.test("a credit session without a user is ignored", () => {
  assertEquals(routeCheckoutSession(event, { id: "cs_6", metadata: {} }).kind, "ignore");
});
