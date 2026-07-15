/**
 * Backfill FREE image metadata from exif_data → structured columns.
 *
 * Step one of the analysis pipeline: copy the already-available data sitting in
 * the heterogeneous vehicle_images.exif_data JSON blob into the typed columns the
 * downstream cheap analysis + grouping read. Zero inference, zero token cost.
 *
 * Promotes (null-only, idempotent — never overwrites an existing value):
 *   - latitude/longitude  ← exif_data.location{lat,lon} | flat exif_data.latitude/longitude
 *   - apple_ml_labels[]   ← exif_data.labels (Apple on-device Vision subject tags)
 *
 * NOT promoted (no clean column home / ambiguous): camera_make/model, dimensions,
 * full technical EXIF (iso/aperture/shutter), orientation→rotation, the Apple
 * aesthetic `score` object. Those stay in the blob until a column exists for them.
 *
 * Why batched + paced: vehicle_images has a per-row AFTER UPDATE trigger
 * (trg_recompute_value_on_images) that recomputes vehicle valuation on EVERY
 * update, and trg_auto_tag_org_from_gps runs an org-stats cascade on lat/lon
 * updates. A single bulk UPDATE blows the statement timeout. GPS batches must stay
 * small (~150-300); label batches tolerate ~1500-2000.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-exif-free-data.mjs \
 *     --user-id <uuid> [--labels-batch 1500] [--gps-batch 200] [--sleep-ms 250]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const USER_ID = arg('--user-id');
const LABELS_BATCH = parseInt(arg('--labels-batch', '1500'));
const GPS_BATCH = parseInt(arg('--gps-batch', '200'));
const SLEEP_MS = parseInt(arg('--sleep-ms', '250'));
if (!USER_ID) { console.error('--user-id <uuid> required'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NUM = /^-?[0-9]+(\.[0-9]+)?$/;

function gpsFrom(exif) {
  const loc = exif?.location;
  const cands = [
    [loc?.latitude, loc?.longitude],
    [exif?.latitude, exif?.longitude],
  ];
  for (const [la, lo] of cands) {
    const las = la == null ? '' : String(la);
    const los = lo == null ? '' : String(lo);
    if (NUM.test(las) && NUM.test(los)) return { lat: Number(las), lon: Number(los) };
  }
  return null;
}

async function backfillLabels() {
  let total = 0;
  for (;;) {
    const { data, error } = await sb
      .from('vehicle_images')
      .select('id, exif_data')
      .eq('user_id', USER_ID)
      .is('apple_ml_labels', null)
      .limit(LABELS_BATCH);
    if (error) { console.error('labels select:', error.message); break; }
    const rows = (data || []).filter((r) => Array.isArray(r.exif_data?.labels) && r.exif_data.labels.length);
    if (!rows.length) break;
    for (const r of rows) {
      const { error: e } = await sb.from('vehicle_images')
        .update({ apple_ml_labels: r.exif_data.labels.map(String) })
        .eq('id', r.id);
      if (e) console.error(`  labels ${r.id}: ${e.message}`); else total++;
    }
    console.log(`labels: +${rows.length} (total ${total})`);
    await sleep(SLEEP_MS);
    if (rows.length < LABELS_BATCH) break;
  }
  return total;
}

async function backfillGps() {
  let total = 0;
  for (;;) {
    const { data, error } = await sb
      .from('vehicle_images')
      .select('id, exif_data')
      .eq('user_id', USER_ID)
      .is('latitude', null)
      .limit(GPS_BATCH);
    if (error) { console.error('gps select:', error.message); break; }
    const rows = (data || []).map((r) => ({ id: r.id, g: gpsFrom(r.exif_data) })).filter((r) => r.g);
    if (!rows.length) break;
    for (const r of rows) {
      const { error: e } = await sb.from('vehicle_images')
        .update({ latitude: r.g.lat, longitude: r.g.lon })
        .eq('id', r.id);
      if (e) console.error(`  gps ${r.id}: ${e.message}`); else total++;
    }
    console.log(`gps: +${rows.length} (total ${total})`);
    await sleep(SLEEP_MS);
    if ((data || []).length < GPS_BATCH) break;
  }
  return total;
}

console.log(`backfill-exif-free-data: user ${USER_ID}`);
const labels = await backfillLabels();
const gps = await backfillGps();
console.log(`done: ${labels} labels, ${gps} gps promoted`);
