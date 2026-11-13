import { purplewaveLot, purplewaveObservation, purplewavePageUrl, purplewaveProjection, purplewaveImages, landPurplewaveLot, pollPurplewave } from "./purplewave.ts";
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const clock = "2026-11-08T19:00:00.000Z";
const raw = { auction: "261111", item: "EX2391", year: 2012, make: "Dodge", model: "Ram 2500", industry_category_id: 277,
  current_bid: 8300, bid_count: 29, endtime: 1794412800, winning_bid_time: 1794110000, auction_closed: 0, closed: 0, halted: 0,
  new_description: "Source description", extension: 1, vin: "source claim", arbitrary_context: { retained: true } };

Deno.test("publisher gallery reaches sanctioned identity intake in source order without changing raw evidence", async () => {
  const base = "https://d323w7klwy72q3.cloudfront.net/i/a/2026/20261111example";
  const source = { ...raw, image_url: base, image: "EX2391.JPG", image_files: ["EX2391.JPG", "EX2391A.JPG", "EX2391ZA.JPG"] };
  const lot = purplewaveLot(source, clock), f = fixture();
  await landPurplewaveLot(f.db, lot);
  equal(f.calls[0].body.image_url, `${base}/EX2391.JPG`);
  equal(f.calls[0].body.image_urls, source.image_files.map(name => `${base}/${name}`));
  equal(f.calls[1].body.structured_data.source_payload, source);
  equal(purplewaveImages({ securebaseurl: base + "/", images: "EX2391.JPG EX2391A.JPG" }, "EX2391"), lot.images.slice(0, 2));
});
Deno.test("gallery rejects foreign lots, traversal and nonpublisher destinations", () => {
  const base = "https://d323w7klwy72q3.cloudfront.net/i/a/2026/20261111example";
  equal(purplewaveImages({ image_url: base, image_files: ["../EX2391.JPG", "OTHER.JPG", "EX2391.JPG?x", "https://evil.test/x", "EX2391.JPG"] }, "EX2391"), [`${base}/EX2391.JPG`]);
  for (const invalid of ["http://d323w7klwy72q3.cloudfront.net/i/a/2026/x", "https://evil.test/i/a/2026/x", base + "?x", base + "#x", "https://user@d323w7klwy72q3.cloudfront.net/i/a/2026/x"]) {
    equal(purplewaveImages({ image_url: invalid, image: "EX2391.JPG" }, "EX2391"), []);
  }
  equal(purplewaveImages({}, "EX2391"), []);
});

Deno.test("PurpleWave snapshots retain native context and distinct read/bid clocks without asserting individual bids", () => {
  const lot = purplewaveLot(raw, clock), post = purplewaveObservation(lot, "vehicle");
  equal(lot.key, "261111:EX2391"); equal(post.kind, "listing"); equal(post.observed_at, clock);
  equal(post.structured_data.source_payload, raw); equal(post.structured_data.individual_bid, false);
  equal(post.structured_data.latest_bid_at, new Date(raw.winning_bid_time * 1000).toISOString());
  equal("sale_price" in post.structured_data, false); equal(lot.closed, false);
  equal(purplewaveLot({ ...raw, endtime: 1 }, clock).closed, false);
  equal(purplewaveLot({ ...raw, closed: 1 }, clock).closed, true);
  equal(purplewaveLot({ ...raw, auction: "261111A" }, clock).url, "https://www.purplewave.com/auction/261111A/item/EX2391");
});
Deno.test("PurpleWave rejects wrong taxonomy, malformed identity and invalid bid clocks/counts", () => {
  for (const patch of [{ auction: "../../other" }, { item: "evil?" }, { current_bid: -1 }, { bid_count: 1.5 }, { endtime: null }, { industry_category_id: 151 }]) {
    let failed = false; try { purplewaveLot({ ...raw, ...patch }, clock); } catch { failed = true; } equal(failed, true);
  }
  equal(new URL(purplewavePageUrl(2)).searchParams.get("filters"), "industry_category_id:277");
});

