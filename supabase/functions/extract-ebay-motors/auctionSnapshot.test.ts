import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { admitAuctionSnapshot, snapshotFields } from "./auctionSnapshot.ts";
const input = { vehicleId: "vehicle-fixture", url: "https://ebay.com/itm/100000000001", previousObservationId: null,
  observedAt: "2026-11-08T12:00:00Z", summary: { legacyItemId: "100000000001", itemId: "v1|100000000001|0", bidCount: 2,
    currentBidPrice: { value: "4100.20", currency: "USD" }, itemEndDate: "2026-11-09T12:00:00Z", buyingOptions: ["AUCTION"] } };
Deno.test("snapshot preserves exact decimal, count, source clock and never infers a bidder or event time", () => {
  const f = snapshotFields(input.summary, input.observedAt);
  assertEquals([f.current_bid, f.bid_count, f.currency, f.source_bid_at, f.clock], ["4100.20", 2, "USD", null, "source_read"]);
  assertEquals("bidder" in f, false);
  assertEquals(snapshotFields({ ...input.summary, bidCount: undefined }, input.observedAt).bid_count, null);
  assertEquals(snapshotFields({ ...input.summary, bidCount: 0 }, input.observedAt).current_bid_kind, "opening_price");
});
Deno.test("capture retries reuse first read clock and canonical identifier; mismatched admission fails closed", async () => {
  const oldFetch = globalThis.fetch, oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), oldUrl = Deno.env.get("SUPABASE_URL");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_fixture"); Deno.env.set("SUPABASE_URL", "https://fixture.invalid");
  const snapshots: any[] = [], posts: any[] = [];
  let mismatch = false;
  const sb: any = { from(table: string) {
    let insert: any, hash: string;
    const b: any = new Proxy({}, { get(_t, p) {
      if (p === "then") return (resolve: any) => {
        if (table === "vehicle_observations") { const post = posts.at(-1); return resolve({ data: {
          id: "observation-fixture", vehicle_id: mismatch ? "other-car" : post.vehicle_id, source_identifier: post.source_identifier,
          raw_source_ref: post.raw_source_ref, kind: post.kind, extraction_method: post.extraction_method,
          source_url: post.source_url, structured_data: post.structured_data, observed_at: post.observed_at, is_superseded: false } }); }
        if (insert) { const row = { ...insert, id: "snapshot-fixture" }; snapshots.push(row); return resolve({ data: row }); }
        return resolve({ data: snapshots.find(s => s.html_sha256 === hash) ?? null });
      };
      return (...args: any[]) => { if (p === "insert") insert = args[0]; if (p === "eq" && args[0] === "html_sha256") hash = args[1]; return b; };
    } }); return b;
  } };
  globalThis.fetch = (async (_url: any, init: any) => { posts.push(JSON.parse(init.body)); return new Response(JSON.stringify({ success: true, observation_id: "observation-fixture" })); }) as typeof fetch;
  try {
    await admitAuctionSnapshot(sb, input);
    await admitAuctionSnapshot(sb, { ...input, observedAt: "2026-11-08T12:15:00Z" });
    assertEquals(snapshots.length, 1);
    assertEquals(posts[1], posts[0]);
    assertEquals(posts[0].raw_source_ref, "listing_page_snapshots:snapshot-fixture");
    assertEquals(posts[0].kind, "listing");
    mismatch = true;
    await assertRejects(() => admitAuctionSnapshot(sb, input), Error, "readback mismatch");
  } finally {
    globalThis.fetch = oldFetch;
    oldKey === undefined ? Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY") : Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    oldUrl === undefined ? Deno.env.delete("SUPABASE_URL") : Deno.env.set("SUPABASE_URL", oldUrl);
  }
});

Deno.test("retained Nov6 eBay quote with omitted count stays a qualified source quote", () => {
  // Public price fields from snapshot a7a11802-c655-46d9-93cd-2a39034d2fd2, getItem 2026-11-06T18:30:57.319Z.
  // This is a bounded quote fixture, not a claim that the listing is still open today.
  const captured = { itemId: "v1|800885752134|0", buyingOptions: ["FIXED_PRICE", "AUCTION"],
    currentBidPrice: { value: "48500.00", currency: "USD" }, price: { value: "58500.00", currency: "USD" } };
  const f = snapshotFields(captured, "2026-11-06T18:30:57.319Z");
  assertEquals([f.current_bid, f.buy_it_now, f.currency, f.bid_count, f.current_bid_kind], ["48500.00", "58500.00", "USD", null, "unknown"]);
});
