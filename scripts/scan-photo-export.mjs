#!/usr/bin/env node
/**
 * Scan exported photo directories for vehicle photos.
 * Works on raw filesystem exports (no osxphotos needed).
 *
 * Strategy:
 *   1. Walk directory, filter images by extension + size (skip screenshots, tiny files)
 *   2. Upload to storage in batches
 *   3. Call YONO classify on each (free, 4ms) — filter to vehicles only
 *   4. Insert vehicle photos into vehicle_images with source='photo-export'
 *   5. Trigger photo-pipeline-orchestrator for full analysis
 *
 * Usage:
 *   dotenvx run -- node scripts/scan-photo-export.mjs /Volumes/NukePortable/PhotosExport/2024
 *   dotenvx run -- node scripts/scan-photo-export.mjs /Volumes/NukePortable/PhotosExport --dry-run
 *   dotenvx run -- node scripts/scan-photo-export.mjs /path/to/photos --since 2024-01
 *   dotenvx run -- node scripts/scan-photo-export.mjs /path/to/photos --limit 100
 */

import { createClient } from '@supabase/supabase-js';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import dns from 'dns';

// ─── DNS fix ────────────────────────────────────────────────────────────────
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

// ─── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. Run with: dotenvx run -- node scripts/scan-photo-export.mjs <path>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { global: { fetch: nodeFetch } });
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 5;
const STATE_FILE = join(process.cwd(), 'data', 'photo-export-state.json');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);
const MIN_SIZE = 200_000;  // 200KB — skip screenshots, icons, thumbnails
const MAX_SIZE = 50_000_000; // 50MB

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const DIR = args.find(a => !a.startsWith('--'));
if (!DIR) {
  console.error('Usage: dotenvx run -- node scripts/scan-photo-export.mjs <directory> [--dry-run] [--since 2024-01] [--limit 100]');
  process.exit(1);
}

const DRY_RUN = flag('--dry-run');
const SINCE = arg('--since');
const LIMIT = parseInt(arg('--limit') || '0') || 0;

// ─── State tracking (resume support) ────────────────────────────────────────
function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return { processed: {}, stats: { scanned: 0, uploaded: 0, vehicle: 0, skipped: 0 } };
}

function saveState(state) {
  try {
    const dir = join(process.cwd(), 'data');
    if (!existsSync(dir)) { import('fs').then(fs => fs.mkdirSync(dir, { recursive: true })); }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('  Warning: failed to save state:', e.message);
  }
}

// ─── Walk directory for images ──────────────────────────────────────────────
function walkForImages(dir, depth = 0) {
  const results = [];
  if (depth > 5) return results;

  let entries;
  try { entries = readdirSync(dir); } catch { return results; }

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);

    let stat;
    try { stat = statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      // Filter by --since (compare folder name like "2024-06")
      if (SINCE && depth <= 1) {
        const folderName = basename(fullPath);
        if (/^\d{4}(-\d{2})?$/.test(folderName) && folderName < SINCE) continue;
      }
      results.push(...walkForImages(fullPath, depth + 1));
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      if (stat.size < MIN_SIZE || stat.size > MAX_SIZE) continue;
      // Skip videos misnamed as images
      if (entry.toLowerCase().includes('.mov') || entry.toLowerCase().includes('.mp4')) continue;

      results.push({
        path: fullPath,
        name: entry,
        size: stat.size,
        ext,
        mtime: stat.mtime,
      });
    }
  }
  return results;
}

// ─── Retry helper ───────────────────────────────────────────────────────────
async function withRetry(fn, label = '', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt === retries) throw e;
      console.log(`  Retry ${attempt}/${retries} (${label}): ${e.message}`);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// ─── Upload + classify pipeline ─────────────────────────────────────────────
