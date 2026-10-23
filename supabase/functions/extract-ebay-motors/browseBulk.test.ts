// Contract tests for bulk landing from Browse search pages. FIXTURES, not captured eBay data: the summaries are synthetic,
// shaped on the field names of a production Browse search response read 2026-10-20 (itemId, legacyItemId, title, price,
// currentBidPrice, bidCount, buyingOptions, categories, leafCategoryIds, image, additionalImages, seller, itemLocation,
// itemEndDate, condition). Item ids, sellers and prices are invented.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildPlan, bulk, categoryOf, compare, type Chunk, filterIgnored, pageLookup, storedBody, summaryIdentity, traceRetryMs, yearRank } from "./browseBulk.ts";
import { toLanding } from "./browseMap.ts";
import { byDetailPriority, type Cand } from "./browseSweep.ts";
import { handleHash } from "./deletedMembers.ts";

const FILTER = "categoryId:6001,Model Year:{1967}";
const MAKES = new Set(["ford", "chevrolet", "austinhealey", "porsche", "internationalharvester"]);
const cat = (make: string | null, model: string, leaf = "100") => [
  { categoryId: leaf, categoryName: model }, { categoryId: "6000", categoryName: "eBay Motors" }, { categoryId: "6001", categoryName: "Cars & Trucks" },
  ...(make ? [{ categoryId: "200", categoryName: make }] : []),
];
const sum = (id: string, o: { title?: string; make?: string | null; model?: string; price?: string; bids?: number; auction?: boolean; seller?: string; zip?: string } = {}) => ({
  itemId: `v1|${id}|0`, legacyItemId: id, title: o.title ?? "1967 Ford Mustang Fastback",
  categories: cat(o.make === undefined ? "Ford" : o.make, o.model ?? "Mustang"), leafCategoryIds: ["100"],
  price: { value: o.price ?? "45000.00", currency: "USD" },
  ...(o.auction ? { buyingOptions: ["AUCTION"], currentBidPrice: { value: o.price ?? "45000.00", currency: "USD" }, bidCount: o.bids ?? 0 } : { buyingOptions: ["FIXED_PRICE"] }),
  image: { imageUrl: `https://i.ebayimg.com/images/g/${id}a/s-l225.jpg` }, additionalImages: [{ imageUrl: `https://i.ebayimg.com/images/g/${id}b/s-l225.jpg` }],
  seller: { username: o.seller ?? "example_seller", feedbackPercentage: "100.0", feedbackScore: 12 },
  itemLocation: { postalCode: o.zip ?? "891**", country: "US" }, itemEndDate: "2026-10-27T00:00:00.000Z", condition: "Used",
  itemWebUrl: `https://www.ebay.com/itm/${id}?hash=x`,
});
const chunk = (y = "1967", fsb: string | null = null): Chunk => ({ y, fsb, n: 1 });

// ---- identity ---------------------------------------------------------------------------------------------------------

Deno.test("a summary's identity: the Model Year filter's year, the category's make and model, each with its basis", () => {
  const id = summaryIdentity(sum("1001") as any, chunk("1967", "Private Seller"), FILTER, MAKES);
  assertEquals([id.year, id.make, id.model, id.conflict], [1967, "Ford", "Mustang", null]);
  assertEquals(id.claims.year, { value: 1967, basis: "ebay Model Year aspect filter", query: FILTER });
  assertEquals(id.claims.make?.basis, "ebay category (Cars & Trucks > Make)");
  assertEquals(id.claims.model?.basis, "ebay category (Make > Model)");
  assertEquals(id.claims.for_sale_by?.value, "Private Seller");
  assertEquals(id.title, { year: 1967, make: "Ford", model: "Mustang Fastback" });
});

