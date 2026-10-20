// Fixtures shaped like the getItem captures held on 2026-10-20 (itemLocation with a full state name and a postal code
// masked to three digits; descriptions that state a dealer address), with made-up places and codes.
import { assertEquals } from "jsr:@std/assert@1";
import { decide, describedPlaces, landPlace, newPlaceCtx, placeRow, prefixState, statedPlace, type StateRow } from "./browsePlace.ts";

const states: StateRow[] = [
  { fips: "06", usps: "CA", name: "California" }, { fips: "08", usps: "CO", name: "Colorado" },
  { fips: "32", usps: "NV", name: "Nevada" }, { fips: "48", usps: "TX", name: "Texas" }, { fips: "01", usps: "AL", name: "Alabama" },
];
const masked = { city: "Example City", stateOrProvince: "Colorado", postalCode: "801**", country: "US" };

Deno.test("the stated place is read as eBay gave it: a masked code is a prefix, never a ZIP", () => {
  const s = statedPlace(masked, states);
  assertEquals([s.city, s.usps, s.state_fips, s.postal, s.prefix, s.postal_raw], ["Example City", "CO", "08", null, "801", "801**"]);
  const full = statedPlace({ city: "Reno", stateOrProvince: "NV", postalCode: "89501", country: "US" }, states);
  assertEquals([full.usps, full.postal, full.prefix], ["NV", "89501", "895"]);
  assertEquals(statedPlace({ city: "Schomberg", stateOrProvince: "Ontario" }, states).usps, null);
  assertEquals(statedPlace({ city: "Kansas", stateOrProvince: "Independence" }, states).usps, null);
});

Deno.test("description addresses are found with their state and ZIP, each ZIP once", () => {
  const m = describedPlaces("Visit us at 100 Main Street in Example City, CO 80112. Example City, CO 80112! Also EXAMPLE TOWN TX 75423-1111", states);
  assertEquals(m.map((x) => [x.usps, x.zip]), [["CO", "80112"], ["TX", "75423"]]);
  assertEquals(describedPlaces("Runs great, 350 V8, 80112 miles", states), []);
});

Deno.test("one seller ZIP inside eBay's prefix places the car at that ZIP; none places it at the city", () => {
  const s = statedPlace(masked, states);
  const z = decide(s, describedPlaces("Located in Example City, CO 80112", states));
  assertEquals([z.grain, z.postal, z.postal_basis, z.dispute], ["zip", "80112", "description", null]);
  assertEquals(decide(s, []).grain, "city");
  // two different ZIPs inside the prefix: not one place, so the city
  assertEquals(decide(s, describedPlaces("Example City, CO 80112 and Other Town, CO 80120", states)).grain, "city");
  // no prefix to vouch for a seller's ZIP (the retired Firecrawl captures): the city
  assertEquals(decide(statedPlace({ city: "Example City", stateOrProvince: "Colorado" }, states), describedPlaces("Example City, CO 80112", states)).grain, "city");
});

Deno.test("a description ZIP outside the stated prefix or state is a dispute, placed only where both agree", () => {
  const s = statedPlace({ city: "Small Town", stateOrProvince: "Texas", postalCode: "754**" }, states);
  const same = decide(s, describedPlaces("Located in Big City, TX 75002", states));
  assertEquals([same.grain, same.usps, same.postal, same.dispute?.described.map((m) => m.zip)], ["region", "TX", null, ["75002"]]);
  const other = decide(s, describedPlaces("Our other lot: Far Away, NV 89101", states));
  assertEquals([other.grain, other.usps], [null, null]);
  const row = placeRow({ vehicleId: "v", url: "https://www.ebay.com/itm/1", observedAt: "2026-10-20T00:00:00Z", loc: s as any, description: "" },
    s, other, { point: { latitude: 1, longitude: 2 }, state: "agrees", zip_prefix: "agrees", county: "48231" })!;
  assertEquals([row.region_code, row.latitude, row.postal_code, row.confidence, (row.metadata as any).place.grain], [null, null, null, 0.5, null]);
});