async function uploadAndClassify(file) {
  // Upload to storage
  const storagePath = `${USER_ID}/photo-export/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const fileData = readFileSync(file.path);
  const mimeType = file.ext === '.png' ? 'image/png' : file.ext === '.heic' ? 'image/heic' : 'image/jpeg';

  const { error: uploadErr } = await withRetry(async () => {
    const r = await supabase.storage.from(BUCKET).upload(storagePath, fileData, {
      contentType: mimeType,
      upsert: false,
    });
    if (r.error) throw new Error(r.error.message);
    return r;
  }, `upload-${file.name}`);

  if (uploadErr) return { status: 'upload_error', error: uploadErr.message };

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  // Insert into vehicle_images — pipeline trigger (photo-pipeline-orchestrator)
  // will classify via Gemini Flash and route accordingly.
  // No YONO gate needed — let the pipeline decide what's a vehicle.
  const { error: insertErr } = await withRetry(async () => {
    const r = await supabase.from('vehicle_images').insert({
      user_id: USER_ID,
      image_url: publicUrl,
      source: 'photo-export',
      ai_processing_status: 'pending',
      image_category: 'unknown',
      created_at: new Date().toISOString(),
    });
    if (r.error) throw new Error(r.error.message);
    return r;
  }, 'insert');

  if (insertErr) return { status: 'insert_error', error: insertErr.message, url: publicUrl };

  return {
    status: 'uploaded',
    url: publicUrl,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nScanning: ${DIR}`);
  if (SINCE) console.log(`  Since: ${SINCE}`);
  if (LIMIT) console.log(`  Limit: ${LIMIT}`);
  if (DRY_RUN) console.log(`  DRY RUN — no uploads`);

  // Walk filesystem
  console.log('  Walking directory...');
  let files = walkForImages(DIR);
  console.log(`  Found ${files.length} image files (>200KB)`);

  // Load state for resume
  const state = loadState();
  const alreadyDone = new Set(Object.keys(state.processed));
  const todo = files.filter(f => !alreadyDone.has(f.path));
  console.log(`  Already processed: ${alreadyDone.size}, remaining: ${todo.length}`);

  if (LIMIT && todo.length > LIMIT) {
    todo.length = LIMIT;
    console.log(`  Limited to ${LIMIT} files`);
  }

  if (DRY_RUN) {
    console.log(`\n── DRY RUN ──`);
    console.log(`  Would process ${todo.length} files`);
    const byExt = {};
    const bySize = { small: 0, medium: 0, large: 0 };
    for (const f of todo) {
      byExt[f.ext] = (byExt[f.ext] || 0) + 1;
      if (f.size < 1_000_000) bySize.small++;
      else if (f.size < 5_000_000) bySize.medium++;
      else bySize.large++;
    }
    console.log(`  By extension:`, byExt);
    console.log(`  By size: <1MB=${bySize.small}, 1-5MB=${bySize.medium}, >5MB=${bySize.large}`);
    return;
  }

  // Process in batches
  let uploaded = 0, vehicles = 0, notVehicle = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (file) => {
      try {
        const result = await uploadAndClassify(file);
        state.processed[file.path] = { status: result.status, at: new Date().toISOString() };
        return result;
      } catch (e) {
        state.processed[file.path] = { status: 'error', error: e.message, at: new Date().toISOString() };
        return { status: 'error', error: e.message };
      }
    }));

    for (const r of results) {
      uploaded++;
      if (r.status === 'uploaded') vehicles++;
      else errors++;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (uploaded / (elapsed || 1)).toFixed(1);
    const pct = ((uploaded / todo.length) * 100).toFixed(1);
    process.stdout.write(`\r  ${uploaded}/${todo.length} (${pct}%) | ${vehicles} queued | ${errors} err | ${rate}/s    `);

    // Save state every batch
    state.stats = { scanned: uploaded, uploaded: vehicles, skipped: notVehicle, errors };
    saveState(state);
  }

  process.stdout.write('\n');

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n────────────────────────────────────`);
  console.log(`Scan complete (${elapsed}s)`);
  console.log(`  Scanned:     ${uploaded}`);
  console.log(`  Vehicles:    ${vehicles}`);
  console.log(`  Not vehicle: ${notVehicle}`);
  console.log(`  Errors:      ${errors}`);
  console.log(`  Rate:        ${(uploaded / (elapsed || 1)).toFixed(1)}/s`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
