#!/usr/bin/env node
/**
 * Work Photos Auto-Intake for Nuke
 *
 * Watches for new unalbumized vehicle photos from Apple Photos,
 * classifies them by vehicle using AI vision, and uploads to Supabase.
 *
 * Usage:
 *   node scripts/work-photos-intake.mjs                    # ingest recent work photos (last 7d)
 *   node scripts/work-photos-intake.mjs --days 14          # last 14 days
 *   node scripts/work-photos-intake.mjs --watch            # daemon mode (checks every 5 min)
 *   node scripts/work-photos-intake.mjs --dry-run          # show what would be ingested
 *   node scripts/work-photos-intake.mjs --since 2026-03-19 # since specific date
 *
 * Requires: osxphotos, @supabase/supabase-js, dotenvx, sips (macOS)
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, basename } from 'path';
import os from 'os';
import dns from 'dns';

// ─── DNS fix (same as iphoto-intake) ────────────────────────────────────────
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
    if (options && options.all) {
      callback(null, addresses.map(a => ({ address: a, family: 4 })));
    } else {
      callback(null, addresses[0], 4);
    }
  });
};
const nodeFetch = (await import('node-fetch')).default;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});
const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 10;
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// ─── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const DRY_RUN = flag('--dry-run');
const WATCH = flag('--watch');
const DAYS = parseInt(arg('--days') || '7');
const SINCE = arg('--since');

// ─── Known shop locations (GPS → shop name) ────────────────────────────────
// These are learned from photo GPS clusters and associated with vehicles
const SHOP_LOCATIONS = [
  {
    name: 'Viva Las Vegas Autos',
    lat: 35.9728, lon: -114.8555,
    radius_m: 200,
    vehicles: [] // Will be populated from DB
  },
  {
    name: "Ernie's Upholstery",
    lat: 35.9775, lon: -114.8539,
    radius_m: 200,
    vehicles: []
  }
];

// ─── State file for tracking what's been processed ──────────────────────────
const STATE_FILE = join(process.cwd(), 'data', 'work-photos-state.json');

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return { processed_uuids: [], last_run: null, sessions: [] };
}

function saveState(state) {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Retry helper ───────────────────────────────────────────────────────────
async function withRetry(fn, label = '', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt === retries) throw e;
      const delay = attempt * 2000;
      console.log(`  Retry ${attempt}/${retries} (${label}): ${e.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── GPS distance calculation ───────────────────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function findNearestShop(lat, lon) {
  if (!lat || !lon) return null;
  for (const shop of SHOP_LOCATIONS) {
    const dist = haversineDistance(lat, lon, shop.lat, shop.lon);
    if (dist <= shop.radius_m) return shop;
  }
  return null;
}

// ─── Query recent unalbumized photos from Apple Photos ──────────────────────
function queryRecentPhotos() {
  const queryArgs = ['query', '--not-in-album', '--json'];
  if (SINCE) {
    queryArgs.push('--from-date', SINCE);
  } else {
    queryArgs.push('--added-in-last', `${DAYS}d`);
  }

  console.log(`Querying Photos library (${SINCE ? `since ${SINCE}` : `last ${DAYS} days`}, not in albums)...`);
  const result = spawnSync('osxphotos', queryArgs, {
    encoding: 'utf8', stdio: 'pipe', maxBuffer: 100 * 1024 * 1024
  });

  if (result.status !== 0) {
    console.error('osxphotos query failed:', result.stderr?.slice(0, 200));
    return [];
  }

  let photos;
  try { photos = JSON.parse(result.stdout); } catch { return []; }

  // Filter to vehicle-related photos using Apple ML labels
  const vehicleKeywords = new Set([
    'car','truck','vehicle','automobile','pickup','van','suv','wheel','tire',
    'engine','motor','hood','bumper','grille','fender','tailgate','dashboard',
    'steering','exhaust','chassis','rim','spoke','tachometer','speedometer',
    'off-road vehicle','pickup truck','jeep','license plate','vehicle engine'
  ]);

  const vehiclePhotos = photos.filter(p => {
    const labels = (p.labels || []).map(l => l.toLowerCase());
    return labels.some(l => vehicleKeywords.has(l));
  });

  console.log(`  Found ${photos.length} unalbumized photos, ${vehiclePhotos.length} vehicle-related`);
  return vehiclePhotos;
}

// ─── Cluster photos into work sessions ──────────────────────────────────────
function clusterIntoSessions(photos) {
  // Sort by date
  const sorted = [...photos].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const sessions = [];
  let current = null;

  for (const photo of sorted) {
    const date = photo.date || '';
    const lat = photo.latitude;
    const lon = photo.longitude;

    // New session if >2 hours gap or >500m away from current cluster
    let startNew = false;
    if (!current) {
      startNew = true;
    } else {
      const lastDate = current.photos[current.photos.length - 1].date || '';
      const timeDiff = new Date(date) - new Date(lastDate);
      if (timeDiff > 2 * 60 * 60 * 1000) startNew = true; // 2 hour gap

      if (!startNew && lat && current.lat) {
        const dist = haversineDistance(lat, lon, current.lat, current.lon);
        if (dist > 500) startNew = true; // 500m away
      }
    }

    if (startNew) {
      current = {
        photos: [],
        lat: lat || null,
        lon: lon || null,
        start: date,
        end: date,
        shop: null
      };
      sessions.push(current);
    }

    current.photos.push(photo);
    current.end = date;
    // Update centroid
    if (lat && lon) {
      const gpsPhotos = current.photos.filter(p => p.latitude);
      current.lat = gpsPhotos.reduce((s, p) => s + p.latitude, 0) / gpsPhotos.length;
      current.lon = gpsPhotos.reduce((s, p) => s + p.longitude, 0) / gpsPhotos.length;
    }
  }

  // Tag each session with its nearest shop
  for (const session of sessions) {
    session.shop = findNearestShop(session.lat, session.lon);
  }

  return sessions;
}

// ─── Export a single photo by UUID ──────────────────────────────────────────
function exportPhotoByUUID(uuid, destDir) {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync('osxphotos', [
    'export', destDir, '--uuid', uuid, '--overwrite',
  ], { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
  return result.status === 0;
}

// ─── Export multiple photos by UUID batch ───────────────────────────────────
function exportPhotosBatch(uuids, destDir) {
  mkdirSync(destDir, { recursive: true });
  // osxphotos supports multiple --uuid flags
  // Use --download-missing to fetch iCloud-only photos
  const cmdArgs = ['export', destDir, '--overwrite', '--download-missing'];
  for (const uuid of uuids) {
    cmdArgs.push('--uuid', uuid);
  }
  // Pipe "y" to handle interactive iCloud download prompt
  const result = spawnSync('bash', ['-c',
    `echo "y" | osxphotos ${cmdArgs.map(a => `"${a}"`).join(' ')}`
  ], {
    encoding: 'utf8', stdio: 'pipe', timeout: 600000 // 10 min for iCloud downloads
  });
  if (result.status !== 0 && result.status !== null) {
    console.error('  Export error:', (result.stderr || '').slice(0, 300));
  }
  return result.status === 0 || result.status === null;
}

// ─── Convert HEIC → JPEG ───────────────────────────────────────────────────
function convertDir(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  let converted = 0, skipped = 0;
  for (const f of readdirSync(srcDir)) {
    if (/\.heic$/i.test(f)) {
      const outName = f.replace(/\.heic$/i, '.jpg');
      try {
        execSync(`sips -s format jpeg "${join(srcDir, f)}" --out "${join(destDir, outName)}" -s formatOptions 85 > /dev/null 2>&1`);
        converted++;
      } catch { skipped++; }
    } else if (/\.(jpg|jpeg|png)$/i.test(f)) {
      execSync(`cp "${join(srcDir, f)}" "${join(destDir, f)}"`);
      converted++;
    }
    // Skip videos (MOV, MP4) for now
  }
  if (skipped > 0) console.log(`  Skipped ${skipped} unconvertible files`);
  return converted;
}

// ─── Upload photos to Supabase ──────────────────────────────────────────────
async function uploadWorkPhotos(photos, vehicleId) {
  const tmpExport = join(os.tmpdir(), `work_export_${Date.now()}`);
  const tmpJpeg = join(os.tmpdir(), `work_jpeg_${Date.now()}`);

  try {
    // Filter to only image files (skip MOV/MP4)
    const imagePhotos = photos.filter(p =>
      /\.(heic|jpg|jpeg|png)$/i.test(p.original_filename || p.filename || '')
    );

    if (imagePhotos.length === 0) {
      console.log('  No image files to upload (all videos?)');
      return { uploaded: 0, errors: 0 };
    }

    // Export all photos in batch
    const uuids = imagePhotos.map(p => p.uuid);
    console.log(`  Exporting ${uuids.length} photos...`);
    const ok = exportPhotosBatch(uuids, tmpExport);
    if (!ok) return { uploaded: 0, errors: uuids.length };

    // Convert HEIC → JPEG
    const count = convertDir(tmpExport, tmpJpeg);
    console.log(`  Converted ${count} images to JPEG`);

    // Build metadata map
    const metaMap = new Map();
    for (const p of imagePhotos) {
      const meta = {
        latitude: p.latitude || null,
        longitude: p.longitude || null,
        taken_at: p.date || null,
        location_name: null,
        exif_data: {
          ...(p.labels && { labels: p.labels }),
          ...(p.height && { height: p.height }),
          ...(p.width && { width: p.width }),
          ...(p.exif_info?.camera_make && { camera_make: p.exif_info.camera_make }),
          ...(p.exif_info?.camera_model && { camera_model: p.exif_info.camera_model }),
        },
      };
      const place = p.place || {};
      if (typeof place === 'string') meta.location_name = place;
      else if (place.address_str) meta.location_name = place.address_str;
      else if (place.name) meta.location_name = place.name;

      // Key by base name (without extension)
      const origFn = (p.original_filename || p.filename || '').replace(/\.[^.]+$/, '').toLowerCase();
      const fn = (p.filename || '').replace(/\.[^.]+$/, '').toLowerCase();
      metaMap.set(origFn, meta);
      if (fn !== origFn) metaMap.set(fn, meta);
    }

    // Check existing to skip dupes
    const { data: existing } = await supabase
      .from('vehicle_images')
      .select('file_name')
      .eq('vehicle_id', vehicleId)
      .eq('source', 'iphoto');
    const existingNames = new Set((existing || []).map(r => r.file_name));

    // Upload
    const files = readdirSync(tmpJpeg).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
    const toUpload = files.filter(f => !existingNames.has(f));
    console.log(`  Uploading ${toUpload.length} images (${files.length - toUpload.length} already exist)...`);

    let uploaded = 0, errors = 0, gpsCount = 0;
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
      const batch = toUpload.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (filename) => {
        const filePath = join(tmpJpeg, filename);
        const fileData = readFileSync(filePath);
        const fileSize = statSync(filePath).size;
        const storagePath = `${vehicleId}/iphoto/${filename}`;
        const mimeType = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';

        const { error: uploadError } = await withRetry(() =>
          supabase.storage.from(BUCKET).upload(storagePath, fileData, {
            contentType: mimeType, upsert: true
          }),
          filename
        );

        if (uploadError) { errors++; return; }

        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
        const baseFn = filename.replace(/\.[^.]+$/, '').toLowerCase();
        const meta = metaMap.get(baseFn) || {};
        if (meta.latitude) gpsCount++;

        const row = {
          vehicle_id: vehicleId,
          image_url: publicUrl,
          storage_path: storagePath,
          source: 'iphoto',
          mime_type: mimeType,
          file_name: filename,
          file_size: fileSize,
          is_external: false,
          ai_processing_status: 'pending',
          documented_by_user_id: USER_ID,
          ...(meta.latitude != null && { latitude: meta.latitude }),
          ...(meta.longitude != null && { longitude: meta.longitude }),
          ...(meta.location_name && { location_name: meta.location_name }),
          ...(meta.taken_at && { taken_at: meta.taken_at }),
          ...(meta.exif_data && { exif_data: meta.exif_data }),
        };

        const { error: insertError } = await supabase.from('vehicle_images').insert(row);
        if (insertError && !insertError.message?.includes('duplicate') && !insertError.message?.includes('unique')) {
          errors++;
        } else {
          uploaded++;
        }
      }));
      process.stdout.write(`\r  ${Math.min(i + BATCH_SIZE, toUpload.length)}/${toUpload.length} (${uploaded} new, ${gpsCount} GPS, ${errors} err)  `);
    }
    process.stdout.write('\n');
    return { uploaded, errors };

  } finally {
    try { rmSync(tmpExport, { recursive: true, force: true }); } catch {}
    try { rmSync(tmpJpeg, { recursive: true, force: true }); } catch {}
  }
}

// ─── Vehicle lookup by known IDs ────────────────────────────────────────────
// These are the user's actively-worked-on vehicles
const WORK_VEHICLES = {
  'white_k10_swb_viva': {
    id: '6442df03-9cac-43a8-b89e-e4fb4c08ee99',
    label: '1984 Chevrolet K10 SWB (Viva Las Vegas)',
    year: 1984, make: 'Chevrolet', model: 'K10 SWB',
    color: 'white', shop: 'Viva Las Vegas Autos'
  },
  'red_c10_ernies': {
    id: '48875fce-7b71-48f5-ac36-bcaf12f50fd0',
    label: '1966 Chevrolet C10 (Ernie\'s)',
    year: 1966, make: 'Chevrolet', model: 'C10 SWB',
    color: 'red', shop: "Ernie's Upholstery"
  },
  'sierra_classic_83': {
    id: 'a90c008a-3379-41d8-9eb2-b4eda365d74c',
    label: '1983 GMC K2500 Sierra Classic',
    year: 1983, make: 'GMC', model: 'K2500 Sierra Classic',
    color: null, shop: null
  },
  // Karmann Ghia - need to find or create the right vehicle_id
  'karmann_ghia_ernies': {
    id: null, // Will be resolved on first run
    label: 'Volkswagen Karmann Ghia (Ernie\'s client)',
    year: null, make: 'Volkswagen', model: 'Karmann Ghia',
    color: null, shop: "Ernie's Upholstery"
  }
};

// ─── AI vehicle classifier (uses Ollama local vision) ───────────────────────
async function classifyPhotoVehicle(imagePath, knownVehicles) {
  // Use Ollama llama3.2-vision for local, free classification
  const vehicleList = Object.values(knownVehicles)
    .filter(v => v.id)
    .map(v => `- ${v.label} (${v.color || 'unknown color'})`)
    .join('\n');

  const prompt = `Look at this vehicle photo. Which of these specific vehicles is shown?

${vehicleList}

Reply with ONLY the vehicle label from the list above, or "UNKNOWN" if you can't determine which vehicle it is. Focus on body style, color, era, and distinguishing features.`;

  try {
    const result = spawnSync('ollama', ['run', 'llama3.2-vision:11b', '--format', 'json',
      prompt, imagePath
    ], { encoding: 'utf8', stdio: 'pipe', timeout: 30000 });

    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
  } catch {}
  return 'UNKNOWN';
}

// ─── Main: single run ───────────────────────────────────────────────────────
async function run() {
  const state = loadState();
  const processedSet = new Set(state.processed_uuids);

  // Query recent vehicle photos
  const photos = queryRecentPhotos();
  if (photos.length === 0) {
    console.log('No new vehicle photos found.');
    return;
  }

  // Filter out already-processed
  const newPhotos = photos.filter(p => !processedSet.has(p.uuid));
  console.log(`${newPhotos.length} new photos to process (${photos.length - newPhotos.length} already ingested)`);

  if (newPhotos.length === 0) return;

  // Cluster into work sessions
  const sessions = clusterIntoSessions(newPhotos);
  console.log(`\nDetected ${sessions.length} work session(s):\n`);

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const dateRange = s.start.slice(0, 10) === s.end.slice(0, 10)
      ? `${s.start.slice(0, 10)} ${s.start.slice(11, 16)}-${s.end.slice(11, 16)}`
      : `${s.start.slice(0, 16)} to ${s.end.slice(0, 16)}`;
    const gps = s.lat ? `GPS: ${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : 'no GPS';
    const shop = s.shop ? s.shop.name : 'unknown location';
    const imgCount = s.photos.filter(p => /\.(heic|jpg|jpeg|png)$/i.test(p.original_filename || p.filename || '')).length;
    const vidCount = s.photos.length - imgCount;

    console.log(`  Session ${i + 1}: ${dateRange}`);
    console.log(`    ${imgCount} images${vidCount > 0 ? `, ${vidCount} videos` : ''} | ${gps} | ${shop}`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would process the above sessions. Run without --dry-run to ingest.');
    return;
  }

  // For now, use a simple approach: upload all photos to a "work session" staging area
  // grouped by the nearest known shop/vehicle. Photos at the same GPS cluster go to
  // the same vehicle. For ambiguous cases, we default to the Sierra Classic (most active).
  console.log('\n--- Ingesting photos ---\n');

  let totalUploaded = 0;
  let totalErrors = 0;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const shop = session.shop;

    // Determine target vehicle based on location
    let targetVehicle = null;

    if (shop?.name === 'Viva Las Vegas Autos') {
      // Could be the white K10 or the Sierra Classic - default to most recent
      targetVehicle = WORK_VEHICLES.white_k10_swb_viva;
    } else if (shop?.name === "Ernie's Upholstery") {
      targetVehicle = WORK_VEHICLES.red_c10_ernies;
    }

    // Default: Sierra Classic (your client's truck, most actively worked on)
    if (!targetVehicle) {
      targetVehicle = WORK_VEHICLES.sierra_classic_83;
    }

    console.log(`Session ${i + 1} → ${targetVehicle.label} (${targetVehicle.id})`);

    const result = await uploadWorkPhotos(session.photos, targetVehicle.id);
    totalUploaded += result.uploaded;
    totalErrors += result.errors;

    // Mark as processed
    for (const p of session.photos) {
      processedSet.add(p.uuid);
    }
  }

  // Save state
  state.processed_uuids = [...processedSet];
  state.last_run = new Date().toISOString();
  saveState(state);

  console.log(`\nDone: ${totalUploaded} photos uploaded, ${totalErrors} errors`);
  console.log(`State saved to ${STATE_FILE}`);
}

// ─── Watch mode (daemon) ────────────────────────────────────────────────────
async function watchMode() {
  const INTERVAL = 5 * 60 * 1000; // 5 minutes
  console.log('Watch mode: checking for new photos every 5 minutes...');
  console.log('(Press Ctrl+C to stop)\n');

  while (true) {
    try {
      await run();
    } catch (e) {
      console.error(`Error during run: ${e.message}`);
    }
    console.log(`\nNext check at ${new Date(Date.now() + INTERVAL).toLocaleTimeString()}\n`);
    await new Promise(r => setTimeout(r, INTERVAL));
  }
}

// ─── Entry ──────────────────────────────────────────────────────────────────
if (WATCH) {
  watchMode();
} else {
  run().catch(e => { console.error(e); process.exit(1); });
}
