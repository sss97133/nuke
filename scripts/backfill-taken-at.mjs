#!/usr/bin/env node
/**
 * Backfill taken_at on vehicle_images from EXIF data in local photo files.
 * Matches by file_name, reads EXIF creation date via sips.
 *
 * Usage:
 *   dotenvx run -- node scripts/backfill-taken-at.mjs \
 *     --folder "/Users/skylar/Desktop/83 k2500" \
 *     --vehicle-id a90c008a-3379-41d8-9eb2-b4eda365d74c
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';
import dns from 'dns';

const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) return origLookup(hostname, options, callback);
    if (options?.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const folder = arg('--folder');
const vehicleId = arg('--vehicle-id');
if (!folder || !vehicleId) { console.error('--folder and --vehicle-id required'); process.exit(1); }

// Get all iphoto images missing taken_at
const { data: images } = await supabase
  .from('vehicle_images')
  .select('id, file_name')
  .eq('vehicle_id', vehicleId)
  .eq('source', 'iphoto')
  .is('taken_at', null);

console.log(`${images.length} images missing taken_at`);

// Build EXIF date map from local files
const files = readdirSync(folder).filter(f => /\.(jpeg|jpg|heic|png)$/i.test(f));
console.log(`${files.length} local files to scan for EXIF dates`);

const exifDates = new Map();
let scanned = 0;
for (const f of files) {
  try {
    const out = execSync(`sips -g creation "${join(folder, f)}" 2>/dev/null`, { encoding: 'utf8' });
    const m = out.match(/creation:\s+(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      exifDates.set(f, iso);
    }
  } catch {}
  scanned++;
  if (scanned % 100 === 0) process.stdout.write(`\r  Scanned ${scanned}/${files.length} EXIF dates`);
}
process.stdout.write(`\r  Scanned ${scanned}/${files.length} EXIF dates\n`);
console.log(`Got EXIF dates for ${exifDates.size} files`);

// Match and update
let updated = 0, missed = 0;
const BATCH = 50;
const toUpdate = [];

for (const img of images) {
  const date = exifDates.get(img.file_name);
  if (date) {
    toUpdate.push({ id: img.id, taken_at: date });
  } else {
    missed++;
  }
}

console.log(`Matched: ${toUpdate.length}, no EXIF: ${missed}`);

for (let i = 0; i < toUpdate.length; i += BATCH) {
  const batch = toUpdate.slice(i, i + BATCH);
  await Promise.all(batch.map(async ({ id, taken_at }) => {
    const { error } = await supabase.from('vehicle_images').update({ taken_at }).eq('id', id);
    if (!error) updated++;
  }));
  process.stdout.write(`\r  Updated ${updated}/${toUpdate.length}`);
}
process.stdout.write('\n');
console.log(`Done: ${updated} taken_at backfilled`);
