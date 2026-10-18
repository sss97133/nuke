import assert from "node:assert/strict";
import { handleBrowserCapture, validateCapture, type BrowserCapture } from "./capture.ts";
import { handleDirect } from "./direct.ts";
import { parseCardLine, prepareCapture } from "../../../scripts/fb-import-urls.ts";

const first: BrowserCapture = {
  capture_id: "00000000-0000-4000-a000-000000000001", observed_at: "2026-10-12T05:51:00Z",
  target_url: "https://www.facebook.com/marketplace/las-vegas/vehicles/",
  actual_url: "https://www.facebook.com/marketplace/category/vehicles/",
  actual_region: "declared test region", retrieval_surface: "chrome_native_accessibility", complete: false, access_state: "available",
};
const item = { facebook_id: "123456789012345", title: "1970 GMC C10", price: 3500, parsed_year: 1970,
  content_text: "1970 GMC C10, $3,500, Example City, XX", status: "active" };

// Supabase's fluent shape with actual durable state, conflict/retry and acknowledgement failures.
class MemoryDb {
  tables: Record<string, any[]> = { marketplace_listings: [], fb_sweep_jobs: [], fb_listing_sightings: [] };
  fail: {table: string; op: string; noAck?: boolean} | null = null;
  from(table: string) {
    const db = this; let op = "read"; let input: any; let options: any; let single = false;
    const filters: [string, any][] = [];
    const q: any = {
      select: () => q, eq: (key: string, val: any) => { filters.push([key,val]); return q; },
      insert: (row: any) => { op = "insert"; input = row; return q; },
      update: (row: any) => { op = "update"; input = row; return q; },
      upsert: (row: any, opts: any) => { op = "upsert"; input = row; options = opts; return q; },
      maybeSingle: () => { single = true; return q; },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        if (db.fail?.table === table && db.fail.op === op) {
          const failed = db.fail; db.fail = null;
          return { data: null, error: failed.noAck ? null : { message: "injected custody failure" } };
        }
        const rows = db.tables[table]; let selected = rows.filter(r => filters.every(([k,v]) => r[k] === v));
        if (op === "insert" || op === "upsert") {
          const existing = rows.find(r => r.id === input.id || (table === "marketplace_listings" && r.facebook_id === input.facebook_id));
          if (existing && op === "insert") return { data: null, error: { code: "23505", message: "duplicate" } };
          if (!existing) { const row = structuredClone({ id: crypto.randomUUID(), ...input }); rows.push(row); selected = [row]; }
          else { if (!options?.ignoreDuplicates) Object.assign(existing, structuredClone(input)); selected = [existing]; }
        } else if (op === "update") selected.forEach(r => Object.assign(r, structuredClone(input)));
        return { data: structuredClone(single ? selected[0] ?? null : selected), error: null };
      }).then(resolve,reject),
    };
    return q;
  }
}

function runner(db: MemoryDb, writer?: any) {
  return (capture: BrowserCapture, batch = [item]) => handleBrowserCapture(db, { capture, batch }, body => handleDirect(body, {
    supabase: db, capturePrepared: true,
    linkToVehicle: async () => ({ vehicle_id: null, suggested_vehicle_id: null }),
    writeObservation: writer ?? (async () => { throw new Error("unlinked testimony must not invent a vehicle"); }),
  }));
}

Deno.test("native card parsing retains unknown/newer years, original text and reduced asking price", () => {
  const plain = "42 link 1970 GMC C10, $3,500, Example City, XX, listing 123456789012345, Value: facebook.com/marketplace/item/123456789012345/";
  const reversed = "43 link Value: facebook.com/marketplace/item/123456789012346/, 2008 Toyota Tundra, $21,000, reduced from $22,000, Example City, XX, listing 123456789012346";
  assert.equal(parseCardLine(plain)?.title, "1970 GMC C10");
  assert.equal(parseCardLine(plain)?.price, 3500);
  assert.equal(parseCardLine(reversed)?.price, 21000);
  assert.equal(parseCardLine(reversed)?.location, "Example City, XX");
  assert.equal(parseCardLine(reversed)?.content_text, reversed);
  const unknown = "44 link Project truck, $0, Example City, XX, listing 123456789012347, Value: facebook.com/marketplace/item/123456789012347/";
  const packet = prepareCapture({ ...first, card_lines: [reversed,unknown,plain,plain] });
  assert.equal(packet.batch.length, 3); assert.equal(packet.batch[0].parsed_year, 1970);
  assert.equal(packet.local_parse.duplicates, 1); assert.equal(parseCardLine(unknown)?.price, 0);
  assert.equal(parseCardLine(unknown)?.parsed_year, undefined);
});