Deno.test("the row: city point with no ZIP, or state only when the point failed its check", () => {
  const s = statedPlace(masked, states);
  const d = decide(s, []);
  const i = { vehicleId: "v", url: "https://www.ebay.com/itm/1", observedAt: "2026-10-20T00:00:00Z", loc: masked, description: "" };
  const ok = placeRow(i, s, d, { point: { latitude: 39.6, longitude: -105 }, state: "agrees", zip_prefix: "agrees", county: "08005" })!;
  assertEquals([ok.region_code, ok.city, ok.postal_code, ok.precision, ok.confidence, ok.location_text_raw, ok.location_text_clean],
    ["CO", "Example City", null, "city", 0.8, "Example City, Colorado 801**", "Example City, CO"]);
  assertEquals((ok.metadata as any).place.grain, "city");
  const failed = placeRow(i, s, d, { point: null, state: "agrees", zip_prefix: "disagrees", county: "08031" })!;
  assertEquals([failed.latitude, failed.precision, failed.confidence, (failed.metadata as any).place.grain], [null, "region", 0.6, "region"]);
});

// A small PostgREST stand-in: reads filter rows; rpc answers from a table of points.
function fakeDb(geo: Record<string, [number, number] | null>, county: (lon: number, lat: number) => string | null, zips: { zip: string; fips: string }[]) {
  const inserted: any[] = [];
  const db: any = {
    inserted,
    from(table: string) {
      const where: ((r: any) => boolean)[] = []; let op = "read"; let input: any;
      const q: any = {
        select: () => q, limit: () => q,
        eq: (k: string, v: any) => { where.push((r) => r[k] === v); return q; },
        is: (k: string, v: any) => { where.push((r) => (r[k] ?? null) === v); return q; },
        like: (k: string, v: string) => { where.push((r) => String(r[k]).startsWith(v.replace(/%$/, ""))); return q; },
        gte: (k: string, v: string) => { where.push((r) => String(r[k]) >= v); return q; },
        lt: (k: string, v: string) => { where.push((r) => String(r[k]) < v); return q; },
        in: (k: string, vs: unknown[]) => { where.push((r) => vs.includes(r[k])); return q; },
        insert: (row: any) => { op = "insert"; input = row; return q; },
        then: (ok: any, no: any) => Promise.resolve().then(() => {
          if (op === "insert") { inserted.push(input); return { data: null, error: null }; }
          const rows = table === "us_states" ? states : table === "zip_to_fips" ? zips : table === "vehicle_location_observations" ? inserted : [];
          return { data: rows.filter((r: any) => where.every((w) => w(r))), error: null };
        }).then(ok, no),
      };
      return q;
    },
    rpc: (name: string, a: any) => Promise.resolve(name === "city_band_geocode"
      ? { data: [geo[`${a.p_city}|${a.p_state}`] ? { latitude: geo[`${a.p_city}|${a.p_state}`]![0], longitude: geo[`${a.p_city}|${a.p_state}`]![1] } : { latitude: null, longitude: null }], error: null }
      : { data: county(a.p_lon, a.p_lat), error: null }),
  };
  return db;
}

