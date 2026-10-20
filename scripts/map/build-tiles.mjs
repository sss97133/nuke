#!/usr/bin/env -S deno run -A --node-modules-dir=none
// build-tiles.mjs: the one map's boundary tiles (plan step 5): states, counties and ZCTAs as one static vector
// tileset, built once from the Census 2020 cartographic boundary files and put in the public map-data bucket, where
// the web map and iOS read them CDN-cached. No live TIGERweb calls, no polygons in the database.
//
//   dotenvx run -- deno run -A --node-modules-dir=none scripts/map/build-tiles.mjs [--out <dir>] [--maxzoom 9] [--upload] [--concurrency 8]
//
// Deno, because geojson-vt (tile cutting with per-zoom simplification) and vt-pbf (Mapbox Vector Tile encoding) come
// straight from npm with no package.json change. The shapefiles are parsed by ./shapefile.mjs (no GDAL).
//
// Layout in the bucket: tiles/v1/tiles.json (TileJSON), tiles/v1/{z}/{x}/{y}.pbf, and for MapKit (which reads GeoJSON,
// not vector tiles) geo/v1/county/{fips}.geojson: every ZCTA that touches the county (Census ZCTA-to-county
// relationship file), with GEOID, INTPTLAT and INTPTLON properties, the shape the iOS drill read from TIGERweb.
// Layers and zooms:
//   states   z0..maxzoom   id = state FIPS as integer   props fips, usps, name
//   counties z3..maxzoom   id = county FIPS as integer  props fips, name, state (two-digit FIPS)
//   zctas    z6..maxzoom   id = ZCTA as integer         props zcta
// maxzoom 9 (about 300 m per pixel at mid latitudes); MapLibre overzooms beyond it, and the 1:500,000 source has no
// more detail to give. A tile is written only when it has a feature; an empty tile is a 404, which MapLibre treats as
// empty. Uploads set cache-control for a year; a new build goes to a new version path (tiles/v2), never over v1.
//
// Known difference: the county file is the 2020 vintage, which has Alaska's Chugach (02063) and Copper River (02066);
// us_county_boundaries in the database is an older release with Valdez-Cordova (02261). The map keys counts by the
// database's codes, so those two Alaska polygons show no count until the table is brought to the 2020 vintage.
//
// Upload needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (dotenvx); nothing is printed.
import geojsonvt from "npm:geojson-vt@4.0.2";
import vtpbf from "npm:vt-pbf@3.1.3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchCensusShapefile, readShapefile } from "./shapefile.mjs";

const CENSUS = "https://www2.census.gov/geo/tiger/GENZ2020/shp/";
const SOURCES = {
  states:   { base: "cb_2020_us_state_500k",   minzoom: 0, pick: (r) => ({ id: Number(r.STATEFP), properties: { fips: r.STATEFP, usps: r.STUSPS, name: r.NAME } }) },
  counties: { base: "cb_2020_us_county_500k",  minzoom: 3, pick: (r) => ({ id: Number(r.GEOID), properties: { fips: r.GEOID, name: r.NAME, state: r.STATEFP } }) },
  zctas:    { base: "cb_2020_us_zcta520_500k", minzoom: 6, pick: (r) => ({ id: Number(r.ZCTA5CE20), properties: { zcta: r.ZCTA5CE20 } }) },
};
const VERSION = "v1";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const outDir = opt("--out", join(tmpdir(), "nuke-tiles"));
const maxzoom = Number(opt("--maxzoom", "9"));
const upload = args.includes("--upload");
const concurrency = Number(opt("--concurrency", "8"));
const srcDir = join(outDir, "src"), tileDir = join(outDir, "tiles", VERSION);
mkdirSync(tileDir, { recursive: true });

const round = (v) => Math.round(v * 1e5) / 1e5;
const indexes = {}, counts = {};
for (const [layer, s] of Object.entries(SOURCES)) {
  await fetchCensusShapefile(srcDir, s.base, `${CENSUS}${s.base}.zip`);
  const features = readShapefile(srcDir, s.base, s.pick, round);
  counts[layer] = features.length;
  indexes[layer] = geojsonvt({ type: "FeatureCollection", features },
    { maxZoom: maxzoom, indexMaxZoom: Math.min(5, maxzoom), indexMaxPoints: 0, tolerance: 3, extent: 4096, buffer: 64, promoteId: undefined });
}

