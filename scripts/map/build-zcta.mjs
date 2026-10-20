#!/usr/bin/env node
// build-zcta.mjs: the ZIP geography for the one map, measured before anything is loaded (plan step 3).
//
// Downloads the Census 2020 ZCTA cartographic boundary file (1:500,000, cb_2020_us_zcta520_500k.zip), reads the
// shapefile with no GDAL and no npm package (the .shp and .dbf formats are parsed here), writes one GeoJSON
// FeatureCollection with id = the five-digit ZCTA, and reports its size raw and gzipped. With --codes <file> (one
// postal code per line) it also reports which codes match a ZCTA and lists the ones that do not.
//
// Nothing here touches the database. The decision the numbers inform: ZCTA polygons stay out of the production
// database (204 GB on 2026-10-19) and are served as vector tiles from storage (scripts/map/build-tiles.mjs); the
// database keys vehicle_location_observations.zcta from postal_code.
//
//   node scripts/map/build-zcta.mjs [--out <dir>] [--codes <file>] [--precision 5]
//
// Provenance: https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip (Census Bureau, 2020
// vintage, generalized to 1:500,000; public domain). The output carries source and vintage in its top-level
// properties.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchCensusShapefile, readShapefile } from "./shapefile.mjs";

const SOURCE_URL = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip";
const BASENAME = "cb_2020_us_zcta520_500k";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const outDir = opt("--out", join(tmpdir(), "nuke-zcta"));
const codesFile = opt("--codes", null);
const precision = Number(opt("--precision", "5"));
mkdirSync(outDir, { recursive: true });

const zip = await fetchCensusShapefile(outDir, BASENAME, SOURCE_URL);
const k = 10 ** precision, round = (v) => Math.round(v * k) / k;
const features = readShapefile(outDir, BASENAME, (row) => {
  const id = row.ZCTA5CE20 ?? row.GEOID20;
  if (!/^\d{5}$/.test(id)) throw new Error(`bad ZCTA id ${id}`);
  return { id, properties: { zcta: id, land_m2: Number(row.ALAND20), water_m2: Number(row.AWATER20) } };
}, round);
const ids = new Set(features.map((f) => f.id));
if (ids.size !== features.length) throw new Error("duplicate ZCTA ids");
const fc = { type: "FeatureCollection", source: SOURCE_URL, vintage: "2020", scale: "1:500,000", precision, features };
const outPath = join(outDir, `zcta-2020-500k.geojson`);
const text = JSON.stringify(fc);
writeFileSync(outPath, text);
const gz = gzipSync(text).length;
let points = 0;
for (const f of features) for (const poly of (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)) for (const ring of poly) points += ring.length;

const report = {
  source: SOURCE_URL, vintage: "2020", scale: "1:500,000",
  census_zip_bytes: statSync(zip).size, shp_bytes: statSync(join(outDir, `${BASENAME}.shp`)).size,
  zctas: features.length, multipolygons: features.filter((f) => f.geometry.type === "MultiPolygon").length,
  vertices: points, precision_decimals: precision,
  geojson_bytes: text.length, geojson_gzip_bytes: gz, geojson_path: outPath,
};
if (codesFile) {
  const codes = [...new Set(readFileSync(codesFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d{5}$/.test(s)))];
  const unmatched = codes.filter((c) => !ids.has(c)).sort();
  report.codes = codes.length; report.codes_matching_zcta = codes.length - unmatched.length; report.codes_unmatched = unmatched.length;
  const unmatchedPath = join(outDir, "codes-unmatched.txt");
  writeFileSync(unmatchedPath, unmatched.join("\n") + "\n");
  report.codes_unmatched_path = unmatchedPath;
}
console.log(JSON.stringify(report, null, 2));
