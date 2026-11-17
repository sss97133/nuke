#!/usr/bin/env node
/**
 * Mac Photos library census: the denominator for capture_library_coverage_v1.
 *
 * Counts EVERY photo in the Mac's Photos library (not only newly added ones, unlike photo-sync-daemon.mjs) by
 * capture month and reports it with library_inventory_record_census_for (service role). Metadata only: it never
 * exports, reads or uploads a photo, and it decides nothing about privacy.
 *
 * Default: census only (one row per run, the per-month counts). --with-rows also upserts one metadata row per
 * asset into library_inventory (asset id 'mac_photos:<uuid>', coarse 2-decimal location, no bytes, no hash) so a
 * later reconciler can match Mac assets to Nuke rows by uuid (vehicle_images.exif_data.photos_uuid / original_uuid).
 *
 * Usage (on the Mac that holds the Photos library):
 *   dotenvx run -- node scripts/photo-library-census-mac.mjs --dry-run      # print counts, write nothing
 *   dotenvx run -- node scripts/photo-library-census-mac.mjs                # record the census
 *   dotenvx run -- node scripts/photo-library-census-mac.mjs --with-rows    # census + metadata rows
 * Env: SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never printed), NUKE_USER_ID, OSXPHOTOS_BIN.
 *
 * Counted: photos (not videos), not hidden, not in shared albums, not recently deleted. That matches what the
 * Photos app's Library footer shows, so the census can be checked against the number the owner sees.
 */
import { spawnSync } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import { hostname, homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const WITH_ROWS = args.includes('--with-rows');
const TZ = 'America/Los_Angeles';   // capture_library_coverage_v1 buckets months in this zone
const USER_ID = process.env.NUKE_USER_ID || '0b9f107a-d124-49de-9ded-94698f63c1c4';
const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const OSXPHOTOS = process.env.OSXPHOTOS_BIN
  || [join(homedir(), '.local/bin/osxphotos'), '/opt/homebrew/bin/osxphotos', '/usr/local/bin/osxphotos'].find(existsSync)
  || 'osxphotos';
const PRODUCER = 'scripts/photo-library-census-mac.mjs v1 (osxphotos query --only-photos --not-hidden --not-shared)';

const monthFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' });
export function monthOf(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(monthFmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}
export function censusCounts(photos) {
  const months = {};
  let undated = 0;
  for (const p of photos) {
    const m = monthOf(p.date);
    if (!m) { undated += 1; continue; }
    months[m] = (months[m] || 0) + 1;
  }
  return { months, undated };
}

async function rpc(fn, body) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function main() {
  if (!DRY && (!URL_ || !KEY)) { console.error('SUPABASE_URL and a service key are required (or use --dry-run)'); process.exit(2); }
  const started = new Date();
  const q = spawnSync(OSXPHOTOS, ['query', '--only-photos', '--not-hidden', '--not-shared', '--json'],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 * 1024 });
  if (q.status !== 0) { console.error(`osxphotos query failed: ${(q.stderr || '').slice(0, 300)}`); process.exit(1); }
  const photos = JSON.parse(q.stdout || '[]').filter((p) => !p.intrash);
  const { months, undated } = censusCounts(photos);
  const runId = randomUUID();
  const device = createHash('sha256').update(hostname()).digest('hex').slice(0, 16);   // not the raw hostname
  const census = {
    run_id: runId, origin_source: 'mac_photos', origin_device_id: device, origin_scope: 'full', media_type: 'image',
    total_count: photos.length, month_counts: months, undated_count: undated, month_tz: TZ,
    started_at: started.toISOString(), finished_at: new Date().toISOString(), producer: PRODUCER,
  };
  const years = {};
  for (const [m, n] of Object.entries(months)) years[m.slice(0, 4)] = (years[m.slice(0, 4)] || 0) + n;
  console.log(`Mac Photos census: ${photos.length} photos, ${undated} undated`);
  console.log(Object.entries(years).sort().map(([y, n]) => `  ${y}: ${n}`).join('\n'));
  if (DRY) { console.log('dry run: nothing written'); return; }

  const id = await rpc('library_inventory_record_census_for', { p_user: USER_ID, p_census: census });
  console.log(`census recorded (run ${runId}, row ${id})`);

  if (WITH_ROWS) {
    const round2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : null);
    let sent = 0;
    for (let i = 0; i < photos.length; i += 1000) {
      const rows = photos.slice(i, i + 1000).map((p) => ({
        asset_local_id: `mac_photos:${p.uuid}`,
        creation_date: p.date || null,
        media_type: 'image',
        source_type: 'user_library',
        is_screenshot: Boolean(p.screenshot),
        pixel_width: p.width ?? null,
        pixel_height: p.height ?? null,
        has_location: typeof p.latitude === 'number' && typeof p.longitude === 'number',
        loc_lat_coarse: round2(p.latitude),
        loc_lon_coarse: round2(p.longitude),
        gate_verdict: 'unknown',
        origin_device_id: device,
        origin_scope: 'full',
      }));
      sent += await rpc('library_inventory_upsert_for', { p_user: USER_ID, p_origin_source: 'mac_photos', p_rows: rows, p_run_id: runId });
    }
    console.log(`inventory rows upserted: ${sent}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
