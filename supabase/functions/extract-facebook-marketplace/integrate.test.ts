import assert from "node:assert/strict";
import { integrateListings, placeRow, sellerKey, type IntegrationDeps } from "./integrate.ts";

// A minimal PostgREST stand-in: select/eq/is/maybeSingle/insert/update over in-memory rows.
class Db {
  t: Record<string, any[]> = { marketplace_listings: [], external_identities: [], vehicle_location_observations: [],
    city_geocode_lookup: [{ city: "Example City", state: "CA", latitude: 38.4, longitude: -121.37 }] };
  from(table: string) {
    const db = this; let op = "read"; let input: any; let single = false;
    const where: ((r: any) => boolean)[] = [];
    const q: any = {
      select: () => q, limit: () => q, maybeSingle: () => { single = true; return q; },
      ilike: (k: string, v: any) => { where.push((r) => String(r[k]).toLowerCase() === String(v).toLowerCase()); return q; },
      eq: (k: string, v: any) => { where.push((r) => r[k] === v); return q; },
      is: (k: string, v: any) => { where.push((r) => (r[k] ?? null) === v); return q; },
      insert: (row: any) => { op = "insert"; input = row; return q; },
      update: (row: any) => { op = "update"; input = row; return q; },
      then: (ok: any, no: any) => Promise.resolve().then(() => {
        const rows = db.t[table] ??= [];
        if (op === "insert") { const row = { id: crypto.randomUUID(), ...structuredClone(input) }; rows.push(row); return { data: single ? row : [row], error: null }; }
        const hit = rows.filter((r) => where.every((w) => w(r)));
        if (op === "update") hit.forEach((r) => Object.assign(r, structuredClone(input)));
        return { data: single ? hit[0] ?? null : hit, error: null };
      }).then(ok, no),
    };
    return q;
  }
}

const capture = { capture_id: "00000000-0000-4000-a000-000000000009", observed_at: "2026-10-19T05:00:00Z" } as any;
const photo = "https://scontent.example.fbcdn.net/v/t45.5328-4/1_n.jpg?stp=dst-jpg_p720x720";

function harness(ingest: IntegrationDeps["callIngest"]) {
  const db = new Db();
  const calls = { ingest: [] as any[], events: [] as any[], ended: [] as any[], photos: [] as any[], observations: [] as any[], limit: 40 };
  const deps: IntegrationDeps = {
    supabase: db,
    writeObservation: async (_s, input) => { calls.observations.push(input); return { observationId: `obs-${calls.observations.length}`, errors: [] }; },
    callIngest: async (batch) => { calls.ingest.push(batch); return await ingest(batch); },
    landEvent: async (_s, a) => { calls.events.push(a); return { event: { action: "inserted" } }; },
    writeEvent: async (_s, row) => { calls.ended.push(row); return { action: "updated" }; },
    persistPhotos: (vehicleId, urls, observedAt) => { calls.photos.push({ vehicleId, urls, observedAt }); return true; },
    promotionLimit: async () => calls.limit,
  };
  return { db, calls, deps };
}

const listing = (db: Db, id: string, fb: string, vehicle_id: string | null = null) => db.t.marketplace_listings.push({ id, facebook_id: fb, vehicle_id, seller_identity_id: null });
const at = (b: any) => b.capture?.observed_at ?? "never";

Deno.test("a titled, unlinked listing becomes a vehicle through ingest; its listing, observation and photos follow", async () => {
  const { db, calls, deps } = harness(async (batch) => batch.map(() => ({ status: "created", vehicle_id: "veh-1" })));
  listing(db, "L1", "111");
  const item = { mode: "direct", capture, facebook_id: "111", title: "1973 Volkswagen super beetle", price: 2200,
    location: "Example City, XX", seller_name: "A Person", image_url: photo,
    content_text: JSON.stringify({ displayed_text: "Just listed\n$2,200\n1973 Volkswagen super beetle" }),
    agent_context: { session_type: "browser_search_card" } } as any;
  const r = await integrateListings([item], [{ facebook_id: "111", listing_id: "L1", vehicle_id: null, listing_landed: true }], deps, at);

  assert.equal(r.vehicles_created, 1);
  assert.deepEqual(calls.ingest[0][0], { url: "https://www.facebook.com/marketplace/item/111/", year: 1973, make: "Volkswagen",
    model: "super beetle", price: 2200, location: "Example City, XX", description: undefined, mileage: undefined,
    transmission: undefined, color: undefined, title_status: undefined, body_style: undefined, enrich: false });
  assert.ok(!("seller_name" in calls.ingest[0][0]), "a private seller's name never reaches the public vehicle row");
  assert.equal(db.t.marketplace_listings[0].vehicle_id, "veh-1");
  assert.equal(calls.observations[0].vehicleId, "veh-1");
  assert.equal(calls.observations[0].observedAt, capture.observed_at, "the observation carries the capture clock");
  assert.equal(calls.events.length, 0, "ingest lands the new vehicle's listing event itself");
  assert.deepEqual(calls.photos, [{ vehicleId: "veh-1", urls: [photo], observedAt: capture.observed_at }]);
});