Deno.test("initial/repeat/replay preserves original testimony, clocks, price history and unresolved identity", async () => {
  const db = new MemoryDb(); const run = runner(db);
  const original = await run(first);
  assert.equal(original.success, true); assert.equal(original.counts.sightings_landed, 1); assert.equal(original.counts.unlinked, 1);
  const listing = db.tables.marketplace_listings[0]; listing.raw_scrape_data.legacy_original = { retained: true };
  const repeat = { ...first, capture_id: "00000000-0000-4000-a000-000000000002", observed_at: "2026-10-12T05:55:00Z" };
  const changed = await run(repeat, [{...item,price:3000,content_text:"same advertised truck, now $3,000"}]);
  assert.equal(changed.counts.new_listings, 0); assert.equal(db.tables.fb_listing_sightings.length, 2);
  assert.deepEqual(db.tables.fb_listing_sightings.map(s => s.price_at_sighting), [3500,3000]);
  const replay = await run(first);
  assert.equal(replay.counts.duplicate_sightings, 1); assert.equal(db.tables.fb_listing_sightings.length, 2);
  assert.equal(listing.submission_count, 2); assert.equal(listing.first_seen_at, first.observed_at);
  assert.equal(listing.last_seen_at, repeat.observed_at); assert.equal(listing.current_price, 3000);
  assert.deepEqual(listing.raw_scrape_data.legacy_original, {retained:true});
  assert.equal(db.tables.fb_sweep_jobs[0].metadata.batch[0].content_text, item.content_text);
  assert.equal(db.tables.fb_sweep_jobs[0].metadata.results[0].observation_landing.status, "unlinked");
  assert.equal(listing.vehicle_id, undefined); assert.equal(listing.status, "active");
});

Deno.test("listing errors and missing ACK never count as landing; retry resumes the same immutable pass", async () => {
  for (const noAck of [false,true]) {
    const db = new MemoryDb(); const run = runner(db);
    db.fail = { table: "marketplace_listings", op: "insert", noAck };
    const failed = await run(first);
    assert.equal(failed.success, false); assert.equal(failed.counts.raw_landed, 1);
    assert.equal(failed.counts.listings_landed, 0); assert.equal(failed.counts.sightings_landed, 0);
    assert.equal(db.tables.fb_sweep_jobs[0].status, "failed");
    const resumed = await run(first);
    assert.equal(resumed.success, true); assert.equal(db.tables.fb_sweep_jobs.length, 1);
    assert.equal(db.tables.fb_listing_sightings.length, 1);
    assert.equal(db.tables.fb_sweep_jobs[0].metadata.capture.observed_at, first.observed_at);
  }
});

Deno.test("linked observations are awaited, failures explicit, retry has stable source identity and original clock", async () => {
  const db = new MemoryDb();
  db.tables.marketplace_listings.push({ id: "listing", facebook_id: item.facebook_id, vehicle_id: "vehicle", submission_count: 1,
    first_seen_at: "2026-10-01T00:00:00Z", last_seen_at: "2026-10-01T00:00:00Z", raw_scrape_data: {original:"kept"} });
  const inputs: any[] = []; let fail = true; let release: (() => void) | undefined;
  let enter!: () => void; let entered = new Promise<void>(r => { enter = r; });
  const run = runner(db, async (_: any, input: any) => {
    inputs.push(input); await new Promise<void>(r => { release = r; enter(); });
    return fail ? { errors: ["rejected observation custody"] } : { observationId:"observation",duplicate:false,errors:[] };
  });
  const pending = run(first); await entered;
  assert.equal(db.tables.fb_listing_sightings.length, 0); release!();
  const failed = await pending;
  assert.equal(failed.success, false); assert.equal(failed.counts.sightings_landed, 1);
  assert.equal(failed.results[0].observation_landing.status, "error");
  fail = false; entered = new Promise<void>(r => { enter = r; }); const retry = run(first); await entered; release!();
  const landed = await retry;
  assert.equal(landed.success, true); assert.equal(landed.counts.linked_observations, 1);
  assert.equal(db.tables.fb_listing_sightings.length, 1);
  assert.equal(inputs[0].observedAt, first.observed_at); assert.equal(inputs[1].source.sourceIdentifier, inputs[0].source.sourceIdentifier);
  assert.equal(inputs[0].contentText, item.content_text);
  assert.equal(db.tables.marketplace_listings[0].submission_count, 2);
});

