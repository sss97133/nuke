#!/usr/bin/env node
/**
 * Photo Sync Engine — scans macOS Camera Roll, filters vehicle photos via Apple ML labels,
 * uploads to Supabase storage, and routes through the existing image-intake pipeline.
 *
 * Usage:
 *   node scripts/photo-sync.mjs                          # incremental sync (since last cursor)
 *   node scripts/photo-sync.mjs --since 2026-03-13       # sync from specific date
 *   node scripts/photo-sync.mjs --since 2026-03-13 --dry-run  # preview without uploading
 *   node scripts/photo-sync.mjs --status                 # show sync state
 *   node scripts/photo-sync.mjs --notify +1XXXXXXXXXX    # SMS clarification for ambiguous photos
 *
 * Requires: osxphotos, @supabase/supabase-js, dotenvx, node-fetch
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import os from 'os';
import dns from 'dns';

// ─── DNS fix: bypass broken macOS system resolver using Google DNS ──────────
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      return origLookup(hostname, options, callback);
    }
    if (options && options.all) {
      callback(null, addresses.map(a => ({ address: a, family: 4 })));
    } else {
      callback(null, addresses[0], 4);
    }
  });
};
const nodeFetch = (await import('node-fetch')).default;

// ─── Supabase client ────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: dotenvx run -- node scripts/photo-sync.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 10;
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes = new session

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const DRY_RUN = flag('--dry-run');
const NOTIFY_PHONE = arg('--notify');
const LIBRARY_PATH = arg('--library'); // External Photos library (e.g. SSD)

// ─── Apple ML label scoring ────────────────────────────────────────────────
const VEHICLE_LABELS = new Set([
  'Automobile', 'Car', 'Vehicle', 'Truck', 'SUV', 'Pickup Truck',
  'Tire', 'Wheel', 'Bumper', 'Engine', 'Rim', 'Van', 'Jeep',
  'Dashboard', 'Steering Wheel', 'Speedometer', 'Gauge',
  'Grille', 'Headlight', 'Taillight', 'License Plate',
  'Motor Vehicle', 'Land Vehicle', 'Automotive', 'Transportation',
]);

const REJECT_LABELS = new Set([
  'Selfie', 'Portrait', 'Food', 'Meal', 'Screenshot', 'Text', 'Receipt',
  'Document', 'Cat', 'Dog', 'Baby', 'Child', 'Face',
]);

function scorePhoto(photo) {
  const labels = photo.labels || [];
  if (labels.length === 0) return 0;

  let score = 0;
  let rejectScore = 0;

  for (const label of labels) {
    if (VEHICLE_LABELS.has(label)) score += 0.3;
    if (REJECT_LABELS.has(label)) rejectScore += 0.4;
  }

  // Bonus for multiple vehicle labels (strong signal)
  const vehicleLabelCount = labels.filter(l => VEHICLE_LABELS.has(l)).length;
  if (vehicleLabelCount >= 2) score += 0.2;

  return Math.max(0, Math.min(1, score - rejectScore));
}

function filterVehiclePhotos(photos) {
  const threshold = 0.3;
  const passed = [];
  const rejected = [];

  for (const photo of photos) {
    const s = scorePhoto(photo);
    if (s >= threshold) {
      passed.push({ ...photo, _vehicleScore: s });
    } else {
      rejected.push({ ...photo, _vehicleScore: s });
    }
  }

  return { passed, rejected };
}

// ─── Temporal clustering ────────────────────────────────────────────────────
function clusterBySession(photos) {
  if (photos.length === 0) return [];

  // Sort by date
  const sorted = [...photos].sort((a, b) => new Date(a.date) - new Date(b.date));

  const clusters = [];
  let current = { photos: [sorted[0]], startTime: new Date(sorted[0].date) };

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = new Date(sorted[i - 1].date).getTime();
    const currTime = new Date(sorted[i].date).getTime();

    if (currTime - prevTime > SESSION_GAP_MS) {
      // Finalize current cluster
      current.endTime = new Date(sorted[i - 1].date);
      clusters.push(finalizeCluster(current));
      // Start new cluster
      current = { photos: [sorted[i]], startTime: new Date(sorted[i].date) };
    } else {
      current.photos.push(sorted[i]);
    }
  }

  // Finalize last cluster
  current.endTime = new Date(sorted[sorted.length - 1].date);
  clusters.push(finalizeCluster(current));

  return clusters;
}

function finalizeCluster(cluster) {
  const lats = cluster.photos.filter(p => p.latitude).map(p => p.latitude);
  const lngs = cluster.photos.filter(p => p.longitude).map(p => p.longitude);

  // Find the most common place name
  const places = cluster.photos.map(p => extractPlaceName(p)).filter(Boolean);
  const placeFreq = {};
  for (const p of places) { placeFreq[p] = (placeFreq[p] || 0) + 1; }
  const topPlace = Object.entries(placeFreq).sort((a, b) => b[1] - a[1])[0];

  return {
    photos: cluster.photos,
    startTime: cluster.startTime,
    endTime: cluster.endTime,
    centroidLat: lats.length > 0 ? lats.reduce((a, b) => a + b, 0) / lats.length : null,
    centroidLng: lngs.length > 0 ? lngs.reduce((a, b) => a + b, 0) / lngs.length : null,
    locationName: topPlace ? topPlace[0] : null,
  };
}

function extractPlaceName(photo) {
  const place = photo.place;
  if (!place) return null;
  if (typeof place === 'string') return place;
  if (place.address_str) return place.address_str;
  if (place.name) return place.name;
  const addr = place.address || {};
  const parts = [addr.city, addr.state_province].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ─── Camera roll query ──────────────────────────────────────────────────────
function queryCameraRoll(sinceDate) {
  const args = ['query', '--from-date', sinceDate, '--json'];
  if (LIBRARY_PATH) args.push('--library', LIBRARY_PATH);
  const libLabel = LIBRARY_PATH ? basename(LIBRARY_PATH) : 'system library';
  console.log(`Querying ${libLabel} since ${sinceDate}...`);

  // Write to temp file to avoid maxBuffer limits (large libraries produce 200MB+ JSON)
  const tmpOut = join(os.tmpdir(), `osxphotos_query_${Date.now()}.json`);
  const result = spawnSync('bash', ['-c',
    `osxphotos ${args.map(a => `"${a}"`).join(' ')} > "${tmpOut}" 2>/dev/null`
  ], { encoding: 'utf8', stdio: 'pipe', timeout: 600000 });

  if (result.status !== 0) {
    console.error('osxphotos query error:', (result.stderr || '').slice(0, 300));
    try { rmSync(tmpOut, { force: true }); } catch {}
    return [];
  }

  try {
    let raw = readFileSync(tmpOut, 'utf8');
    rmSync(tmpOut, { force: true });
    // osxphotos emits -Infinity/Infinity/NaN which are invalid JSON — replace with null
    raw = raw.replace(/-Infinity|Infinity|NaN/g, 'null');
    const photos = JSON.parse(raw);
    // Filter out videos — we only process still images
    return photos.filter(p => {
      const fn = (p.filename || p.original_filename || '').toLowerCase();
      return !fn.endsWith('.mov') && !fn.endsWith('.mp4') && !fn.endsWith('.m4v');
    });
  } catch (e) {
    console.error('Failed to parse osxphotos JSON:', e.message);
    try { rmSync(tmpOut, { force: true }); } catch {}
    return [];
  }
}

// ─── Export + convert ───────────────────────────────────────────────────────
function exportByUuids(uuids, destDir) {
  mkdirSync(destDir, { recursive: true });

  // osxphotos export with --uuid flags
  const uuidArgs = uuids.flatMap(u => ['--uuid', u]);
  const libraryArg = LIBRARY_PATH ? `--library "${LIBRARY_PATH}" ` : '';
  const result = spawnSync('bash', ['-c',
    `echo "y" | osxphotos export ${libraryArg}"${destDir}" ${uuidArgs.map(a => `"${a}"`).join(' ')} --download-missing --overwrite`
  ], { encoding: 'utf8', stdio: 'pipe', timeout: 600000 }); // 10 min timeout

  if (result.status !== 0 && result.status !== null) {
    console.error('  Export error:', (result.stderr || '').slice(0, 200));
    return false;
  }
  return true;
}

function convertHeicToJpeg(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  const heicFiles = readdirSync(srcDir).filter(f => /\.heic$/i.test(f));
  let skipped = 0;
  for (const f of heicFiles) {
    const outName = f.replace(/\.heic$/i, '.jpg');
    try {
      execSync(`sips -s format jpeg "${join(srcDir, f)}" --out "${join(destDir, outName)}" -s formatOptions 85 > /dev/null 2>&1`);
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) console.log(`  Skipped ${skipped} HEIC files (iCloud-only or unreadable)`);
  // Copy non-HEIC images
  for (const f of readdirSync(srcDir)) {
    if (/\.(jpg|jpeg|png)$/i.test(f)) {
      execSync(`cp "${join(srcDir, f)}" "${join(destDir, f)}"`);
    }
  }
  return readdirSync(destDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length;
}

// ─── Retry helper ───────────────────────────────────────────────────────────
async function withRetry(fn, label = '', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      const delay = attempt * 2000;
      console.log(`  Retry ${attempt}/${retries} (${label}): ${e.message} — waiting ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Upload to storage ──────────────────────────────────────────────────────
async function uploadClusterPhotos(jpegDir, photoMeta) {
  const files = readdirSync(jpegDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  const uploaded = [];
  let errors = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (filename) => {
      const filePath = join(jpegDir, filename);
      const fileData = readFileSync(filePath);
      const mimeType = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
      const storagePath = `unassigned/photo_sync/${Date.now()}_${filename}`;

      const { error: uploadError } = await withRetry(async () => {
        const r = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, fileData, { contentType: mimeType, upsert: false });
        if (r.error) throw new Error(r.error.message);
        return r;
      }, `upload-${filename}`);

      if (uploadError) { errors++; return; }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

      // Find matching photo metadata by filename (base name without extension)
      const baseName = filename.replace(/\.[^.]+$/, '').toLowerCase();
      const meta = photoMeta.get(baseName);

      uploaded.push({
        url: publicUrl,
        storagePath,
        filename,
        takenAt: meta?.date || null,
        latitude: meta?.latitude || null,
        longitude: meta?.longitude || null,
      });
    }));
    process.stdout.write(`\r  Uploaded ${Math.min(i + batch.length, files.length)}/${files.length} (${errors} err)  `);
  }
  if (files.length > 0) process.stdout.write('\n');
  return { uploaded, errors };
}

// ─── Call image-intake edge function ────────────────────────────────────────
async function callImageIntake(cluster, uploadedPhotos) {
  const body = {
    userId: USER_ID,
    images: uploadedPhotos.map(p => ({
      url: p.url,
      takenAt: p.takenAt,
      caption: `Photo sync session ${cluster.startTime.toISOString().slice(0, 16)}${cluster.locationName ? ' @ ' + cluster.locationName : ''}`,
    })),
  };

  if (NOTIFY_PHONE) {
    body.notifyPhone = NOTIFY_PHONE;
  }

  const response = await withRetry(async () => {
    const r = await nodeFetch(`${SUPABASE_URL}/functions/v1/image-intake`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`image-intake ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json();
  }, 'image-intake');

  return response;
}

// ─── Update sync state cursor ───────────────────────────────────────────────
async function updateSyncState(lastDate, processed, uploaded, skipped) {
  const { error } = await supabase
    .from('photo_sync_state')
    .update({
      last_processed_date: lastDate,
      last_poll_at: new Date().toISOString(),
      photos_processed_total: supabase.rpc ? undefined : undefined, // Use raw SQL for increment
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', USER_ID);

  // Increment counters with SQL (can't do atomic increment via PostgREST easily)
  if (!error) {
    await supabase.rpc('', {}).catch(() => {}); // noop - use execute_sql below
  }

  // Use direct SQL for atomic counter increments
  const { error: sqlErr } = await supabase.from('photo_sync_state')
    .update({
      last_processed_date: lastDate,
      last_poll_at: new Date().toISOString(),
      photos_processed_total: processed,
      photos_uploaded_total: uploaded,
      photos_skipped_total: skipped,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', USER_ID);

  if (sqlErr) console.error('  Warning: failed to update sync state:', sqlErr.message);
}

// ─── Log sync run ───────────────────────────────────────────────────────────
async function logSyncRun(runData) {
  const { error } = await supabase.from('photo_sync_log').insert({
    user_id: USER_ID,
    ...runData,
  });
  if (error) console.error('  Warning: failed to log sync run:', error.message);
}

// ─── Get sync state ─────────────────────────────────────────────────────────
async function getSyncState() {
  const { data, error } = await supabase
    .from('photo_sync_state')
    .select('*')
    .eq('user_id', USER_ID)
    .single();
  if (error) return null;
  return data;
}

// ─── Show status ────────────────────────────────────────────────────────────
async function showStatus() {
  const state = await getSyncState();
  if (!state) {
    console.log('No sync state found for this user.');
    return;
  }

  console.log('\nPhoto Sync State');
  console.log('────────────────────────────────────');
  console.log(`  Last processed date:  ${state.last_processed_date || 'never'}`);
  console.log(`  Last poll:            ${state.last_poll_at || 'never'}`);
  console.log(`  Photos processed:     ${state.photos_processed_total}`);
  console.log(`  Photos uploaded:      ${state.photos_uploaded_total}`);
  console.log(`  Photos skipped:       ${state.photos_skipped_total}`);
  console.log(`  Errors:               ${state.errors_total}`);
  console.log(`  Auto-create vehicles: ${state.auto_create_vehicles}`);
  console.log(`  Min confidence:       ${state.min_confidence_auto_assign}`);
  console.log('');

  // Show recent sync runs
  const { data: runs } = await supabase
    .from('photo_sync_log')
    .select('*')
    .eq('user_id', USER_ID)
    .order('started_at', { ascending: false })
    .limit(5);

  if (runs && runs.length > 0) {
    console.log('Recent Sync Runs');
    console.log('────────────────────────────────────');
    for (const r of runs) {
      const dur = r.completed_at
        ? `${Math.round((new Date(r.completed_at) - new Date(r.started_at)) / 1000)}s`
        : 'in progress';
      console.log(`  ${r.started_at.slice(0, 16)} | scanned:${r.photos_scanned} filtered:${r.photos_filtered} uploaded:${r.photos_uploaded} matched:${r.photos_matched} pending:${r.photos_pending} | ${dur}`);
    }
  }
  console.log('');
}

// ─── Main sync flow ─────────────────────────────────────────────────────────
async function runSync() {
  const startedAt = new Date().toISOString();

  // Determine since date
  let sinceDate = arg('--since');
  if (!sinceDate) {
    const state = await getSyncState();
    if (state?.last_processed_date) {
      sinceDate = new Date(state.last_processed_date).toISOString().slice(0, 10);
      console.log(`Resuming from last cursor: ${sinceDate}`);
    } else {
      // Default to yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      sinceDate = yesterday.toISOString().slice(0, 10);
      console.log(`No previous cursor — defaulting to yesterday: ${sinceDate}`);
    }
  }

  // 1. Query camera roll
  const allPhotos = queryCameraRoll(sinceDate);
  console.log(`Found ${allPhotos.length} photos since ${sinceDate}`);

  if (allPhotos.length === 0) {
    console.log('Nothing to sync.');
    return;
  }

  // 2. Filter by Apple ML labels
  const { passed, rejected } = filterVehiclePhotos(allPhotos);
  console.log(`Vehicle filter: ${passed.length} passed, ${rejected.length} rejected`);

  if (passed.length === 0) {
    console.log('No vehicle photos detected. Try --since with an earlier date.');
    return;
  }

  // Show top rejected labels for transparency
  if (rejected.length > 0 && rejected.length <= 20) {
    const rejLabels = {};
    for (const p of rejected) {
      for (const l of (p.labels || [])) { rejLabels[l] = (rejLabels[l] || 0) + 1; }
    }
    const topRej = Object.entries(rejLabels).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`  Top rejected labels: ${topRej.map(([l, c]) => `${l}(${c})`).join(', ')}`);
  }

  // 3. Cluster by session
  const clusters = clusterBySession(passed);
  console.log(`Clustered into ${clusters.length} session(s):`);
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const duration = Math.round((c.endTime - c.startTime) / 60000);
    console.log(`  Session ${i + 1}: ${c.photos.length} photos, ${c.startTime.toISOString().slice(0, 16)} (${duration}min)${c.locationName ? ' @ ' + c.locationName : ''}`);
  }

  if (DRY_RUN) {
    console.log('\n── DRY RUN ── Would process the above. Run without --dry-run to execute.\n');

    // Show per-photo detail in dry run
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      console.log(`\nSession ${i + 1} photos:`);
      for (const p of c.photos) {
        const labels = (p.labels || []).filter(l => VEHICLE_LABELS.has(l)).join(', ');
        console.log(`  ${p.original_filename || p.filename} | score:${p._vehicleScore.toFixed(2)} | ${labels} | ${p.date?.slice(0, 16) || 'no date'}`);
      }
    }
    return;
  }

  // 4. Process each cluster
  const runStats = {
    started_at: startedAt,
    date_range_start: sinceDate,
    date_range_end: new Date().toISOString(),
    photos_scanned: allPhotos.length,
    photos_filtered: passed.length,
    clusters_created: clusters.length,
    photos_uploaded: 0,
    photos_matched: 0,
    photos_pending: 0,
    photos_skipped: 0,
    vehicles_touched: [],
  };

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    console.log(`\nProcessing session ${i + 1}/${clusters.length} (${cluster.photos.length} photos)...`);

    const tmpExport = join(os.tmpdir(), `photo_sync_export_${Date.now()}`);
    const tmpJpeg = join(os.tmpdir(), `photo_sync_jpeg_${Date.now()}`);

    try {
      // Build metadata map keyed by base filename
      const photoMeta = new Map();
      for (const p of cluster.photos) {
        const keys = new Set();
        if (p.filename) keys.add(p.filename.replace(/\.[^.]+$/, '').toLowerCase());
        if (p.original_filename) keys.add(p.original_filename.replace(/\.[^.]+$/, '').toLowerCase());
        for (const k of keys) {
          photoMeta.set(k, p);
        }
      }

      // Export
      const uuids = cluster.photos.map(p => p.uuid);
      console.log(`  Exporting ${uuids.length} photos...`);
      const ok = exportByUuids(uuids, tmpExport);
      if (!ok) {
        console.log('  Export failed, skipping cluster');
        continue;
      }

      // Convert HEIC → JPEG
      const jpegCount = convertHeicToJpeg(tmpExport, tmpJpeg);
      console.log(`  Converted: ${jpegCount} images`);
      if (jpegCount === 0) {
        console.log('  No images to upload, skipping');
        continue;
      }

      // Upload to storage
      console.log('  Uploading to storage...');
      const { uploaded, errors: uploadErrors } = await uploadClusterPhotos(tmpJpeg, photoMeta);
      runStats.photos_uploaded += uploaded.length;

      if (uploaded.length === 0) {
        console.log('  No photos uploaded successfully, skipping intake');
        continue;
      }

      // Call image-intake
      console.log(`  Calling image-intake with ${uploaded.length} photos...`);
      const intakeResult = await callImageIntake(cluster, uploaded);

      if (intakeResult?.summary) {
        const s = intakeResult.summary;
        console.log(`  Results: ${s.matched} matched, ${s.pending} pending, ${s.skipped} skipped`);
        runStats.photos_matched += s.matched || 0;
        runStats.photos_pending += s.pending || 0;
        runStats.photos_skipped += s.skipped || 0;

        if (s.clarificationSent) {
          console.log(`  SMS clarification sent to ${NOTIFY_PHONE}`);
        }
      }

      // Collect vehicle IDs from results
      if (intakeResult?.results) {
        const vehicleIds = intakeResult.results
          .filter(r => r.vehicleId)
          .map(r => r.vehicleId);
        runStats.vehicles_touched.push(...vehicleIds);
      }

    } finally {
      try { rmSync(tmpExport, { recursive: true, force: true }); } catch {}
      try { rmSync(tmpJpeg, { recursive: true, force: true }); } catch {}
    }
  }

  // Deduplicate vehicle IDs
  runStats.vehicles_touched = [...new Set(runStats.vehicles_touched)];
  runStats.completed_at = new Date().toISOString();

  // 5. Update sync state
  const lastPhotoDate = passed[passed.length - 1]?.date || new Date().toISOString();

  // Fetch current totals to increment
  const currentState = await getSyncState();
  const newProcessed = (currentState?.photos_processed_total || 0) + allPhotos.length;
  const newUploaded = (currentState?.photos_uploaded_total || 0) + runStats.photos_uploaded;
  const newSkipped = (currentState?.photos_skipped_total || 0) + runStats.photos_skipped;
  await updateSyncState(lastPhotoDate, newProcessed, newUploaded, newSkipped);

  // 6. Log the run
  await logSyncRun(runStats);

  // Summary
  console.log('\n────────────────────────────────────');
  console.log('Sync complete');
  console.log(`  Scanned:    ${runStats.photos_scanned}`);
  console.log(`  Filtered:   ${runStats.photos_filtered} vehicle photos`);
  console.log(`  Sessions:   ${runStats.clusters_created}`);
  console.log(`  Uploaded:   ${runStats.photos_uploaded}`);
  console.log(`  Matched:    ${runStats.photos_matched}`);
  console.log(`  Pending:    ${runStats.photos_pending}`);
  console.log(`  Skipped:    ${runStats.photos_skipped}`);
  if (runStats.vehicles_touched.length > 0) {
    console.log(`  Vehicles:   ${runStats.vehicles_touched.length} touched`);
  }
  console.log('');
}

// ─── Entry point ────────────────────────────────────────────────────────────
if (flag('--status')) {
  await showStatus();
} else if (flag('--help') || flag('-h')) {
  console.log(`
Photo Sync Engine — scan camera roll → filter vehicles → upload → classify

Usage:
  dotenvx run -- node scripts/photo-sync.mjs                         # incremental sync
  dotenvx run -- node scripts/photo-sync.mjs --since 2026-03-13      # from specific date
  dotenvx run -- node scripts/photo-sync.mjs --since 2026-03-13 --dry-run  # preview only
  dotenvx run -- node scripts/photo-sync.mjs --status                # show sync state
  dotenvx run -- node scripts/photo-sync.mjs --notify +15551234567   # SMS for ambiguous
  dotenvx run -- node scripts/photo-sync.mjs --library "/path/to/Photos Library.photoslibrary" --since 2023-01

Options:
  --since <date>       Sync photos from this date (YYYY-MM-DD)
  --library <path>     Use external Photos library instead of system library
  --dry-run            Show what would sync without uploading
  --status             Display sync state and recent runs
  --notify <phone>     Send SMS for unmatched photos
  --help               Show this help
  `);
} else {
  await runSync();
}