Deno.test("an already-linked listing lands its listing event at the capture clock; no ingest call", async () => {
  const { db, calls, deps } = harness(async () => { throw new Error("must not be called"); });
  listing(db, "L2", "222", "veh-2");
  const item = { mode: "direct", capture, facebook_id: "222", title: "1972 Dodge charger", price: 15000, agent_context: { session_type: "browser_search_card" } } as any;
  const r = await integrateListings([item], [{ facebook_id: "222", listing_id: "L2", vehicle_id: "veh-2", listing_landed: true }], deps, at);
  assert.equal(r.already_linked, 1);
  assert.equal(calls.ingest.length, 0);
  assert.equal(calls.events[0].listingId, "222");
  assert.equal(calls.events[0].observedAt, capture.observed_at);
  assert.equal(calls.events[0].price, 15000);
  assert.equal(calls.photos.length, 0, "a repeat search sighting does not re-copy photos");
});

Deno.test("a revisit that saw the listing gone ends its event with the evidence, never a sale", async () => {
  const { db, calls, deps } = harness(async () => []);
  listing(db, "L3", "333", "veh-3");
  const removal = { observed_at: "2026-10-19T06:00:00Z", reason: "displayed_sold", basis: "displayed_seller_label", evidence: "Sold" };
  const item = { mode: "direct", capture, facebook_id: "333", title: "1966 Ford f100", status: "sold", removal } as any;
  const r = await integrateListings([item], [{ facebook_id: "333", listing_id: "L3", vehicle_id: "veh-3", listing_landed: true }], deps, at);
  assert.equal(r.ended, 1);
  assert.equal(calls.ended[0].event_status, "ended");
  assert.equal(calls.ended[0].ended_at, removal.observed_at);
  assert.equal(calls.ended[0].metadata.removal.reason, "displayed_sold");
  assert.ok(!("sold_at" in calls.ended[0]) && !("sale_price" in calls.ended[0]));
  assert.equal(calls.events.length, 0);
});

Deno.test("a title without a model stays unresolved; a gate rejection is counted and nothing is linked", async () => {
  const { db, calls, deps } = harness(async (batch) => batch.map(() => ({ status: "rejected", reason: "quality_gate_reject: score below acceptance threshold" })));
  listing(db, "L4", "444"); listing(db, "L5", "555");
  const items = [
    { mode: "direct", capture, facebook_id: "444", title: "1984 Porsche" },
    { mode: "direct", capture, facebook_id: "555", title: "1988 Ford ranger Custom" },
  ] as any[];
  const r = await integrateListings(items, [
    { facebook_id: "444", listing_id: "L4", vehicle_id: null, listing_landed: true },
    { facebook_id: "555", listing_id: "L5", vehicle_id: null, listing_landed: true },
  ], deps, at);
  assert.equal(r.unresolved_identity, 1);
  assert.equal(calls.ingest[0].length, 1, "only the titled listing is sent");
  assert.equal(r.rejected, 1);
  assert.deepEqual(r.rejected_reasons, { quality_gate_reject: 1 });
  assert.ok(db.t.marketplace_listings.every((l) => l.vehicle_id === null));
});

Deno.test("an ingest outage is a counted error; custody already happened and nothing throws", async () => {
  const { db, deps } = harness(async () => { throw new Error("ingest HTTP 503"); });
  listing(db, "L6", "666");
  const r = await integrateListings([{ mode: "direct", capture, facebook_id: "666", title: "1990 Mazda rx-7" } as any],
    [{ facebook_id: "666", listing_id: "L6", vehicle_id: null, listing_landed: true }], deps, at);
  assert.deepEqual(r.errors, ["ingest: ingest HTTP 503"]);
  assert.equal(db.t.marketplace_listings[0].vehicle_id, null);
});

