// shapefile.mjs: a dependency-free reader for ESRI shapefiles (polygon records) and their dBase attribute files,
// enough for the Census cartographic boundary files the one map is built from. Used by build-zcta.mjs and
// build-tiles.mjs; runs under Node and Deno.
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// Downloads <base>.zip from the Census server into dir (once) and unzips it (once). Returns the zip path.
export async function fetchCensusShapefile(dir, base, url) {
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, `${base}.zip`);
  if (!existsSync(zip)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status} ${url}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  }
  if (!existsSync(join(dir, `${base}.shp`))) execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  return zip;
}

// dBase III: one object per record, text fields trimmed; deleted records come back as null.
export function readDbf(path) {
  const b = readFileSync(path);
  const records = b.readUInt32LE(4), headerLen = b.readUInt16LE(8), recordLen = b.readUInt16LE(10);
  const fields = [];
  for (let p = 32; b[p] !== 0x0d; p += 32) {
    fields.push({ name: b.toString("ascii", p, p + 11).replace(/\0.*$/, ""), len: b[p + 16] });
  }
  const rows = [];
  for (let r = 0, p = headerLen; r < records; r++, p += recordLen) {
    if (b[p] === 0x2a) { rows.push(null); continue; }
    const row = {}; let q = p + 1;
    for (const f of fields) { row[f.name] = b.toString("latin1", q, q + f.len).trim(); q += f.len; }
    rows.push(row);
  }
  return rows;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2; // negative = clockwise = an outer ring, by the shapefile convention
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ESRI shapefile, polygon records (type 5), as GeoJSON geometries in record order; null shapes come back as null.
// round(v) rounds each coordinate (pass (v) => v for none). Holes attach to the outer ring that contains their first
// vertex, else to the first outer ring.
export function readShpPolygons(path, round = (v) => v) {
  const b = readFileSync(path);
  const shapes = [];
  for (let p = 100; p < b.length;) {
    const contentWords = b.readInt32BE(p + 4); p += 8;
    const type = b.readInt32LE(p);
    if (type === 0) { shapes.push(null); p += contentWords * 2; continue; }
    if (type !== 5) throw new Error(`shape type ${type}, expected 5 (polygon)`);
    const numParts = b.readInt32LE(p + 36), numPoints = b.readInt32LE(p + 40);
    const parts = []; for (let i = 0; i < numParts; i++) parts.push(b.readInt32LE(p + 44 + i * 4));
    let q = p + 44 + numParts * 4;
    const pts = new Array(numPoints);
    for (let i = 0; i < numPoints; i++, q += 16) pts[i] = [round(b.readDoubleLE(q)), round(b.readDoubleLE(q + 8))];
    const rings = parts.map((s, i) => pts.slice(s, i + 1 < parts.length ? parts[i + 1] : numPoints));
    const outers = [], holes = [];
    for (const r of rings) (ringArea(r) <= 0 ? outers : holes).push([r]);
    for (const [h] of holes) (outers.find((o) => pointInRing(h[0], o[0])) ?? outers[0]).push(h);
    shapes.push(outers.length === 1 ? { type: "Polygon", coordinates: outers[0] }
                                    : { type: "MultiPolygon", coordinates: outers });
    p += contentWords * 2;
  }
  return shapes;
}

// Both files of one shapefile as GeoJSON features: id and properties from pick(row), geometry from the .shp.
export function readShapefile(dir, base, pick, round) {
  const rows = readDbf(join(dir, `${base}.dbf`));
  const shapes = readShpPolygons(join(dir, `${base}.shp`), round);
  if (rows.length !== shapes.length) throw new Error(`${base}: dbf ${rows.length} rows, shp ${shapes.length} shapes`);
  const features = [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i] || !shapes[i]) continue;
    const { id, properties } = pick(rows[i]);
    features.push({ type: "Feature", id, properties, geometry: shapes[i] });
  }
  return features;
}