// Walk the tile pyramid from the root; a child is visited only when the parent had features.
let written = 0, bytes = 0;
const perZoom = {};
const stack = [[0, 0, 0]];
while (stack.length) {
  const [z, x, y] = stack.pop();
  const layers = {};
  let any = false;
  for (const [layer, s] of Object.entries(SOURCES)) {
    if (z < s.minzoom) continue;
    const t = indexes[layer].getTile(z, x, y);
    if (t && t.features.length) { layers[layer] = t; any = true; }
  }
  // Children are worth visiting when any layer (including ones not yet at their minzoom) has features here.
  const below = Object.values(indexes).some((ix) => { const t = ix.getTile(z, x, y); return t && t.features.length; });
  if (any) {
    const buf = vtpbf.fromGeojsonVt(layers, { version: 2 });
    const dir = join(tileDir, String(z), String(x));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${y}.pbf`), buf);
    written++; bytes += buf.length; perZoom[z] = (perZoom[z] ?? 0) + 1;
  }
  if (below && z < maxzoom) for (const dx of [0, 1]) for (const dy of [0, 1]) stack.push([z + 1, x * 2 + dx, y * 2 + dy]);
}

const base = (process.env.VITE_SUPABASE_URL ?? "https://qkgaybvrernstplzjaam.supabase.co").replace(/\/$/, "");
const tilejson = {
  tilejson: "3.0.0", name: "nuke-boundaries", version: "1.0.0", scheme: "xyz", minzoom: 0, maxzoom,
  tiles: [`${base}/storage/v1/object/public/map-data/tiles/${VERSION}/{z}/{x}/{y}.pbf`],
  attribution: "U.S. Census Bureau, 2020 cartographic boundary files (1:500,000)",
  vector_layers: Object.entries(SOURCES).map(([id, s]) => ({ id, minzoom: s.minzoom, maxzoom, fields: Object.fromEntries(Object.keys(s.pick({})?.properties ?? {}).map((k) => [k, "String"])) })),
  bounds: [-180, -15, 180, 72],
};
writeFileSync(join(tileDir, "tiles.json"), JSON.stringify(tilejson));

// Per-county ZCTA GeoJSON for MapKit: group by every county a ZCTA touches.
const REL_URL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";
const relPath = join(srcDir, "tab20_zcta520_county20_natl.txt");
if (!existsSync(relPath)) {
  const res = await fetch(REL_URL);
  if (!res.ok) throw new Error(`download ${res.status} ${REL_URL}`);
  writeFileSync(relPath, Buffer.from(await res.arrayBuffer()));
}
const byCounty = new Map();
for (const line of readFileSync(relPath, "utf8").split(/\r?\n/).slice(1)) {
  const c = line.split("|");
  const z = c[1], county = c[9];
  if (!/^\d{5}$/.test(z ?? "") || !/^\d{5}$/.test(county ?? "")) continue;
  if (!byCounty.has(county)) byCounty.set(county, new Set());
  byCounty.get(county).add(z);
}
const zctaFeatures = new Map(readShapefile(srcDir, SOURCES.zctas.base, SOURCES.zctas.pick, round).map((f) => [f.properties.zcta, f]));
const centroid = (g) => { // the centre of the largest outer ring's bounding box
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let best = null, bestN = -1;
  for (const p of polys) if (p[0].length > bestN) { bestN = p[0].length; best = p[0]; }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of best) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return [((minX + maxX) / 2).toFixed(5), ((minY + maxY) / 2).toFixed(5)];
};
const geoDir = join(outDir, "geo", "v1", "county");
mkdirSync(geoDir, { recursive: true });
let geoFiles = 0, geoBytes = 0, geoMax = 0, geoMaxFips = "";
for (const [county, zs] of byCounty) {
  const features = [];
  for (const z of [...zs].sort()) {
    const f = zctaFeatures.get(z);
    if (!f) continue;
    const [lon, lat] = centroid(f.geometry);
    features.push({ type: "Feature", id: z, properties: { GEOID: z, INTPTLAT: lat, INTPTLON: lon }, geometry: f.geometry });
  }
  const text = JSON.stringify({ type: "FeatureCollection", county, source: CENSUS, vintage: "2020", features });
  writeFileSync(join(geoDir, `${county}.geojson`), text);
  geoFiles++; geoBytes += text.length;
  if (text.length > geoMax) { geoMax = text.length; geoMaxFips = county; }
}

const report = { source: CENSUS, vintage: "2020", scale: "1:500,000", features: counts, maxzoom, tiles: written, tiles_per_zoom: perZoom,
                 tile_bytes: bytes, out: tileDir, county_geojson: { files: geoFiles, bytes: geoBytes, largest: geoMaxFips, largest_bytes: geoMax, dir: geoDir },
                 uploaded: 0, upload_failed: 0 };

if (upload) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not in the environment (run under dotenvx)");
  const files = [];
  const walk = (dir, rel) => { for (const e of Deno.readDirSync(dir)) { const p = join(dir, e.name); if (e.isDirectory) walk(p, `${rel}${e.name}/`); else files.push([p, `${rel}${e.name}`]); } };
  walk(tileDir, `tiles/${VERSION}/`);
  walk(geoDir, `geo/${VERSION}/county/`);
  const put = async ([path, rel]) => {
    const body = readFileSync(path);
    const type = rel.endsWith(".geojson") ? "application/geo+json" : rel.endsWith(".json") ? "application/json" : "application/x-protobuf";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(`${base}/storage/v1/object/map-data/${rel}`, {
        method: "POST", body,
        headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": type, "x-upsert": "true",
                   "cache-control": "max-age=31536000, immutable" },
      });
      if (res.ok) { report.uploaded++; return; }
      if (attempt === 3) { report.upload_failed++; console.error(`upload ${rel}: ${res.status} ${(await res.text()).slice(0, 120)}`); }
      else await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  };
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (i < files.length) await put(files[i++]); }));
}
console.log(JSON.stringify(report, null, 2));