Deno.test("an 'Other' category: the title's make (one of eBay's) and its model words, marked as claims from the title", () => {
  const other = summaryIdentity(sum("1002", { title: "1956 Chevrolet 3200 Pickup", make: "Chevrolet", model: "Other" }) as any, chunk("1956"), FILTER, MAKES);
  assertEquals([other.make, other.model, other.claims.model?.basis], ["Chevrolet", "3200 Pickup", "title (parseVehicleTitle): the words after the make"]);
  const makes = summaryIdentity({ ...sum("1003", { title: "1959 Austin-Healey Sprite" }), categories: [{ categoryId: "300", categoryName: "Other Makes" },
    { categoryId: "6000", categoryName: "eBay Motors" }, { categoryId: "6001", categoryName: "Cars & Trucks" }], leafCategoryIds: ["300"] } as any, chunk("1959"), FILTER, MAKES);
  assertEquals([makes.make, makes.model, makes.claims.make?.basis], ["Austin-Healey", "Sprite", "title (parseVehicleTitle), one of eBay's Make values"]);
  // a title word that is not one of eBay's makes is not a make: the listing stays a blip
  const none = summaryIdentity({ ...sum("1004", { title: "1950 Powell Wagon" }), categories: [{ categoryId: "300", categoryName: "Other Makes" }], leafCategoryIds: ["300"] } as any, chunk("1950"), FILTER, MAKES);
  assertEquals([none.year, none.make, none.model], [1950, null, null]);
  assertEquals(categoryOf({ categories: [{ categoryId: "400", categoryName: "Willys" }, { categoryId: "6001", categoryName: "Cars & Trucks" }], leafCategoryIds: ["400"] } as any),
    { make: "Willys", model: null, leaf_id: "400" });
});

Deno.test("a title year against the filter's, or a title make against the category's, leaves the field unknown with both claims", () => {
  const y = summaryIdentity(sum("1005", { title: "1968 Ford Mustang" }) as any, chunk("1967"), FILTER, MAKES);
  assertEquals([y.year, y.make, y.model], [null, "Ford", "Mustang"]);
  assert(y.conflict?.includes("the title says 1968"));
  const m = summaryIdentity(sum("1006", { title: "1967 Porsche 912", make: "Ford", model: "Mustang" }) as any, chunk("1967"), FILTER, MAKES);
  assertEquals([m.year, m.make, m.model], [1967, null, null]);
  assert(m.conflict?.includes("the category says Ford, the title says Porsche"));
  // with no year in the filter (Model Year 'Not Specified'), the title's year is a claim from the title
  const ns = summaryIdentity(sum("1007") as any, chunk("Not Specified"), "categoryId:6001,Model Year:{Not Specified}", MAKES);
  assertEquals([ns.year, ns.claims.year?.basis], [1967, "title (parseVehicleTitle); eBay Model Year not specified"]);
});

Deno.test("the landing takes the summary's identity exactly: complete goes to ingest, incomplete is a blip", () => {
  const s = sum("1008") as any;
  const full = toLanding(s, (h) => h, "ebay-browse-search", summaryIdentity(s, chunk(), FILTER, MAKES))!;
  assertEquals([full.ingestInput?.year, full.ingestInput?.make, full.ingestInput?.model, full.obsFields.year], [1967, "Ford", "Mustang", 1967]);
  assertEquals(full.images, ["https://i.ebayimg.com/images/g/1008a/s-l1600.jpg", "https://i.ebayimg.com/images/g/1008b/s-l1600.jpg"]);
  assertEquals([full.eventMetadata.source, full.eventMetadata.tier, full.eventMetadata.location], ["ebay-browse-search", 1, "891**"]);
  const blip = toLanding(s, (h) => h, "ebay-browse-search", { year: 1967, make: null, model: null })!;
  assertEquals([blip.ingestInput, blip.obsFields.make, blip.obsFields.year], [null, undefined, 1967]);
});

// ---- plan ---------------------------------------------------------------------------------------------------------------

Deno.test("the plan: owner's year order, a vintage year's private sellers first, then the whole year; no 'Not Specified' chunk", () => {
  const years = new Map([["2024", 900], ["1967", 311], ["1985", 40], ["1955", 12], ["1925", 3], ["1999", 70], ["Not Specified", 6]]);
  const priv = new Map([["1967", 37], ["1955", 10], ["1999", 9]]);
  const p = buildPlan(1342, "Model Year", years, "For Sale By", priv, ["Ford"]);
  assertEquals(p.chunks.map((c) => `${c.y}${c.fsb ? `/${c.fsb}` : ""}:${c.n}`),
    ["1967/Private Seller:37", "1967:311", "1985:40", "1955/Private Seller:10", "1955:12", "1925:3", "1999:70", "2024:900"]);
  assertEquals([p.planned, p.pages, p.unreachable], [1336, 13, 6]);   // 2024 is 5 pages, 1967 is 2, every other chunk 1
  assertEquals([yearRank("1967"), yearRank("1980"), yearRank("1940"), yearRank("1920"), yearRank("2000"), yearRank("2020"), yearRank("Not Specified")], [1, 2, 3, 4, 5, 6, 7]);
  // eBay ignores a filter value it does not hold: a page far past its chunk's count is not that chunk
  assertEquals([filterIgnored(35624, { y: "1964", n: 20 }), filterIgnored(26, { y: "1964", n: 20 }), filterIgnored(430, { y: "1964", n: 20 })], [true, false, true]);
});

