#!/usr/bin/env node
/**
 * HD Vehicle Photo Intake for Nuke
 *
 * Batch uploads vehicle photos from external HD to Supabase storage + vehicle_images.
 * Modeled on iphoto-intake.mjs — same proven pattern.
 *
 * Usage:
 *   dotenvx run -- node scripts/hd-vehicle-intake.mjs --list           # show vehicle→folder map
 *   dotenvx run -- node scripts/hd-vehicle-intake.mjs --vehicle k2500  # upload one vehicle
 *   dotenvx run -- node scripts/hd-vehicle-intake.mjs --all            # upload all vehicles
 *   dotenvx run -- node scripts/hd-vehicle-intake.mjs --dry-run --all  # preview without uploading
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';
import dns from 'dns';

// ─── DNS fix (same as iphoto-intake) ─────────────────────────────────────────
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
const SOURCE = 'hd_archive';

// ─── Vehicle → Folder mapping ────────────────────────────────────────────────
const HD = '/Volumes/EXTERNAL HD/mac-archive-2026-03-05';

const VEHICLE_MAP = {
  k2500: {
    id: 'd6a01df2-dc78-4fe9-9559-2c4cf6124a7a',
    label: '1983 GMC K2500 Sierra Classic',
    folders: [
      `${HD}/Desktop-Projects/83 k2500`,
      `${HD}/Desktop-Projects/my last dtop folder/dtop/1983 k2500`,
    ],
  },
  c10: {
    id: 'ac070808-4cbd-4d03-9c39-2ec5b0f0708c',
    label: '1968 Chevrolet C-10',
    folders: [
      `${HD}/Desktop-Projects/CAR/black 68`,
    ],
  },
  blazer: {
    id: '21501c21-22a7-4f97-9a3a-84823bd1c6b3',
    label: '1977 Chevrolet K5 Blazer',
    folders: [
      `${HD}/Desktop-Projects/my last dtop folder/dtop/1977 k5 blazer`,
      `${HD}/Desktop-Projects/my last dtop folder/dtop/77 blza`,
    ],
  },
  jimmy: {
    id: '50dd2f1a-01de-4f26-9729-c38a82b7c1bb',
    label: '1972 GMC Jimmy',
    folders: [
      `${HD}/Desktop-Projects/my last dtop folder/dtop/73 jimmy`,
      `${HD}/Desktop-Projects/CAR/jimmy images`,
    ],
  },
  bronco71: {
    id: 'c6189023-ab62-4ca8-9bb0-94511a30f037',
    label: '1971 Ford Bronco',
    folders: [
      `${HD}/Desktop-Projects/my last dtop folder/dtop/BRonco dale`,
    ],
  },
  roadster: {
    id: 'd19b2f39-8fff-4bbc-8b77-e809fb2f560b',
    label: '1932 Ford Roadster',
    folders: [], // No photo folders — only HTML reports and video
  },
  mustang: {
    id: '8bde1dda-ebb4-480e-8942-e561feb36667',
    label: '1966 Ford Mustang',
    folders: [
      `${HD}/Desktop-Projects/my last dtop folder/dtop/1966 mustang`,
    ],
  },
  lx450: {
    id: 'f57a4747-6c23-411c-bbad-dd980b24cf0e',
    label: '1996 Lexus LX450',
    folders: [], // Only videos — skip for now
  },
  bronco74: {
    id: '3761cc78-b0d9-4840-881d-aec6def86f0f',
    label: '1974 Ford Bronco',
    folders: [], // Only docs — skip for now
  },
  corvette: {
    id: '592a3bab-9c6b-41ee-8c19-e55dd6a902b6',
    label: '1972 Chevrolet Corvette Stingray',
    folders: [
      `${HD}/Desktop-Projects/CAR/corvette`,
    ],
  },
  k10: {
    id: '6442df03-9cac-43a8-b89e-e4fb4c08ee99',
    label: '1984 Chevrolet K10',
    folders: [
      `${HD}/Desktop-Projects/CAR/K20`,
    ],
  },
};

// Image extensions to upload
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic']);
// Skip these (raw, sidecar, web files)
const SKIP_EXTS = new Set(['.arw', '.cr2', '.xmp', '.html', '.htm', '.js', '.css', '.gif', '.psd',
  '.mov', '.mp4', '.m4v', '.avi', '.indd', '.pdf', '.numbers', '.xlsx', '.rtf', '.rtfd',
  '.bridgesort', '.ds_store']);

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const DRY_RUN = flag('--dry-run');

// ─── Retry helper ────────────────────────────────────────────────────────────
async function withRetry(fn, label = '', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt === retries) throw e;
      const delay = attempt * 2000;
      console.log(`  Retry ${attempt}/${retries} (${label}): ${e.message} — waiting ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── File scanner ────────────────────────────────────────────────────────────
function scanFolder(folderPath) {
  const files = [];
  try {
    const entries = readdirSync(folderPath);
    for (const entry of entries) {
      const fullPath = join(folderPath, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) continue; // don't recurse into subdirs (avoid _files/ junk)
        const ext = extname(entry).toLowerCase();
        if (IMAGE_EXTS.has(ext)) {
          files.push({ path: fullPath, name: entry, size: stat.size, ext });
        }
      } catch { /* skip unreadable */ }
    }
  } catch (e) {
    console.log(`  Warning: cannot read ${folderPath}: ${e.message}`);
  }
  return files;
}

