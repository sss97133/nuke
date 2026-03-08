#!/usr/bin/env node
/**
 * HD Dedup Scanner — scans external HD files, extracts EXIF + SHA-256,
 * cross-references against ALL existing DB records, produces a local
 * HTML report for review BEFORE uploading.
 *
 * Usage:
 *   dotenvx run -- node scripts/hd-dedup-scanner.mjs --vehicle k2500
 *   dotenvx run -- node scripts/hd-dedup-scanner.mjs --all
 *   dotenvx run -- node scripts/hd-dedup-scanner.mjs --all --output report.html
 *
 * Produces: hd-dedup-report.html (open in browser to review)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, extname, basename } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import dns from 'dns';

// ─── DNS fix ─────────────────────────────────────────────────────────────────
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

const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// ─── Vehicle map (same as hd-vehicle-intake) ────────────────────────────────
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
    folders: [`${HD}/Desktop-Projects/CAR/black 68`],
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
    folders: [`${HD}/Desktop-Projects/my last dtop folder/dtop/BRonco dale`],
  },
  mustang: {
    id: '8bde1dda-ebb4-480e-8942-e561feb36667',
    label: '1966 Ford Mustang',
    folders: [`${HD}/Desktop-Projects/my last dtop folder/dtop/1966 mustang`],
  },
  corvette: {
    id: '592a3bab-9c6b-41ee-8c19-e55dd6a902b6',
    label: '1972 Chevrolet Corvette Stingray',
    folders: [`${HD}/Desktop-Projects/CAR/corvette`],
  },
  k10: {
    id: '6442df03-9cac-43a8-b89e-e4fb4c08ee99',
    label: '1984 Chevrolet K10',
    folders: [`${HD}/Desktop-Projects/CAR/K20`],
  },
};

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png']);

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

// ─── EXIF extraction via exiftool ────────────────────────────────────────────
function extractExifBatch(filePaths) {
  // exiftool -json outputs structured EXIF for multiple files at once
  // Much faster than calling per-file
  const tmpList = `/tmp/hd-dedup-files-${Date.now()}.txt`;
  writeFileSync(tmpList, filePaths.join('\n'));

  try {
    const raw = execSync(
      `exiftool -json -DateTimeOriginal -CreateDate -Make -Model -ImageWidth -ImageHeight -FileSize -Orientation -GPSLatitude -GPSLongitude -n -@ "${tmpList}" 2>/dev/null`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
    );
    const results = JSON.parse(raw);
    const map = new Map();
    for (const r of results) {
      map.set(r.SourceFile, {
        dateTime: r.DateTimeOriginal || r.CreateDate || null,
        cameraMake: r.Make || null,
        cameraModel: r.Model || null,
        width: r.ImageWidth || null,
        height: r.ImageHeight || null,
        fileSize: r.FileSize || null,
        orientation: r.Orientation || null,
        latitude: r.GPSLatitude || null,
        longitude: r.GPSLongitude || null,
      });
    }
    return map;
  } catch (e) {
    console.error(`  exiftool error: ${e.message.slice(0, 100)}`);
    return new Map();
  } finally {
    try { execSync(`rm -f "${tmpList}"`); } catch {}
  }
}

// ─── Load existing DB records for cross-reference ────────────────────────────
async function loadExistingRecords(vehicleId) {
  const records = { byHash: new Map(), byExifKey: new Map(), byFilename: new Map() };

  // Load ALL images for this vehicle from ALL sources
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('id, file_name, file_hash, source, taken_at, exif_data, image_url')
      .eq('vehicle_id', vehicleId)
      .range(offset, offset + 999);

    if (error) { console.error(`  DB error: ${error.message}`); break; }
    if (!data?.length) break;

    for (const r of data) {
      // Index by hash
      if (r.file_hash) records.byHash.set(r.file_hash, r);

      // Index by filename (normalized)
      if (r.file_name) {
        records.byFilename.set(r.file_name.toLowerCase(), r);
      }

      // Index by EXIF key (date + dimensions)
      if (r.taken_at && r.exif_data) {
        const w = r.exif_data?.width || r.exif_data?.dimensions?.width;
        const h = r.exif_data?.height || r.exif_data?.dimensions?.height;
        if (w && h) {
          const key = `${r.taken_at}_${w}x${h}`;
          records.byExifKey.set(key, r);
        }
      }
    }

    if (data.length < 1000) break;
    offset += 1000;
  }

  // Also load images from other vehicles that might be Skylar's
  // (check by user_id for unorganized photos)
  const { data: unorg } = await supabase
    .from('vehicle_images')
    .select('id, file_name, file_hash, source, taken_at, exif_data')
    .or(`documented_by_user_id.eq.${USER_ID},user_id.eq.${USER_ID}`)
    .is('vehicle_id', null)
    .limit(5000);

  for (const r of (unorg || [])) {
    if (r.file_hash) records.byHash.set(r.file_hash, r);
    if (r.file_name) records.byFilename.set(r.file_name.toLowerCase(), r);
  }

  return records;
}

// ─── Scan one vehicle ────────────────────────────────────────────────────────
async function scanVehicle(key, vehicle) {
  console.log(`\nScanning: ${vehicle.label}`);

  if (!vehicle.folders.length) {
    console.log('  No folders — skipping');
    return { key, label: vehicle.label, files: [], stats: { total: 0, newFiles: 0, hashDupe: 0, exifDupe: 0, nameDupe: 0, uncertain: 0 } };
  }

  // 1. Collect all image files
  let allFiles = [];
  for (const folder of vehicle.folders) {
    try {
      const entries = readdirSync(folder);
      for (const entry of entries) {
        const ext = extname(entry).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) continue;
        const fullPath = join(folder, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) continue;
          allFiles.push({ path: fullPath, name: entry, size: stat.size, ext });
        } catch {}
      }
    } catch (e) {
      console.log(`  Warning: ${folder}: ${e.message}`);
    }
  }
  console.log(`  ${allFiles.length} images found on disk`);

  if (!allFiles.length) {
    return { key, label: vehicle.label, files: [], stats: { total: 0, newFiles: 0, hashDupe: 0, exifDupe: 0, nameDupe: 0, uncertain: 0 } };
  }

  // 2. Extract EXIF in batch
  process.stdout.write('  Extracting EXIF... ');
  const exifMap = extractExifBatch(allFiles.map(f => f.path));
  const withExif = [...exifMap.values()].filter(e => e.dateTime).length;
  console.log(`${exifMap.size} processed, ${withExif} with date/time`);

  // 3. Compute SHA-256 hashes
  process.stdout.write('  Computing SHA-256 hashes... ');
  for (const file of allFiles) {
    try {
      const data = readFileSync(file.path);
      file.hash = createHash('sha256').update(data).digest('hex');
    } catch {
      file.hash = null;
    }
    file.exif = exifMap.get(file.path) || null;
  }
  console.log('done');

  // 4. Load existing DB records
  process.stdout.write('  Loading existing DB records... ');
  const existing = await loadExistingRecords(vehicle.id);
  console.log(`${existing.byHash.size} hashes, ${existing.byExifKey.size} EXIF keys, ${existing.byFilename.size} filenames`);

  // 5. Cross-reference each file
  let newFiles = 0, hashDupe = 0, exifDupe = 0, nameDupe = 0, uncertain = 0;

  for (const file of allFiles) {
    file.dupeType = null;
    file.dupeMatch = null;

    // Check 1: exact SHA-256 match
    if (file.hash && existing.byHash.has(file.hash)) {
      file.dupeType = 'hash';
      file.dupeMatch = existing.byHash.get(file.hash);
      hashDupe++;
      continue;
    }

    // Check 2: EXIF date+dimensions match
    if (file.exif?.dateTime && file.exif?.width && file.exif?.height) {
      const key = `${file.exif.dateTime}_${file.exif.width}x${file.exif.height}`;
      if (existing.byExifKey.has(key)) {
        file.dupeType = 'exif';
        file.dupeMatch = existing.byExifKey.get(key);
        exifDupe++;
        continue;
      }
    }

    // Check 3: filename match (weak signal but worth flagging)
    const nameKey = file.name.toLowerCase();
    if (existing.byFilename.has(nameKey)) {
      file.dupeType = 'filename';
      file.dupeMatch = existing.byFilename.get(nameKey);
      nameDupe++;
      continue;
    }

    // No match — genuinely new
    file.dupeType = 'new';
    newFiles++;
  }

  const stats = { total: allFiles.length, newFiles, hashDupe, exifDupe, nameDupe, uncertain };
  console.log(`  Results: ${newFiles} NEW | ${hashDupe} hash-dupe | ${exifDupe} EXIF-dupe | ${nameDupe} name-dupe`);

  return { key, label: vehicle.label, vehicleId: vehicle.id, files: allFiles, stats };
}

// ─── Generate HTML report ────────────────────────────────────────────────────
function generateReport(results, outputPath) {
  const totalStats = {
    total: 0, newFiles: 0, hashDupe: 0, exifDupe: 0, nameDupe: 0,
  };
  for (const r of results) {
    totalStats.total += r.stats.total;
    totalStats.newFiles += r.stats.newFiles;
    totalStats.hashDupe += r.stats.hashDupe;
    totalStats.exifDupe += r.stats.exifDupe;
    totalStats.nameDupe += r.stats.nameDupe;
  }

  let html = `<!DOCTYPE html>
<html><head>
<title>HD Dedup Report — ${new Date().toISOString().slice(0, 10)}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #e0e0e0; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
  h2 { margin-top: 40px; border-bottom: 1px solid #333; }
  .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 20px 0; }
  .stat { background: #1a1a1a; border: 2px solid #333; padding: 16px; text-align: center; }
  .stat .number { font-size: 32px; font-weight: bold; }
  .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-top: 4px; }
  .new .number { color: #4CAF50; }
  .hash .number { color: #f44336; }
  .exif .number { color: #ff9800; }
  .name .number { color: #ffeb3b; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th { text-align: left; padding: 8px; background: #1a1a1a; border-bottom: 2px solid #333; font-size: 11px; text-transform: uppercase; }
  td { padding: 6px 8px; border-bottom: 1px solid #222; }
  tr.new td:first-child { border-left: 3px solid #4CAF50; }
  tr.hash td:first-child { border-left: 3px solid #f44336; }
  tr.exif td:first-child { border-left: 3px solid #ff9800; }
  tr.filename td:first-child { border-left: 3px solid #ffeb3b; }
  .match-source { color: #888; font-size: 11px; }
  .vehicle-section { margin: 30px 0; padding: 20px; background: #111; border: 1px solid #333; }
  .action-needed { background: #1a2a1a; border-color: #4CAF50; }
  .all-dupes { background: #1a1a1a; border-color: #333; opacity: 0.7; }
  .exif-detail { color: #888; font-size: 11px; }
  .collapse { cursor: pointer; user-select: none; }
  .collapse-content { display: none; }
  .collapse.open + .collapse-content { display: block; }
</style>
</head><body>
<h1>HD Dedup Report</h1>
<p>Scanned: ${new Date().toLocaleString()} | Source: /Volumes/EXTERNAL HD/</p>

<div class="summary">
  <div class="stat"><div class="number">${totalStats.total}</div><div class="label">Total Files</div></div>
  <div class="stat new"><div class="number">${totalStats.newFiles}</div><div class="label">New (upload)</div></div>
  <div class="stat hash"><div class="number">${totalStats.hashDupe}</div><div class="label">Hash Dupe (skip)</div></div>
  <div class="stat exif"><div class="number">${totalStats.exifDupe}</div><div class="label">EXIF Dupe (likely skip)</div></div>
  <div class="stat name"><div class="number">${totalStats.nameDupe}</div><div class="label">Name Match (review)</div></div>
</div>

<p><strong>Legend:</strong>
  <span style="color:#4CAF50">GREEN = genuinely new, safe to upload</span> |
  <span style="color:#f44336">RED = exact byte match, definitely skip</span> |
  <span style="color:#ff9800">ORANGE = same EXIF date+dimensions, very likely same photo</span> |
  <span style="color:#ffeb3b">YELLOW = same filename, needs manual review</span>
</p>
`;

  for (const result of results) {
    if (!result.files.length) continue;

    const sectionClass = result.stats.newFiles > 0 ? 'action-needed' : 'all-dupes';
    html += `
<div class="vehicle-section ${sectionClass}">
  <h2>${result.label}</h2>
  <p>${result.stats.total} files: ${result.stats.newFiles} new, ${result.stats.hashDupe} hash-dupe, ${result.stats.exifDupe} EXIF-dupe, ${result.stats.nameDupe} name-match</p>
`;

    // Show new files first
    const newFiles = result.files.filter(f => f.dupeType === 'new');
    const dupeFiles = result.files.filter(f => f.dupeType !== 'new');

    if (newFiles.length) {
      html += `<h3 style="color:#4CAF50">New Files (${newFiles.length})</h3>
<table>
<tr><th>File</th><th>Size</th><th>Date Taken</th><th>Camera</th><th>Dimensions</th><th>GPS</th></tr>`;
      for (const f of newFiles) {
        const exif = f.exif || {};
        html += `<tr class="new">
  <td>${f.name}</td>
  <td>${(f.size / 1024).toFixed(0)} KB</td>
  <td>${exif.dateTime || '—'}</td>
  <td>${[exif.cameraMake, exif.cameraModel].filter(Boolean).join(' ') || '—'}</td>
  <td>${exif.width && exif.height ? `${exif.width}x${exif.height}` : '—'}</td>
  <td>${exif.latitude ? `${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}` : '—'}</td>
</tr>`;
      }
      html += '</table>';
    }

    if (dupeFiles.length) {
      html += `<h3>Duplicates (${dupeFiles.length}) — will skip</h3>
<table>
<tr><th>File</th><th>Match Type</th><th>Matched Record</th><th>Source</th></tr>`;
      for (const f of dupeFiles.slice(0, 50)) { // limit to 50 for readability
        const match = f.dupeMatch || {};
        html += `<tr class="${f.dupeType}">
  <td>${f.name}</td>
  <td>${f.dupeType}</td>
  <td>${match.file_name || match.id?.slice(0, 8) || '—'}</td>
  <td class="match-source">${match.source || '—'}</td>
</tr>`;
      }
      if (dupeFiles.length > 50) {
        html += `<tr><td colspan="4" style="color:#888">... and ${dupeFiles.length - 50} more duplicates</td></tr>`;
      }
      html += '</table>';
    }

    html += '</div>';
  }

  html += `
<div style="margin-top: 40px; padding: 20px; background: #1a2a1a; border: 2px solid #4CAF50;">
  <h2 style="margin-top: 0;">Next Steps</h2>
  <ol>
    <li>Review the NEW files above — are they correctly assigned to the right vehicle?</li>
    <li>Check EXIF dupes — these are likely the same photo from a different export. Verify a few.</li>
    <li>Check name matches — same filename doesn't always mean same photo (IMG_0001.jpg is common).</li>
    <li>When satisfied, run: <code>dotenvx run -- node scripts/hd-vehicle-intake.mjs --all --skip-dupes</code></li>
  </ol>
</div>
</body></html>`;

  writeFileSync(outputPath, html);
  console.log(`\nReport written to: ${outputPath}`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const outputFile = arg('--output') || 'hd-dedup-report.html';

if (flag('--vehicle')) {
  const key = arg('--vehicle');
  if (!VEHICLE_MAP[key]) {
    console.error(`Unknown vehicle: ${key}. Valid: ${Object.keys(VEHICLE_MAP).join(', ')}`);
    process.exit(1);
  }
  const result = await scanVehicle(key, VEHICLE_MAP[key]);
  generateReport([result], outputFile);

} else if (flag('--all')) {
  console.log('Scanning all vehicles for duplicates...');
  const results = [];
  for (const [key, vehicle] of Object.entries(VEHICLE_MAP)) {
    const result = await scanVehicle(key, vehicle);
    results.push(result);
  }
  generateReport(results, outputFile);

} else {
  console.log(`
HD Dedup Scanner — scan before uploading

Usage:
  dotenvx run -- node scripts/hd-dedup-scanner.mjs --vehicle k2500
  dotenvx run -- node scripts/hd-dedup-scanner.mjs --all
  dotenvx run -- node scripts/hd-dedup-scanner.mjs --all --output my-report.html

Vehicle keys: ${Object.keys(VEHICLE_MAP).join(', ')}
  `);
}