function fixture(failAdmission = false) {
  const calls: { name: string; body: any }[] = [], writes: { table: string; body: any }[] = [];
  const snapshots = new Map<string, any>();
  const controls = { progressConflict: false, newerEpisode: false };
  let saved: any;
  const db = { functions: { invoke: async (name: string, { body }: any) => {
    calls.push({ name, body });
    if (name === "ingest") return { data: { status: "created", vehicle_id: "vehicle" } };
    saved = body;
    return failAdmission ? { error: { message: "refused" } } : { data: { success: true, observation_id: "observation" } };
  } }, from(table: string) {
    let action = "read";
    let selectedId: string | undefined, insertedId: string | undefined;
    const result = () => ({ data: table === "listing_page_snapshots" ? (action === "insert" ? { id: insertedId } : [...snapshots.values()].filter(r => !selectedId || r.id === selectedId))
      : table === "listing_feeds" ? (controls.progressConflict ? [] : [{ id: "feed" }])
      : table === "observation_sources" ? { species: "timed_auction", supported_observations: ["listing"] }
      : table === "vehicle_observations" ? { id: "observation", ...saved }
      : table === "vehicle_events" ? (action === "insert" ? [{ id: "episode" }] : controls.newerEpisode ? [{ id: "episode", metadata: { source_observed_at: "2026-11-09T00:00:00Z" } }] : [])
      : table === "vehicles" ? (action === "update" ? [{ id: "vehicle" }] : { id: "vehicle", platform_source: "purplewave", listing_url: `https://www.purplewave.com/auction/${raw.auction}/item/${raw.item}`, origin_metadata: null, deleted_at: null })
      : null, error: null });
    const q: any = { select: () => q, eq: (key: string, value: string) => { if (key === "id") selectedId = value; return q; }, is: () => q, limit: () => q,
      maybeSingle: async () => { const r = result(); return table === "listing_page_snapshots" && action === "read" ? { ...r, data: (r.data as any[])[0] } : r; }, single: async () => result(),
      update: (body: any) => { action = "update"; writes.push({ table, body }); return q; },
      insert: (body: any) => { action = "insert"; writes.push({ table, body });
        if (table === "listing_page_snapshots") { insertedId = `00000000-0000-4000-8000-${String(snapshots.size + 1).padStart(12, "0")}`; snapshots.set(insertedId, { ...body, id: insertedId }); }
        return q; },
      then: (resolve: any) => Promise.resolve(result()).then(resolve) };
    return q;
  } };
  return { db, calls, writes, snapshots, controls };
}
Deno.test("PurpleWave lands identity -> attributed snapshot -> episode -> high bid, never asking/sale price", async () => {
  const f = fixture(), result = await landPurplewaveLot(f.db, purplewaveLot(raw, clock));
  equal(result.episode_id, "episode"); equal(f.calls.map(c => c.name), ["ingest", "ingest-observation"]);
  equal(f.calls[0].body.enrich, false); equal("price" in f.calls[0].body, false);
  equal(f.writes.map(w => w.table), ["vehicle_events", "vehicles"]);
  equal(f.writes[0].body.source_listing_id, "261111:EX2391");
  equal(f.writes[0].body.metadata.source_observation_id, "observation");
  equal(f.writes[1].body.high_bid, 8300); equal("sale_price" in f.writes[1].body, false);
});
Deno.test("failed admission never projects an episode or high bid", async () => {
  const f = fixture(true); let failed = false;
  try { await landPurplewaveLot(f.db, purplewaveLot(raw, clock)); } catch { failed = true; }
  equal(failed, true); equal(f.writes.length, 0);
});
Deno.test("an exhausted grant stops before any identity or testimony write", async () => {
  const f = fixture(); let failed = false;
  try { await landPurplewaveLot(f.db, purplewaveLot(raw, clock), AbortSignal.abort()); } catch { failed = true; }
  equal(failed, true); equal(f.calls, []); equal(f.writes, []);
});
Deno.test("missing source identity stays unresolved rather than inventing a vehicle", async () => {
  const f = fixture(); const result = await landPurplewaveLot(f.db, purplewaveLot({ ...raw, year: 0 }, clock));
  equal(result.vehicle_id, null); equal(f.calls.map(c => c.name), ["ingest-observation"]); equal(f.writes, []);
});
Deno.test("feed advances only admitted bounded slots and preserves controls", async () => {
  const f = fixture(); let reservations = 0;
  const budget = { refusal: () => null, reserve: () => (++reservations <= 1 ? { timeout_ms: 5000 } : null), record: () => {} } as any;
  const feed = { id: "feed", enabled: true, display_name: "PurpleWave", search_criteria: { native_page: 1, native_offset: 0, kept: true } };
  const result = await pollPurplewave(f.db, feed, budget, 1, async () => new Response(JSON.stringify([raw, { ...raw, item: "EX2392" }])));
  equal(result.snapshots_admitted, 1); equal(result.error, null);
  const progress = f.writes.filter(w => w.table === "listing_feeds").at(-1)!.body;
  equal(progress.search_criteria.native_offset, 1); equal(progress.search_criteria.kept, true);
  equal("poll_interval_minutes" in progress, false); equal("enabled" in progress, false);
});
Deno.test("scalar projection preserves other source ownership, freshness and opening-price semantics", () => {
  const lot = purplewaveLot(raw, clock);
  const held = { platform_source: "purplewave", listing_url: lot.url, origin_metadata: { keep: true }, deleted_at: null };
  equal(purplewaveProjection(lot, { ...held, platform_source: "bat" }, "obs"), null);
  equal(purplewaveProjection(lot, { ...held, sale_status: "no_sale" }, "obs"), null);
  equal(purplewaveProjection(lot, { ...held, listing_url: lot.url + "other" }, "obs"), null);
  equal(purplewaveProjection(lot, { ...held, origin_metadata: { purplewave_observed_at: "2026-11-09T00:00:00Z" } }, "obs"), null);
  equal(purplewaveProjection(purplewaveLot({ ...raw, bid_count: 0 }, clock), held, "obs")?.high_bid, null);
  equal(purplewaveProjection(purplewaveLot({ ...raw, current_bid: 8300.75 }, clock), held, "obs")?.high_bid, 8300);
  equal(purplewaveProjection(lot, held, "obs")?.origin_metadata.keep, true);
});
Deno.test("public API refusal does not invoke a renderer or intake", async () => {
  const f = fixture();
  const result = await pollPurplewave(f.db, { enabled: true }, { refusal: () => null } as any, 1,
    async () => new Response("denied", { status: 403 }));
  equal(result.error, "PurpleWave HTTP 403; no fallback"); equal(f.calls, []);
});

