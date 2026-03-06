#!/usr/bin/env node
/**
 * Upload a folder of images directly to a vehicle profile on nuke.ag
 * Bypasses osxphotos/iCloud — works with any folder of JPEGs.
 *
 * Usage:
 *   dotenvx run -- node scripts/upload-folder-to-vehicle.mjs \
 *     --folder "/Users/skylar/Desktop/83 k2500" \
 *     --vehicle-id a90c008a-3379-41d8-9eb2-b4eda365d74c
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import dns from 'dns';

// DNS fix for macOS
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

const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 10;
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const folder = arg('--folder');
const vehicleId = arg('--vehicle-id');
const source = arg('--source') || 'iphoto';

if (!folder || !vehicleId) {
  console.error('Usage: --folder <path> --vehicle-id <uuid>');
  process.exit(1);
}

// Get all image files
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic']);
const allFiles = readdirSync(folder).filter(f => {
  const ext = extname(f).toLowerCase();
  return IMAGE_EXTS.has(ext) && !f.startsWith('.');
});

console.log(`Found ${allFiles.length} images in ${folder}`);

// Check what's already uploaded for this vehicle from this source
const { data: existing } = await supabase
  .from('vehicle_images')
  .select('file_name')
  .eq('vehicle_id', vehicleId)
  .eq('source', source);

const existingNames = new Set((existing || []).map(r => r.file_name));
const toUpload = allFiles.filter(f => !existingNames.has(f));
console.log(`Already uploaded: ${existingNames.size}, new to upload: ${toUpload.length}`);

if (toUpload.length === 0) {
  console.log('Nothing to upload.');
  process.exit(0);
}

let uploaded = 0, errors = 0;

for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
  const batch = toUpload.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(async (filename) => {
    const filePath = join(folder, filename);
    const fileData = readFileSync(filePath);
    const fileSize = statSync(filePath).size;
    const ext = extname(filename).toLowerCase();

    // Convert HEIC to note — storage accepts it but we tag the mime
    const mimeType = ext === '.heic' ? 'image/heic'
      : ext === '.png' ? 'image/png'
      : 'image/jpeg';

    const storagePath = `${vehicleId}/${source}/${filename}`;

    // Upload with retry
    let uploadError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, fileData, { contentType: mimeType, upsert: true });
      uploadError = r.error;
      if (!uploadError) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1000));
    }
    if (uploadError) {
      if (errors < 10) console.error(`\n  Error (${filename}): ${uploadError.message}`);
      errors++;
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    const row = {
      vehicle_id: vehicleId,
      image_url: publicUrl,
      storage_path: storagePath,
      source,
      mime_type: mimeType,
      file_name: filename,
      file_size: fileSize,
      is_external: false,
      ai_processing_status: 'pending',
      documented_by_user_id: USER_ID,
    };

    const { error: insErr } = await supabase.from('vehicle_images').insert(row);
    if (insErr && !insErr.message.includes('duplicate')) {
      if (errors < 10) console.error(`\n  DB error (${filename}): ${insErr.message}`);
      errors++;
    } else {
      uploaded++;
    }
  }));
  process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, toUpload.length)}/${toUpload.length} (${uploaded} uploaded, ${errors} errors)  `);
}

process.stdout.write('\n');
console.log(`Done: ${uploaded} uploaded, ${errors} errors`);
