#!/usr/bin/env node
/**
 * Re-geocode organizations whose stored coordinate is not actually their location.
 *
 * THE DEFECT. 1,286 of 2,275 geocoded St Barth orgs (57%) sit on a coordinate shared with at
 * least one other org — 182 distinct "piles", the largest holding 143 businesses on one point.
 * These are Nominatim town/neighbourhood centroids returned when the address could not be
 * resolved, stored as though they were the business's door. The precision was recorded honestly
 * at ingest (address 596 / locality 494 / city_fallback 232 / unrecorded 953) and then ignored
 * by every reader. Measured example: Eden Rock's pin sits 150m off its own promontory, and
 * Eden Rock Villa Rental sits on a pile of 66 orgs, 232m away.
 *
 * Per THE FRAME (docs/HANDOFF.md) a low-confidence value must surface AS low-confidence, never
 * as a clean-looking fact. A centroid pin is the cleanest-looking lie on the map: 143 businesses
 * each appear precisely located.
 *
 * WHAT THIS DOES
 *   1. Finds every org on a shared point, or flagged city_fallback/locality, or with no
 *      precision recorded at all.
 *   2. Asks OSM/Nominatim for the business BY NAME, scoped to Saint-Barthélemy.
 *   3. Adopts the result ONLY if it is a real place POI (a node/way with a business-ish class),
 *      not another administrative centroid, and only if it is not itself on a known pile.
 *   4. Where no POI is found, it does NOT invent one. It records the coordinate's true precision
 *      so the map can render it honestly (or decline to pin it) — an absent location stays absent.
 *
 * Never overwrites blindly: the prior coordinate, its source and the reason are preserved in
 * metadata.geocode_history, so every move is reversible and auditable.
 *
 * Nominatim usage policy: 1 request/second, identifying User-Agent. Resumable — safe to re-run.
 *
 * Usage: node scripts/concierge/regeocode-centroid-pins.mjs [--apply] [--limit N]
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');
const li = process.argv.indexOf('--limit');
const LIMIT = li > -1 ? Number(process.argv[li + 1]) : Infinity;
const UA = 'nuke-lofficiel-geocode/1.0 (shkylar@gmail.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hav = (a, b, c, d) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (c - a) * r, dLon = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
};

async function page(table, sel) {
  let out = [], i = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select(sel).order('id').range(i, i + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    i += 1000;
  }
  return out;
}

// A Nominatim result is usable only if it is an actual place, not an admin/boundary centroid.
// 'place' class covers hamlets/localities — exactly the fallbacks that created this mess.
const ADMIN = new Set(['place', 'boundary', 'landuse', 'natural', 'waterway']);
const usable = (r) => r && !ADMIN.has(r.class) && (r.osm_type === 'node' || r.osm_type === 'way');

const orgs = await page('organizations', 'id,name,latitude,longitude,city,address,metadata,country');
const geo = orgs.filter((o) => o.country === 'BL' && o.latitude != null && o.longitude != null);

// Identify the piles: any exact coordinate carrying more than one org.
const byPoint = new Map();
for (const o of geo) {
  const k = `${o.latitude},${o.longitude}`;
  if (!byPoint.has(k)) byPoint.set(k, []);
  byPoint.get(k).push(o);
}
const piled = new Set();
for (const [, list] of byPoint) if (list.length > 1) list.forEach((o) => piled.add(o.id));

const suspect = geo.filter((o) => {
  const p = o.metadata?.geocode?.precision;
  return piled.has(o.id) || p === 'city_fallback' || p === 'locality';
});

console.log(`orgs (BL, geocoded): ${geo.length}`);
console.log(`  on a shared point : ${piled.size}`);
console.log(`  suspect (pile or coarse precision): ${suspect.length}`);
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — querying OSM at 1 req/s\n`);

let moved = 0, flagged = 0, nohit = 0, done = 0;
for (const o of suspect) {
  if (done >= LIMIT) break;
  done++;
  const q = `${o.name}, Saint-Barthélemy`;
  let hit = null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
      { headers: { 'User-Agent': UA } }
    );
    if (res.ok) {
      const arr = await res.json();
      hit = arr.find(usable) || null;
    }
  } catch { /* network hiccup: treat as no-hit, the run is resumable */ }
  await sleep(1100);

  const prior = { latitude: o.latitude, longitude: o.longitude, precision: o.metadata?.geocode?.precision ?? null };

  if (hit) {
    const lat = Number(hit.lat), lon = Number(hit.lon);
    // Another pile is not an improvement.
    if (byPoint.has(`${lat},${lon}`) && byPoint.get(`${lat},${lon}`).length > 1) { nohit++; continue; }
    const shift = hav(o.latitude, o.longitude, lat, lon);
    console.log(`  MOVE  ${String(o.name).slice(0, 34).padEnd(36)} ${shift}m -> ${lat},${lon}  [${hit.class}/${hit.type}]`);
    moved++;
    if (APPLY) {
      const metadata = {
        ...(o.metadata || {}),
        geocode: { at: new Date().toISOString().slice(0, 10), source: 'openstreetmap', precision: 'poi', osm_type: hit.osm_type, osm_id: hit.osm_id, osm_class: hit.class, display_name: hit.display_name },
        geocode_history: [...(o.metadata?.geocode_history || []), { ...prior, replaced_at: new Date().toISOString(), reason: piled.has(o.id) ? 'shared_centroid_pile' : 'coarse_precision', moved_m: shift, restore: `UPDATE organizations SET latitude=${prior.latitude}, longitude=${prior.longitude} WHERE id='${o.id}';` }],
      };
      const { error } = await sb.from('organizations').update({ latitude: lat, longitude: lon, metadata }).eq('id', o.id);
      if (error) throw new Error(`${o.name}: ${error.message}`);
    }
  } else {
    // No POI exists. Do NOT invent one — record that this pin is not a real location so the
    // map can decline to present it as one.
    nohit++;
    flagged++;
    if (APPLY) {
      const metadata = {
        ...(o.metadata || {}),
        geocode: { ...(o.metadata?.geocode || {}), precision: prior.precision || (piled.has(o.id) ? 'shared_centroid' : 'unverified'), is_precise: false, checked_at: new Date().toISOString(), note: piled.has(o.id) ? `coordinate shared with ${byPoint.get(`${o.latitude},${o.longitude}`).length - 1} other orgs — a locality centroid, not this business's door` : 'coarse geocode; no OSM POI found for this name' },
      };
      const { error } = await sb.from('organizations').update({ metadata }).eq('id', o.id);
      if (error) throw new Error(`${o.name}: ${error.message}`);
    }
  }
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — checked ${done}, moved to a real POI ${moved}, marked imprecise ${flagged}, no OSM hit ${nohit}`);
if (!APPLY) console.log('re-run with --apply to write');