Deno.test("a seller profile id becomes a facebook identity without the name; later sightings advance it, earlier ones do not", async () => {
  assert.equal(sellerKey({ seller_profile_url: "https://www.facebook.com/marketplace/profile/100012345678/?ref=x" } as any)?.id, "100012345678");
  assert.equal(sellerKey({ contact_info: { seller_fb_user_id: "100099999999" } } as any)?.id, "100099999999");
  assert.equal(sellerKey({ seller_name: "A Person" } as any), null, "a name is not a key");

  const { db, deps } = harness(async () => []);
  listing(db, "L7", "777", "veh-7"); listing(db, "L8", "888", "veh-8");
  const page = "Seller information\nSeller details\nA Person\n(5)\nJoined Facebook in 2010\nAd";
  const mk = (fb: string, observed_at: string) => ({ mode: "direct", capture: { ...capture, observed_at }, facebook_id: fb, title: "1983 Chevrolet blazer",
    seller_name: "A Person", seller_profile_url: "https://www.facebook.com/marketplace/profile/100012345678/",
    content_text: JSON.stringify({ displayed_text: page }) }) as any;
  await integrateListings([mk("777", "2026-10-19T05:00:00Z")], [{ facebook_id: "777", listing_id: "L7", vehicle_id: "veh-7", listing_landed: true }], deps, at);
  await integrateListings([mk("888", "2026-10-18T05:00:00Z")], [{ facebook_id: "888", listing_id: "L8", vehicle_id: "veh-8", listing_landed: true }], deps, at);

  assert.equal(db.t.external_identities.length, 1);
  const who = db.t.external_identities[0];
  assert.equal(who.platform, "facebook");
  assert.equal(who.display_name, null);
  assert.equal(who.profile_url, "https://www.facebook.com/marketplace/profile/100012345678/");
  assert.equal(who.last_seen_at, "2026-10-19T05:00:00Z", "an earlier sighting does not move the clock back");
  assert.equal(who.metadata.marketplace.rating_count, 5);
  assert.ok(db.t.marketplace_listings.every((l) => l.seller_identity_id === who.id));
});

Deno.test("a linked listing's displayed city lands once as a city-grain map row; no place, no row", async () => {
  const { db, deps } = harness(async () => []);
  listing(db, "L9", "999", "veh-9"); listing(db, "L10", "1000", "veh-10");
  const mk = (fb: string, location: string | undefined) => ({ mode: "direct", capture, facebook_id: fb, title: "1979 Ford bronco", location }) as any;
  const landed = (fb: string, id: string, v: string) => ({ facebook_id: fb, listing_id: id, vehicle_id: v, listing_landed: true, observation_landing: { observation_id: "obs-x" } });
  const r1 = await integrateListings([mk("999", "Example City, CA"), mk("1000", undefined)], [landed("999", "L9", "veh-9"), landed("1000", "L10", "veh-10")], deps, at);
  const r2 = await integrateListings([mk("999", "Example City, CA")], [landed("999", "L9", "veh-9")], deps, at);
  assert.deepEqual(r1.places, { written: 1, no_place: 1 });
  assert.deepEqual(r2.places, { duplicate: 1 }, "a repeat sighting of the same place adds nothing");
  const row = db.t.vehicle_location_observations[0];
  assert.equal(db.t.vehicle_location_observations.length, 1);
  assert.equal(row.source_platform, "facebook_marketplace");
  assert.equal(row.precision, "city");
  assert.equal(row.confidence, 0.8);
  assert.equal(row.latitude, 38.4);
  assert.equal(row.observed_at, capture.observed_at);
  assert.equal(row.metadata.observation_id, "obs-x");
});

Deno.test("place rows: an ungeocoded city keeps no point and lower confidence; a non-US region names no country", () => {
  const row = placeRow("v", "https://www.facebook.com/marketplace/item/1/", "Nowhere, NV", "2026-10-19T00:00:00Z", null, null)!;
  assert.equal(row.latitude, null);
  assert.equal(row.confidence, 0.6);
  assert.equal(row.country_code, "US");
  assert.equal(placeRow("v", "u", "Mexicali, BC", "t", null, null)!.country_code, null);
  assert.equal(placeRow("v", "u", "Ships to you", "t", null, null), null);
});

Deno.test("the owner's intake ceiling bounds promotion; switched off, nothing is sent and every listing waits", async () => {
  const { db, calls, deps } = harness(async (batch) => batch.map((_, i) => ({ status: "created", vehicle_id: `veh-${i}` })));
  const items = ["1966 Ford mustang", "1967 Ford mustang", "1968 Ford mustang"].map((title, i) => ({ mode: "direct", capture, facebook_id: `9${i}`, title })) as any[];
  items.forEach((x, i) => listing(db, `C${i}`, x.facebook_id));
  const landed = items.map((x, i) => ({ facebook_id: x.facebook_id, listing_id: `C${i}`, vehicle_id: null, listing_landed: true }));
  calls.limit = 2;
  const capped = await integrateListings(items, landed, deps, at);
  assert.equal(calls.ingest[0].length, 2);
  assert.equal(capped.deferred, 1);
  calls.limit = 0;
  const off = await integrateListings(items.slice(2), landed.slice(2), deps, at);
  assert.equal(calls.ingest.length, 1, "no ingest call while intake is off");
  assert.equal(off.deferred, 1);
});