Deno.test("landing: the point is kept only when eBay's state and prefix agree; a second landing adds nothing", async () => {
  const db = fakeDb({ "Example City|CO": [39.6, -105], "Wrong Town|CO": [33.5, -86] },
    (_lon, lat) => (lat > 39 ? "08005" : "01121"), [{ zip: "80112", fips: "08005" }]);
  const ctx = newPlaceCtx();
  const base = { vehicleId: "v1", url: "https://www.ebay.com/itm/1", observedAt: "2026-10-20T01:00:00Z", description: "" };
  assertEquals((await landPlace(db, ctx, { ...base, loc: masked })).outcome, "written");
  assertEquals([db.inserted[0].latitude, db.inserted[0].metadata.place.checks], [39.6, { point_state: "agrees", point_zip_prefix: "agrees" }]);
  assertEquals((await landPlace(db, ctx, { ...base, loc: masked })).outcome, "duplicate");
  // the lookup puts this town in another state: no point, state only
  const r = await landPlace(db, ctx, { ...base, vehicleId: "v2", loc: { ...masked, city: "Wrong Town" } });
  assertEquals([r.outcome, r.grain, db.inserted[1].latitude, db.inserted[1].metadata.place.checks.point_state], ["written", "region", null, "disagrees"]);
  // a prefix the county holds no ZIP of: no point
  const p = await landPlace(db, ctx, { ...base, vehicleId: "v3", loc: { ...masked, postalCode: "810**" } });
  assertEquals([p.grain, db.inserted[2].metadata.place.checks.point_zip_prefix], ["region", "disagrees"]);
  // outside the US map: nothing written
  assertEquals((await landPlace(db, ctx, { ...base, vehicleId: "v4", loc: { city: "Winnipeg", stateOrProvince: "Manitoba" } })).outcome, "no_state");
});

Deno.test("a seller ZIP counts only when zip_to_fips puts it in its state: a stock number is not an address", async () => {
  const db = fakeDb({ "Example City|CO": [39.6, -105] }, () => "08005", [{ zip: "80112", fips: "08005" }, { zip: "71469", fips: "22069" }, { zip: "75002", fips: "48085" }]);
  const ctx = newPlaceCtx();
  const base = { url: "https://www.ebay.com/itm/2", observedAt: "2026-10-20T01:00:00Z", loc: masked };
  // "mention ID 71469": 71469 is a Louisiana ZIP, so this is no Idaho address; the one real address places the car at its ZIP
  const z = await landPlace(db, ctx, { ...base, vehicleId: "w1", description: "Please mention ID 71469. Located in Example City, CO 80112" });
  assertEquals([z.grain, z.disputed, db.inserted[0].postal_code, db.inserted[0].metadata.place.postal_basis], ["zip", false, "80112", "description"]);
  // a real address in another state: disputed, not placed
  const d = await landPlace(db, ctx, { ...base, vehicleId: "w2", description: "Located in Big City, TX 75002" });
  assertEquals([d.disputed, d.grain, db.inserted[1].region_code, db.inserted[1].latitude], [true, null, null, null]);
});

Deno.test("a search summary names no state: eBay's prefix places the car in a state only when all its ZIPs are in one", async () => {
  assertEquals(prefixState("891", ["32003", "32003", "32031"], states)?.usps, "NV");
  assertEquals(prefixState("739", ["40139", "48421"], states), null);   // a prefix across a state line places it nowhere
  assertEquals(prefixState("999", [], states), null);
  const db = fakeDb({}, () => null, [{ zip: "89101", fips: "32003" }, { zip: "89199", fips: "32003" }, { zip: "73901", fips: "40139" }, { zip: "73960", fips: "48421" }]);
  const ctx = newPlaceCtx();
  const base = { url: "https://www.ebay.com/itm/3", observedAt: "2026-10-20T01:00:00Z", description: "" };
  const r = await landPlace(db, ctx, { ...base, vehicleId: "s1", loc: { postalCode: "891**", country: "US" } });
  assertEquals([r.outcome, r.grain], ["written", "region"]);
  const row = db.inserted[0];
  assertEquals([row.region_code, row.city, row.postal_code, row.latitude, row.precision, row.location_text_raw, row.metadata.place.state_basis],
    ["NV", null, null, null, "region", "891**", "zip3_prefix"]);
  assertEquals((await landPlace(db, ctx, { ...base, vehicleId: "s2", loc: { postalCode: "739**", country: "US" } })).outcome, "no_state");
  assertEquals((await landPlace(db, ctx, { ...base, vehicleId: "s3", loc: { postalCode: "891**", country: "CA" } })).outcome, "no_state");
});
