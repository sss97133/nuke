#!/usr/bin/env node
/**
 * Full HD Scanner — comprehensive inventory of every image on the drive.
 *
 * - Extracts EXIF including camera serial numbers
 * - Computes SHA-256 hashes
 * - Finds duplicates WITHIN the HD (same image in multiple folders)
 * - Cross-references against ALL images in the Nuke DB
 * - Generates a visual HTML report with embedded thumbnails
 *
 * Usage:
 *   dotenvx run -- node scripts/hd-full-scan.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, extname, basename, dirname, relative } from 'path';
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
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic']);
const HD = '/Volumes/EXTERNAL HD';

// ─── Directories to scan ─────────────────────────────────────────────────────
const SCAN_DIRS = [
  // Vehicle photo folders
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/CAR`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/83 k2500`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/corvette_cl`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/shop`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/vegas`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/untitled folder`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/my last dtop folder`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/Photos`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/sccreens`,
  `${HD}/mac-archive-2026-03-05/Desktop-Projects/jak jpg`,
  // Root screenshots/images
  `${HD}/mac-archive-2026-03-05/Desktop-Projects`,
  // Downloads
  `${HD}/mac-archive-2026-03-05/Downloads`,
  // Skylar photos
  `${HD}/jenny/0 SKYLAR PHOTOS`,
];

// Skip these subdirectories (web page saves, not real images)
const SKIP_DIRS = new Set([
  '_files', 'Apply to Y Combinator_files', 'dl-owds',
]);

// ─── Recursive file scanner ─────────────────────────────────────────────────
function scanDirRecursive(dir, maxDepth = 4, depth = 0) {
  const files = [];
  if (depth > maxDepth) return files;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip web-saved page folders and known non-image dirs
          const lower = entry.toLowerCase();
          if (lower.endsWith('_files') || SKIP_DIRS.has(entry)) continue;
          if (lower === 'wiring' || lower === 'old videos 2005') continue;
          files.push(...scanDirRecursive(fullPath, maxDepth, depth + 1));
        } else {
          const ext = extname(entry).toLowerCase();
          if (IMAGE_EXTS.has(ext)) {
            files.push({ path: fullPath, name: entry, size: stat.size, ext,
              folder: relative(HD, dirname(fullPath)) });
          }
        }
      } catch {}
    }
  } catch {}
  return files;
}

// ─── EXIF batch extraction ──────────────────────────────────────────────────
function extractExifBatch(filePaths) {
  const CHUNK = 500;
  const allResults = new Map();

  for (let i = 0; i < filePaths.length; i += CHUNK) {
    const chunk = filePaths.slice(i, i + CHUNK);
    const tmpList = `/tmp/hd-scan-files-${Date.now()}.txt`;
    writeFileSync(tmpList, chunk.join('\n'));

    try {
      const raw = execSync(
        `exiftool -json -DateTimeOriginal -CreateDate -Make -Model -SerialNumber -InternalSerialNumber -LensSerialNumber -ImageWidth -ImageHeight -GPSLatitude -GPSLongitude -n -@ "${tmpList}" 2>/dev/null`,
        { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 }
      );
      for (const r of JSON.parse(raw)) {
        allResults.set(r.SourceFile, {
          dateTime: r.DateTimeOriginal || r.CreateDate || null,
          cameraMake: r.Make || null,
          cameraModel: r.Model || null,
          cameraSerial: r.SerialNumber || r.InternalSerialNumber || null,
          lensSerial: r.LensSerialNumber || null,
          width: r.ImageWidth || null,
          height: r.ImageHeight || null,
          latitude: r.GPSLatitude || null,
          longitude: r.GPSLongitude || null,
        });
      }
    } catch {} finally {
      try { execSync(`rm -f "${tmpList}"`); } catch {}
    }
    process.stdout.write(`\r  EXIF: ${Math.min(i + CHUNK, filePaths.length)}/${filePaths.length}  `);
  }
  process.stdout.write('\n');
  return allResults;
}

// ─── Load ALL existing hashes from DB ───────────────────────────────────────
async function loadAllDbHashes() {
  console.log('Loading existing DB image hashes...');
  const hashes = new Map(); // hash → {id, source, vehicle_id, file_name}
  let offset = 0;
  let total = 0;

  const BATCH = 1000; // PostgREST default max
  while (true) {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('id, file_hash, source, vehicle_id, file_name')
      .not('file_hash', 'is', null)
      .range(offset, offset + BATCH - 1);

    if (error) { console.error(`  DB error: ${error.message}`); break; }
    if (!data?.length) break;

    for (const r of data) {
      if (r.file_hash) hashes.set(r.file_hash, r);
    }
    total += data.length;
    if (data.length < BATCH) break;
    offset += BATCH;
    process.stdout.write(`\r  Loaded ${total} hashes...  `);
  }
  process.stdout.write(`\r  Loaded ${total} hashes total\n`);
  return hashes;
}

// ─── Generate thumbnail (base64) ────────────────────────────────────────────
function generateThumbnail(filePath) {
  try {
    const tmpOut = `/tmp/hd-thumb-${Date.now()}.jpg`;
    execSync(`sips -Z 200 "${filePath}" --out "${tmpOut}" -s formatOptions 60 -s format jpeg > /dev/null 2>&1`, { timeout: 5000 });
    const data = readFileSync(tmpOut);
    try { execSync(`rm -f "${tmpOut}"`); } catch {}
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

// ─── Main scan ──────────────────────────────────────────────────────────────

console.log('=== Full HD Image Scanner ===\n');

// 1. Find all images
console.log('Step 1: Scanning directories...');
let allFiles = [];
for (const dir of SCAN_DIRS) {
  if (!existsSync(dir)) { continue; }
  const isDeep = dir.endsWith('Desktop-Projects') || dir.endsWith('Downloads');
  const maxDepth = isDeep ? 1 : 5; // don't recurse too deep into root dirs
  const files = scanDirRecursive(dir, maxDepth);
  console.log(`  ${relative(HD, dir)}: ${files.length} images`);
  allFiles.push(...files);
}

// Deduplicate by path (in case scan dirs overlap)
const pathSet = new Set();
allFiles = allFiles.filter(f => {
  if (pathSet.has(f.path)) return false;
  pathSet.add(f.path);
  return true;
});
console.log(`\nTotal unique image files: ${allFiles.length}`);

// 2. Extract EXIF
console.log('\nStep 2: Extracting EXIF metadata...');
const exifMap = extractExifBatch(allFiles.map(f => f.path));

// Attach EXIF to files
for (const f of allFiles) {
  f.exif = exifMap.get(f.path) || null;
}

// 3. Identify unique cameras/devices
const cameras = new Map(); // "make model serial" → count
for (const f of allFiles) {
  if (f.exif?.cameraModel) {
    const key = [f.exif.cameraMake, f.exif.cameraModel, f.exif.cameraSerial].filter(Boolean).join(' | ');
    cameras.set(key, (cameras.get(key) || 0) + 1);
  }
}
console.log('\nStep 3: Cameras/devices detected:');
for (const [cam, count] of [...cameras.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(5)} photos — ${cam}`);
}

// 4. Compute SHA-256 hashes
console.log('\nStep 4: Computing SHA-256 hashes...');
const hashToFiles = new Map(); // hash → [file, file, ...]
for (let i = 0; i < allFiles.length; i++) {
  const f = allFiles[i];
  try {
    const data = readFileSync(f.path);
    f.hash = createHash('sha256').update(data).digest('hex');
    if (!hashToFiles.has(f.hash)) hashToFiles.set(f.hash, []);
    hashToFiles.get(f.hash).push(f);
  } catch {
    f.hash = null;
  }
  if (i % 100 === 0) process.stdout.write(`\r  ${i}/${allFiles.length}  `);
}
process.stdout.write(`\r  ${allFiles.length}/${allFiles.length}  \n`);

// 5. Find duplicates WITHIN the HD
const hdDupes = [];
for (const [hash, files] of hashToFiles) {
  if (files.length > 1) {
    hdDupes.push({ hash, files });
  }
}
const hdDupeFileCount = hdDupes.reduce((sum, d) => sum + d.files.length - 1, 0); // -1 for the "original"
console.log(`\nStep 5: HD-internal duplicates: ${hdDupes.length} unique images appear in ${hdDupeFileCount + hdDupes.length} locations (${hdDupeFileCount} removable copies)`);

// 6. Cross-reference against DB
console.log('\nStep 6: Cross-referencing against DB...');
const dbHashes = await loadAllDbHashes();

let dbMatches = 0, dbNew = 0;
for (const f of allFiles) {
  if (f.hash && dbHashes.has(f.hash)) {
    f.inDb = true;
    f.dbRecord = dbHashes.get(f.hash);
    dbMatches++;
  } else {
    f.inDb = false;
    dbNew++;
  }
}
console.log(`  In DB already: ${dbMatches}`);
console.log(`  Not in DB (new): ${dbNew}`);

// 7. Group by folder for reporting
const byFolder = new Map();
for (const f of allFiles) {
  if (!byFolder.has(f.folder)) byFolder.set(f.folder, []);
  byFolder.get(f.folder).push(f);
}

// 8. Generate thumbnails for sample images (first 5 per folder)
console.log('\nStep 7: Generating thumbnails for report...');
let thumbCount = 0;
for (const [folder, files] of byFolder) {
  const newFiles = files.filter(f => !f.inDb);
  for (const f of newFiles.slice(0, 5)) {
    if (f.ext !== '.heic') {
      f.thumbnail = generateThumbnail(f.path);
      if (f.thumbnail) thumbCount++;
    }
  }
}
console.log(`  ${thumbCount} thumbnails generated`);

// 9. Generate report
console.log('\nStep 8: Generating report...');

let html = `<!DOCTYPE html>
<html><head>
<title>Full HD Scan — ${new Date().toISOString().slice(0, 10)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; max-width: 1400px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #e0e0e0; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 10px; font-size: 24px; }
  h2 { margin-top: 30px; font-size: 18px; border-bottom: 1px solid #333; padding-bottom: 6px; }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 16px 0; }
  .stat { background: #1a1a1a; border: 2px solid #333; padding: 14px; text-align: center; }
  .stat .n { font-size: 28px; font-weight: bold; font-family: 'Courier New', monospace; }
  .stat .l { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-top: 4px; }
  .new .n { color: #4CAF50; }
  .dupe .n { color: #f44336; }
  .hd-dupe .n { color: #ff9800; }
  .folder-section { margin: 20px 0; padding: 16px; background: #111; border: 1px solid #222; }
  .folder-section.has-new { border-color: #4CAF50; }
  .folder-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
  .folder-header:hover { color: #fff; }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
  .thumb { width: 120px; height: 120px; object-fit: cover; border: 1px solid #333; }
  .cameras { margin: 20px 0; }
  .cam-row { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid #1a1a1a; font-size: 13px; }
  .cam-count { width: 60px; text-align: right; color: #4CAF50; font-family: 'Courier New', monospace; }
  .cam-name { color: #ccc; }
  .cam-serial { color: #666; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 6px; background: #1a1a1a; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #333; }
  td { padding: 4px 6px; border-bottom: 1px solid #1a1a1a; }
  .tag { display: inline-block; padding: 2px 6px; font-size: 10px; border: 1px solid; margin: 1px; }
  .tag-new { border-color: #4CAF50; color: #4CAF50; }
  .tag-db { border-color: #f44336; color: #f44336; }
  .tag-hd-dupe { border-color: #ff9800; color: #ff9800; }
  details { margin: 8px 0; }
  summary { cursor: pointer; padding: 4px 0; color: #888; font-size: 13px; }
  summary:hover { color: #fff; }
  .section-collapsed table { display: none; }
  .hd-dupe-section { background: #1a1200; border: 1px solid #ff9800; padding: 16px; margin: 20px 0; }
</style>
</head><body>
<h1>FULL HD IMAGE SCAN</h1>
<p style="color:#888">Scanned: ${new Date().toLocaleString()} | Drive: /Volumes/EXTERNAL HD/</p>

<div class="grid">
  <div class="stat"><div class="n">${allFiles.length}</div><div class="l">Total Images</div></div>
  <div class="stat new"><div class="n">${dbNew}</div><div class="l">Not in DB</div></div>
  <div class="stat dupe"><div class="n">${dbMatches}</div><div class="l">Already in DB</div></div>
  <div class="stat hd-dupe"><div class="n">${hdDupeFileCount}</div><div class="l">HD Internal Dupes</div></div>
  <div class="stat"><div class="n">${cameras.size}</div><div class="l">Unique Cameras</div></div>
</div>

<h2>CAMERAS / DEVICES</h2>
<div class="cameras">`;

for (const [cam, count] of [...cameras.entries()].sort((a, b) => b[1] - a[1])) {
  const parts = cam.split(' | ');
  html += `<div class="cam-row">
    <div class="cam-count">${count}</div>
    <div class="cam-name">${parts.slice(0, 2).join(' ')}</div>
    ${parts[2] ? `<div class="cam-serial">S/N: ${parts[2]}</div>` : ''}
  </div>`;
}

html += `</div>`;

// HD-internal duplicates section
if (hdDupes.length > 0) {
  html += `<div class="hd-dupe-section">
  <h2 style="margin-top:0; color:#ff9800;">HD INTERNAL DUPLICATES (${hdDupes.length} images in ${hdDupeFileCount + hdDupes.length} locations)</h2>
  <p style="color:#888">Same file (identical SHA-256) exists in multiple folders on the drive.</p>
  <details><summary>Show all ${hdDupes.length} duplicated images</summary>
  <table>
  <tr><th>Hash (first 12)</th><th>Copies</th><th>Locations</th></tr>`;
  for (const d of hdDupes.slice(0, 200)) {
    const locs = d.files.map(f => f.folder + '/' + f.name).join('<br>');
    html += `<tr><td style="font-family:monospace;font-size:11px">${d.hash.slice(0, 12)}</td><td>${d.files.length}</td><td style="font-size:11px">${locs}</td></tr>`;
  }
  if (hdDupes.length > 200) html += `<tr><td colspan="3" style="color:#888">... and ${hdDupes.length - 200} more</td></tr>`;
  html += `</table></details></div>`;
}

// Per-folder sections
html += `<h2>BY FOLDER</h2>`;
const sortedFolders = [...byFolder.entries()].sort((a, b) => {
  const aNew = a[1].filter(f => !f.inDb).length;
  const bNew = b[1].filter(f => !f.inDb).length;
  return bNew - aNew; // folders with most new files first
});

for (const [folder, files] of sortedFolders) {
  const newFiles = files.filter(f => !f.inDb);
  const dbFiles = files.filter(f => f.inDb);
  const hasNew = newFiles.length > 0;

  html += `<div class="folder-section ${hasNew ? 'has-new' : ''}">
  <div class="folder-header">
    <div>
      <strong>${folder}</strong>
      <span style="color:#888; margin-left: 12px">${files.length} images</span>
      ${newFiles.length ? `<span class="tag tag-new">${newFiles.length} NEW</span>` : ''}
      ${dbFiles.length ? `<span class="tag tag-db">${dbFiles.length} IN DB</span>` : ''}
    </div>
  </div>`;

  // Thumbnails for new files
  const thumbFiles = newFiles.filter(f => f.thumbnail);
  if (thumbFiles.length) {
    html += `<div class="thumbs">`;
    for (const f of thumbFiles) {
      html += `<img class="thumb" src="${f.thumbnail}" title="${f.name}${f.exif?.dateTime ? '\n' + f.exif.dateTime : ''}${f.exif?.cameraModel ? '\n' + f.exif.cameraModel : ''}" />`;
    }
    html += `</div>`;
  }

  // File table
  if (files.length <= 30 || hasNew) {
    const showFiles = hasNew ? newFiles.slice(0, 30) : files.slice(0, 15);
    html += `<details${hasNew ? ' open' : ''}><summary>${hasNew ? `${newFiles.length} new files` : `${files.length} files (all in DB)`}</summary>
    <table>
    <tr><th>File</th><th>Size</th><th>Date</th><th>Camera</th><th>Dimensions</th><th>GPS</th><th>Status</th></tr>`;
    for (const f of showFiles) {
      const e = f.exif || {};
      const status = f.inDb ? '<span class="tag tag-db">IN DB</span>' : '<span class="tag tag-new">NEW</span>';
      html += `<tr>
        <td>${f.name}</td>
        <td>${(f.size / 1024).toFixed(0)} KB</td>
        <td>${e.dateTime || '—'}</td>
        <td>${[e.cameraMake, e.cameraModel].filter(Boolean).join(' ') || '—'}${e.cameraSerial ? `<br><span style="color:#666;font-size:10px">S/N: ${e.cameraSerial}</span>` : ''}</td>
        <td>${e.width && e.height ? `${e.width}x${e.height}` : '—'}</td>
        <td>${e.latitude ? `${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}` : '—'}</td>
        <td>${status}</td>
      </tr>`;
    }
    if (showFiles.length < newFiles.length) {
      html += `<tr><td colspan="7" style="color:#888">... and ${newFiles.length - showFiles.length} more new files</td></tr>`;
    }
    html += `</table></details>`;
  }

  html += `</div>`;
}

html += `
<div style="margin:40px 0; padding:20px; background:#1a2a1a; border:2px solid #4CAF50;">
  <h2 style="margin-top:0">SUMMARY</h2>
  <ul>
    <li><strong>${dbNew}</strong> images on the HD are NOT in the database — ready to upload after review</li>
    <li><strong>${dbMatches}</strong> images are already in the DB (exact SHA-256 match) — will be skipped</li>
    <li><strong>${hdDupeFileCount}</strong> files are internal duplicates on the HD itself (same image in multiple folders)</li>
    <li><strong>${cameras.size}</strong> unique camera/phone devices detected</li>
  </ul>
</div>
</body></html>`;

const outputPath = 'hd-full-scan-report.html';
writeFileSync(outputPath, html);
console.log(`\nReport: ${outputPath} (${(html.length / 1024).toFixed(0)} KB)`);
console.log('Opening in browser...');
try { execSync(`open "${outputPath}"`); } catch {}
