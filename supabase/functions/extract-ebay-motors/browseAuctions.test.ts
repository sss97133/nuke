// Contract tests for the open-auctions action. FIXTURES, not captured eBay data: the summaries are synthetic, shaped on
// the field names of a production Browse search response read 2026-10-20 (itemId, legacyItemId, title, currentBidPrice,
// bidCount, itemEndDate, price, buyingOptions, image, itemLocation). Item ids are invented.
import { assertEquals } from "jsr:@std/assert@1";
import { auctions, itemUrls, liveRow, liveState } from "./browseAuctions.ts";
import { ItemGone } from "./browseApi.ts";

const NOW = Date.parse("2026-10-20T20:00:00.000Z");
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const lot = (id: string, o: { title?: string; bids?: number; bid?: string; ends?: string; bin?: string } = {}) => ({
  itemId: `v1|${id}|0`, legacyItemId: id, title: o.title ?? "1969 Chevrolet Camaro", bidCount: o.bids ?? 0,
  currentBidPrice: { value: o.bid ?? "5000.00", currency: "USD" }, itemEndDate: o.ends ?? at(3),
  buyingOptions: o.bin ? ["FIXED_PRICE", "AUCTION"] : ["AUCTION"], ...(o.bin ? { price: { value: o.bin, currency: "USD" } } : {}),
  image: { imageUrl: `https://i.ebayimg.com/images/g/${id}/s-l225.jpg` }, itemLocation: { postalCode: "891**", country: "US" },
  itemWebUrl: `https://www.ebay.com/itm/${id}?hash=x`,
});

// ---- fakes --------------------------------------------------------------------------------------------------------
type Op = { op: string; args: unknown[] };
interface World {
  snapshots: string[];                                    // item keys with a stored capture
  vehicles: any[];                                        // vehicles rows (listing_url, platform_source, ...)
  episodes?: any[];                                       // auction-format listing episodes past their end
  rpcs: { name: string; args: any }[];
  updates: { table: string; patch: any }[];
}
function fakeSb(w: World) {
  const run = (table: string, ops: Op[]) => {
    const has = (op: string, col?: string) => ops.find((o) => o.op === op && (col === undefined || o.args[0] === col));
    const inList = (has("in", "listing_url")?.args[1] ?? []) as string[];
    if (ops.some((o) => o.op === "update")) {
      w.updates.push({ table, patch: ops.find((o) => o.op === "update")!.args[0] });
      return { data: [{ id: "ev1" }], error: null };
    }
    if (table === "listing_page_snapshots") return { data: w.snapshots.map((k) => ({ listing_url: `https://www.ebay.com/itm/${k}` })).filter((r) => inList.includes(r.listing_url)), error: null };
    if (table === "vehicles" && has("in", "listing_url")) return { data: w.vehicles.filter((v) => inList.includes(v.listing_url)), error: null };
    if (table === "vehicles" && has("eq", "sale_status")) return { data: w.vehicles.filter((v) => v.sale_status === "auction_live" && v.platform_source === "ebay-motors"), error: null };
    if (table === "vehicle_events" && has("contains")) return { data: w.episodes ?? [], error: null };
    if (table === "vehicle_events" && has("eq", "source_listing_id")) return { data: [{ id: "ev1", metadata: {}, sold_at: null, ended_at: null }], error: null };
    return { data: [], error: null };
  };
  const builder = (table: string) => {
    const ops: Op[] = [];
    const b: any = new Proxy({}, {
      get: (_t, p: string) => p === "then"
        ? (res: any, rej: any) => Promise.resolve(run(table, ops)).then(res, rej)
        : (...args: unknown[]) => { ops.push({ op: p, args }); return b; },
    });
    return b;
  };
  return {
    from: (t: string) => builder(t),
    rpc: async (name: string, args: any) => { w.rpcs.push({ name, args }); return { data: name === "end_live_auctions_absent" ? 1 : (args.p_rows?.length ?? 0), error: null }; },
  };
}
function fakeClient(pages: any[][], o: { remaining?: number; total?: number; items?: Record<string, any> } = {}) {
  const c: any = {
    calls: 0, searches: [] as number[], items: [] as string[],
    remainingToday: async () => { c.calls++; return { remaining: o.remaining ?? 4000, limit: 5000, resetAt: null }; },
    search: async (q: { offset: number; filter: string; sort: string }) => {
      c.calls++; c.searches.push(q.offset);
      assertEquals([q.filter, q.sort], ["buyingOptions:{AUCTION}", "endingSoonest"]);
      const i = q.offset / 200;
      const total = o.total ?? pages.length * 200;     // each fixture page stands for a full page of 200
      return { total, itemSummaries: pages[i] ?? [], next: i + 1 < pages.length ? "next" : null };
    },
    getItem: async (id: string) => { c.calls++; c.items.push(id); if (o.items?.[id]) return o.items[id]; throw new ItemGone(id); },
  };
  return c;
}
const held = (id: string, extra: Record<string, unknown> = {}) => ({
  id: `veh-${id}`, listing_url: `https://ebay.com/itm/${id}`, platform_source: "ebay-motors", sale_status: "available", auction_status: null,
  high_bid: null, auction_end_date: null, origin_metadata: { import_source: "ingest", import_date: "2026-10-19" }, title: "1969 Chevrolet Camaro",
  year: 1969, make: "Chevrolet", model: "Camaro", ...extra,
});
const world = (w: Partial<World>): World => ({ snapshots: [], vehicles: [], rpcs: [], updates: [], ...w });
const open = { take: async () => null };                  // a ledger with room left today

