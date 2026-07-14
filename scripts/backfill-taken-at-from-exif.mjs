/**
 * backfill-taken-at-from-exif.mjs — recover real capture dates from file EXIF.
 *
 * Problem (measured 2026-06-22): the HD-archive frames (full-res originals, e.g. the
 * 1966 Mustang's finished-car shots) have vehicle_images.taken_at = NULL and empty
 * exif_data in the DB, even though the real capture date (2024) sits in each file's
 * embedded EXIF (DateTimeOriginal). With no taken_at the chronology has holes, "latest"
 * silently favors the capture-relay frames that *do* have dates, and build-era vs
 * finished-era can't be separated. This backfills taken_at from the file EXIF.
 *
 * Efficient: EXIF lives in the first chunk of the file, so we range-GET only the first
 * ~256 KB instead of downloading multi-MB originals. Public bucket → no auth for the read;
 * the DB write uses the service role. Idempotent: only touches rows where taken_at IS NULL.
 *
 * Usage:
 *   node scripts/backfill-taken-at-from-exif.mjs --vehicle-id <uuid> [--limit N] [--dry-run]
 *   node scripts/backfill-taken-at-from-exif.mjs --all [--limit N] [--dry-run]
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Dep: exifr (npm i exifr) — reads JPEG/HEIC/PNG EXIF.
 */
import { createClient } from '@supabase/supabase-js';
import exifr from 'exifr';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing SUPABASE_URL / SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const VEHICLE_ID = arg('--vehicle-id');
const ALL = args.includes('--all');
const DRY = args.includes('--dry-run');
const LIMIT = parseInt(arg('--limit', '500'), 10);
if (!VEHICLE_ID && !ALL) { console.error('need --vehicle-id <uuid> or --all'); process.exit(1); }

// Pull only the bytes that hold EXIF (first ~256 KB). Falls back to a full GET on the
// rare file whose EXIF block sits past the range.
async function readShotAt(url) {
  for (const range of ['bytes=0-262143', null]) {
    try {
      const res = await fetch(url, range ? { headers: { Range: range } } : {});
      if (!res.ok && res.status !== 206) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ex = await exifr.parse(buf, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] }).catch(() => null);
      const d = ex?.DateTimeOriginal || ex?.CreateDate || ex?.ModifyDate;
      if (d instanceof Date && !isNaN(d) && d.getFullYear() > 1990) return d.toISOString();
      if (range) continue; // ranged read had no date — try full
    } catch { /* try next */ }
  }
  return null;
}

async function page(from, to) {
  let q = sb.from('vehicle_images')
    .select('id, image_url')
    .is('taken_at', null)
    .not('image_url', 'is', null)
    .order('id')
    .range(from, to);
  if (!ALL) q = q.eq('vehicle_id', VEHICLE_ID);
  const { data, error } = await q;
  if (error) { console.error('query: ' + error.message); process.exit(1); }
  return data || [];
}

let scanned = 0, updated = 0, nodate = 0;
for (let off = 0; off < LIMIT; off += 200) {
  const rows = await page(off, Math.min(off + 199, LIMIT - 1));
  if (!rows.length) break;
  for (const r of rows) {
    scanned++;
    const iso = await readShotAt(r.image_url);
    if (!iso) { nodate++; continue; }
    if (DRY) { updated++; console.log(`would set ${r.id.slice(0, 8)} -> ${iso}`); continue; }
    const { error } = await sb.from('vehicle_images')
      .update({ taken_at: iso }).eq('id', r.id).is('taken_at', null); // re-check guard
    if (error) { console.error(`update ${r.id.slice(0, 8)}: ${error.message}`); continue; }
    updated++;
  }
  if (rows.length < 200) break;
}
console.log(`backfill-taken-at: scanned=${scanned} updated=${updated} no_date=${nodate}${DRY ? ' (dry-run)' : ''}`);