Deno.test("a chunk eBay answers unfiltered is skipped with an error, and the pass moves on", async () => {
  const w = world(), store = memStore(), rec = recorder(w);
  const unfiltered = Array.from({ length: 900 }, (_, i) => sum(String(8000 + i)));
  const c = fakeClient({ [FILTER]: unfiltered }, { years: { "1967": 3 } });
  const r = await bulk(fakeSb(w), c, { ledger: open, store, gate: gateOpen, land: rec.land as any });
  assertEquals([r.bulk.pages[0].ignored, rec.landed.length, w.snapshots.length, store.get().pass.i, r.ok], [true, 0, 0, 1, false]);
});

// ---- the run, against a recorded world ------------------------------------------------------------------------------------

interface World {
  episodes: { source_url: string; vehicle_id: string; current_price: number | null; event_status: string; bids: number | null; ppo?: string; ppc?: string }[];
  blips: { source_identifier: string; vehicle_id: null; observed_at: string; amount: string | null; extraction_method?: string; po?: string; pc?: string }[];
  gone: Set<string>; lookups: number; snapshots: { sha: string; row: any }[]; uploads: { path: string; bytes: Uint8Array }[];
  updates: any[]; priceLog: any[];
}
const world = (): World => ({ episodes: [], blips: [], gone: new Set(), lookups: 0, snapshots: [], uploads: [], updates: [], priceLog: [] });

function fakeSb(w: World) {
  const run = (table: string, ops: { op: string; args: any[] }[]) => {
    const arg = (op: string, col?: string) => ops.find((o) => o.op === op && (col === undefined || o.args[0] === col))?.args;
    if (table === "observation_sources") return { data: { id: "src-ebay" }, error: null };
    if (table === "listing_page_snapshots" && arg("insert")) {
      const row = arg("insert")![0];
      if (w.snapshots.some((s) => s.sha === row.html_sha256 && s.row.listing_url === row.listing_url)) return { data: null, error: { code: "23505", message: "duplicate" } };
      w.snapshots.push({ sha: row.html_sha256, row });
      return { data: { id: `snap-${w.snapshots.length}` }, error: null };
    }
    if (table === "listing_page_snapshots") return { data: { id: `snap-${w.snapshots.findIndex((s) => s.sha === arg("eq", "html_sha256")![1]) + 1}` }, error: null };
    if (table === "vehicle_price_history") { w.priceLog.push(arg("insert")![0]); return { data: null, error: null }; }
    if (table === "vehicle_events" && arg("update")) { w.updates.push(arg("update")![0]); return { data: [{ id: "ev" }], error: null }; }
    if (table === "vehicle_events" && arg("in", "source_url")) return { data: w.episodes.filter((e) => arg("in", "source_url")![1].includes(e.source_url)), error: null };
    if (table === "vehicle_events" && arg("eq", "vehicle_id")) return { data: [{ id: "ev", metadata: {} }], error: null };
    if (table === "vehicle_observations") return { data: w.blips.filter((b) => arg("in", "source_identifier")![1].includes(b.source_identifier)), error: null };
    return { data: [], error: null };
  };
  const builder = (table: string) => {
    const ops: { op: string; args: any[] }[] = [];
    const b: any = new Proxy({}, {
      get: (_t, p: string) => p === "then" ? (res: any, rej: any) => Promise.resolve(run(table, ops)).then(res, rej)
        : (...args: any[]) => { ops.push({ op: p, args }); return b; },
    });
    return b;
  };
  return {
    from: (t: string) => builder(t),
    storage: { from: () => ({ upload: async (path: string, bytes: Uint8Array) => { w.uploads.push({ path, bytes }); return { error: null }; } }) },
    rpc: async (name: string, a: any) => {
      if (name === "ebay_deleted_member_hashes") { w.lookups++; return { data: a.p_hashes.filter((h: string) => w.gone.has(h)), error: null }; }
      return { data: null, error: null };
    },
  };
}