// ---- the live state ---------------------------------------------------------------------------------------------------
Deno.test("a bid is the high bid; with no bid the current price is the opening price and high_bid stays empty", () => {
  assertEquals(liveState(lot("100000000001", { bids: 14, bid: "3827.60" })).highBid, 3827);   // whole dollars, never rounded up
  const none = liveState(lot("100000000002", { bids: 0, bid: "9500.00", bin: "18000.00" }));
  assertEquals([none.highBid, none.bidCount, none.currency, none.buyItNow], [null, 0, "USD", "18000.00"]);
});

Deno.test("the live row keeps the vehicle's own URL and metadata, and is null when nothing the writer compares changed", () => {
  const s = lot("100000000001", { bids: 3, bid: "7100.00", ends: at(5) });
  const r = liveRow(held("100000000001"), s, at(0))!;
  assertEquals([r.listing_url, r.sale_status, r.auction_status, r.sale_price, r.auction_end_date, r.platform_source],
    ["https://ebay.com/itm/100000000001", "auction_live", "active", 7100, at(5), "ebay-motors"]);
  const om = r.origin_metadata as any;
  assertEquals([om.import_source, om.currency, om.bid_count, om.current_bid_kind, om.external_id], ["ingest", "USD", 3, "high_bid", "100000000001"]);
  assertEquals(liveRow(held("100000000001", { sale_status: "auction_live", auction_status: "active", high_bid: 7100, auction_end_date: at(5) }), s, at(0)), null);
  assertEquals(liveRow(held("100000000001", { sale_status: "auction_live", auction_status: "active", high_bid: 7000, auction_end_date: at(5) }), s, at(0))?.sale_price, 7100);
});

// ---- a run ------------------------------------------------------------------------------------------------------------
Deno.test("a partial pass writes held lots' live state and ends nothing, even a held live lot past its end", async () => {
  const w = world({
    snapshots: ["100000000001", "100000000009"],
    vehicles: [
      held("100000000001"),
      { ...held("100000000009"), sale_status: "auction_live", auction_end_date: at(-2) },   // past its end, not on page 1
    ],
  });
  const client = fakeClient([[lot("100000000001", { bids: 2, bid: "4100.00" })], [lot("100000000003")]]);
  const rep = await auctions(fakeSb(w), client, { maxPages: 1, maxItems: 0, now: () => NOW, ledger: open });
  assertEquals([rep.auctions.complete, rep.auctions.pages_read, rep.auctions.held_rows], [false, 1, 1]);
  assertEquals(w.rpcs.map((r) => r.name), ["upsert_live_auction_vehicles"]);
  assertEquals(w.rpcs[0].args.p_rows.map((r: any) => [r.listing_url, r.sale_price]), [["https://ebay.com/itm/100000000001", 4100]]);
  assertEquals(w.updates.length, 0);                                   // no listing episode ended
  assertEquals(rep.calls, 1);                                          // the two rate-limit reads are not Browse calls
});

Deno.test("ended is written only after a complete pass: absent and past its end, both spellings kept, no outcome", async () => {
  const w = world({
    snapshots: ["100000000001"],
    vehicles: [
      held("100000000001", { sale_status: "auction_live", auction_status: "active", high_bid: 4100, auction_end_date: at(3) }),
      { ...held("100000000008"), sale_status: "auction_live", auction_end_date: at(6) },      // absent, still before its end: stays
      { ...held("100000000009"), sale_status: "auction_live", auction_end_date: at(-2) },     // absent and past its end: ends
    ],
    episodes: [{ vehicle_id: "veh-100000000009", source_listing_id: "100000000009", source_url: "https://www.ebay.com/itm/100000000009", metadata: { listing_ends_at: at(-2) } }],
  });
  const client = fakeClient([[lot("100000000001", { bids: 2, bid: "4100.00" })], [lot("100000000002", { ends: at(30) })]]);
  const rep = await auctions(fakeSb(w), client, { maxPages: 5, maxItems: 0, now: () => NOW, ledger: open });
  assertEquals([rep.auctions.complete, rep.auctions.pages_read, rep.auctions.unchanged], [true, 2, 1]);
  const end = w.rpcs.find((r) => r.name === "end_live_auctions_absent")!;
  assertEquals(end.args.p_platform, "ebay-motors");
  const keep = new Set(end.args.p_live_urls as string[]);
  for (const u of [...itemUrls("100000000001"), ...itemUrls("100000000002"), "https://ebay.com/itm/100000000008"]) assertEquals(keep.has(u), true, u);
  assertEquals(keep.has("https://ebay.com/itm/100000000009"), false);
  assertEquals(rep.auctions.ended_vehicles, 1);
  assertEquals(rep.auctions.ended_episodes, 1);
  const patch = w.updates[0].patch;
  assertEquals([patch.event_status, patch.metadata.removal.basis], ["ended", "absent_from_complete_auction_pass"]);
  for (const k of ["sold_at", "sold_price", "sale_price", "final_price", "outcome"]) assertEquals(k in patch, false, k);
});

