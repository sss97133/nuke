#!/usr/bin/env node
/**
 * bulk-photo-upload — High-throughput photo uploader for Nuke
 *
 * Uploads photos to Supabase Storage with 50 concurrent connections,
 * then batch-inserts DB records 500 at a time. 10-50x faster than
 * nuke-photo-drop.mjs for large directories.
 *
 * Usage:
 *   dotenvx run -- node scripts/bulk-photo-upload.mjs <folder> [options]
 *   dotenvx run -- node scripts/bulk-photo-upload.mjs /Volumes/NukePortable/PhotosConverted --source ssd_heic
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Run with: dotenvx run -- node scripts/bulk-photo-upload.mjs <folder>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BUCKET = 'vehicle-photos';
const UPLOAD_CONCURRENCY = 50;    // 50 parallel storage uploads
const DB_BATCH_SIZE = 500;        // 500 rows per INSERT
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png']);

// CLI
const args = process.argv.slice(2);
const folderPath = args.find(a => !a.startsWith('--'));
const arg = (name) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const flag = (name) => args.includes(name);
const source = arg('--source') || 'bulk_upload';
const userId = arg('--user-id');
const startAt = parseInt(arg('--start-at') || '0');

if (!folderPath) {
  console.log('Usage: dotenvx run -- node scripts/bulk-photo-upload.mjs <folder> [--source name] [--start-at N]');
  process.exit(0);
}

// Collect all image files
console.log(`\nScanning ${folderPath}...`);
const allFiles = readdirSync(folderPath)
  .filter(f => !f.startsWith('.') && IMAGE_EXTS.has(extname(f).toLowerCase()))
  .map(f => join(folderPath, f));

console.log(`Found ${allFiles.length} images (starting at index ${startAt})`);
const files = allFiles.slice(startAt);
console.log(`Will upload ${files.length} images with ${UPLOAD_CONCURRENCY} concurrent connections`);

// Phase 1: Upload to storage + collect results
const results = [];
let uploaded = 0, skipped = 0, errors = 0;
const startTime = Date.now();

async function uploadOne(filePath) {
  const filename = basename(filePath);
  try {
    const fileData = readFileSync(filePath);
    const fileSize = fileData.length;
    const ext = extname(filename).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const storagePath = `unassigned/${source}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileData, { contentType: mimeType, upsert: true });

    if (uploadErr) {
      if (uploadErr.message?.includes('already exists') || uploadErr.message?.includes('Duplicate')) {
        skipped++;
        return null;
      }
      if (errors < 10) console.error(`\n  ERR upload ${filename}: ${uploadErr.message}`);
      errors++;
      return null;
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    uploaded++;
    return {
      image_url: publicUrl,
      storage_path: storagePath,
      source,
      file_name: filename,
      file_size: fileSize,
      mime_type: mimeType,
      is_external: false,
      ai_processing_status: 'pending',
      ...(userId && { documented_by_user_id: userId }),
    };
  } catch (e) {
    if (errors < 10) console.error(`\n  ERR ${filename}: ${e.message}`);
    errors++;
    return null;
  }
}

// Process in chunks of UPLOAD_CONCURRENCY
for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
  const chunk = files.slice(i, i + UPLOAD_CONCURRENCY);
  const chunkResults = await Promise.all(chunk.map(uploadOne));
  results.push(...chunkResults.filter(Boolean));

  const elapsed = (Date.now() - startTime) / 1000;
  const rate = Math.round((i + chunk.length) / elapsed * 3600);
  const pct = Math.round((i + chunk.length) / files.length * 100);
  process.stdout.write(`\r  ${i + chunk.length}/${files.length} (${pct}%) | ${uploaded} up, ${skipped} dup, ${errors} err | ${rate}/hr`);
}
process.stdout.write('\n');

console.log(`\nStorage uploads complete: ${uploaded} new, ${skipped} dup, ${errors} err`);
console.log(`Rate: ${Math.round(uploaded / ((Date.now() - startTime) / 3600000))}/hr`);

// Phase 2: Batch insert DB records
if (results.length > 0) {
  console.log(`\nInserting ${results.length} DB records in batches of ${DB_BATCH_SIZE}...`);
  let dbInserted = 0, dbErrors = 0;

  for (let i = 0; i < results.length; i += DB_BATCH_SIZE) {
    const batch = results.slice(i, i + DB_BATCH_SIZE);
    const { error } = await supabase.from('vehicle_images').insert(batch);
    if (error) {
      // Fall back to one-by-one for this batch
      for (const row of batch) {
        const { error: rowErr } = await supabase.from('vehicle_images').insert(row);
        if (rowErr && !rowErr.message?.includes('duplicate')) {
          dbErrors++;
        } else {
          dbInserted++;
        }
      }
    } else {
      dbInserted += batch.length;
    }
    process.stdout.write(`\r  DB: ${dbInserted}/${results.length} inserted, ${dbErrors} errors`);
  }
  process.stdout.write('\n');
  console.log(`\nDB inserts complete: ${dbInserted} rows, ${dbErrors} errors`);
}

const totalTime = Math.round((Date.now() - startTime) / 1000);
console.log(`\nDone in ${Math.floor(totalTime/60)}m ${totalTime%60}s`);
console.log(`Total: ${uploaded} uploaded, ${skipped} duplicates, ${errors} errors`);
