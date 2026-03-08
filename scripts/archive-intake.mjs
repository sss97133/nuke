#!/usr/bin/env node
/**
 * archive-intake.mjs — General-purpose data dump ingestion for Nuke
 *
 * Point this at any folder of unstructured content and it will:
 *   1. Scan & hash everything into a persistent manifest
 *   2. Classify files (vehicle photo, video, document, listing, personal)
 *   3. Map content to vehicles using folder names + DB lookups
 *   4. Deduplicate against existing vehicle_images
 *   5. Upload in phases with resume support
 *
 * Usage:
 *   dotenvx run -- node scripts/archive-intake.mjs --scan [--source <path>]
 *   dotenvx run -- node scripts/archive-intake.mjs --summary
 *   dotenvx run -- node scripts/archive-intake.mjs --ingest-photos [--folder <name>] [--dry-run]
 *   dotenvx run -- node scripts/archive-intake.mjs --ingest-videos [--folder <name>] [--dry-run]
 *   dotenvx run -- node scripts/archive-intake.mjs --dedup-check
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import {
  readFileSync, writeFileSync, readdirSync, statSync, existsSync,
  mkdirSync, createReadStream
} from 'fs';
import { join, basename, extname, relative, dirname } from 'path';
import dns from 'dns';

// ─── DNS fix (from iphoto-intake) ────────────────────────────────────────────
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

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

const BUCKET = 'vehicle-photos';
const BATCH_SIZE = 10;
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const SOURCE = 'desktop_archive';
const MANIFEST_DIR = join(dirname(new URL(import.meta.url).pathname), 'archive-manifests');

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const DEFAULT_SOURCE = '/Volumes/EXTERNAL HD/mac-archive-2026-03-05/Desktop-Projects';

// ─── File classification ─────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff']);
const RAW_EXTS = new Set(['.cr2', '.arw', '.dng', '.nef', '.raf', '.orf', '.rw2']);
const VIDEO_EXTS = new Set(['.mov', '.mp4', '.m4v', '.avi', '.mkv']);
const DOC_EXTS = new Set(['.pdf', '.numbers', '.xlsx', '.csv', '.doc', '.docx']);
const LISTING_EXTS = new Set(['.htm', '.html']);

// Folders to skip entirely (personal, not vehicle-related)
const PERSONAL_FOLDERS = new Set([
  'wedding copy', 'Welcome Dinner 13:02', 'OLD VIDEOS 2005',
  'wedding-sony', 'jak jpg'
]);

// ─── Vehicle alias map ───────────────────────────────────────────────────────
// Maps folder name patterns to vehicle lookup hints
const VEHICLE_ALIASES = [
  { patterns: ['83 k2500', 'CAR/K20', '1983 k2500'], hints: { year: 1983, make: 'Chevrolet', model: 'K2500', note: 'Blue, sold on BaT, Dave Granholm' } },
  { patterns: ['black 68', '1966 mustang', '1968 mustang'], hints: { year: 1968, make: 'Ford', model: 'Mustang Fastback', note: 'Justin Oshea build' } },
  { patterns: ['1977 k5 blazer', '77 blza', 'k5 blazer'], hints: { year: 1977, make: 'Chevrolet', model: 'K5 Blazer' } },
  { patterns: ['73 jimmy', 'jimmy images'], hints: { year: 1973, make: 'GMC', model: 'Jimmy', note: 'Laurent Gineston / Lole' } },
  { patterns: ['corvette', 'corvette_cl'], hints: { make: 'Chevrolet', model: 'Corvette' } },
  { patterns: ['COYOTE_BRONCO', 'coyote bronco'], hints: { make: 'Ford', model: 'Bronco', note: 'Coyote swap' } },
];

function classifyFile(relPath) {
  const ext = extname(relPath).toLowerCase();
  const parts = relPath.split('/');
  const topFolder = parts[0];

  // Personal content
  if (PERSONAL_FOLDERS.has(topFolder)) return 'personal';

  // By extension
  if (IMAGE_EXTS.has(ext)) return 'vehicle_photo';
  if (RAW_EXTS.has(ext)) return 'vehicle_raw';
  if (VIDEO_EXTS.has(ext)) return 'vehicle_video';
  if (DOC_EXTS.has(ext)) return 'document';
  if (LISTING_EXTS.has(ext)) return 'craigslist_listing';

  // XMP sidecars
  if (ext === '.xmp') return 'xmp_sidecar';

  // PSD, design files
  if (['.psd', '.ai', '.indd'].includes(ext)) return 'design_file';

  return 'unknown';
}

function matchVehicle(relPath) {
  const pathLower = relPath.toLowerCase();
  for (const alias of VEHICLE_ALIASES) {
    for (const pattern of alias.patterns) {
      if (pathLower.includes(pattern.toLowerCase())) {
        return { ...alias.hints, match_method: 'folder_alias', confidence: 0.9 };
      }
    }
  }
  return null;
}

// ─── SHA-256 hashing ─────────────────────────────────────────────────────────

function hashFile(filePath, maxBytes = 500 * 1024 * 1024) {
  const stat = statSync(filePath);
  if (stat.size > maxBytes) return `skip_large_${stat.size}`;

  const hash = createHash('sha256');
  const buffer = readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

// ─── EXIF extraction (batch via exiftool) ────────────────────────────────────

function extractExifBatch(filePaths) {
  if (filePaths.length === 0) return [];
  const results = [];

  // Process in batches of 50
  for (let i = 0; i < filePaths.length; i += 50) {
    const batch = filePaths.slice(i, i + 50);
    try {
      const result = spawnSync('exiftool', [
        '-json', '-q',
        '-DateTimeOriginal', '-CreateDate', '-GPSLatitude', '-GPSLongitude',
        '-Make', '-Model', '-ImageWidth', '-ImageHeight',
        '-Duration', '-VideoFrameRate', '-ImageSize',
        ...batch
      ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 60000 });

      if (result.stdout) {
        const parsed = JSON.parse(result.stdout);
        results.push(...parsed);
      }
    } catch (e) {
      // Fill with empty objects for failed batch
      results.push(...batch.map(() => ({})));
    }
  }
  return results;
}

// ─── Manifest scan ───────────────────────────────────────────────────────────

function walkDir(dir, relBase = '') {
  const entries = [];
  let items;
  try {
    items = readdirSync(dir);
  } catch (e) {
    return entries;
  }

  for (const item of items) {
    if (item.startsWith('.') && item !== '.image_cache') continue;
    const full = join(dir, item);
    const rel = relBase ? `${relBase}/${item}` : item;

    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      entries.push(...walkDir(full, rel));
    } else if (stat.isFile() && stat.size > 0) {
      entries.push({ abs: full, rel, size: stat.size });
    }
  }
  return entries;
}

async function buildManifest(sourcePath) {
  console.log(`\n  Scanning: ${sourcePath}`);
  console.log(`  Building manifest...\n`);

  if (!existsSync(sourcePath)) {
    console.error(`  Source path not found: ${sourcePath}`);
    console.error(`  Is the external drive connected?`);
    process.exit(1);
  }

  const allFiles = walkDir(sourcePath);
  console.log(`  Found ${allFiles.length.toLocaleString()} files\n`);

  // Classify and match vehicles
  const manifest = {
    created_at: new Date().toISOString(),
    source_path: sourcePath,
    total_files: allFiles.length,
    total_bytes: allFiles.reduce((sum, f) => sum + f.size, 0),
    files: []
  };

  // Group image files for EXIF batch extraction
  const imageFiles = [];
  const fileMap = new Map();

  for (const { abs, rel, size } of allFiles) {
    const ext = extname(rel).toLowerCase();
    const category = classifyFile(rel);
    const vehicleMatch = matchVehicle(rel);

    const entry = {
      path: rel,
      abs_path: abs,
      size,
      ext: ext.replace('.', ''),
      category,
      vehicle_match: vehicleMatch,
      sha256: null,
      exif: null,
      ingestion_status: category === 'personal' ? 'skipped' : 'pending'
    };

    manifest.files.push(entry);
    fileMap.set(abs, entry);

    if (['vehicle_photo', 'vehicle_raw', 'vehicle_video'].includes(category)) {
      imageFiles.push(abs);
    }
  }

  // Phase 1: Hash files (skip personal and very large files)
  console.log(`  Hashing files...`);
  let hashed = 0;
  for (const entry of manifest.files) {
    if (entry.ingestion_status === 'skipped') continue;
    if (entry.size > 500 * 1024 * 1024) {
      entry.sha256 = `skip_large_${entry.size}`;
      continue;
    }
    try {
      entry.sha256 = hashFile(entry.abs_path);
    } catch (e) {
      entry.sha256 = `error_${e.code || 'unknown'}`;
    }
    hashed++;
    if (hashed % 500 === 0) {
      process.stdout.write(`\r  Hashed ${hashed.toLocaleString()} / ${manifest.files.filter(f => f.ingestion_status !== 'skipped').length.toLocaleString()}`);
    }
  }
  console.log(`\r  Hashed ${hashed.toLocaleString()} files`);

  // Phase 2: Extract EXIF for image/video files
  console.log(`  Extracting EXIF from ${imageFiles.length.toLocaleString()} media files...`);
  const exifResults = extractExifBatch(imageFiles);
  for (let i = 0; i < exifResults.length && i < imageFiles.length; i++) {
    const entry = fileMap.get(imageFiles[i]);
    if (entry && exifResults[i]) {
      const e = exifResults[i];
      entry.exif = {
        date: e.DateTimeOriginal || e.CreateDate || null,
        gps_lat: e.GPSLatitude || null,
        gps_lng: e.GPSLongitude || null,
        camera_make: e.Make || null,
        camera_model: e.Model || null,
        width: e.ImageWidth || null,
        height: e.ImageHeight || null,
        duration: e.Duration || null,
      };
    }
  }

  // Phase 3: Detect duplicates within the archive
  const hashCounts = new Map();
  for (const entry of manifest.files) {
    if (entry.sha256 && !entry.sha256.startsWith('skip_') && !entry.sha256.startsWith('error_')) {
      if (!hashCounts.has(entry.sha256)) hashCounts.set(entry.sha256, []);
      hashCounts.get(entry.sha256).push(entry.path);
    }
  }
  const dupeGroups = [...hashCounts.entries()].filter(([, paths]) => paths.length > 1);

  // Save manifest
  mkdirSync(MANIFEST_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const manifestPath = join(MANIFEST_DIR, `manifest-${ts}.json`);
  // Also save as 'latest'
  const latestPath = join(MANIFEST_DIR, 'manifest-latest.json');

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(latestPath, JSON.stringify(manifest, null, 2));

  // Print summary
  const cats = {};
  for (const f of manifest.files) {
    cats[f.category] = (cats[f.category] || 0) + 1;
  }

  const vehicleMatched = manifest.files.filter(f => f.vehicle_match).length;
  const totalSize = (manifest.total_bytes / (1024 ** 3)).toFixed(1);

  console.log(`\n  ── Manifest Summary ──────────────────────`);
  console.log(`  Total: ${manifest.total_files.toLocaleString()} files (${totalSize} GB)`);
  console.log(`  Categories:`);
  for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count.toLocaleString()}`);
  }
  console.log(`  Vehicle-matched: ${vehicleMatched.toLocaleString()} files`);
  console.log(`  Internal duplicates: ${dupeGroups.length} groups`);
  console.log(`\n  Saved: ${manifestPath}`);

  // Print vehicle match breakdown
  const vehicleBreakdown = {};
  for (const f of manifest.files) {
    if (f.vehicle_match) {
      const key = `${f.vehicle_match.year || '?'} ${f.vehicle_match.make} ${f.vehicle_match.model}`;
      vehicleBreakdown[key] = (vehicleBreakdown[key] || 0) + 1;
    }
  }
  if (Object.keys(vehicleBreakdown).length > 0) {
    console.log(`\n  Vehicle breakdown:`);
    for (const [v, count] of Object.entries(vehicleBreakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${v}: ${count} files`);
    }
  }

  return manifest;
}

// ─── Summary (read existing manifest) ────────────────────────────────────────

function printSummary() {
  const latestPath = join(MANIFEST_DIR, 'manifest-latest.json');
  if (!existsSync(latestPath)) {
    console.error('  No manifest found. Run --scan first.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(latestPath, 'utf8'));
  const cats = {};
  const statuses = {};
  for (const f of manifest.files) {
    cats[f.category] = (cats[f.category] || 0) + 1;
    statuses[f.ingestion_status] = (statuses[f.ingestion_status] || 0) + 1;
  }

  const totalSize = (manifest.total_bytes / (1024 ** 3)).toFixed(1);
  console.log(`\n  ── Archive Manifest ──────────────────────`);
  console.log(`  Source: ${manifest.source_path}`);
  console.log(`  Scanned: ${manifest.created_at}`);
  console.log(`  Total: ${manifest.total_files.toLocaleString()} files (${totalSize} GB)\n`);

  console.log(`  Categories:`);
  for (const [cat, count] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat}: ${count.toLocaleString()}`);
  }

  console.log(`\n  Ingestion status:`);
  for (const [status, count] of Object.entries(statuses).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${status}: ${count.toLocaleString()}`);
  }

  // Vehicle match breakdown
  const vehicleBreakdown = {};
  for (const f of manifest.files) {
    if (f.vehicle_match) {
      const key = `${f.vehicle_match.year || '?'} ${f.vehicle_match.make} ${f.vehicle_match.model}`;
      vehicleBreakdown[key] = (vehicleBreakdown[key] || 0) + 1;
    }
  }
  if (Object.keys(vehicleBreakdown).length > 0) {
    console.log(`\n  Vehicle breakdown:`);
    for (const [v, count] of Object.entries(vehicleBreakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${v}: ${count} files`);
    }
  }
}

// ─── Vehicle lookup/creation ─────────────────────────────────────────────────

const vehicleCache = new Map();

async function resolveVehicle(hints) {
  const key = `${hints.year}-${hints.make}-${hints.model}`;
  if (vehicleCache.has(key)) return vehicleCache.get(key);

  // Try to find existing vehicle
  let query = supabase.from('vehicles').select('id, year, make, model, vin, color, status');

  if (hints.year) query = query.eq('year', hints.year);
  if (hints.make) query = query.ilike('make', `%${hints.make}%`);
  if (hints.model) query = query.ilike('model', `%${hints.model}%`);

  const { data, error } = await query.neq('status', 'duplicate').limit(5);

  if (data && data.length > 0) {
    // Prefer active status
    const active = data.find(v => v.status === 'active') || data[0];
    vehicleCache.set(key, active.id);
    console.log(`    Matched: ${active.year} ${active.make} ${active.model} (${active.id.slice(0, 8)})`);
    return active.id;
  }

  // No match — return null (don't auto-create, log for manual review)
  console.log(`    No match for: ${hints.year || '?'} ${hints.make} ${hints.model}`);
  vehicleCache.set(key, null);
  return null;
}

// ─── Photo ingestion ─────────────────────────────────────────────────────────

async function ingestPhotos(folderFilter, dryRun) {
  const latestPath = join(MANIFEST_DIR, 'manifest-latest.json');
  if (!existsSync(latestPath)) {
    console.error('  No manifest found. Run --scan first.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(latestPath, 'utf8'));

  // Filter to uploadable images
  let candidates = manifest.files.filter(f =>
    ['vehicle_photo', 'vehicle_raw'].includes(f.category) &&
    f.ingestion_status === 'pending' &&
    f.vehicle_match
  );

  if (folderFilter) {
    candidates = candidates.filter(f => f.path.toLowerCase().includes(folderFilter.toLowerCase()));
  }

  console.log(`\n  ── Photo Ingestion ───────────────────────`);
  console.log(`  Candidates: ${candidates.length} files`);
  if (dryRun) console.log(`  DRY RUN — no uploads will happen\n`);

  // Check for existing hashes in DB to skip duplicates
  const hashes = candidates.map(f => f.sha256).filter(h => h && !h.startsWith('skip_') && !h.startsWith('error_'));
  const existingHashes = new Set();

  if (hashes.length > 0) {
    // Batch check in groups of 500
    for (let i = 0; i < hashes.length; i += 500) {
      const batch = hashes.slice(i, i + 500);
      const { data } = await supabase.from('vehicle_images')
        .select('file_hash')
        .in('file_hash', batch);
      if (data) data.forEach(r => existingHashes.add(r.file_hash));
    }
    console.log(`  Already in DB: ${existingHashes.size} (will skip)`);
  }

  let uploaded = 0, skipped = 0, errors = 0;

  // Group by vehicle for organized upload
  const byVehicle = new Map();
  for (const f of candidates) {
    const key = JSON.stringify(f.vehicle_match);
    if (!byVehicle.has(key)) byVehicle.set(key, { hints: f.vehicle_match, files: [] });
    byVehicle.get(key).files.push(f);
  }

  for (const [, group] of byVehicle) {
    const vehicleId = await resolveVehicle(group.hints);
    if (!vehicleId) {
      console.log(`    Skipping ${group.files.length} files (no vehicle match)`);
      skipped += group.files.length;
      continue;
    }

    console.log(`\n  Uploading ${group.files.length} files for ${group.hints.year || '?'} ${group.hints.make} ${group.hints.model}...`);

    for (let i = 0; i < group.files.length; i += BATCH_SIZE) {
      const batch = group.files.slice(i, i + BATCH_SIZE);

      const uploads = batch.map(async (entry) => {
        // Skip if hash already in DB
        if (entry.sha256 && existingHashes.has(entry.sha256)) {
          entry.ingestion_status = 'skipped';
          skipped++;
          return;
        }

        if (!existsSync(entry.abs_path)) {
          entry.ingestion_status = 'error';
          errors++;
          return;
        }

        if (dryRun) {
          console.log(`    [DRY] ${entry.path}`);
          return;
        }

        try {
          let uploadPath;
          let fileBuffer;
          const fileName = basename(entry.abs_path);

          // RAW files: convert to JPG
          if (entry.category === 'vehicle_raw') {
            const ext = extname(entry.abs_path).toLowerCase();
            const jpgName = fileName.replace(new RegExp(`\\${ext}$`, 'i'), '.jpg');

            // Check if companion JPG exists
            const companionJpg = entry.abs_path.replace(new RegExp(`\\${ext}$`, 'i'), '.jpg');
            const companionJPG = entry.abs_path.replace(new RegExp(`\\${ext}$`, 'i'), '.JPG');

            if (existsSync(companionJpg) || existsSync(companionJPG)) {
              // Use existing JPG, just record the RAW reference
              const jpgPath = existsSync(companionJpg) ? companionJpg : companionJPG;
              fileBuffer = readFileSync(jpgPath);
              uploadPath = `${vehicleId}/archive/${jpgName}`;
            } else {
              // Convert RAW to JPG via sips
              const tmpJpg = `/tmp/archive-intake-${jpgName}`;
              try {
                execSync(`sips -s format jpeg "${entry.abs_path}" --out "${tmpJpg}" -s formatOptions 90 2>/dev/null`, { timeout: 30000 });
                fileBuffer = readFileSync(tmpJpg);
                try { execSync(`rm -f "${tmpJpg}"`); } catch {}
              } catch {
                entry.ingestion_status = 'error';
                errors++;
                return;
              }
              uploadPath = `${vehicleId}/archive/${jpgName}`;
            }
          } else {
            fileBuffer = readFileSync(entry.abs_path);
            uploadPath = `${vehicleId}/archive/${fileName}`;
          }

          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(uploadPath, fileBuffer, {
              contentType: entry.category === 'vehicle_raw' ? 'image/jpeg' : `image/${entry.ext}`,
              upsert: false
            });

          if (uploadError && !uploadError.message?.includes('already exists')) {
            throw uploadError;
          }

          // Get public URL
          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadPath);
          const imageUrl = urlData?.publicUrl;

          // Insert vehicle_images record
          const record = {
            vehicle_id: vehicleId,
            image_url: imageUrl,
            storage_path: uploadPath,
            file_name: basename(uploadPath),
            file_size: fileBuffer.length,
            mime_type: entry.category === 'vehicle_raw' ? 'image/jpeg' : `image/${entry.ext === 'jpg' ? 'jpeg' : entry.ext}`,
            source: SOURCE,
            is_external: false,
            uploaded_by: USER_ID,
            file_hash: entry.sha256?.startsWith('skip_') ? null : entry.sha256,
            exif_data: {
              ...(entry.exif || {}),
              archive_source_path: entry.path,
              ...(entry.category === 'vehicle_raw' ? { raw_original: { path: entry.abs_path, format: entry.ext.toUpperCase() } } : {})
            },
            taken_at: entry.exif?.date ? parseExifDate(entry.exif.date) : null,
            latitude: entry.exif?.gps_lat || null,
            longitude: entry.exif?.gps_lng || null,
          };

          const { error: insertError } = await supabase.from('vehicle_images').insert(record);
          if (insertError) throw insertError;

          entry.ingestion_status = 'uploaded';
          uploaded++;
        } catch (e) {
          entry.ingestion_status = 'error';
          errors++;
          if (e.message) console.error(`    Error: ${basename(entry.abs_path)}: ${e.message}`);
        }
      });

      await Promise.all(uploads);
      process.stdout.write(`\r    Progress: ${Math.min(i + BATCH_SIZE, group.files.length)}/${group.files.length} (${uploaded} uploaded, ${skipped} skipped, ${errors} errors)`);
    }
    console.log('');
  }

  // Save updated manifest
  if (!dryRun) {
    writeFileSync(latestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n  Manifest updated. ${uploaded} uploaded, ${skipped} skipped, ${errors} errors.`);
  }
}

// ─── Video ingestion ─────────────────────────────────────────────────────────

async function ingestVideos(folderFilter, dryRun) {
  const latestPath = join(MANIFEST_DIR, 'manifest-latest.json');
  if (!existsSync(latestPath)) {
    console.error('  No manifest found. Run --scan first.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(latestPath, 'utf8'));

  let candidates = manifest.files.filter(f =>
    f.category === 'vehicle_video' &&
    f.ingestion_status === 'pending' &&
    f.vehicle_match
  );

  if (folderFilter) {
    candidates = candidates.filter(f => f.path.toLowerCase().includes(folderFilter.toLowerCase()));
  }

  console.log(`\n  ── Video Ingestion ───────────────────────`);
  console.log(`  Candidates: ${candidates.length} video files`);
  if (dryRun) console.log(`  DRY RUN\n`);

  // Check size limits (50 MB for Supabase Pro)
  const oversized = candidates.filter(f => f.size > 50 * 1024 * 1024);
  if (oversized.length > 0) {
    console.log(`  ${oversized.length} files exceed 50 MB upload limit — will skip`);
    oversized.forEach(f => { f.ingestion_status = 'skipped'; });
    candidates = candidates.filter(f => f.size <= 50 * 1024 * 1024);
  }

  let uploaded = 0, errors = 0;

  for (const entry of candidates) {
    const vehicleId = await resolveVehicle(entry.vehicle_match);
    if (!vehicleId) continue;

    if (dryRun) {
      console.log(`  [DRY] ${entry.path} (${(entry.size / (1024 * 1024)).toFixed(1)} MB)`);
      continue;
    }

    if (!existsSync(entry.abs_path)) {
      entry.ingestion_status = 'error';
      errors++;
      continue;
    }

    try {
      const fileName = basename(entry.abs_path);
      const uploadPath = `${vehicleId}/archive/video/${fileName}`;

      // Extract video metadata via ffprobe
      let videoMeta = {};
      try {
        const probe = execSync(
          `ffprobe -v quiet -print_format json -show_format -show_streams "${entry.abs_path}"`,
          { encoding: 'utf8', timeout: 15000 }
        );
        const parsed = JSON.parse(probe);
        const videoStream = parsed.streams?.find(s => s.codec_type === 'video');
        videoMeta = {
          duration: parsed.format?.duration ? parseFloat(parsed.format.duration) : null,
          codec: videoStream?.codec_name || null,
          resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : null,
        };
      } catch {}

      // Generate thumbnail
      let thumbBuffer = null;
      const thumbPath = `/tmp/archive-intake-thumb-${fileName}.jpg`;
      try {
        execSync(`ffmpeg -y -i "${entry.abs_path}" -ss 00:00:01 -frames:v 1 -q:v 2 "${thumbPath}" 2>/dev/null`, { timeout: 15000 });
        thumbBuffer = readFileSync(thumbPath);
        try { execSync(`rm -f "${thumbPath}"`); } catch {}
      } catch {}

      // Upload video
      const fileBuffer = readFileSync(entry.abs_path);
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(uploadPath, fileBuffer, {
          contentType: 'video/quicktime',
          upsert: false
        });

      if (uploadError && !uploadError.message?.includes('already exists')) {
        throw uploadError;
      }

      // Upload thumbnail if generated
      let thumbUrl = null;
      if (thumbBuffer) {
        const thumbUploadPath = `${vehicleId}/archive/video/thumb_${fileName}.jpg`;
        await supabase.storage.from(BUCKET).upload(thumbUploadPath, thumbBuffer, {
          contentType: 'image/jpeg', upsert: false
        });
        const { data: thumbUrlData } = supabase.storage.from(BUCKET).getPublicUrl(thumbUploadPath);
        thumbUrl = thumbUrlData?.publicUrl;
      }

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadPath);

      // Insert record
      const { error: insertError } = await supabase.from('vehicle_images').insert({
        vehicle_id: vehicleId,
        image_url: thumbUrl || urlData?.publicUrl,
        storage_path: uploadPath,
        file_name: fileName,
        file_size: fileBuffer.length,
        mime_type: 'video/quicktime',
        source: SOURCE,
        is_external: false,
        is_video: true,
        uploaded_by: USER_ID,
        file_hash: entry.sha256?.startsWith('skip_') ? null : entry.sha256,
        duration_seconds: videoMeta.duration,
        video_codec: videoMeta.codec,
        video_resolution: videoMeta.resolution,
        taken_at: entry.exif?.date ? parseExifDate(entry.exif.date) : null,
        exif_data: { ...(entry.exif || {}), archive_source_path: entry.path, video_url: urlData?.publicUrl },
      });

      if (insertError) throw insertError;

      entry.ingestion_status = 'uploaded';
      uploaded++;
      console.log(`  Uploaded: ${fileName} (${(entry.size / (1024 * 1024)).toFixed(1)} MB)`);
    } catch (e) {
      entry.ingestion_status = 'error';
      errors++;
      console.error(`  Error: ${basename(entry.abs_path)}: ${e.message}`);
    }
  }

  if (!dryRun) {
    writeFileSync(latestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n  ${uploaded} videos uploaded, ${errors} errors.`);
  }
}

// ─── Dedup check against existing DB ─────────────────────────────────────────

async function dedupCheck() {
  const latestPath = join(MANIFEST_DIR, 'manifest-latest.json');
  if (!existsSync(latestPath)) {
    console.error('  No manifest found. Run --scan first.');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(latestPath, 'utf8'));
  const hashes = manifest.files
    .filter(f => f.sha256 && !f.sha256.startsWith('skip_') && !f.sha256.startsWith('error_'))
    .map(f => f.sha256);

  const uniqueHashes = [...new Set(hashes)];
  console.log(`\n  Checking ${uniqueHashes.length.toLocaleString()} unique hashes against DB...`);

  let found = 0;
  for (let i = 0; i < uniqueHashes.length; i += 500) {
    const batch = uniqueHashes.slice(i, i + 500);
    const { data } = await supabase.from('vehicle_images')
      .select('file_hash')
      .in('file_hash', batch);
    if (data) found += data.length;
  }

  console.log(`  Already in DB: ${found} / ${uniqueHashes.length} unique files`);
  console.log(`  New files to ingest: ${uniqueHashes.length - found}`);

  // Internal archive duplicates
  const hashMap = new Map();
  for (const f of manifest.files) {
    if (f.sha256 && !f.sha256.startsWith('skip_') && !f.sha256.startsWith('error_')) {
      if (!hashMap.has(f.sha256)) hashMap.set(f.sha256, []);
      hashMap.get(f.sha256).push(f.path);
    }
  }
  const dupes = [...hashMap.entries()].filter(([, paths]) => paths.length > 1);
  console.log(`  Internal duplicates: ${dupes.length} groups`);
  if (dupes.length > 0 && dupes.length <= 20) {
    for (const [hash, paths] of dupes) {
      console.log(`    ${hash.slice(0, 12)}... → ${paths.length} copies`);
      paths.forEach(p => console.log(`      ${p}`));
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseExifDate(dateStr) {
  if (!dateStr) return null;
  // EXIF dates: "2024:11:15 14:23:01" → ISO
  const cleaned = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (flag('--scan')) {
    const source = arg('--source') || DEFAULT_SOURCE;
    await buildManifest(source);
  } else if (flag('--summary')) {
    printSummary();
  } else if (flag('--ingest-photos')) {
    await ingestPhotos(arg('--folder'), flag('--dry-run'));
  } else if (flag('--ingest-videos')) {
    await ingestVideos(arg('--folder'), flag('--dry-run'));
  } else if (flag('--dedup-check')) {
    await dedupCheck();
  } else {
    console.log(`
  archive-intake.mjs — General-purpose data dump ingestion for Nuke

  Usage:
    --scan [--source <path>]           Scan & hash all files into manifest
    --summary                          Show manifest summary
    --ingest-photos [--folder <name>]  Upload vehicle photos
    --ingest-videos [--folder <name>]  Upload vehicle videos
    --dedup-check                      Check for duplicates against DB
    --dry-run                          Preview without uploading

  Default source: ${DEFAULT_SOURCE}
`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