Deno.test("reusing a capture ID with changed testimony and blocked surfaces fails before any new landing", async () => {
  const db = new MemoryDb(); const run = runner(db); await run(first);
  await assert.rejects(run(first,[{...item,price:1}]), /different original testimony/);
  assert.equal(db.tables.fb_listing_sightings.length, 1);
  assert.throws(() => validateCapture({...first,access_state:"blocked" as any},[item]), /source access/);
  assert.throws(() => validateCapture({...first,actual_url:"https://www.facebook.com/api/graphql/"},[item]), /browser surface/);
});

Deno.test("failed sighting and failed completion ACK are visible; retries retain source clocks", async () => {
  const db = new MemoryDb(); const run = runner(db);
  db.fail = {table:"fb_listing_sightings",op:"upsert"};
  const failed = await run(first); assert.equal(failed.success,false); assert.equal(failed.counts.listings_landed,1);
  assert.equal(failed.counts.sightings_landed,0); assert.equal(failed.results[0].observation_landing.status,"unlinked");
  db.fail = {table:"fb_sweep_jobs",op:"update",noAck:true};
  await assert.rejects(run(first),/completion not acknowledged/);
  const resumed = await run(first); assert.equal(resumed.success,true);
  assert.equal(db.tables.fb_listing_sightings.length,1); assert.equal(db.tables.marketplace_listings[0].submission_count,1);
});

Deno.test("existing-listing read/update failures preserve prior raw material and never acknowledge a visit", async () => {
  const db = new MemoryDb(); const run = runner(db); await run(first);
  const repeat = { ...first, capture_id: "00000000-0000-4000-a000-000000000003", observed_at: "2026-10-12T06:00:00Z" };
  const before = structuredClone(db.tables.marketplace_listings[0]);
  for (const op of ["read", "update"]) {
    db.fail = {table:"marketplace_listings",op};
    const failed = await run(repeat);
    assert.equal(failed.success,false); assert.equal(failed.counts.listings_landed,0);
    assert.deepEqual(db.tables.marketplace_listings[0],before); assert.equal(db.tables.fb_listing_sightings.length,1);
  }
  assert.equal((await run(repeat)).success,true); assert.equal(db.tables.fb_listing_sightings.length,2);
});

Deno.test("a revisit that finds the listing gone ends it with the evidence; removed_at is fill-only and replay adds nothing", async () => {
  const db = new MemoryDb(); const run = runner(db);
  await run(first);
  const gone = { ...first, capture_id: "00000000-0000-4000-a000-000000000003", observed_at: "2026-10-13T05:55:00Z" };
  const removal = { observed_at: gone.observed_at, reason: "revisit_unavailable" as const, basis: "listing_page_unavailable", evidence: "This listing isn't available" };
  const ended = await run(gone, [{ ...(item as any), removal }]);
  const listing = db.tables.marketplace_listings[0];
  assert.equal(ended.success, true); assert.equal(listing.status, "removed"); assert.equal(listing.removed_at, gone.observed_at);
  assert.equal(listing.removal_reason, "revisit_unavailable"); assert.deepEqual(listing.raw_scrape_data.removals, [removal]);
  const later = { ...first, capture_id: "00000000-0000-4000-a000-000000000004", observed_at: "2026-10-14T05:55:00Z" };
  await run(later, [{ ...(item as any), removal: { ...removal, observed_at: later.observed_at } }]);
  assert.equal(listing.removed_at, gone.observed_at);
  await run(gone, [{ ...(item as any), removal }]);
  assert.equal(listing.raw_scrape_data.removals.length, 2);
  const sold = await run({ ...first, capture_id: "00000000-0000-4000-a000-000000000005", observed_at: "2026-10-15T05:55:00Z" }, [{ ...(item as any), facebook_id: "999", removal: { ...removal, reason: "displayed_sold" as const } }]);
  assert.equal(sold.success, true);
});
