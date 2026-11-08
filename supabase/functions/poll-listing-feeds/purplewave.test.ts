import { purplewaveLot, purplewaveObservation, purplewavePageUrl, purplewaveProjection, landPurplewaveLot, pollPurplewave } from "./purplewave.ts";
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const clock = "2026-11-08T19:00:00.000Z";
const raw = { auction: "261111", item: "EX2391", year: 2012, make: "Dodge", model: "Ram 2500", industry_category_id: 277,
  current_bid: 8300, bid_count: 29, endtime: 1794412800, winning_bid_time: 1794110000, auction_closed: 0, closed: 0, halted: 0,
  new_description: "Source description", extension: 1, vin: "source claim", arbitrary_context: { retained: true } };

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
  let saved: any;
  const db = { functions: { invoke: async (name: string, { body }: any) => {
    calls.push({ name, body });
    if (name === "ingest") return { data: { status: "created", vehicle_id: "vehicle" } };
    saved = body;
    return failAdmission ? { error: { message: "refused" } } : { data: { success: true, observation_id: "observation" } };
  } }, from(table: string) {
    let action = "read";
    const result = () => ({ data: table === "observation_sources" ? { species: "timed_auction", supported_observations: ["listing"] }
      : table === "vehicle_observations" ? { id: "observation", ...saved }
      : table === "vehicle_events" ? (action === "insert" ? [{ id: "episode" }] : [])
      : table === "vehicles" ? (action === "update" ? [{ id: "vehicle" }] : { id: "vehicle", platform_source: "purplewave", listing_url: `https://www.purplewave.com/auction/${raw.auction}/item/${raw.item}`, origin_metadata: null, deleted_at: null })
      : null, error: null });
    const q: any = { select: () => q, eq: () => q, is: () => q, limit: () => q, maybeSingle: async () => result(), single: async () => result(),
      update: (body: any) => { action = "update"; writes.push({ table, body }); return q; },
      insert: (body: any) => { action = "insert"; writes.push({ table, body }); return q; },
      then: (resolve: any) => Promise.resolve(result()).then(resolve) };
    return q;
  } };
  return { db, calls, writes };
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
  const progress = f.writes.find(w => w.table === "listing_feeds")!.body;
  equal(progress.search_criteria.native_offset, 1); equal(progress.search_criteria.kept, true);
  equal("poll_interval_minutes" in progress, false); equal("enabled" in progress, false);
});
Deno.test("scalar projection preserves other source ownership, freshness and opening-price semantics", () => {
  const lot = purplewaveLot(raw, clock);
  const held = { platform_source: "purplewave", listing_url: lot.url, origin_metadata: { keep: true }, deleted_at: null };
  equal(purplewaveProjection(lot, { ...held, platform_source: "bat" }, "obs"), null);
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
