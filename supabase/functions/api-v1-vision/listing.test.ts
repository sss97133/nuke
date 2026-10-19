/**
 * The listing read, without a network: the aggregation, the analyzer order and the route's refusals. Run with:
 *   deno test --node-modules-dir=none supabase/functions/api-v1-vision/listing.test.ts
 * wire.test.ts drives the same route through index.ts, the write guard and supabase-js.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aggregateListingRead, type Analyzer, cloudPhotoRead, dailyCap, handleListing, type ListingPhoto, type ListingStore,
  listingSummary, type ListingVehicle, median, normalizeFlag, parseListingBody, type PhotoOutcome, type PhotoRead,
  readPhotos, yonoPhotoRead,
} from "./listing.ts";

const VEHICLE_ID = "0b9f107a-0000-4000-8000-0000000000c1";
const photo = (n: number): ListingPhoto => ({ id: `0b9f107a-0000-4000-8000-00000000010${n}`, image_url: `https://images.example/${n}.jpg` });
const PHOTOS = [1, 2, 3, 4].map(photo);

const yono = (f: Record<string, unknown> = {}): PhotoRead =>
  yonoPhotoRead({ condition_score: 3, damage_flags: [], modification_flags: [], photo_quality: 4, photo_type: "exterior_front", model: "finetuned_v2", ms: 900, ...f });
const cloud = (f: Record<string, unknown> = {}): PhotoRead =>
  cloudPhotoRead({ provider: "anthropic", model: "claude-sonnet-4-5", keySource: "user", ms: 2100, condition_score: 3, damage_flags: [], modification_flags: [], photo_quality: "high", ...f });
const outcome = (p: ListingPhoto, read: PhotoRead | null, tried = read ? [read.analyzer === "yono" ? "yono" : "cloud"] : ["yono", "cloud"]): PhotoOutcome =>
  ({ image_id: p.id, image_url: p.image_url, read, tried });

// ── aggregation ────────────────────────────────────────────────────────────

Deno.test("median: the middle value, the mean of the two middle values, or null", () => {
  assertEquals(median([4, 2, 3]), 3);
  assertEquals(median([4, 2, 3, 5]), 3.5);
  assertEquals(median([]), null);
});

Deno.test("a YONO read of a listing: median condition, flags with the photos that showed them, zones, interior, photo quality", () => {
  const read = aggregateListingRead([
    outcome(PHOTOS[0], yono({ condition_score: 2, vehicle_zone: "ext_front_driver", damage_flags: ["rust", "dent", "rust"] })),
    outcome(PHOTOS[1], yono({ condition_score: 3, vehicle_zone: "ext_rear", damage_flags: ["Rust"], modification_flags: ["aftermarket_wheels"] })),
    outcome(PHOTOS[2], yono({ condition_score: 4, vehicle_zone: "int_dashboard", interior_quality: 3, photo_type: "interior", photo_quality: 2 })),
    outcome(PHOTOS[3], null),
  ]);
  assertEquals(read.photos_requested, 4);
  assertEquals(read.photos_analyzed, 3);
  assertEquals(read.analyzer, "yono");
  assertEquals(read.analyzers, { yono: 3 });
  assertEquals(read.cost_bearer, "nuke");
  assertEquals(read.cost_usd, 0);
  assertEquals(read.condition_score, 3);
  assertEquals(read.condition_scores_counted, 3);
  assertEquals(read.zones_seen, ["ext_front_driver", "ext_rear", "int_dashboard"]);
  // A flag counts once per photo, whatever its case.
  assertEquals(read.damage_flags, [{ flag: "rust", photos: 2 }, { flag: "dent", photos: 1 }]);
  assertEquals(read.modification_flags, [{ flag: "aftermarket_wheels", photos: 1 }]);
  assertEquals(read.interior_quality, 3);
  assertEquals(read.photo_quality, { median: 4, by_value: { "2": 1, "4": 2 } });
  assertEquals(read.photos.length, 4);
  assertEquals(read.photos[0].image_url, PHOTOS[0].image_url);
  assertEquals(read.photos[0].analyzer, "yono");
  assertEquals(read.photos[0].condition_score, 2);
  assertEquals(read.photos[3], { image_id: PHOTOS[3].id, image_url: PHOTOS[3].image_url, analyzer: null, tried: ["yono", "cloud"] });
});

Deno.test("YONO and the caller's provider together: mixed analyzer and bearer, and no cost claimed", () => {
  const read = aggregateListingRead([
    outcome(PHOTOS[0], yono({ condition_score: 4, vehicle_zone: "ext_front" })),
    outcome(PHOTOS[1], cloud({ condition_score: 2, vehicle_zone: "ext_side", damage_flags: ["paint fade"], is_vehicle: true })),
    outcome(PHOTOS[2], cloud({ condition_score: 3, damage_flags: ["paint-fade", "dent"], photo_quality: "Low" })),
  ]);
  assertEquals(read.analyzer, "mixed");
  assertEquals(read.analyzers, { "anthropic/claude-sonnet-4-5": 2, yono: 1 });
  assertEquals(read.cost_bearer, "mixed");
  assertEquals(read.cost_bearers, { nuke: 1, user: 2 });
  // The provider's charge is the caller's and is not visible here: unknown, not zero.
  assertEquals(read.cost_usd, null);
  assertEquals(read.condition_score, 3);
  assertEquals(read.damage_flags, [{ flag: "paint_fade", photos: 2 }, { flag: "dent", photos: 1 }]);
  assertEquals(read.interior_quality, null);
  assertEquals(read.photo_quality, { median: 4, by_value: { "4": 1, high: 1, low: 1 } });
  assertEquals(read.photos[1].is_vehicle, true);
});

Deno.test("a score off the 1–5 scale is not counted", () => {
  const read = aggregateListingRead([
    outcome(PHOTOS[0], cloud({ condition_score: 0 })),
    outcome(PHOTOS[1], cloud({ condition_score: 7 })),
    outcome(PHOTOS[2], cloud({ condition_score: null })),
    outcome(PHOTOS[3], cloud({ condition_score: 5 })),
  ]);
  assertEquals(read.condition_score, 5);
  assertEquals(read.condition_scores_counted, 1);
});

Deno.test("no read at all: nothing scored, no analyzer, no bearer", () => {
  const read = aggregateListingRead(PHOTOS.map((p) => outcome(p, null)));
  assertEquals(read.photos_analyzed, 0);
  assertEquals([read.analyzer, read.cost_bearer, read.cost_usd, read.condition_score], [null, null, null, null]);
  assertEquals(read.damage_flags, []);
});

Deno.test("the one-line summary says what was read, by what, and what it saw", () => {
  const read = aggregateListingRead([
    outcome(PHOTOS[0], yono({ condition_score: 3, vehicle_zone: "ext_front", damage_flags: ["rust"], modification_flags: ["lowered"] })),
    outcome(PHOTOS[1], yono({ condition_score: 3, vehicle_zone: "ext_rear", damage_flags: ["rust", "dent"] })),
  ]);
  assertEquals(listingSummary(read),
    "Condition read of 2 of 2 listing photos by yono; median condition 3 of 5 (5 concours, 1 project); " +
    "damage seen: rust (2 photos), dent (1 photo); modifications seen: lowered (1 photo); zones: ext_front, ext_rear.");
  assertEquals(listingSummary(aggregateListingRead([outcome(PHOTOS[0], cloud({ condition_score: null }))])),
    "Condition read of 1 of 1 listing photos by anthropic/claude-sonnet-4-5; condition not scored; no damage flagged.");
  assertEquals(normalizeFlag(" Missing-Parts  Rear "), "missing_parts_rear");
});

// ── the analyzer order ─────────────────────────────────────────────────────

function fake(name: string, answer: (url: string, call: number) => PhotoRead | null, opts: Partial<Analyzer> = {}) {
  const asked: string[] = [];
  const analyzer: Analyzer = {
    name, timeoutMs: 1000, concurrency: 2, stopOnFailure: false, ...opts,
    read: (url) => { asked.push(url); return Promise.resolve(answer(url, asked.length)); },
  };
  return { analyzer, asked };
}

Deno.test("YONO's first call fails: YONO is not called again, and the caller's provider reads every photo", async () => {
  const y = fake("yono", () => null, { stopOnFailure: true });
  const c = fake("cloud", () => cloud());
  const outcomes = await readPhotos(PHOTOS, [y.analyzer, c.analyzer], Date.now() + 60_000);
  assertEquals(y.asked, [PHOTOS[0].image_url]);
  assertEquals(c.asked.length, 4);
  assert(outcomes.every((o) => o.read?.analyzer === "anthropic/claude-sonnet-4-5"));
  assertEquals(outcomes[0].tried, ["yono", "cloud"]);
  assertEquals(outcomes[1].tried, ["cloud"]);
});

Deno.test("YONO fails part way: it stops there, its reads stand, and the provider reads the rest", async () => {
  const y = fake("yono", (_url, call) => (call <= 2 ? yono() : null), { stopOnFailure: true, concurrency: 1 });
  const c = fake("cloud", () => cloud());
  const outcomes = await readPhotos(PHOTOS, [y.analyzer, c.analyzer], Date.now() + 60_000);
  assertEquals(y.asked, PHOTOS.slice(0, 3).map((p) => p.image_url));
  assertEquals(outcomes.map((o) => o.read?.analyzer), ["yono", "yono", "anthropic/claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"]);
  // The provider is probed with a photo no analyzer has failed on, and asked about YONO's failure after.
  assertEquals(c.asked, [PHOTOS[3].image_url, PHOTOS[2].image_url]);
});

Deno.test("one dead image URL is not a dead provider: the probe skips the photo YONO failed on", async () => {
  const dead = PHOTOS[0].image_url;
  const y = fake("yono", () => null, { stopOnFailure: true });
  const c = fake("cloud", (url) => (url === dead ? null : cloud()));
  const outcomes = await readPhotos(PHOTOS, [y.analyzer, c.analyzer], Date.now() + 60_000);
  assertEquals(c.asked[0], PHOTOS[1].image_url);
  assertEquals(outcomes.map((o) => o.read !== null), [false, true, true, true]);
  assertEquals(outcomes[0].tried, ["yono", "cloud"]);
});

Deno.test("no read from the provider's first call (no connected provider): it is not asked about the rest", async () => {
  const y = fake("yono", () => null, { stopOnFailure: true });
  const c = fake("cloud", () => null);
  const outcomes = await readPhotos(PHOTOS, [y.analyzer, c.analyzer], Date.now() + 60_000);
  assertEquals(y.asked.length, 1);
  assertEquals(c.asked.length, 1);
  assert(outcomes.every((o) => o.read === null));
});

Deno.test("nothing starts after the deadline", async () => {
  let clock = 0;
  const y = fake("yono", () => { clock += 50; return yono(); }, { concurrency: 1 });
  const outcomes = await readPhotos(PHOTOS, [y.analyzer], 120, () => clock);
  assertEquals(y.asked.length, 3);
  assertEquals(outcomes.filter((o) => o.read).length, 3);
  assertEquals(outcomes[3].tried, []);
});

Deno.test("a call that never answers is cut off at its timeout", async () => {
  const hang: Analyzer = { name: "cloud", timeoutMs: 20, concurrency: 1, stopOnFailure: false, read: () => new Promise(() => {}) };
  const outcomes = await readPhotos([PHOTOS[0]], [hang], Date.now() + 60_000);
  assertEquals(outcomes[0].read, null);
});

// ── the route, after index.ts's guard ──────────────────────────────────────

const PUBLIC_VEHICLE: ListingVehicle = {
  id: VEHICLE_ID, is_public: true, deleted_at: null, listing_kind: "vehicle",
  listing_url: "https://lasvegas.craigslist.org/cto/d/example/0000000001.html", discovery_url: null,
};

function world(opts: { used?: number; vehicle?: ListingVehicle | null; photos?: ListingPhoto[]; capFails?: boolean } = {}) {
  const reads: string[] = [];
  const store: ListingStore = {
    sourceId: (slug) => { reads.push(`source:${slug}`); return Promise.resolve("src-nuke-vision"); },
    recentReads: (_source, _since, limit) => {
      reads.push(`count:${limit}`);
      return opts.capFails ? Promise.reject(new Error("timeout")) : Promise.resolve(Math.min(opts.used ?? 0, limit));
    },
    vehicle: (id) => { reads.push(`vehicle:${id}`); return Promise.resolve(opts.vehicle === undefined ? PUBLIC_VEHICLE : opts.vehicle); },
    photos: (_id, limit) => { reads.push(`photos:${limit}`); return Promise.resolve((opts.photos ?? PHOTOS).slice(0, limit)); },
  };
  const written: Record<string, unknown>[] = [];
  return { store, reads, written };
}

function route(w: ReturnType<typeof world>, analyzers: Analyzer[], opts: { env?: Record<string, string>; writeFails?: boolean } = {}) {
  return (body: unknown) => handleListing(
    new Request("https://fn.test/api-v1-vision/listing", { method: "POST", body: JSON.stringify(body) }),
    {
      store: w.store, analyzers, userId: "0b9f107a-0000-4000-8000-0000000000a1",
      write: (o) => {
        w.written.push(o);
        return Promise.resolve(opts.writeFails ? { ok: false as const, error: "ingest-observation 400: Unknown source" } : { ok: true as const, observationId: "obs-1" });
      },
      env: (name) => opts.env?.[name], headers: { "Access-Control-Allow-Origin": "*" },
    },
  );
}

Deno.test("at the day's cap: 429 before the vehicle is read or any analyzer is called", async () => {
  const w = world({ used: 40 });
  const y = fake("yono", () => yono());
  const res = await route(w, [y.analyzer])({ vehicle_id: VEHICLE_ID });
  assertEquals(res.status, 429);
  assertEquals((await res.json()).cap, 40);
  assertEquals(w.reads, ["source:nuke-vision", "count:40"]);
  assertEquals(y.asked.length, 0);
  assertEquals(w.written.length, 0);
});

Deno.test("LISTING_ANALYSES_PER_DAY sets the cap, 0 turns the route off, and a cap that cannot be counted refuses", async () => {
  assertEquals([dailyCap(undefined), dailyCap("5"), dailyCap("0"), dailyCap("ten"), dailyCap("-1"), dailyCap("2.5")], [40, 5, 0, 40, 40, 40]);
  const y = fake("yono", () => yono());
  const five = world({ used: 5 });
  assertEquals((await route(five, [y.analyzer], { env: { LISTING_ANALYSES_PER_DAY: "5" } })({ vehicle_id: VEHICLE_ID })).status, 429);
  const off = world();
  assertEquals((await route(off, [y.analyzer], { env: { LISTING_ANALYSES_PER_DAY: "0" } })({ vehicle_id: VEHICLE_ID })).status, 429);
  assertEquals(off.reads, ["source:nuke-vision"]);
  const down = world({ capFails: true });
  assertEquals((await route(down, [y.analyzer])({ vehicle_id: VEHICLE_ID })).status, 503);
  assertEquals(y.asked.length, 0);
});

Deno.test("the body: a uuid, and max_photos from 1 to 16 (more is read as 16)", async () => {
  assertEquals(parseListingBody({ vehicle_id: VEHICLE_ID }), { ok: true, vehicleId: VEHICLE_ID, maxPhotos: 12 });
  assertEquals(parseListingBody({ vehicle_id: VEHICLE_ID, max_photos: 99 }), { ok: true, vehicleId: VEHICLE_ID, maxPhotos: 16 });
  assertEquals(parseListingBody({ vehicle_id: VEHICLE_ID, max_photos: 0 }).ok, false);
  assertEquals(parseListingBody({ vehicle_id: VEHICLE_ID, max_photos: 2.5 }).ok, false);
  assertEquals(parseListingBody({ vehicle_id: "not-a-uuid" }).ok, false);
  assertEquals(parseListingBody([VEHICLE_ID]).ok, false);
  const w = world();
  const res = await route(w, [fake("yono", () => yono()).analyzer])({ vehicle_id: "nope" });
  assertEquals(res.status, 400);
  assertEquals(w.reads, []);
  const many = world();
  await route(many, [fake("yono", () => yono()).analyzer])({ vehicle_id: VEHICLE_ID, max_photos: 99 });
  assert(many.reads.includes("photos:16"));
});

Deno.test("a vehicle that is not public, or has no photos, is refused before any analyzer is called", async () => {
  const y = fake("yono", () => yono());
  for (const vehicle of [null, { ...PUBLIC_VEHICLE, is_public: false }, { ...PUBLIC_VEHICLE, deleted_at: "2026-10-01T00:00:00Z" },
    { ...PUBLIC_VEHICLE, listing_kind: "non_vehicle_item" }]) {
    assertEquals((await route(world({ vehicle }), [y.analyzer])({ vehicle_id: VEHICLE_ID })).status, 404);
  }
  assertEquals((await route(world({ photos: [] }), [y.analyzer])({ vehicle_id: VEHICLE_ID })).status, 422);
  assertEquals(y.asked.length, 0);
});

Deno.test("no analyzer reads anything: 503, connect your AI subscription, and nothing is written", async () => {
  const w = world();
  const res = await route(w, [fake("yono", () => null, { stopOnFailure: true }).analyzer, fake("cloud", () => null).analyzer])({ vehicle_id: VEHICLE_ID });
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: "no analyzer available", hint: "connect your AI subscription" });
  assertEquals(w.written.length, 0);
});

Deno.test("a read: one observation through the writer (nuke-vision, condition, agent-inferred), and its id back", async () => {
  const w = world({ vehicle: { ...PUBLIC_VEHICLE, listing_url: null, discovery_url: "https://lasvegas.craigslist.org/cto/d/example/0000000002.html" } });
  const y = fake("yono", (url) => yono({ condition_score: url.endsWith("1.jpg") ? 2 : 4, damage_flags: url.endsWith("1.jpg") ? ["rust"] : [] }));
  const res = await route(w, [y.analyzer])({ vehicle_id: VEHICLE_ID });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.observation_id, "obs-1");
  assertEquals([body.photos_analyzed, body.condition_score, body.analyzer, body.time_budget_reached], [4, 4, "yono", false]);
  assertEquals(w.written.length, 1);
  // deno-lint-ignore no-explicit-any
  const o = w.written[0] as Record<string, any>;
  assertEquals([o.source_slug, o.kind, o.vehicle_id, o.agent_inferred, o.extraction_method, o.agent_model],
    ["nuke-vision", "condition", VEHICLE_ID, true, "listing_photo_condition_v1", "yono"]);
  // listing_url is empty here, so the discovery URL is the source.
  assertEquals(o.source_url, "https://lasvegas.craigslist.org/cto/d/example/0000000002.html");
  assertEquals(o.structured_data.analysis_kind, "listing_photo_condition_v1");
  assertEquals(o.structured_data.damage_flags, [{ flag: "rust", photos: 1 }]);
  assertEquals(o.structured_data.photos.length, 4);
  assertEquals(o.observer_raw, { extracted_by: "api-v1-vision/listing", requested_by_user_id: "0b9f107a-0000-4000-8000-0000000000a1" });
  assert(!("descriptor_key" in o));
  assert(Number.isFinite(Date.parse(o.observed_at)));
  assertEquals(o.content_text, listingSummary(o.structured_data));
});

Deno.test("the writer refuses: 502, and the read made is still returned", async () => {
  const w = world();
  const res = await route(w, [fake("yono", () => yono()).analyzer], { writeFails: true })({ vehicle_id: VEHICLE_ID });
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.photos_analyzed, 4);
  assertEquals(body.write_error, "ingest-observation 400: Unknown source");
});
