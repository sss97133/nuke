import { assertEquals } from "jsr:@std/assert";
import { COMPS_RETRY_BACKOFF_MS, hammerBasis } from "./handlers.ts";

Deno.test("hammerBasis strips a buyer premium the stored price includes", () => {
  // 1996 911 Turbo, Broad Arrow 2023: stored 187,600 = hammer 167,500 + 12% premium.
  const ai = { stored_price: 187600, hammer: 167500, stored_price_includes_premium: true };
  assertEquals(hammerBasis(187600, ai), { amount: 167500, converted: true });
});

Deno.test("hammerBasis leaves hammer-basis or mismatched prices alone", () => {
  assertEquals(hammerBasis(19000, { stored_price: 19000, hammer: 19000, stored_price_includes_premium: false }).converted, false);
  assertEquals(hammerBasis(50000, { stored_price: 187600, hammer: 167500, stored_price_includes_premium: true }).amount, 50000);
  assertEquals(hammerBasis(50000, undefined).amount, 50000);
});

Deno.test("comps lookup retries with growing backoff", () => {
  assertEquals(COMPS_RETRY_BACKOFF_MS[0], 0);
  for (let i = 1; i < COMPS_RETRY_BACKOFF_MS.length; i++) {
    if (!(COMPS_RETRY_BACKOFF_MS[i]! > COMPS_RETRY_BACKOFF_MS[i - 1]!)) throw new Error("backoff not increasing");
  }
});
