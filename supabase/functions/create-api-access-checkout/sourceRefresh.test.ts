import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { FUNDING_SOURCE, refreshQuote, sourceRefreshCheckout } from "./sourceRefresh.ts";

const sourceConfig = { enabled: true, needs_funding: true, feed_source: "fixture-feed", provider: "anthropic", amount_cents: 300,
  max_ingests: 3, replenishment_mode: "provider_auto_reload", billing_verified: true, billing_reference: "fixture-receipt" };
const config = { enabled: true, sources: { fixture: sourceConfig } };
const user = "e7000000-0000-0000-0000-0000000000c1";
const id = "e7000000-0000-0000-0000-0000000000c2";

Deno.test("no contribution is priced without verified provider replenishment and an enabled source", () => {
  assertEquals(refreshQuote("fixture", null, {}), null);
  for (const change of [{ needs_funding: false }, { billing_verified: false }, { replenishment_mode: "stripe_wallet" },
    { amount_cents: 1.2 }, { amount_cents: 0 }, { amount_cents: 10001 }, { max_ingests: 6 }, { billing_reference: "" }]) {
    assertEquals(refreshQuote("fixture", { ...config, sources: { fixture: { ...sourceConfig, ...change } } }, {}), null);
  }
  assertEquals(refreshQuote("fixture", config, { enabled: false }), null);
  assertEquals(refreshQuote("fixture", config, { sources: { "fixture-feed": { enabled: false } } }), null);
  assertEquals(refreshQuote("fixture", config, { max_ingests: 1 })?.max_ingests, 1);
  assertEquals(refreshQuote("fixture", { ...config, sources: { fixture: { ...sourceConfig, needs_funding: false } } }, {}, true)?.source, "fixture");
});

function fixture(policy = config) {
  let stored: any = null;
  const sessions: any[] = [];
  const db = { auth: { getUser: async () => ({ data: { user: { id: user } } }) }, rpc: async () => ({ data: 1 }), from(table: string) {
    const q: any = { select: () => q, eq: () => q,
      in: async () => ({ data: [{ config_key: "source_refresh_funding", config_value: policy }] }),
      limit: async () => ({ data: [{ id: "enabled-feed" }] }),
      insert: async (row: any) => {
        assertEquals(table, "extraction_runs"); assertEquals(row.source, FUNDING_SOURCE);
        if (stored) return { error: { code: "23505" } };
        stored = row; return {};
      }, maybeSingle: async () => ({ data: stored }) };
    return q;
  } };
  const stripe = { checkout: { sessions: { create: async (p: any, options: any) => {
    sessions.push({ p, options }); return { url: "https://checkout.stripe.com/c/pay/fixture" };
  } } } };
  return { db, stripe, sessions, stored: () => stored };
}

Deno.test("any signed-in payer gets a server-priced, source-bound checkout with replay-stable parameters", async () => {
  const old = Deno.env.get("STRIPE_SECRET_KEY");
  Deno.env.set("STRIPE_SECRET_KEY", "sk_live_fixture_not_a_credential");
  try {
    const f = fixture();
    const req = new Request("https://fixture.invalid", { headers: { Authorization: "Bearer fixture" } });
    const body = { action: "source_refresh_checkout", source: "fixture", request_id: id,
      user_id: "attacker", amount_cents: 1, success_url: "https://attacker.invalid" };
    await sourceRefreshCheckout(req, body, f.db, f.stripe);
    await sourceRefreshCheckout(req, body, f.db, f.stripe);
    assertEquals(f.sessions.length, 2);
    assertEquals(f.sessions[0], f.sessions[1]);
    const p = f.sessions[0].p;
    assertEquals(p.line_items[0].price_data.unit_amount, 300);
    assertEquals(p.client_reference_id, user);
    assertEquals(p.metadata, { purchase_type: "source_refresh", request_id: id, user_id: user });
    assertEquals(new URL(p.success_url).hostname, "nuke.ag");
    f.stored().metadata.user_id = "someone-else";
    await assertRejects(() => sourceRefreshCheckout(req, body, f.db, f.stripe));
    assertEquals(f.sessions.length, 2);
  } finally { if (old === undefined) Deno.env.delete("STRIPE_SECRET_KEY"); else Deno.env.set("STRIPE_SECRET_KEY", old); }
});

Deno.test("verified existing capacity queues a bounded refresh without Stripe or a payment receipt", async () => {
  const f = fixture({ enabled: true, sources: { fixture: { ...sourceConfig, needs_funding: false,
    amount_cents: 0, replenishment_mode: "subscription_credit" } } });
  const req = new Request("https://fixture.invalid", { headers: { Authorization: "Bearer fixture" } });
  const result = await sourceRefreshCheckout(req, { action: "source_refresh_request", source: "fixture", request_id: id }, f.db, f.stripe);
  assertEquals(result, { request_id: id, payment_required: false });
  assertEquals(f.sessions.length, 0);
  assertEquals(f.stored().status, "funded"); assertEquals(f.stored().metadata.amount_cents, 0);
});