// ─── SHA-256 hash ────────────────────────────────────────────────────────────
function hashFile(filePath) {
  const data = readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

// ─── Upload one vehicle ──────────────────────────────────────────────────────
async function uploadVehicle(key, vehicle) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Vehicle: ${vehicle.label} (${key})`);
  console.log(`ID: ${vehicle.id}`);

  if (!vehicle.folders.length) {
    console.log('  No photo folders — skipping');
    return { uploaded: 0, skipped: 0, errors: 0, total: 0 };
  }

  // Scan all folders
  let allFiles = [];
  for (const folder of vehicle.folders) {
    const files = scanFolder(folder);
    console.log(`  ${folder}: ${files.length} images`);
    allFiles.push(...files);
  }

  if (allFiles.length === 0) {
    console.log('  No images found');
    return { uploaded: 0, skipped: 0, errors: 0, total: 0 };
  }

  // Check existing to skip dupes (by filename)
  const { data: existing } = await withRetry(async () => {
    const r = await supabase
      .from('vehicle_images')
      .select('file_name, file_hash')
      .eq('vehicle_id', vehicle.id)
      .in('source', [SOURCE, 'iphoto']);
    if (r.error) throw new Error(r.error.message);
    return r;
  }, 'existing-check');

  const existingNames = new Set((existing || []).map(r => r.file_name));
  const existingHashes = new Set((existing || []).filter(r => r.file_hash).map(r => r.file_hash));

  const toUpload = allFiles.filter(f => !existingNames.has(f.name));
  console.log(`  Total: ${allFiles.length} images, ${allFiles.length - toUpload.length} already uploaded, ${toUpload.length} to upload`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would upload these files:');
    for (const f of toUpload.slice(0, 10)) console.log(`    ${f.name} (${(f.size / 1024).toFixed(0)} KB)`);
    if (toUpload.length > 10) console.log(`    ... and ${toUpload.length - 10} more`);
    return { uploaded: 0, skipped: allFiles.length - toUpload.length, errors: 0, total: allFiles.length };
  }

  let uploaded = 0, errors = 0, dupeHash = 0;
  for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
    const batch = toUpload.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (file) => {
      try {
        const fileData = readFileSync(file.path);
        const fileSize = file.size;
        const mimeType = file.ext === '.png' ? 'image/png' : 'image/jpeg';

        // SHA-256 dedup check
        const fileHash = createHash('sha256').update(fileData).digest('hex');
        if (existingHashes.has(fileHash)) {
          dupeHash++;
          return;
        }

        const storagePath = `${vehicle.id}/hd-archive/${file.name}`;

        const { error: uploadError } = await withRetry(async () => {
          const r = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, fileData, { contentType: mimeType, upsert: true });
          if (r.error) throw r.error;
          return r;
        }, `upload-${file.name}`);

        if (uploadError) { errors++; return; }

        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

        const row = {
          vehicle_id: vehicle.id,
          image_url: publicUrl,
          storage_path: storagePath,
          source: SOURCE,
          mime_type: mimeType,
          file_name: file.name,
          file_size: fileSize,
          file_hash: fileHash,
          is_external: false,
          ai_processing_status: 'pending',
          documented_by_user_id: USER_ID,
        };

        const { error: insertError } = await supabase.from('vehicle_images').insert(row);
        if (insertError && !insertError.message.includes('duplicate') && !insertError.message.includes('unique')) {
          if (errors < 5) console.error(`\n  Insert error (${file.name}): ${insertError.message.slice(0, 100)}`);
          errors++;
        } else {
          uploaded++;
          existingHashes.add(fileHash);
        }
      } catch (e) {
        if (errors < 5) console.error(`\n  Error (${file.name}): ${e.message.slice(0, 100)}`);
        errors++;
      }
    }));
    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, toUpload.length)}/${toUpload.length} (${uploaded} new, ${dupeHash} hash-dupe, ${errors} err)  `);
  }
  process.stdout.write('\n');

  // Set primary image if none exists
  const { count: primaryCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id)
    .eq('is_primary', true);

  if (!primaryCount) {
    const { data: first } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (first) {
      await supabase.from('vehicle_images').update({ is_primary: true }).eq('id', first.id);
      console.log('  Set primary image');
    }
  }

  console.log(`  Done: ${uploaded} uploaded, ${dupeHash} hash-dupes, ${errors} errors`);
  return { uploaded, skipped: allFiles.length - toUpload.length + dupeHash, errors, total: allFiles.length };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (flag('--list')) {
  console.log('\nVehicle → Folder mapping:\n');
  for (const [key, v] of Object.entries(VEHICLE_MAP)) {
    const folders = v.folders.length ? v.folders.join(', ') : '(no photo folders)';
    console.log(`  ${key.padEnd(12)} ${v.label}`);
    console.log(`${''.padEnd(15)}${folders}`);
    console.log();
  }

} else if (flag('--vehicle')) {
  const key = arg('--vehicle');
  if (!VEHICLE_MAP[key]) {
    console.error(`Unknown vehicle key: ${key}`);
    console.error(`Valid keys: ${Object.keys(VEHICLE_MAP).join(', ')}`);
    process.exit(1);
  }
  await uploadVehicle(key, VEHICLE_MAP[key]);

} else if (flag('--all')) {
  console.log('Uploading all vehicles from external HD...\n');
  let totalUploaded = 0, totalErrors = 0, totalFiles = 0;
  for (const [key, vehicle] of Object.entries(VEHICLE_MAP)) {
    const result = await uploadVehicle(key, vehicle);
    totalUploaded += result.uploaded;
    totalErrors += result.errors;
    totalFiles += result.total;
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TOTAL: ${totalUploaded} uploaded, ${totalErrors} errors, ${totalFiles} files scanned`);

} else {
  console.log(`
HD Vehicle Photo Intake for Nuke

Usage:
  dotenvx run -- node scripts/hd-vehicle-intake.mjs --list
  dotenvx run -- node scripts/hd-vehicle-intake.mjs --vehicle k2500
  dotenvx run -- node scripts/hd-vehicle-intake.mjs --all
  dotenvx run -- node scripts/hd-vehicle-intake.mjs --dry-run --all

Vehicle keys: ${Object.keys(VEHICLE_MAP).join(', ')}
  `);
}