Deno.test("native call cap preserves the partial page for the next invocation", async () => {
  const f = fixture();
  const budget = { refusal: () => null, reserve: () => ({ timeout_ms: 5000 }), record: () => {} } as any;
  const feed = { id: "feed", enabled: true, display_name: "PurpleWave", search_criteria: { native_page: 1, native_offset: 0 } };
  const rows = Array.from({ length: 25 }, (_, i) => ({ ...raw, item: `EX${String(i).padStart(4, "0")}` }));
  const fetcher = async () => new Response(JSON.stringify(rows));
  const first = await pollPurplewave(f.db, feed, budget, 40, fetcher);
  equal(first.error, null); equal(first.snapshots_admitted, 8); equal(f.calls.length, 16);
  const saved = f.writes.filter(w => w.table === "listing_feeds").at(-1)!.body.search_criteria;
  equal(saved.native_page, 1); equal(saved.native_offset, 8);
  const second = await pollPurplewave(f.db, { ...feed, search_criteria: saved }, budget, 40, fetcher);
  equal(second.error, null); equal(second.snapshots_admitted, 8);
  const resumed = f.calls.filter(c => c.name === "ingest")[8].body.url;
  equal(resumed.endsWith("/item/EX0008"), true);
  equal(f.writes.filter(w => w.table === "listing_feeds").at(-1)!.body.search_criteria.native_offset, 16);
});