/** Records each landing into the world the way landItem's writes would make it held. */
function recorder(w: World) {
  const landed: { item: any; opts: any }[] = [];
  const land = async (_sb: any, item: any, _rep: any, at: string, opts: any) => {
    landed.push({ item, opts });
    const key = item.legacyItemId, price = Number(item.buyingOptions?.includes("AUCTION") ? item.currentBidPrice?.value : item.price?.value);
    const o = opts.extra?.price_original ?? {};
    if (opts.identity?.year && opts.identity?.make && opts.identity?.model) {
      w.episodes.push({ source_url: `https://www.ebay.com/itm/${key}`, vehicle_id: `veh-${key}`, current_price: price, event_status: "active", bids: item.bidCount ?? null,
        ppo: o.amount == null ? undefined : String(o.amount), ppc: o.currency });
      return "landed" as const;
    }
    w.blips.push({ source_identifier: key, vehicle_id: null, observed_at: at, amount: String(price), extraction_method: opts.method,
      po: o.amount == null ? undefined : String(o.amount), pc: o.currency });
    return "blip" as const;
  };
  return { land, landed };
}

function fakeClient(pages: Record<string, any[]>, o: { remaining?: number; years?: Record<string, number> } = {}) {
  const c: any = {
    calls: 0, reads: [] as string[],
    remainingToday: async () => { c.calls++; return { remaining: o.remaining ?? 4000, limit: 5000, resetAt: null }; },
    search: async (q: { aspectFilter?: string; offset?: number; fieldgroups?: string }) => {
      c.calls++;
      if (q.fieldgroups === "ASPECT_REFINEMENTS") {
        return { total: 0, itemSummaries: [], next: null, aspectDistributions: [
          { localizedAspectName: "Model Year", aspectValueDistributions: Object.entries(o.years ?? { "1967": 3 }).map(([v, n]) => ({ localizedAspectValue: v, matchCount: n })) },
          { localizedAspectName: "Make", aspectValueDistributions: [{ localizedAspectValue: "Ford", matchCount: 3 }, { localizedAspectValue: "Porsche", matchCount: 1 }] },
        ] };
      }
      c.reads.push(`${q.aspectFilter}@${q.offset}`);
      const all = pages[q.aspectFilter ?? ""] ?? [];
      const items = all.slice(q.offset ?? 0, (q.offset ?? 0) + 200);
      const next = (q.offset ?? 0) + 200 < all.length ? "next" : null;
      return { total: all.length, itemSummaries: items, next, raw: { total: all.length, offset: q.offset, limit: 200, itemSummaries: items } };
    },
  };
  return c;
}
const memStore = () => { let s: any = { pass: null }; return { read: async () => structuredClone(s), write: async (v: any) => { s = structuredClone(v); }, get: () => s }; };
const open = { take: async () => null };
const gateOpen = async () => ({ open: true });

Deno.test("new listings land once, the page is stored once and every landing names it; the same page again writes nothing", async () => {
  const w = world(), sb = fakeSb(w), store = memStore(), rec = recorder(w);
  const pages = { [FILTER]: [sum("2001"), sum("2002", { title: "1967 Porsche 912", make: "Ford" }), sum("2003", { auction: true, price: "100.00" })] };
  const run = (restart = false) => bulk(sb, fakeClient(pages), { ledger: open, store, gate: gateOpen, land: rec.land as any, restart });
  const r1 = await run();
  assertEquals([r1.bulk.pages[0].new, r1.bulk.pages[0].landed, r1.bulk.pages[0].blips, w.snapshots.length, w.uploads.length], [3, 2, 1, 1, 1]);
  assert(rec.landed.every((l) => l.opts.snapshotId === "snap-1" && l.opts.source === "ebay-browse-search" && l.opts.method === "ebay_browse_search_v1"));
  assertEquals(rec.landed[0].opts.extra.identity_claims.year.basis, "ebay Model Year aspect filter");
  assertEquals(w.snapshots[0].row.fetch_method, "ebay_browse_search_page");
  assertEquals(w.snapshots[0].row.metadata.item_keys, ["2001", "2002", "2003"]);
  // the whole chunk was read: the pass is done after one page
  assertEquals(store.get().pass.i, 1);
  const r2 = await run(true);
  assertEquals([r2.bulk.pages[0].current, r2.bulk.pages[0].new, r2.bulk.pages[0].changed], [3, 0, 0]);
  assertEquals([rec.landed.length, w.snapshots.length, w.uploads.length, w.updates.length, w.priceLog.length], [3, 1, 1, 0, 0]);
});

