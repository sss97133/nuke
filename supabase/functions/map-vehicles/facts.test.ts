// deno test --node-modules-dir=none supabase/functions/map-vehicles/facts.test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { areaSql, areasSql, parseArea, parseAreas, shapeAreas } from "./facts.ts";

const now = new Date("2026-10-20T05:00:00Z");

Deno.test("areas defaults: county, listing, last 30 UTC days", () => {
  const q = parseAreas({}, now);
  assertEquals(q, { level: "county", layer: "listing", sources: [], from: "2026-09-20", to: "2026-10-20", keys: null });
});

Deno.test("areas rejects what it cannot answer", () => {
  assertThrows(() => parseAreas({ level: "city" }, now), Error, "level must be");
  assertThrows(() => parseAreas({ layer: "Listing!" }, now), Error, "layer must be");
  assertThrows(() => parseAreas({ from: "2026-10-21", to: "2026-10-20" }, now), Error, "from <= to");
  assertThrows(() => parseAreas({ from: "2020-01-01" }, now), Error, "366 days");
  assertThrows(() => parseAreas({ level: "zcta" }, now), Error, "needs keys");
  assertThrows(() => parseAreas({ keys: Array.from({ length: 2001 }, (_, i) => String(10000 + i)).join(",") }, now), Error, "2000 keys");
});

Deno.test("keys and sources are filtered to their shapes", () => {
  const q = parseAreas({ level: "state", keys: "32,06,abc,123", source: "bat, Facebook!,craigslist" }, now);
  assertEquals(q.keys, ["32", "06"]);
  assertEquals(q.sources, ["bat", "craigslist"]);
  const z = parseAreas({ level: "zcta", keys: "89101,8910,90001" }, now);
  assertEquals(z.keys, ["89101", "90001"]);
});

Deno.test("areas SQL reads map_facts only, by layer and level, with the window and the snapshot rule", () => {
  const { text, args } = areasSql(parseAreas({ layer: "sale", source: "bat", keys: "32003" }, now));
  assertEquals(args, ["sale", "county", "2026-09-20", "2026-10-20", ["bat"], ["32003"]]);
  assertEquals(/FROM map_facts f/.test(text), true);
  assertEquals(/vehicles|vehicle_location_observations|vehicle_events|vehicle_images/.test(text), false);
  assertEquals(/\$1 = 'organization' THEN f\.day = snap\.day/.test(text), true);
});

Deno.test("area SQL lists every layer, even with no rows, in picker order", () => {
  const { text, args } = areaSql(parseArea({ level: "county", key: "32003" }, now));
  assertEquals(args, ["county", "32003", "2026-09-20", "2026-10-20"]);
  assertEquals(/FROM map_layers l\s+LEFT JOIN map_facts f/.test(text), true);
  assertEquals(/ORDER BY l\.sort_order/.test(text), true);
  assertThrows(() => parseArea({ level: "county", key: "32" }, now), Error, "county code");
});

Deno.test("shaping: keyed areas with avg, unkeyed and undated apart, totals whole", () => {
  const q = parseAreas({ layer: "listing" }, now);
  const out = shapeAreas(q, [
    { key: "32003", undated: false, entities: 10, priced: 4, value: "40000", as_of: "2026-10-20T05:00:00+00" },
    { key: "06037", undated: false, entities: 30, priced: 0, value: null, as_of: "2026-10-20T04:50:00+00" },
    { key: null, undated: false, entities: 5, priced: 0, value: null, as_of: "2026-10-20T05:00:00+00" },
    { key: null, undated: true, entities: 2, priced: 0, value: null, as_of: "2026-10-20T05:00:00+00" },
  ], [{ source: "bat", entities: 45 }]);
  assertEquals(out.areas.map((a) => a.key), ["06037", "32003"]);
  assertEquals(out.areas[1], { key: "32003", entities: 10, priced: 4, value: 40000, avg: 10000 });
  assertEquals(out.areas[0].avg, null);
  assertEquals(out.unkeyed.entities, 5);
  assertEquals(out.undated.entities, 2);
  assertEquals(out.totals, { entities: 45, value: 40000, areas: 2 });
  assertEquals(out.as_of, "2026-10-20T05:00:00+00");
});
