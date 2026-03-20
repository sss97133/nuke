#!/usr/bin/env node
/**
 * iPhoto / Apple Photos intake for Nuke vehicle data platform
 *
 * Usage:
 *   node scripts/iphoto-intake.mjs --list                          # list all vehicle albums
 *   node scripts/iphoto-intake.mjs --album "1977 K5 Chevrolet Blazer"
 *   node scripts/iphoto-intake.mjs --vehicle-id <uuid> --album "..."
 *   node scripts/iphoto-intake.mjs --all                           # process all unmatched albums
 *
 * Requires: osxphotos, @supabase/supabase-js, dotenvx
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'fs';
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
// Use node-fetch (respects dns.lookup) instead of built-in fetch (undici, doesn't)
const nodeFetch = (await import('node-fetch')).default;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});
const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 10;
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // skylar's user_id

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

// ─── Album enumeration ───────────────────────────────────────────────────────

function listAlbums() {
  const raw = execSync('osxphotos albums 2>/dev/null', { encoding: 'utf8' });
  const albums = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^  '?([\d].*?)'?\s*:\s*(\d+)/);
    if (m) {
      const name = m[1].trim();
      const count = parseInt(m[2]);
      // Only vehicle-ish albums: starts with a year
      if (/^\d{4}\s/.test(name) && count > 0) {
        albums.push({ name, count });
      }
    }
  }
  return albums;
}

function parseAlbumName(name) {
  // Patterns:
  //   "1984 Chevrolet K20 LWB"  → year=1984, make=Chevrolet, model=K20
  //   "1977 K5 Chevrolet Blazer" → year=1977, make=Chevrolet, model=K5 Blazer
  //   "1972 K10 Chevrolet SWB"   → year=1972, make=Chevrolet, model=K10 SWB
  const yearMatch = name.match(/^(\d{4})\s+(.+)$/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[1]);
  const rest = yearMatch[2].trim();

  const MAKES = ['Chevrolet', 'GMC', 'Ford', 'Dodge', 'Pontiac', 'Jaguar', 'Porsche',
    'Ferrari', 'Mercedes', 'Nissan', 'Lexus', 'Lincoln', 'Buick', 'DMC', 'DeLorean'];

  let make = null;
  let modelParts = rest.split(' ');
  for (const m of MAKES) {
    const idx = modelParts.findIndex(p => p.toLowerCase() === m.toLowerCase());
    if (idx !== -1) {
      make = m;
      modelParts.splice(idx, 1);
      break;
    }
  }
  if (!make) {
    // First word might be model series (K5, C10, etc.), second might be make
    make = 'Unknown';
  }
  const model = modelParts.join(' ').replace(/\s+/g, ' ').trim();
  return { year, make, model };
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

// ─── Vehicle cache (pre-loaded at startup to avoid per-album DNS failures) ──

let vehicleCache = null; // Array of {id, year, make, model, vin}

async function loadVehicleCache(albums = null) {
  if (vehicleCache) return;
  console.log('Loading vehicle cache...');

  // STRATEGY: Load vehicles that already have iphoto records (from --map-only run).
  // These are the user's actual vehicles — much more accurate than searching 1.2M vehicles.
  const iphotoVehicleIds = new Set();
  let offset = 0;
  while (true) {
    const { data } = await withRetry(async () => {
      const r = await supabase.from('vehicle_images')
        .select('vehicle_id')
        .eq('source', 'iphoto')
        .range(offset, offset + 999);
      if (r.error) throw new Error(r.error.message);
      return r;
    }, 'iphoto-vehicles');
    if (!data || data.length === 0) break;
    for (const d of data) iphotoVehicleIds.add(d.vehicle_id);
    if (data.length < 1000) break;
    offset += 1000;
  }

  // Fetch full details for those vehicles
  vehicleCache = [];
  const ids = [...iphotoVehicleIds];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const { data } = await withRetry(async () => {
      const r = await supabase.from('vehicles')
        .select('id, year, make, model, vin')
        .in('id', batch);
      if (r.error) throw new Error(r.error.message);
      return r;
    }, 'vehicle-details');
    if (data) vehicleCache.push(...data);
  }

  console.log(`  Cached ${vehicleCache.length} vehicles (user's iphoto-linked vehicles)`);
}

function findVehicleCached(year, make, model) {
  const modelFirst = model.split(' ')[0].toLowerCase();
  const makeLower = make.toLowerCase();
  const matches = vehicleCache.filter(v =>
    v.year === year &&
    v.make?.toLowerCase().includes(makeLower) &&
    v.model?.toLowerCase().includes(modelFirst)
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.log(`  ⚠ AMBIGUOUS: ${matches.length} vehicles match "${year} ${make} ${model}":`);
    for (const m of matches) {
      console.log(`    - ${m.year} ${m.make} ${m.model} (${m.vin || 'no VIN'}) → ${m.id}`);
    }
    console.log(`  Skipping — use --vehicle-id <uuid> to specify which vehicle.`);
    return null;
  }
  return null;
}

async function findVehicle(year, make, model) {
  // Use cache if loaded (preferred — avoids DNS issues during long runs)
  if (vehicleCache) return findVehicleCached(year, make, model);

  // Fallback to live query
  const { data: exact } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .eq('year', year)
    .ilike('make', `%${make}%`)
    .ilike('model', `%${model.split(' ')[0]}%`)
    .limit(5);

  if (exact && exact.length === 1) return exact[0];
  if (exact && exact.length > 1) {
    console.log(`  ⚠ AMBIGUOUS: ${exact.length} vehicles match "${year} ${make} ${model}":`);
    for (const m of exact) {
      console.log(`    - ${m.year} ${m.make} ${m.model} (${m.vin || 'no VIN'}) → ${m.id}`);
    }
    console.log(`  Skipping — use --vehicle-id <uuid> to specify which vehicle.`);
    return null;
  }
  return null;
}

// ─── Photo metadata from osxphotos ──────────────────────────────────────────

function queryAlbumMetadata(albumName) {
  console.log(`  Querying osxphotos metadata for "${albumName}"...`);
  const result = spawnSync('osxphotos', [
    'query', '--album', albumName, '--json',
  ], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 });

  if (result.status !== 0) {
    console.error('  osxphotos query error:', result.stderr?.slice(0, 200));
    return new Map();
  }

  let photos;
  try {
    photos = JSON.parse(result.stdout);
  } catch (e) {
    console.error('  Failed to parse osxphotos JSON');
    return new Map();
  }

  // Build lookup by base filename (no extension) since HEIC→JPG conversion changes extension.
  // Map both `filename` (Photos library name, often UUID-based) and `original_filename`.
  const metaMap = new Map();
  let withGps = 0;
  for (const p of photos) {
    const meta = extractPhotoMeta(p);
    if (meta.latitude) withGps++;

    // Key by base name without extension (handles HEIC→JPG renaming)
    const keys = new Set();
    if (p.filename) keys.add(baseName(p.filename));
    if (p.original_filename) keys.add(baseName(p.original_filename));
    for (const k of keys) {
      metaMap.set(k, meta);
    }
  }
  console.log(`  Metadata: ${photos.length} photos, ${withGps} with GPS`);
  return metaMap;
}

function baseName(filename) {
  return filename.replace(/\.[^.]+$/, '').toLowerCase();
}

function extractPhotoMeta(p) {
  // osxphotos place is a nested object: { name, address_str, address: { city, state_province, street, ... } }
  const place = p.place || {};
  let locationName = null;
  if (typeof place === 'string') {
    locationName = place;
  } else if (place.address_str) {
    locationName = place.address_str;
  } else if (place.name) {
    locationName = place.name;
  } else {
    const addr = place.address || {};
    const parts = [addr.street, addr.city, addr.state_province, addr.country].filter(Boolean);
    if (parts.length > 0) locationName = parts.join(', ');
  }

  // Build EXIF-style metadata object
  const exifData = {};
  const exif = p.exif_info || {};
  if (exif.camera_make) exifData.camera_make = exif.camera_make;
  if (exif.camera_model) exifData.camera_model = exif.camera_model;
  if (exif.lens_model) exifData.lens_model = exif.lens_model;
  if (exif.focal_length) exifData.focal_length = exif.focal_length;
  if (exif.aperture) exifData.aperture = exif.aperture;
  if (exif.iso) exifData.iso = exif.iso;
  if (exif.shutter_speed) exifData.shutter_speed = exif.shutter_speed;
  if (exif.flash_fired != null) exifData.flash_fired = exif.flash_fired;
  // GPS data stored in exif for downstream processing
  if (p.latitude != null) exifData.location = { latitude: p.latitude, longitude: p.longitude };
  // Dimensions
  if (p.height) exifData.height = p.height;
  if (p.width) exifData.width = p.width;
  // osxphotos-specific enrichments
  if (p.score) exifData.score = p.score;
  if (p.labels) exifData.labels = p.labels;

  return {
    latitude: p.latitude || null,
    longitude: p.longitude || null,
    taken_at: p.date || null,
    location_name: locationName,
    exif_data: Object.keys(exifData).length > 0 ? exifData : null,
  };
}

// ─── Photo export ────────────────────────────────────────────────────────────

function exportAlbum(albumName, destDir, downloadFromICloud = false) {
  mkdirSync(destDir, { recursive: true });
  console.log(`  Exporting "${albumName}" → ${destDir}${downloadFromICloud ? ' (downloading from iCloud)' : ''}`);

  if (downloadFromICloud) {
    // Pipe "y" to handle the interactive "Do you want to continue?" prompt
    const result = spawnSync('bash', ['-c',
      `echo "y" | osxphotos export "${destDir}" --album "${albumName}" --download-missing --overwrite`
    ], { encoding: 'utf8', stdio: 'pipe', timeout: 1800000 }); // 30 min timeout per album
    if (result.status !== 0 && result.status !== null) {
      console.error('  Export error:', (result.stderr || '').slice(0, 200));
      return false;
    }
  } else {
    const result = spawnSync('osxphotos', [
      'export', destDir, '--album', albumName, '--overwrite',
    ], { encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0) {
      console.error('  Export error:', (result.stderr || '').slice(0, 200));
      return false;
    }
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
    } catch (e) {
      // File may be iCloud-only stub or corrupted — skip silently
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

// ─── Supabase upload ─────────────────────────────────────────────────────────

async function uploadPhotos(vehicleId, jpegDir, metaMap = new Map()) {
  const files = readdirSync(jpegDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  console.log(`  Uploading ${files.length} images for vehicle ${vehicleId}...`);

  // Check existing to skip dupes
  const { data: existing } = await supabase
    .from('vehicle_images')
    .select('file_name')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'iphoto');
  const existingNames = new Set((existing || []).map(r => r.file_name));

  const toUpload = files.filter(f => !existingNames.has(f));
  console.log(`  Skipping ${files.length - toUpload.length} already uploaded`);

  let uploaded = 0, errors = 0, gpsCount = 0;
  for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
    const batch = toUpload.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (filename) => {
      const filePath = join(jpegDir, filename);
      const fileData = readFileSync(filePath);
      const fileSize = statSync(filePath).size;
      const storagePath = `${vehicleId}/iphoto/${filename}`;
      const mimeType = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, fileData, { contentType: mimeType, upsert: true });

      if (uploadError) { errors++; return; }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

      // Look up GPS/EXIF metadata from osxphotos
      const meta = metaMap.get(baseName(filename)) || {};
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
        // GPS fields
        ...(meta.latitude != null && { latitude: meta.latitude }),
        ...(meta.longitude != null && { longitude: meta.longitude }),
        ...(meta.location_name && { location_name: meta.location_name }),
        // Temporal
        ...(meta.taken_at && { taken_at: meta.taken_at }),
        // EXIF blob
        ...(meta.exif_data && { exif_data: meta.exif_data }),
      };

      const { error: insertError } = await supabase.from('vehicle_images').insert(row);
      if (insertError && !insertError.message.includes('duplicate') && !insertError.message.includes('unique')) {
        errors++;
      } else {
        uploaded++;
      }
    }));
    process.stdout.write(`\r  ${i + batch.length}/${toUpload.length} (${uploaded} new, ${gpsCount} GPS, ${errors} err)  `);
  }
  process.stdout.write('\n');

  // Set primary if none exists
  const { count: primaryCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
    .eq('is_primary', true);

  if (!primaryCount) {
    const { data: first } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('source', 'iphoto')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (first) {
      await supabase.from('vehicle_images').update({ is_primary: true }).eq('id', first.id);
    }
  }

  return { uploaded, errors, total: files.length };
}

// ─── Vehicle/Album mismatch guard ────────────────────────────────────────────

async function validateVehicleAlbumMatch(vehicleId, albumName) {
  const parsed = parseAlbumName(albumName);
  if (!parsed) return; // Can't validate unparseable album names

  // Fetch the target vehicle
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .eq('id', vehicleId)
    .single();

  if (error || !vehicle) {
    console.error(`  ⚠ Vehicle ${vehicleId} not found in database!`);
    process.exit(1);
  }

  // Check year match
  if (vehicle.year && parsed.year !== vehicle.year) {
    console.error(`  ⚠ MISMATCH: Album year ${parsed.year} ≠ vehicle year ${vehicle.year}`);
    console.error(`    Album:   "${albumName}"`);
    console.error(`    Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vin || 'no VIN'})`);
    console.error(`    Pass --force to override this check.`);
    process.exit(1);
  }

  // Check model match (first word, case-insensitive)
  const albumModelFirst = parsed.model.split(' ')[0].toLowerCase();
  const vehicleModelFirst = (vehicle.model || '').split(' ')[0].toLowerCase();
  if (vehicleModelFirst && albumModelFirst !== vehicleModelFirst) {
    console.error(`  ⚠ MISMATCH: Album model "${parsed.model}" ≠ vehicle model "${vehicle.model}"`);
    console.error(`    Album:   "${albumName}" → ${parsed.year} ${parsed.make} ${parsed.model}`);
    console.error(`    Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vin || 'no VIN'})`);
    console.error(`    These look like different vehicles. Pass --force to override this check.`);
    process.exit(1);
  }

  console.log(`  ✓ Album matches vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.vin || 'no VIN'})`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function processAlbum(albumName, vehicleId = null) {
  console.log(`\nAlbum: "${albumName}"`);

  if (!vehicleId) {
    const parsed = parseAlbumName(albumName);
    if (!parsed) {
      console.log('  Could not parse album name, skipping');
      return null;
    }
    console.log(`  Parsed: ${parsed.year} ${parsed.make} ${parsed.model}`);
    const match = await findVehicle(parsed.year, parsed.make, parsed.model);
    if (!match) {
      console.log(`  No vehicle match found in DB — skipping (add vehicle first or pass --vehicle-id)`);
      return null;
    }
    vehicleId = match.id;
    console.log(`  Matched: ${match.year} ${match.make} ${match.model} (${match.vin || 'no VIN'}) → ${match.id}`);
  } else if (!flag('--force')) {
    // Explicit vehicle-id provided — validate it matches the album
    await validateVehicleAlbumMatch(vehicleId, albumName);
  }

  const tmpExport = join(os.tmpdir(), `iphoto_export_${Date.now()}`);
  const tmpJpeg = join(os.tmpdir(), `iphoto_jpeg_${Date.now()}`);

  try {
    // Query GPS + EXIF metadata from osxphotos BEFORE export
    const metaMap = queryAlbumMetadata(albumName);

    const ok = exportAlbum(albumName, tmpExport);
    if (!ok) return null;

    const count = convertHeicToJpeg(tmpExport, tmpJpeg);
    console.log(`  Converted: ${count} images`);

    const result = await uploadPhotos(vehicleId, tmpJpeg, metaMap);
    console.log(`  Done: ${result.uploaded} uploaded, ${result.errors} errors`);
    return result;
  } finally {
    try { rmSync(tmpExport, { recursive: true, force: true }); } catch {}
    try { rmSync(tmpJpeg, { recursive: true, force: true }); } catch {}
  }
}

// ─── GPS Backfill for existing images ────────────────────────────────────────

async function backfillAlbumGps(albumName, vehicleId = null) {
  console.log(`\nBackfill GPS: "${albumName}"`);

  if (!vehicleId) {
    const parsed = parseAlbumName(albumName);
    if (!parsed) { console.log('  Could not parse album name, skipping'); return 0; }
    const match = await findVehicle(parsed.year, parsed.make, parsed.model);
    if (!match) { console.log('  No vehicle match found in DB — skipping'); return 0; }
    vehicleId = match.id;
    console.log(`  Vehicle: ${match.year} ${match.make} ${match.model} → ${match.id}`);
  } else if (!flag('--force')) {
    await validateVehicleAlbumMatch(vehicleId, albumName);
  }

  // Get existing iphoto images missing GPS
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, file_name')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'iphoto')
    .is('latitude', null);

  if (error || !images?.length) {
    console.log(`  ${images?.length === 0 ? 'All images already have GPS' : 'Error fetching images'}`);
    return 0;
  }
  console.log(`  ${images.length} images missing GPS`);

  // Query osxphotos metadata
  const metaMap = queryAlbumMetadata(albumName);
  if (metaMap.size === 0) { console.log('  No metadata available'); return 0; }

  let updated = 0, noMatch = 0;
  for (const img of images) {
    const key = baseName(img.file_name);
    const meta = metaMap.get(key);
    if (!meta || meta.latitude == null) { noMatch++; continue; }

    const patch = {
      latitude: meta.latitude,
      longitude: meta.longitude,
      documented_by_user_id: USER_ID,
    };
    if (meta.location_name) patch.location_name = meta.location_name;
    if (meta.taken_at) patch.taken_at = meta.taken_at;
    if (meta.exif_data) patch.exif_data = meta.exif_data;

    const { error: upErr } = await supabase.from('vehicle_images').update(patch).eq('id', img.id);
    if (!upErr) updated++;
  }
  console.log(`  Updated ${updated}/${images.length} images with GPS (${noMatch} no metadata match)`);
  return updated;
}

// ─── Map-only mode (GPS metadata without image upload) ──────────────────────

async function mapOnlyAlbum(albumName, vehicleId = null) {
  console.log(`\nMap-only: "${albumName}"`);

  if (!vehicleId) {
    const parsed = parseAlbumName(albumName);
    if (!parsed) { console.log('  Could not parse album name, skipping'); return 0; }
    const match = await findVehicle(parsed.year, parsed.make, parsed.model);
    if (!match) { console.log('  No vehicle match in DB — skipping'); return 0; }
    vehicleId = match.id;
    console.log(`  Vehicle: ${match.year} ${match.make} ${match.model} → ${match.id}`);
  } else if (!flag('--force')) {
    await validateVehicleAlbumMatch(vehicleId, albumName);
  }

  const metaMap = queryAlbumMetadata(albumName);
  if (metaMap.size === 0) { console.log('  No metadata available'); return 0; }

  // Check existing iphoto images for this vehicle (to avoid dupes)
  const { data: existing } = await supabase
    .from('vehicle_images')
    .select('file_name')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'iphoto');
  const existingNames = new Set((existing || []).map(r => r.file_name));

  let inserted = 0, skipped = 0, noGps = 0;
  const mappings = [];
  // Deduplicate — metaMap has 2 keys per photo (filename + original_filename).
  // Track which meta objects we've already processed.
  const seenMeta = new WeakSet();

  for (const [key, meta] of metaMap.entries()) {
    if (seenMeta.has(meta)) continue;
    seenMeta.add(meta);
    if (!meta.latitude) { noGps++; continue; }

    // Use original-style filename (IMG_XXXX.jpg) for consistency
    const fileName = key + '.jpg';
    if (existingNames.has(fileName) || existingNames.has(key + '.JPG') || existingNames.has(key + '.heic')) {
      skipped++;
      continue;
    }

    const row = {
      file_name: fileName,
      latitude: meta.latitude,
      longitude: meta.longitude,
      ...(meta.location_name && { location_name: meta.location_name }),
      ...(meta.taken_at && { taken_at: meta.taken_at }),
      ...(meta.exif_data && { exif_data: meta.exif_data }),
    };

    mappings.push(row);
    inserted++;
  }

  // Write to local JSON file instead of DB (no more placeholder URLs)
  const mappingDir = join(process.cwd(), 'data', 'iphoto-mappings');
  if (!existsSync(mappingDir)) mkdirSync(mappingDir, { recursive: true });
  const mappingFile = join(mappingDir, `${vehicleId}.json`);

  // Merge with existing mappings if file already exists
  let savedMappings = [];
  if (existsSync(mappingFile)) {
    try { savedMappings = JSON.parse(readFileSync(mappingFile, 'utf8')); } catch {}
  }
  const existingFileNames = new Set(savedMappings.map(r => r.file_name));
  const newMappings = mappings.filter(r => !existingFileNames.has(r.file_name));
  const merged = [...savedMappings, ...newMappings];
  writeFileSync(mappingFile, JSON.stringify(merged, null, 2));

  console.log(`  Saved ${newMappings.length} photo mappings to ${mappingFile} (${skipped} dupe, ${noGps} no GPS)`);
  return newMappings.length;
}

// ─── Sync mode: download from iCloud → upload → replace placeholders ────────

async function syncAlbum(albumName, vehicleId = null) {
  console.log(`\nSync: "${albumName}"`);

  if (!vehicleId) {
    const parsed = parseAlbumName(albumName);
    if (!parsed) { console.log('  Could not parse album name, skipping'); return null; }
    const match = await findVehicle(parsed.year, parsed.make, parsed.model);
    if (!match) { console.log('  No vehicle match in DB — skipping'); return null; }
    vehicleId = match.id;
    console.log(`  Vehicle: ${match.year} ${match.make} ${match.model} → ${match.id}`);
  } else if (!flag('--force')) {
    await validateVehicleAlbumMatch(vehicleId, albumName);
  }

  const tmpExport = join(os.tmpdir(), `iphoto_sync_${Date.now()}`);
  const tmpJpeg = join(os.tmpdir(), `iphoto_jpeg_${Date.now()}`);

  try {
    // Query metadata BEFORE export
    const metaMap = queryAlbumMetadata(albumName);

    // Download from iCloud + export
    const ok = exportAlbum(albumName, tmpExport, true);
    if (!ok) return null;

    const count = convertHeicToJpeg(tmpExport, tmpJpeg);
    console.log(`  Converted: ${count} images`);
    if (count === 0) { console.log('  No images to upload'); return null; }

    // Load local JSON mappings if they exist (from --map-only)
    const localMappingFile = join(process.cwd(), 'data', 'iphoto-mappings', `${vehicleId}.json`);
    let localMappings = [];
    if (existsSync(localMappingFile)) {
      try { localMappings = JSON.parse(readFileSync(localMappingFile, 'utf8')); } catch {}
      console.log(`  Found ${localMappings.length} local mappings from --map-only`);
    }

    // Get existing placeholder records for this vehicle (to replace them)
    // Placeholders may be keyed by UUID filename or original filename — build a
    // reverse lookup from the osxphotos metadata that maps original→UUID and vice versa.
    const { data: placeholders } = await withRetry(async () => {
      const r = await supabase
        .from('vehicle_images')
        .select('id, file_name')
        .eq('vehicle_id', vehicleId)
        .eq('source', 'iphoto')
        .like('image_url', '%placeholder.nuke.app%');
      if (r.error) throw new Error(r.error.message);
      return r;
    }, 'placeholders');
    const placeholderById = new Map();
    for (const p of (placeholders || [])) {
      placeholderById.set(baseName(p.file_name), p.id);
    }
    // Also build mapping from original_filename → placeholder ID via metaMap's dual keys
    // metaMap has entries for both UUID filename and original filename pointing to same meta.
    // Placeholders were keyed by whichever came first. We need to find the placeholder for
    // each exported file (which uses original_filename like IMG_XXXX).
    const placeholderMap = new Map(placeholderById);
    // Walk the metaMap to find UUID↔original pairs
    const metaToKeys = new Map();
    for (const [key, meta] of metaMap.entries()) {
      if (!metaToKeys.has(meta)) metaToKeys.set(meta, []);
      metaToKeys.get(meta).push(key);
    }
    for (const [_meta, keys] of metaToKeys.entries()) {
      // Find which key has a placeholder
      let phId = null;
      for (const k of keys) { phId = placeholderById.get(k); if (phId) break; }
      // Map ALL keys to that placeholder ID
      if (phId) { for (const k of keys) placeholderMap.set(k, phId); }
    }

    // Get existing real images (skip these)
    const { data: realExisting } = await withRetry(async () => {
      const r = await supabase
        .from('vehicle_images')
        .select('file_name')
        .eq('vehicle_id', vehicleId)
        .eq('source', 'iphoto')
        .like('image_url', '%supabase.co/storage%');
      if (r.error) throw new Error(r.error.message);
      return r;
    }, 'real-images');
    const realNames = new Set((realExisting || []).map(r => r.file_name));

    const files = readdirSync(tmpJpeg).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
    let uploaded = 0, replaced = 0, skipped = 0, errors = 0;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (filename) => {
        // Skip if already have a real image for this file
        if (realNames.has(filename)) { skipped++; return; }

        const filePath = join(tmpJpeg, filename);
        const fileData = readFileSync(filePath);
        const fileSize = statSync(filePath).size;
        const storagePath = `${vehicleId}/iphoto/${filename}`;
        const mimeType = /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';

        // Upload to storage (with retry for intermittent network)
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
          if (errors < 5) console.error(`\n  Upload error (${filename}): ${uploadError.message}`);
          errors++;
          return;
        }

        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
        const meta = metaMap.get(baseName(filename)) || {};

        // Check if we have a placeholder to replace
        const placeholderId = placeholderMap.get(baseName(filename));
        if (placeholderId) {
          // Replace placeholder with real image URL
          const { error: upErr } = await supabase.from('vehicle_images')
            .update({
              image_url: publicUrl,
              storage_path: storagePath,
              mime_type: mimeType,
              file_size: fileSize,
            })
            .eq('id', placeholderId);
          if (!upErr) { replaced++; uploaded++; } else { errors++; }
        } else {
          // Insert new record
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
          const { error: insErr } = await supabase.from('vehicle_images').insert(row);
          if (insErr && !insErr.message.includes('duplicate')) { errors++; }
          else { uploaded++; }
        }
      }));
      process.stdout.write(`\r  ${i + batch.length}/${files.length} (${uploaded} up, ${replaced} replaced, ${skipped} skip, ${errors} err)  `);
    }
    process.stdout.write('\n');
    console.log(`  Done: ${uploaded} uploaded (${replaced} replaced placeholders), ${skipped} skipped, ${errors} errors`);

    // Clean up local mapping file after successful sync
    if (errors === 0 && existsSync(localMappingFile)) {
      try { rmSync(localMappingFile); console.log(`  Cleaned up local mapping file`); } catch {}
    }

    return { uploaded, replaced, skipped, errors, total: files.length };
  } finally {
    try { rmSync(tmpExport, { recursive: true, force: true }); } catch {}
    try { rmSync(tmpJpeg, { recursive: true, force: true }); } catch {}
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (flag('--backfill-gps')) {
  const albumName = arg('--album');
  const vehicleId = arg('--vehicle-id');
  if (albumName) {
    await backfillAlbumGps(albumName, vehicleId);
  } else {
    // Backfill ALL albums
    const albums = listAlbums();
    console.log(`Backfilling GPS for ${albums.length} vehicle albums...`);
    let total = 0;
    for (const a of albums) {
      const count = await backfillAlbumGps(a.name);
      total += count;
    }
    console.log(`\nTotal backfilled: ${total} images`);
  }

} else if (flag('--sync')) {
  const albumName = arg('--album');
  const vehicleId = arg('--vehicle-id');
  const albums = albumName ? null : listAlbums();
  await loadVehicleCache(albums || [{ name: albumName }]);
  if (albumName) {
    await syncAlbum(albumName, vehicleId);
  } else {
    console.log(`Syncing ${albums.length} vehicle albums (download from iCloud → upload)...`);
    let totalUploaded = 0, totalReplaced = 0, albumsDone = 0;
    for (const a of albums) {
      const result = await syncAlbum(a.name);
      if (result) {
        totalUploaded += result.uploaded;
        totalReplaced += result.replaced;
        albumsDone++;
      }
    }
    console.log(`\nTotal: ${totalUploaded} photos uploaded (${totalReplaced} replaced) across ${albumsDone} albums`);
  }

} else if (flag('--map-only')) {
  const albumName = arg('--album');
  if (albumName) {
    const vehicleId = arg('--vehicle-id');
    await mapOnlyAlbum(albumName, vehicleId);
  } else {
    const albums = listAlbums();
    console.log(`Mapping GPS for ${albums.length} vehicle albums (no image upload)...`);
    let total = 0, albumsDone = 0;
    for (const a of albums) {
      const count = await mapOnlyAlbum(a.name);
      total += count;
      if (count > 0) albumsDone++;
    }
    console.log(`\nTotal: ${total} photo pins mapped across ${albumsDone} albums`);
  }

} else if (flag('--list')) {
  const albums = listAlbums();
  console.log(`\n${albums.length} vehicle albums:\n`);
  for (const a of albums) {
    const parsed = parseAlbumName(a.name);
    const tag = parsed ? `${parsed.year} ${parsed.make} ${parsed.model}` : '?';
    console.log(`  [${a.count.toString().padStart(4)}] "${a.name}" → ${tag}`);
  }

} else if (flag('--album')) {
  const albumName = arg('--album');
  const vehicleId = arg('--vehicle-id');
  if (!albumName) { console.error('--album requires a value'); process.exit(1); }
  await processAlbum(albumName, vehicleId);

} else if (flag('--all')) {
  const albums = listAlbums();
  console.log(`Processing ${albums.length} vehicle albums...`);
  let matched = 0, skipped = 0;
  for (const a of albums) {
    const result = await processAlbum(a.name);
    if (result) matched++;
    else skipped++;
  }
  console.log(`\nDone: ${matched} matched, ${skipped} skipped`);

} else {
  console.log(`
iPhoto intake for Nuke

Usage:
  node scripts/iphoto-intake.mjs --list
  node scripts/iphoto-intake.mjs --album "1977 K5 Chevrolet Blazer"
  node scripts/iphoto-intake.mjs --album "..." --vehicle-id <uuid>
  node scripts/iphoto-intake.mjs --all

GPS backfill (update existing images with GPS from Apple Photos):
  node scripts/iphoto-intake.mjs --backfill-gps                          # all albums
  node scripts/iphoto-intake.mjs --backfill-gps --album "1984 Chevrolet K20 LWB "

Map-only mode (GPS metadata without image upload — works with iCloud-only photos):
  node scripts/iphoto-intake.mjs --map-only                              # all albums
  node scripts/iphoto-intake.mjs --map-only --album "1968 Porsche 911"

Full sync (download from iCloud → convert → upload → replace placeholders):
  node scripts/iphoto-intake.mjs --sync                                  # all albums
  node scripts/iphoto-intake.mjs --sync --album "1977 K5 Chevrolet Blazer"
  `);
}