Deno.test("a held listing whose price or bid count moved is updated, not landed again; a blip's new price is a new observation", async () => {
  const w = world(), sb = fakeSb(w), store = memStore(), rec = recorder(w);
  w.episodes.push({ source_url: "https://www.ebay.com/itm/3001", vehicle_id: "veh-3001", current_price: 50000, event_status: "active", bids: null });
  w.episodes.push({ source_url: "https://www.ebay.com/itm/3002", vehicle_id: "veh-3002", current_price: 100, event_status: "active", bids: 0 });
  w.blips.push({ source_identifier: "3003", vehicle_id: null, observed_at: "2026-10-19T00:00:00Z", amount: "9000" });
  const pages = { [FILTER]: [sum("3001", { price: "47500.00" }), sum("3002", { auction: true, price: "150.00", bids: 2 }), sum("3003", { price: "8500.00", make: null, model: "Other Makes" })] };
  const r = await bulk(sb, fakeClient(pages), { ledger: open, store, gate: gateOpen, land: rec.land as any });
  assertEquals([r.bulk.pages[0].changed, r.bulk.pages[0].updated, r.bulk.pages[0].new], [3, 2, 0]);
  assertEquals(w.updates.map((u) => u.current_price), [47500, 150]);
  assertEquals(w.priceLog.map((p) => [p.vehicle_id, p.value, p.price_type]), [["veh-3001", 47500, "asking"]]);   // a bid is not an asking price
  assertEquals([rec.landed.length, rec.landed[0].item.legacyItemId, rec.landed[0].opts.hashRawData], [1, "3003", true]);
  assertEquals(compare(sum("9", { price: "1.00" }) as any, { kind: "episode", vehicle_id: "v", price: 1, bids: null, status: "ended" }), "skip");
});

Deno.test("a converted listing is compared on the seller's own price, not eBay's USD figure of the day", async () => {
  const cad = (id: string, usd: string, own: string) => ({ ...sum(id), price: { value: usd, currency: "USD", convertedFromValue: own, convertedFromCurrency: "CAD" } });
  const ep = (orig: number | null) => ({ kind: "episode" as const, vehicle_id: "v", price: 28000, bids: null, status: "active", orig, origCur: orig == null ? null : "CAD" });
  assertEquals(compare(cad("1", "28343.14", "39995.00") as any, ep(39995)), "current");      // the rate moved, the seller did not
  assertEquals(compare(cad("1", "26930.00", "37995.00") as any, ep(39995)), "changed");      // the seller dropped the price
  assertEquals(compare(cad("1", "28343.14", "39995.00") as any, ep(null)), "changed");       // not recorded yet: one update records it
  // a blip read another way (Firecrawl, Wayback) is read once from the page; one this lander wrote is compared on price
  const blip = (method: string) => ({ kind: "blip" as const, price: 45000, observed_at: "2026-10-15T00:00:00Z", method, orig: null, origCur: null });
  assertEquals([compare(sum("2") as any, blip("ebay_firecrawl_v1")), compare(sum("2") as any, blip("ebay_browse_search_v1"))], ["changed", "current"]);

  const w = world(), store = memStore(), rec = recorder(w);
  w.episodes.push({ source_url: "https://www.ebay.com/itm/3101", vehicle_id: "veh-3101", current_price: 28000, event_status: "active", bids: null });
  w.episodes.push({ source_url: "https://www.ebay.com/itm/3102", vehicle_id: "veh-3102", current_price: 15999, event_status: "active", bids: null, ppo: "22500", ppc: "CAD" });
  const pages = { [FILTER]: [cad("3101", "28343.14", "39995.00"), cad("3102", "13819.01", "19500.00")] };
  const r = await bulk(fakeSb(w), fakeClient(pages), { ledger: open, store, gate: gateOpen, land: rec.land as any });
  assertEquals([r.bulk.pages[0].changed, r.bulk.pages[0].updated], [2, 2]);
  assertEquals(w.updates.map((u) => [u.metadata.price_original, u.metadata.price_changed_at != null]),
    [[{ amount: 39995, currency: "CAD", converted: true }, false], [{ amount: 19500, currency: "CAD", converted: true }, true]]);
  assertEquals(w.priceLog.map((p) => [p.vehicle_id, p.value, p.notes.includes("seller's price CAD 19500")]), [["veh-3102", 13819.01, true]]);
});

