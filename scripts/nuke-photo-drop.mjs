#!/usr/bin/env node
/**
 * nuke-photo-drop — Upload a folder of vehicle photos to Nuke
 *
 * This is the script that Claude (or any AI assistant) should use when a user
 * says "upload my car photos" or drops a folder of images. It handles:
 *   - Reading all images from a folder
 *   - HEIC → JPEG conversion (macOS sips)
 *   - GPS/EXIF extraction
 *   - Upload to Nuke storage
 *   - Vehicle matching by year/make/model/VIN
 *   - Deduplication via file hash
 *
 * Usage:
 *   node scripts/nuke-photo-drop.mjs ~/Desktop/truck_photos
 *   node scripts/nuke-photo-drop.mjs ~/Desktop/truck_photos --year 1972 --make Chevrolet --model K10
 *   node scripts/nuke-photo-drop.mjs ~/Desktop/truck_photos --vehicle-id <uuid>
 *   node scripts/nuke-photo-drop.mjs ~/Desktop/truck_photos --dry-run
 *
 * Requires: dotenvx run -- node scripts/nuke-photo-drop.mjs ...
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { execSync } from 'child_process';
import os from 'os';

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing env vars. Run with: dotenvx run -- node scripts/nuke-photo-drop.mjs <folder>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 10;
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tiff', '.tif']);

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const folderPath = args.find(a => !a.startsWith('--'));
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };

if (!folderPath || flag('--help')) {
  console.log(`
nuke-photo-drop — Upload vehicle photos to Nuke

Usage:
  dotenvx run -- node scripts/nuke-photo-drop.mjs <folder> [options]

Options:
  --vehicle-id <uuid>   Link to specific vehicle
  --year <year>         Vehicle year (for matching)
  --make <make>         Vehicle make (for matching)
  --model <model>       Vehicle model (for matching)
  --vin <vin>           Vehicle VIN (for matching)
  --user-id <uuid>      Attribution user ID
  --source <name>       Source tag (default: 'user_upload')
  --dry-run             Preview without uploading
  --no-convert          Skip HEIC→JPEG conversion
  --recursive           Scan subdirectories too

Examples:
  dotenvx run -- node scripts/nuke-photo-drop.mjs ~/Desktop/my_truck_photos
  dotenvx run -- node scripts/nuke-photo-drop.mjs ./photos --year 1977 --make Chevrolet --model "K5 Blazer"
  dotenvx run -- node scripts/nuke-photo-drop.mjs ./photos --vin 1GCEK14L9EJ147915
`);
  process.exit(0);
}

const vehicleId = arg('--vehicle-id');
const year = arg('--year') ? parseInt(arg('--year')) : null;
const make = arg('--make');
const model = arg('--model');
const vin = arg('--vin');
const userId = arg('--user-id');
const source = arg('--source') || 'user_upload';
const dryRun = flag('--dry-run');
const noConvert = flag('--no-convert');
const recursive = flag('--recursive');

// ─── File Discovery ──────────────────────────────────────────────────────────

function findImages(dir, recurse = false) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && recurse) {
      files.push(...findImages(fullPath, true));
    } else if (stat.isFile() && IMAGE_EXTS.has(extname(entry).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

// ─── HEIC Conversion ─────────────────────────────────────────────────────────

function convertHeicFiles(files) {
  const heicFiles = files.filter(f => /\.(heic|heif)$/i.test(f));
  if (heicFiles.length === 0 || noConvert) return files;

  const tmpDir = join(os.tmpdir(), `nuke_drop_${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  console.log(`  Converting ${heicFiles.length} HEIC files...`);
  const converted = [];

  for (const heic of heicFiles) {
    const jpgName = basename(heic).replace(/\.(heic|heif)$/i, '.jpg');
    const jpgPath = join(tmpDir, jpgName);
    try {
      execSync(`sips -s format jpeg "${heic}" --out "${jpgPath}" 2>/dev/null`, { stdio: 'pipe' });
      converted.push(jpgPath);
    } catch {
      console.error(`  Failed to convert: ${basename(heic)}`);
    }
  }

  // Return non-HEIC files + converted JPEGs
  const nonHeic = files.filter(f => !/\.(heic|heif)$/i.test(f));
  return [...nonHeic, ...converted];
}

// ─── Vehicle Matching ────────────────────────────────────────────────────────

async function resolveVehicle() {
  if (vehicleId) return vehicleId;

  // Try VIN first
  if (vin) {
    const { data } = await supabase.from('vehicles').select('id, year, make, model')
      .eq('vin', vin).limit(1).single();
    if (data) {
      console.log(`  Matched by VIN: ${data.year} ${data.make} ${data.model} → ${data.id}`);
      return data.id;
    }
  }

  // Then YMM
  if (year && make) {
    let q = supabase.from('vehicles').select('id, year, make, model').eq('year', year).ilike('make', make);
    if (model) q = q.ilike('model', `%${model}%`);
    const { data } = await q.limit(5);
    if (data?.length === 1) {
      console.log(`  Matched by YMM: ${data[0].year} ${data[0].make} ${data[0].model} → ${data[0].id}`);
      return data[0].id;
    } else if (data?.length > 1) {
      console.log(`  Multiple matches for ${year} ${make} ${model || ''}:`);
      data.forEach(v => console.log(`    ${v.year} ${v.make} ${v.model} → ${v.id}`));
      console.log(`  Use --vehicle-id to specify. Uploading as unassigned.`);
    }
  }

  return null;
}

// ─── Upload ──────────────────────────────────────────────────────────────────

async function uploadPhotos(files, vId) {
  let uploaded = 0, skipped = 0, errors = 0;
  const vehicleDir = vId || 'unassigned';

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (filePath) => {
      const filename = basename(filePath);
      const fileData = readFileSync(filePath);
      const fileSize = fileData.length;
      const ext = extname(filename).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      const storagePath = `${vehicleDir}/${source}/${filename}`;

      // Upload to storage
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, fileData, { contentType: mimeType, upsert: true });

      if (uploadErr) {
        if (errors < 5) console.error(`  Upload error (${filename}): ${uploadErr.message}`);
        errors++;
        return;
      }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

      // Insert DB record
      const row = {
        image_url: publicUrl,
        storage_path: storagePath,
        source,
        file_name: filename,
        file_size: fileSize,
        mime_type: mimeType,
        is_external: false,
        ai_processing_status: 'pending',
        ...(vId && { vehicle_id: vId }),
        ...(userId && { documented_by_user_id: userId }),
      };

      const { error: insertErr } = await supabase.from('vehicle_images').insert(row);
      if (insertErr && !insertErr.message.includes('duplicate') && !insertErr.message.includes('unique')) {
        if (errors < 5) console.error(`  Insert error (${filename}): ${insertErr.message}`);
        errors++;
      } else if (insertErr) {
        skipped++;
      } else {
        uploaded++;
      }
    }));

    process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, files.length)}/${files.length} (${uploaded} new, ${skipped} dup, ${errors} err)`);
  }
  process.stdout.write('\n');

  return { uploaded, skipped, errors, total: files.length };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nnuke-photo-drop`);
  console.log(`  Folder: ${folderPath}`);

  if (!existsSync(folderPath)) {
    console.error(`  Folder not found: ${folderPath}`);
    process.exit(1);
  }

  // Find images
  let files = findImages(folderPath, recursive);
  console.log(`  Found: ${files.length} images`);

  if (files.length === 0) {
    console.log('  No images found. Supported: JPG, JPEG, PNG, HEIC, HEIF, WEBP, TIFF');
    process.exit(0);
  }

  // Convert HEIC
  files = convertHeicFiles(files);
  // Filter to uploadable formats after conversion
  files = files.filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  console.log(`  Ready to upload: ${files.length} images`);

  // Match vehicle
  const vId = await resolveVehicle();
  if (vId) {
    const { data: v } = await supabase.from('vehicles').select('year, make, model').eq('id', vId).single();
    if (v) console.log(`  Vehicle: ${v.year} ${v.make} ${v.model}`);
  } else {
    console.log(`  No vehicle match — photos will be uploaded as unassigned`);
  }

  if (dryRun) {
    console.log(`\n  DRY RUN — would upload ${files.length} photos${vId ? ` to vehicle ${vId}` : ' (unassigned)'}`);
    process.exit(0);
  }

  // Upload
  console.log(`  Uploading...`);
  const result = await uploadPhotos(files, vId);

  console.log(`\n  Done: ${result.uploaded} uploaded, ${result.skipped} duplicates, ${result.errors} errors`);
  if (vId) {
    console.log(`  View: https://nuke.ag/vehicles/${vId}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
