import { assertEquals, assert } from "jsr:@std/assert@1";
import { checkoutParams } from "./checkout.ts";
import { routeCheckoutSession } from "../_shared/stripeCheckoutRouting.ts";

const terms = {
  work_order_id: "e7400000-0000-0000-0000-000000000001", vehicle_id: "40000000-0000-0000-0000-000000000001",
  invoice_id: "e7500000-0000-0000-0000-000000000001", invoice_version: 2, invoice_hash: "h2", currency: "USD",
  balance_due: 80.25, amount_minor: 8025,
};
const user = "e7000000-0000-0000-0000-0000000000c1";

Deno.test("checkout charges exactly the balance due in the invoice currency", () => {
  const { params, idempotencyKey } = checkoutParams(terms, user, "https://nuke.ag");
  assertEquals(params.mode, "payment");
  assertEquals(params.line_items.length, 1);
  assertEquals(params.line_items[0].price_data.unit_amount, 8025);
  assertEquals(params.line_items[0].price_data.currency, "usd");
  assertEquals(params.client_reference_id, user);
  assertEquals(idempotencyKey, `wo-invoice:${terms.invoice_id}:h2:${user}:8025`);
  assertEquals(params.success_url, `https://nuke.ag/vehicle/${terms.vehicle_id}?payment=received&work_order=${terms.work_order_id}`);
});

Deno.test("only the invoice version reaches Stripe, no title or names", () => {
  const { params } = checkoutParams(terms, user, "https://nuke.ag");
  assertEquals(params.line_items[0].price_data.product_data, { name: "Work order invoice, version 2" });
  assert(!JSON.stringify(params).includes("title"));
});

Deno.test("a completed session from these params routes to the recorder, never the wallet", () => {
  const { params } = checkoutParams(terms, user, "https://nuke.ag");
  const r = routeCheckoutSession({ id: "evt_1", created: 1, livemode: false }, {
    id: "cs_test_1", payment_status: "paid", amount_total: 8025, currency: "usd",
    client_reference_id: params.client_reference_id, payment_intent: "pi_1", metadata: params.metadata,
  });
  assertEquals(r.kind, "work_order_invoice");
});