Deno.test("a deleted member is redacted before anything is stored or landed, with one lookup for the page", async () => {
  const w = world(), sb = fakeSb(w), store = memStore(), rec = recorder(w);
  w.gone.add(await handleHash("gone_member"));
  const pages = { [FILTER]: [sum("4001", { seller: "gone_member", title: "1967 Ford Mustang from gone_member" }), sum("4002", { seller: "kept_member" })] };
  await bulk(sb, fakeClient(pages), { ledger: open, store, gate: gateOpen, land: rec.land as any });
  assertEquals(w.lookups, 1);
  const gone = rec.landed.find((l) => l.item.legacyItemId === "4001")!.item;
  assertEquals([gone.seller, gone.title.includes("gone_member")], [{}, false]);
  assertEquals(rec.landed.find((l) => l.item.legacyItemId === "4002")!.item.seller.username, "kept_member");
  // the stored page carries no seller object at all, so no handle: each item's observation keeps the seller, where deletions are honoured
  const body = new TextDecoder().decode(await new Response(new Blob([w.uploads[0].bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  assertEquals([body.includes("gone_member"), body.includes("kept_member"), body.includes('"seller"'), w.snapshots[0].row.metadata.member_handles_sha256], [false, false, false, []]);
  const pl = await pageLookup(async () => new Set(["x"]), []);
  assertEquals((await pl(["x", "y"])).size, 0);   // an empty page asks nothing and answers nothing
  assertEquals(JSON.parse(storedBody({ total: 1, next: null }, [sum("5") as any])).itemSummaries[0].seller, undefined);
});

Deno.test("caps stop the action: calls per run, the day's ledger, the quota floor, the IO gate, landings per run", async () => {
  const pages = { [FILTER]: Array.from({ length: 450 }, (_, i) => sum(String(6000 + i))) };
  const years = { "1967": 450 };
  // calls per run: the plan (1) + one page
  let w = world(); let c = fakeClient(pages, { years });
  let r = await bulk(fakeSb(w), c, { maxCalls: 2, ledger: open, store: memStore(), gate: gateOpen, land: recorder(w).land as any, maxLand: 1000 });
  assertEquals([r.bulk.browse_calls, r.bulk.pages.length, r.stopped?.startsWith("budget")], [2, 1, true]);
  // the day's ledger
  let n = 0;
  w = world(); c = fakeClient(pages, { years });
  r = await bulk(fakeSb(w), c, { ledger: { take: async () => (++n > 1 ? "daily cap: used" : null) }, store: memStore(), gate: gateOpen, land: recorder(w).land as any });
  assertEquals([r.bulk.pages.length, r.stopped], [0, "daily cap: used"]);
  // the floor: eBay says 900 left, 1,000 kept
  w = world(); c = fakeClient(pages, { years, remaining: 900 });
  r = await bulk(fakeSb(w), c, { ledger: open, store: memStore(), gate: gateOpen, land: recorder(w).land as any });
  assertEquals([r.bulk.browse_calls, r.stopped?.startsWith("quota")], [0, true]);
  // the IO gate closed: nothing read
  w = world(); c = fakeClient(pages, { years });
  r = await bulk(fakeSb(w), c, { ledger: open, store: memStore(), gate: async () => ({ open: false, io_waiters: 9 }), land: recorder(w).land as any });
  assertEquals([c.calls, r.stopped?.startsWith("io_gate")], [0, true]);
  // landings per run: the page stops part-way and the cursor stays on it
  w = world(); c = fakeClient(pages, { years });
  const store = memStore(), rec = recorder(w);
  r = await bulk(fakeSb(w), c, { maxLand: 50, ledger: open, store, gate: gateOpen, land: rec.land as any });
  assertEquals([rec.landed.length, r.bulk.pages[0].complete, store.get().pass.offset, r.stopped?.startsWith("cap")], [50, false, 10, true]);
});

Deno.test("cursor resume: each run continues where the last stopped, re-reading a cut page, until the pass completes", async () => {
  const pages = { [FILTER]: Array.from({ length: 450 }, (_, i) => sum(String(7000 + i))) };
  const w = world(), store = memStore(), rec = recorder(w), sb = fakeSb(w);
  const reads: string[] = [];
  const run = async (o: Record<string, unknown>) => {
    const c = fakeClient(pages, { years: { "1967": 450 } });
    const r = await bulk(sb, c, { ledger: open, store, gate: gateOpen, land: rec.land as any, ...o });
    reads.push(...c.reads);
    return r;
  };
  await run({ maxCalls: 2, maxLand: 1000 });              // plan + page @0 (200 landed)
  await run({ maxCalls: 1, maxLand: 120 });               // page @190 (overlap 10): 10 held, 120 of 190 new land, cut
  await run({ maxCalls: 1, maxLand: 1000 });              // the same page again: the rest land
  const last = await run({ maxCalls: 2, maxLand: 1000 }); // page @380 (the last), then the pass completes
  assertEquals(reads, [`${FILTER}@0`, `${FILTER}@190`, `${FILTER}@190`, `${FILTER}@380`]);
  assertEquals(new Set(rec.landed.map((l) => l.item.legacyItemId)).size, 450);
  assertEquals(rec.landed.length, 450);                   // nothing landed twice
  assertEquals([last.bulk.pass_done, store.get().pass.finished_at !== null, store.get().pass.counts.landed], [true, true, 450]);
});

Deno.test("a throttled landing waits out the trace window and is tried again; one that fails settles and the cursor moves on", async () => {
  assertEquals([traceRetryMs(new Error("Rate limit exceeded for trace 01a1. Retry after 49787ms.")), traceRetryMs(new Error("boom"))], [49787, null]);
  const w = world(), store = memStore(), rec = recorder(w);
  let calls = 0;
  const land = async (...a: any[]) => {
    calls++;
    if (calls === 2) throw new Error("Rate limit exceeded for trace 01a1. Retry after 5ms.");
    if (a[1].legacyItemId === "9003") throw new Error("ingest timeout");
    return await (rec.land as any)(...a);
  };
  const pages = { [FILTER]: [sum("9001"), sum("9002"), sum("9003"), sum("9004")] };
  const r = await bulk(fakeSb(w), fakeClient(pages), { ledger: open, store, gate: gateOpen, land: land as any, concurrency: 1 });
  assertEquals([r.bulk.trace_waits, r.bulk.pages[0].landed, r.bulk.pages[0].skipped, r.bulk.pages[0].complete, store.get().pass.i], [1, 3, 1, true, 1]);
  assertEquals([new Set(rec.landed.map((l) => l.item.legacyItemId)).size, r.errors.length], [3, 1]);   // 9002 landed on its retry; 9003 is the one error
  // a window that opens after the run's time budget: the throttled listing waits for the next run, and the page is read again
  const w2 = world(), store2 = memStore();
  const r2 = await bulk(fakeSb(w2), fakeClient(pages), { ledger: open, store: store2, gate: gateOpen, budgetMs: 1000, concurrency: 1,
    land: (async () => { throw new Error("Rate limit exceeded for trace 01a2. Retry after 60000ms."); }) as any });
  assertEquals([r2.bulk.pages[0].complete, store2.get().pass.offset, r2.ok], [false, 10, true]);
});

// ---- which listings get a full read first (the sweep) ----------------------------------------------------------------------

Deno.test("full reads go vintage first, then auctions ending soonest, private sellers, the anchor areas", () => {
  const c = (key: string, tier: number, endsAt: number | null, cls: Cand["cls"], area: number): Cand => ({ key, id: key, tier, endsAt, cls, area });
  const ranked = [c("dealer-t2", 2, null, "likely_dealer", 0), c("lv-t1", 1, null, "unknown", 0), c("auc-late", 1, 2000, "likely_dealer", 5),
    c("auc-soon", 1, 1000, "likely_dealer", 5), c("priv-t1", 1, null, "likely_private", 9), c("far-t1", 1, null, "unknown", 9)].sort(byDetailPriority);
  assertEquals(ranked.map((x) => x.key), ["auc-soon", "auc-late", "priv-t1", "lv-t1", "far-t1", "dealer-t2"]);
});
