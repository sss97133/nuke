import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { recordSellerTypes, sellerTypeConfidence, sellerTypeRow } from "./sellerType.ts";

const id = "00000000-0000-4000-8000-000000000001";

Deno.test("confidence: declared 0.9, inferred 0.5, unknown 0; dealer wording lowers a private class only", () => {
  assertEquals(sellerTypeConfidence({ value: "private", basis: "declared" }), 0.9);
  assertEquals(sellerTypeConfidence({ value: "private", basis: "declared", dealerWording: ["financing"] }), 0.5);
  assertEquals(sellerTypeConfidence({ value: "private", basis: "inferred", dealerWording: ["dealer"] }), 0.2);
  assertEquals(sellerTypeConfidence({ value: "dealer", basis: "declared", dealerWording: ["dealer"] }), 0.9);
  assertEquals(sellerTypeConfidence({ value: "unknown", basis: "inferred" }), 0);
});

Deno.test("a row names its basis, the source's own label and the wording that lowered it", () => {
  const r = sellerTypeRow({ eventId: id, value: "private", basis: "declared", field: "For Sale By", text: "Private Seller", dealerWording: ["we offer"], method: "lane-ebay-audit-v1" });
  assertEquals(r, { event_id: id, signal: "seller_type", value: "private", method: "lane-ebay-audit-v1",
    evidence: { basis: "declared", confidence: 0.5, field: "For Sale By", text: "Private Seller", wording_terms: ["we offer"] } });
  assertThrows(() => sellerTypeRow({ eventId: id, value: "private", basis: "declared", method: "lexicon_v1" }));
});

Deno.test("rows go out in chunks of 500 and a failed chunk throws", async () => {
  const calls: number[] = [];
  const ok = { rpc: async (_: string, a: Record<string, unknown>) => { calls.push((a.p_rows as unknown[]).length); return { data: (a.p_rows as unknown[]).length, error: null }; } };
  const rows = Array.from({ length: 1201 }, () => sellerTypeRow({ eventId: id, value: "unknown", basis: "inferred", method: "m" }));
  assertEquals(await recordSellerTypes(ok, rows, "lane-x"), 1201);
  assertEquals(calls, [500, 500, 201]);
  const bad = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
  let threw = false; try { await recordSellerTypes(bad, rows, "lane-x"); } catch { threw = true; }
  assertEquals(threw, true);
});