Deno.test("explicit native VIN reaches intake and raw source HTML remains attributed", async () => {
  const source = { ...raw, vin: "1GT19LE74NF216181", new_description: "<b>GMC Sierra</b><li>VIN: 1GT19LE74NF216181</li>" };
  const lot = purplewaveLot(source, clock), f = fixture();
  await landPurplewaveLot(f.db, lot);
  equal(f.calls[0].body.vin, source.vin);
  equal(f.calls[0].body.description.includes("<"), false);
  equal(f.calls[1].body.structured_data.source_payload.new_description, source.new_description);
  const owned = { platform_source: "purplewave", listing_url: lot.url, description: source.new_description };
  equal(purplewaveProjection(lot, owned, "obs")?.description, lot.description);
  equal(purplewaveProjection(lot, { ...owned, description: "Owner's separate description" }, "obs")?.description, undefined);
});

Deno.test("resumed page keeps all 25 original members and source clock even if publisher reorders", async () => {
  const f = fixture(), budget = { refusal: () => null, reserve: () => ({ timeout_ms: 5000 }), record: () => {} } as any;
  const rows = Array.from({ length: 25 }, (_, i) => ({ ...raw, item: `EX${String(i).padStart(4, "0")}` }));
  let reads = 0, config: any = { native_page: 1, native_offset: 0, kept: true };
  const fetcher = async () => { reads++; return new Response(JSON.stringify(reads === 1 ? rows : rows.toReversed())); };
  for (const expected of [8, 8, 8, 1]) {
    const result = await pollPurplewave(f.db, { id: "feed", enabled: true, search_criteria: config }, budget, 40, fetcher);
    equal(result.error, null); equal(result.snapshots_admitted, expected);
    config = f.writes.filter(w => w.table === "listing_feeds").at(-1)!.body.search_criteria;
  }
  const observations = f.calls.filter(c => c.name === "ingest-observation").map(c => c.body);
  equal(reads, 1); equal(observations.length, 25); equal(new Set(observations.map(o => o.structured_data.native_item_id)).size, 25);
  equal(new Set(observations.map(o => o.observed_at)).size, 1);
  equal(new Set(observations.map(o => o.raw_source_ref)).size, 1);
  equal(config.native_page, 2); equal(config.native_offset, 0); equal(config.native_capture, null); equal(config.kept, true);
});

Deno.test("legacy partial offset restarts a retained page; corrupt custody refuses fresh-page fallback", async () => {
  const f = fixture(), budget = { refusal: () => null, reserve: () => ({ timeout_ms: 5000 }), record: () => {} } as any;
  const rows = Array.from({ length: 25 }, (_, i) => ({ ...raw, item: `EX${String(i).padStart(4, "0")}` }));
  const feed = { id: "feed", enabled: true, search_criteria: { native_page: 2, native_offset: 16 } };
  const first = await pollPurplewave(f.db, feed, budget, 1, async () => new Response(JSON.stringify(rows)));
  equal(first.error, null); equal(f.calls[0].body.url.endsWith("EX0000"), true);
  const config = f.writes.filter(w => w.table === "listing_feeds").at(-1)!.body.search_criteria;
  equal(config.native_offset, 1);
  f.snapshots.get(config.native_capture.id).html += " ";
  const second = await pollPurplewave(f.db, { ...feed, search_criteria: config }, budget, 8, async () => { throw Error("must not refetch"); });
  equal(second.error, "PurpleWave retained page verification failed"); equal(second.snapshots_admitted, 0);
  equal(f.calls.length, 2);
});

Deno.test("conflicting checkpoint cannot admit lots from an unclaimed page", async () => {
  const f = fixture(); f.controls.progressConflict = true;
  const result = await pollPurplewave(f.db, { id: "feed", enabled: true, search_criteria: {} },
    { refusal: () => null, reserve: () => ({ timeout_ms: 5000 }), record: () => {} } as any, 8,
    async () => new Response(JSON.stringify([raw])));
  equal(result.error, "PurpleWave progress changed concurrently or could not be saved"); equal(f.calls, []);
});

Deno.test("a resumed older snapshot is retained without regressing a newer episode or blocking the cursor", async () => {
  const f = fixture(); f.controls.newerEpisode = true;
  const result = await landPurplewaveLot(f.db, purplewaveLot(raw, clock));
  equal(result.observation_id, "observation"); equal("newer_state_preserved" in result && result.newer_state_preserved, true);
  equal(f.writes, []); equal(f.calls.map(c => c.name), ["ingest", "ingest-observation"]);
});