Deno.test("the call budget stops the action: the floor caps searches, a partial pass ends nothing", async () => {
  const w = world({ vehicles: [{ ...held("100000000009"), sale_status: "auction_live", auction_end_date: at(-2) }] });
  const pages = Array.from({ length: 18 }, (_, i) => [lot(String(200000000000 + i))]);
  const client = fakeClient(pages, { remaining: 103 });
  const rep = await auctions(fakeSb(w), client, { maxPages: 20, maxItems: 0, floor: 100, now: () => NOW, ledger: open });
  assertEquals([client.searches.length, rep.auctions.complete, rep.calls], [3, false, 3]);
  assertEquals(rep.stopped?.startsWith("budget"), true);
  assertEquals(w.rpcs.some((r) => r.name === "end_live_auctions_absent"), false);
});

Deno.test("the daily cap stops the action: each Browse call is counted in the day's ledger before it is made", async () => {
  let count = 398;                                        // two calls left of 400 today
  const keys: string[] = [];
  const sb: any = { ...fakeSb(world({})), rpc: async (name: string, args: any) => {
    assertEquals(name, "rate_limit_increment"); keys.push(args.p_key); return { data: ++count, error: null }; } };
  const pages = Array.from({ length: 18 }, (_, i) => [lot(String(500000000000 + i))]);
  const client = fakeClient(pages);
  const rep = await auctions(sb, client, { maxPages: 20, maxItems: 0, dailyCap: 400, now: () => NOW });
  assertEquals([client.searches.length, rep.auctions.complete], [2, false]);
  assertEquals(rep.stopped?.startsWith("daily cap"), true);
  assertEquals(keys[0], "ebay-auctions:browse:2026-10-20");   // the Pacific day eBay's quota runs on
});

Deno.test("under the floor nothing is called", async () => {
  const client = fakeClient([[lot("100000000001")]], { remaining: 90 });
  const rep = await auctions(fakeSb(world({})), client, { floor: 100, now: () => NOW, ledger: open });
  assertEquals([client.searches.length, client.items.length, rep.stopped?.startsWith("quota")], [0, 0, true]);
});

Deno.test("max_calls caps landings; unheld lots land vintage first, then ending soonest, and the rest are counted", async () => {
  const page = [
    lot("300000000001", { title: "2019 Dodge Charger", ends: at(1) }),
    lot("300000000002", { title: "1972 Ford Bronco", ends: at(2) }),
    lot("300000000003", { title: "1965 Ford Mustang", ends: at(4) }),
    lot("300000000004", { title: "1966 Ford Mustang", ends: at(0.2) }),   // ends inside 30 minutes: not worth a getItem
  ];
  const client = fakeClient([page]);
  const rep = await auctions(fakeSb(world({})), client, { maxPages: 1, maxItems: 5, maxCalls: 3, now: () => NOW, ledger: open });
  assertEquals(client.items, ["v1|300000000002|0", "v1|300000000003|0"]);   // 1 search + 2 getItem = the cap
  assertEquals([rep.calls, rep.auctions.unheld.vintage, rep.auctions.unheld.other], [3, 3, 1]);
  assertEquals(rep.auctions.left, { vintage: 1, other: 1 });
});

Deno.test("a lot linked to another source's vehicle is never written or landed", async () => {
  const w = world({ snapshots: ["400000000001"], vehicles: [] });              // captured, but its vehicle is a BaT row under the VIN
  const client = fakeClient([[lot("400000000001", { bids: 5, bid: "22000.00" })]]);
  const rep = await auctions(fakeSb(w), client, { maxPages: 1, maxItems: 2, now: () => NOW, ledger: open });
  assertEquals([rep.auctions.held_elsewhere, rep.auctions.written_live, client.items.length], [1, 0, 0]);
  assertEquals(w.rpcs.length, 0);
});
