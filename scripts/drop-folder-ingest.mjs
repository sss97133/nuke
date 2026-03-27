#!/usr/bin/env node
/**
 * Drop-Folder Photo Ingestor
 *
 * Point it at a folder of photos. It looks at each one, figures out
 * which vehicle it belongs to, and uploads it. No albums, no GPS
 * heuristics. Just vision.
 *
 * Usage:
 *   node scripts/drop-folder-ingest.mjs /path/to/folder
 *   node scripts/drop-folder-ingest.mjs /path/to/folder --dry-run
 *   node scripts/drop-folder-ingest.mjs /path/to/folder --classify-only
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import os from 'os';
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

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});
const BUCKET = 'vehicle-photos';
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const folderPath = args.find(a => !a.startsWith('-'));
const DRY_RUN = args.includes('--dry-run');
const CLASSIFY_ONLY = args.includes('--classify-only');

if (!folderPath) {
  console.error('Usage: node scripts/drop-folder-ingest.mjs /path/to/folder [--dry-run] [--classify-only]');
  process.exit(1);
}

if (!existsSync(folderPath)) {
  console.error(`Folder not found: ${folderPath}`);
  process.exit(1);
}

// ─── Known vehicles (the ones you're actively working on) ───────────────────
const VEHICLES = [
  {
    id: 'a90c008a-3379-41d8-9eb2-b4eda365d74c',
    label: '1983 GMC K2500 Sierra Classic',
    hints: 'blue square body GMC pickup truck, lifted, long bed, two-tone blue and dark blue, chrome bumpers, BFGoodrich tires, polished aluminum wheels'
  },
  {
    id: '6442df03-9cac-43a8-b89e-e4fb4c08ee99',
    label: '1984 Chevrolet K10 SWB',
    hints: 'white Chevrolet square body pickup truck, short bed, 4x4'
  },
  {
    id: '48875fce-7b71-48f5-ac36-bcaf12f50fd0',
    label: '1966 Chevrolet C10',
    hints: 'red 1960s Chevrolet C10 pickup truck, classic body style with rounded fenders'
  },
  {
    id: 'e8a9c558-a930-4e55-9e5c-4a2711cab081',
    label: '1972 Chevrolet K10 SWB',
    hints: 'early 70s Chevrolet pickup, square body predecessor'
  },
];

// Also match the 1932 Ford Roadster that's at the shop
const ALL_KNOWN = [
  ...VEHICLES,
  { id: null, label: '1932 Ford Roadster', hints: 'bare metal hot rod roadster body, no paint, fabrication in progress' },
  { id: null, label: 'shop_environment', hints: 'workshop, tools, welding, workbench, shop floor, equipment' },
  { id: null, label: 'documentation', hints: 'receipt, invoice, instruction sheet, manual, parts list, paperwork' },
  { id: null, label: 'parts', hints: 'loose parts, bolts, fittings, hoses, bottles of fluid, hardware' },
];

// ─── Retry helper ───────────────────────────────────────────────────────────
async function withRetry(fn, label = '', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// ─── Vision classify via Ollama (two-step: describe → keyword match) ────────
async function describePhoto(imagePath) {
  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2-vision:11b',
        prompt: 'Describe this photo in one sentence. Include: vehicle color, vehicle type (truck/car/rod), body style, era, or if not a vehicle say what the object is (receipt, tools, parts, etc).',
        images: [readFileSync(imagePath).toString('base64')],
        stream: false,
        options: { temperature: 0.1, num_predict: 40 }
      })
    });
    const data = await resp.json();
    return (data.response || '').trim().toLowerCase();
  } catch { return ''; }
}

function matchDescription(desc) {
  if (!desc) return null;
  const d = desc.toLowerCase();

  // Documentation: receipts, invoices, paperwork, instructions
  if (/receipt|invoice|paper|barcode|qr code|instruction|manual|document/.test(d)) {
    return ALL_KNOWN.find(v => v.label === 'documentation');
  }

  // Parts: fluids, bottles, bolts, hardware
  if (/bottle|fluid|bolt|fitting|hose|hardware|gasket|seal|filter/.test(d) && !/truck|car|vehicle/.test(d)) {
    return ALL_KNOWN.find(v => v.label === 'parts');
  }

  // Blue truck/pickup → Sierra Classic (the blue one)
  if (/blue.*(truck|pickup|gmc|chevy|chevrolet|square)/.test(d) || /(truck|pickup).*(blue)/.test(d)) {
    return ALL_KNOWN[0]; // Sierra Classic
  }

  // White truck/pickup → K10 SWB
  if (/white.*(truck|pickup|chevy|chevrolet|square|k10)/.test(d) || /(truck|pickup).*(white)/.test(d)) {
    return ALL_KNOWN[1]; // K10 SWB
  }

  // Red truck/car + engine/underside → C10
  if (/red.*(truck|pickup|car|chevy|chevrolet|c10|engine|under)/.test(d) || /(truck|car).*(red)/.test(d) || /red.*engine/.test(d) || /underside.*red/.test(d)) {
    return ALL_KNOWN[2]; // C10
  }

  // Roadster, hot rod, convertible, bare metal, silver body
  if (/roadster|hot rod|rod|bare metal|convertible.*silver|silver.*convertible/.test(d)) {
    return ALL_KNOWN.find(v => v.label === '1932 Ford Roadster');
  }

  // Welding, tools, workbench
  if (/weld|grind|tool|workbench|bench|shop|garage/.test(d) && !/truck|car|vehicle/.test(d)) {
    return ALL_KNOWN.find(v => v.label === 'shop_environment');
  }

  // Generic truck/car but can't determine color → default to Sierra (most photographed)
  if (/truck|pickup|vehicle/.test(d)) {
    return ALL_KNOWN[0]; // Sierra Classic as default vehicle
  }

  return null;
}

async function classifyPhoto(imagePath) {
  const desc = await describePhoto(imagePath);
  const match = matchDescription(desc);
  return { ...(match || { id: null, label: 'unknown', hints: '' }), description: desc };
}

// ─── HEIC → JPEG conversion ────────────────────────────────────────────────
function ensureJpeg(filePath, tmpDir) {
  const ext = extname(filePath).toLowerCase();
  const base = basename(filePath, extname(filePath));

  if (ext === '.heic') {
    const outPath = join(tmpDir, base + '.jpg');
    try {
      execSync(`sips -s format jpeg "${filePath}" --out "${outPath}" -s formatOptions 85 > /dev/null 2>&1`);
      return outPath;
    } catch { return null; }
  } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    return filePath; // Already usable
  }
  return null; // Skip videos etc
}

// Make a small thumbnail for vision classification
function makeThumbnail(filePath, tmpDir) {
  const base = basename(filePath, extname(filePath));
  const thumbPath = join(tmpDir, base + '_thumb.jpg');
  try {
    execSync(`sips -s format jpeg "${filePath}" --out "${thumbPath}" -s formatOptions 40 -Z 512 > /dev/null 2>&1`);
    return thumbPath;
  } catch { return null; }
}

// ─── Upload to Supabase ─────────────────────────────────────────────────────
async function uploadPhoto(jpegPath, vehicleId, originalFilename) {
  const fileData = readFileSync(jpegPath);
  const fileSize = statSync(jpegPath).size;
  const filename = basename(jpegPath);
  const storagePath = `${vehicleId}/work-photos/${filename}`;
  const mimeType = 'image/jpeg';

  const { error: uploadError } = await withRetry(() =>
    supabase.storage.from(BUCKET).upload(storagePath, fileData, {
      contentType: mimeType, upsert: true
    }), filename);

  if (uploadError) return null;

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  const row = {
    vehicle_id: vehicleId,
    image_url: publicUrl,
    storage_path: storagePath,
    source: 'drop-folder',
    mime_type: mimeType,
    file_name: filename,
    file_size: fileSize,
    is_external: false,
    ai_processing_status: 'pending',
    documented_by_user_id: USER_ID,
  };

  const { error: insertError } = await supabase.from('vehicle_images').insert(row);
  if (insertError && !insertError.message?.includes('duplicate')) {
    return null;
  }
  return publicUrl;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function run() {
  // Find all image files
  const allFiles = readdirSync(folderPath)
    .filter(f => /\.(heic|jpg|jpeg|png)$/i.test(f))
    .sort();

  console.log(`\nDrop-folder ingest: ${folderPath}`);
  console.log(`${allFiles.length} images found\n`);

  if (allFiles.length === 0) return;

  // Check existing uploads to skip dupes
  const { data: existing } = await supabase
    .from('vehicle_images')
    .select('file_name')
    .eq('source', 'drop-folder');
  const existingNames = new Set((existing || []).map(r => r.file_name));

  const tmpDir = join(os.tmpdir(), `drop_ingest_${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Classification results
  const results = { uploaded: 0, skipped: 0, errors: 0, classified: {} };

  // Process in order — classify each, then upload
  // Use session heuristic: photos taken within minutes of each other
  // are likely the same vehicle. Classify one per cluster, apply to all.
  let lastClassification = null;
  let lastTimestamp = null;

  for (let i = 0; i < allFiles.length; i++) {
    const filename = allFiles[i];
    const filePath = join(folderPath, filename);
    const jpegName = filename.replace(/\.heic$/i, '.jpg');

    // Skip already uploaded
    if (existingNames.has(jpegName)) {
      results.skipped++;
      continue;
    }

    // Get file modification time for session clustering
    const mtime = statSync(filePath).mtimeMs;
    const timeSinceLast = lastTimestamp ? (mtime - lastTimestamp) : Infinity;
    const sameSession = timeSinceLast < 30 * 60 * 1000; // 30 min = same session

    // Classify: either reuse last classification (same session) or classify fresh
    let classification = null;
    if (sameSession && lastClassification) {
      classification = lastClassification;
    } else {
      // Need to classify this photo
      const thumbPath = makeThumbnail(filePath, tmpDir);
      if (thumbPath) {
        process.stdout.write(`  Classifying ${filename}...`);
        classification = await classifyPhoto(thumbPath);
        if (classification) {
          process.stdout.write(` → ${classification.label}\n`);
        } else {
          process.stdout.write(` → unknown\n`);
        }
      }
    }

    lastClassification = classification;
    lastTimestamp = mtime;

    // Track classification counts
    const label = classification?.label || 'unknown';
    results.classified[label] = (results.classified[label] || 0) + 1;

    if (DRY_RUN || CLASSIFY_ONLY) continue;

    // Only upload if we have a vehicle ID
    if (!classification?.id) {
      // Still upload — just put in Sierra Classic as default (most active)
      classification = { id: 'a90c008a-3379-41d8-9eb2-b4eda365d74c', label: 'default → Sierra Classic' };
    }

    // Convert HEIC → JPEG if needed
    const jpegPath = ensureJpeg(filePath, tmpDir);
    if (!jpegPath) { results.errors++; continue; }

    const url = await uploadPhoto(jpegPath, classification.id, filename);
    if (url) {
      results.uploaded++;
    } else {
      results.errors++;
    }

    // Progress
    if ((results.uploaded + results.errors) % 20 === 0) {
      console.log(`  Progress: ${results.uploaded} uploaded, ${results.errors} errors, ${results.skipped} skipped (${i + 1}/${allFiles.length})`);
    }
  }

  // Summary
  console.log('\n--- Results ---');
  console.log(`Uploaded: ${results.uploaded}`);
  console.log(`Skipped (already exists): ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);
  console.log('\nClassification breakdown:');
  for (const [label, count] of Object.entries(results.classified).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${count}`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
