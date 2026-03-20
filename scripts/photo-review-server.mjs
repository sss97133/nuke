#!/usr/bin/env node
/**
 * Local Photo Review Server
 *
 * Scans Photos library with osxphotos, filters by Apple ML labels,
 * serves thumbnails from local disk, lets you accept/reject in browser.
 * Only uploads accepted photos to Supabase.
 *
 * Usage:
 *   dotenvx run -- node scripts/photo-review-server.mjs
 *   dotenvx run -- node scripts/photo-review-server.mjs --library "/Volumes/NukePortable/Pictures/Photos Library.photoslibrary"
 *   dotenvx run -- node scripts/photo-review-server.mjs --since 2024-01-01
 *
 * Opens browser to http://localhost:3847
 */

import http from 'http';
import { spawnSync, execSync } from 'child_process';
import { readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import os from 'os';
import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

// DNS fix
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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing env vars. Run with: dotenvx run -- node scripts/photo-review-server.mjs');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch: nodeFetch } });

const PORT = 3847;
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const LIBRARY_PATH = arg('--library');
const SINCE = arg('--since') || '2024-01-01';
const TO_DATE = arg('--to-date');

// Apple ML labels
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

function scorePhoto(labels) {
  if (!labels?.length) return 0;
  let score = 0, reject = 0;
  for (const l of labels) {
    if (VEHICLE_LABELS.has(l)) score += 0.3;
    if (REJECT_LABELS.has(l)) reject += 0.4;
  }
  if (labels.filter(l => VEHICLE_LABELS.has(l)).length >= 2) score += 0.2;
  return Math.max(0, Math.min(1, score - reject));
}

// ─── Scan library ────────────────────────────────────────────────
let allPhotos = [];
let scanComplete = false;
let scanError = null;

function scanLibrary() {
  console.log(`Scanning library since ${SINCE}...`);
  const qArgs = ['query', '--from-date', SINCE, '--json'];
  if (TO_DATE) qArgs.push('--to-date', TO_DATE);
  if (LIBRARY_PATH) qArgs.push('--library', LIBRARY_PATH);

  const tmpOut = join(os.tmpdir(), `photo_review_${Date.now()}.json`);
  const result = spawnSync('bash', ['-c',
    `osxphotos ${qArgs.map(a => `"${a}"`).join(' ')} > "${tmpOut}" 2>/dev/null`
  ], { encoding: 'utf8', timeout: 600000 });

  if (result.status !== 0) {
    scanError = 'osxphotos query failed';
    scanComplete = true;
    return;
  }

  try {
    let raw = readFileSync(tmpOut, 'utf8');
    rmSync(tmpOut, { force: true });
    raw = raw.replace(/-Infinity|Infinity|NaN/g, 'null');
    const parsed = JSON.parse(raw);

    // Filter videos
    const photos = parsed.filter(p => {
      const fn = (p.filename || p.original_filename || '').toLowerCase();
      return !fn.endsWith('.mov') && !fn.endsWith('.mp4') && !fn.endsWith('.m4v');
    });

    // Score and sort
    allPhotos = photos.map(p => {
      const score = scorePhoto(p.labels || []);
      const vLabels = (p.labels || []).filter(l => VEHICLE_LABELS.has(l));
      const rLabels = (p.labels || []).filter(l => REJECT_LABELS.has(l));
      // Store path for direct thumbnail serving
      if (p.path) photoPathMap.set(p.uuid, p.path);

      return {
        uuid: p.uuid,
        filename: p.original_filename || p.filename,
        date: p.date,
        score,
        vLabels,
        rLabels,
        allLabels: p.labels || [],
        latitude: p.latitude,
        longitude: p.longitude,
        place: extractPlace(p),
        isVehicle: score >= 0.3,
      };
    }).sort((a, b) => b.score - a.score);

    const vehicleCount = allPhotos.filter(p => p.isVehicle).length;
    console.log(`Scanned ${allPhotos.length} photos: ${vehicleCount} vehicle, ${allPhotos.length - vehicleCount} other`);
    scanComplete = true;
  } catch (e) {
    scanError = e.message;
    scanComplete = true;
    try { rmSync(tmpOut, { force: true }); } catch {}
  }
}

function extractPlace(p) {
  const pl = p.place;
  if (!pl) return null;
  if (typeof pl === 'string') return pl;
  if (pl.name) return pl.name;
  const a = pl.address || {};
  return [a.city, a.state_province].filter(Boolean).join(', ') || null;
}

// ─── Thumbnail cache ─────────────────────────────────────────────
const THUMB_DIR = join(os.tmpdir(), 'nuke_photo_review_thumbs');
mkdirSync(THUMB_DIR, { recursive: true });

// Map uuid -> original file path (populated during scan)
const photoPathMap = new Map();

function getThumbnail(uuid) {
  const cached = join(THUMB_DIR, `${uuid}.jpg`);
  if (existsSync(cached)) return readFileSync(cached);

  // Use direct file path from the library (no osxphotos export needed)
  const srcPath = photoPathMap.get(uuid);
  if (!srcPath || !existsSync(srcPath)) return null;

  try {
    execSync(`sips -s format jpeg "${srcPath}" --out "${cached}" -Z 400 -s formatOptions 70 > /dev/null 2>&1`);
  } catch {}

  return existsSync(cached) ? readFileSync(cached) : null;
}

// ─── HTML UI ─────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NUKE Photo Review</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: Arial, sans-serif; }

  .header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    background: #111; border-bottom: 2px solid #222; padding: 12px 20px;
    display: flex; align-items: center; gap: 16px;
  }
  .header h1 { font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #fff; }
  .stats { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
  .stats span { color: #fff; font-weight: bold; }

  .tabs { display: flex; gap: 2px; margin-left: auto; }
  .tab {
    padding: 6px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
    background: #1a1a1a; border: 1px solid #333; cursor: pointer; color: #888;
  }
  .tab.active { background: #fff; color: #000; border-color: #fff; }
  .tab .count { font-weight: bold; margin-left: 4px; }

  .grid {
    padding: 60px 8px 8px 8px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 4px;
  }

  .photo {
    position: relative; aspect-ratio: 1; overflow: hidden; cursor: pointer;
    border: 2px solid transparent; transition: border-color 0.1s;
  }
  .photo img { width: 100%; height: 100%; object-fit: cover; }
  .photo.selected { border-color: #fff; }
  .photo.accepted { border-color: #22c55e; }
  .photo.rejected { border-color: #ef4444; opacity: 0.4; }

  .photo .overlay {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: linear-gradient(transparent, rgba(0,0,0,0.8));
    padding: 20px 6px 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .photo .score {
    position: absolute; top: 4px; right: 4px;
    background: rgba(0,0,0,0.7); padding: 2px 6px; font-size: 10px; font-weight: bold;
  }
  .photo .score.high { color: #22c55e; }
  .photo .score.med { color: #eab308; }
  .photo .score.low { color: #ef4444; }

  .photo .labels { color: #999; font-size: 8px; margin-top: 2px; }
  .photo .vlabel { color: #22c55e; }

  .actions {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
    background: #111; border-top: 2px solid #222; padding: 10px 20px;
    display: flex; align-items: center; gap: 12px;
  }
  .actions.hidden { display: none; }
  .btn {
    padding: 8px 20px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
    border: 2px solid; cursor: pointer; font-weight: bold; background: transparent;
  }
  .btn-accept { color: #22c55e; border-color: #22c55e; }
  .btn-accept:hover { background: #22c55e; color: #000; }
  .btn-reject { color: #ef4444; border-color: #ef4444; }
  .btn-reject:hover { background: #ef4444; color: #000; }
  .btn-clear { color: #888; border-color: #444; }
  .sel-count { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-left: auto; }

  .loading { padding: 100px; text-align: center; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 2px; }
  .place { color: #666; font-size: 8px; }
</style>
</head><body>

<div class="header">
  <h1>NUKE</h1>
  <div class="stats" id="stats">Loading...</div>
  <div class="tabs">
    <div class="tab active" data-filter="vehicle" id="tab-vehicle">Vehicle<span class="count" id="count-vehicle">-</span></div>
    <div class="tab" data-filter="all" id="tab-all">All<span class="count" id="count-all">-</span></div>
    <div class="tab" data-filter="accepted" id="tab-accepted">Accepted<span class="count" id="count-accepted">0</span></div>
    <div class="tab" data-filter="rejected" id="tab-rejected">Rejected<span class="count" id="count-rejected">0</span></div>
  </div>
</div>

<div class="grid" id="grid">
  <div class="loading">Scanning library...</div>
</div>

<div class="actions hidden" id="actions">
  <button class="btn btn-accept" onclick="acceptSelected()">Accept</button>
  <button class="btn btn-reject" onclick="rejectSelected()">Reject</button>
  <button class="btn btn-clear" onclick="clearSelection()">Clear</button>
  <div class="sel-count"><span id="sel-count">0</span> selected</div>
</div>

<script>
let photos = [];
let filter = 'vehicle';
let selected = new Set();
let decisions = {}; // uuid -> 'accepted' | 'rejected'
let page = 0;
const PAGE_SIZE = 100;
let loading = false;

async function init() {
  const resp = await fetch('/api/photos');
  const data = await resp.json();
  if (data.error) { document.getElementById('grid').innerHTML = '<div class="loading">' + data.error + '</div>'; return; }
  if (!data.ready) { setTimeout(init, 2000); return; }

  photos = data.photos;
  updateStats();
  renderGrid();
}

function updateStats() {
  const vehicle = photos.filter(p => p.isVehicle).length;
  const accepted = Object.values(decisions).filter(d => d === 'accepted').length;
  const rejected = Object.values(decisions).filter(d => d === 'rejected').length;

  document.getElementById('stats').innerHTML =
    '<span>' + photos.length + '</span> total / <span>' + vehicle + '</span> vehicle / <span>' + (photos.length - vehicle) + '</span> other';
  document.getElementById('count-vehicle').textContent = vehicle;
  document.getElementById('count-all').textContent = photos.length;
  document.getElementById('count-accepted').textContent = accepted;
  document.getElementById('count-rejected').textContent = rejected;
}

function getFiltered() {
  if (filter === 'vehicle') return photos.filter(p => p.isVehicle);
  if (filter === 'accepted') return photos.filter(p => decisions[p.uuid] === 'accepted');
  if (filter === 'rejected') return photos.filter(p => decisions[p.uuid] === 'rejected');
  return photos;
}

function renderGrid() {
  const grid = document.getElementById('grid');
  const filtered = getFiltered();
  const toShow = filtered.slice(0, (page + 1) * PAGE_SIZE);

  grid.innerHTML = toShow.map(p => {
    const dec = decisions[p.uuid] || '';
    const sel = selected.has(p.uuid) ? 'selected' : '';
    const scoreClass = p.score >= 0.8 ? 'high' : p.score >= 0.3 ? 'med' : 'low';
    const vLabels = p.vLabels.map(l => '<span class="vlabel">' + l + '</span>').join(', ');
    const place = p.place ? '<div class="place">' + p.place + '</div>' : '';

    return '<div class="photo ' + dec + ' ' + sel + '" data-uuid="' + p.uuid + '" onclick="toggleSelect(event, \\'' + p.uuid + '\\')">' +
      '<img loading="lazy" src="/thumb/' + p.uuid + '" alt="">' +
      '<div class="score ' + scoreClass + '">' + p.score.toFixed(2) + '</div>' +
      '<div class="overlay">' +
        '<div>' + (p.filename || '') + '</div>' +
        '<div class="labels">' + vLabels + '</div>' +
        place +
      '</div>' +
    '</div>';
  }).join('');

  // Lazy load more on scroll
  if (toShow.length < filtered.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'loading';
    sentinel.textContent = 'Scroll for more (' + (filtered.length - toShow.length) + ' remaining)';
    sentinel.id = 'sentinel';
    grid.appendChild(sentinel);

    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading) {
        loading = true;
        page++;
        renderGrid();
        loading = false;
      }
    });
    obs.observe(sentinel);
  }
}

function toggleSelect(e, uuid) {
  if (e.shiftKey && selected.size > 0) {
    // Range select
    const filtered = getFiltered();
    const uuids = filtered.map(p => p.uuid);
    const lastSelected = [...selected].pop();
    const start = uuids.indexOf(lastSelected);
    const end = uuids.indexOf(uuid);
    const [lo, hi] = start < end ? [start, end] : [end, start];
    for (let i = lo; i <= hi; i++) selected.add(uuids[i]);
  } else if (e.metaKey || e.ctrlKey) {
    if (selected.has(uuid)) selected.delete(uuid);
    else selected.add(uuid);
  } else {
    if (selected.has(uuid) && selected.size === 1) selected.clear();
    else { selected.clear(); selected.add(uuid); }
  }
  updateSelection();
}

function updateSelection() {
  document.querySelectorAll('.photo').forEach(el => {
    el.classList.toggle('selected', selected.has(el.dataset.uuid));
  });
  document.getElementById('sel-count').textContent = selected.size;
  document.getElementById('actions').classList.toggle('hidden', selected.size === 0);
}

function acceptSelected() {
  selected.forEach(uuid => decisions[uuid] = 'accepted');
  selected.clear();
  updateSelection();
  updateStats();
  renderGrid();
}

function rejectSelected() {
  selected.forEach(uuid => decisions[uuid] = 'rejected');
  selected.clear();
  updateSelection();
  updateStats();
  renderGrid();
}

function clearSelection() {
  selected.clear();
  updateSelection();
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    getFiltered().forEach(p => selected.add(p.uuid));
    updateSelection();
  }
  if (e.key === 'Escape') { clearSelection(); }
  if (e.key === 'Enter' && selected.size > 0) { acceptSelected(); }
  if (e.key === 'Backspace' && selected.size > 0 && !e.metaKey) { e.preventDefault(); rejectSelected(); }
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    filter = tab.dataset.filter;
    page = 0;
    renderGrid();
  });
});

init();
</script>
</body></html>`;

// ─── HTTP Server ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve UI
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
    return;
  }

  // API: photo list
  if (url.pathname === '/api/photos') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!scanComplete) {
      res.end(JSON.stringify({ ready: false, scanning: true }));
    } else if (scanError) {
      res.end(JSON.stringify({ ready: true, error: scanError }));
    } else {
      res.end(JSON.stringify({ ready: true, photos: allPhotos }));
    }
    return;
  }

  // Thumbnails
  if (url.pathname.startsWith('/thumb/')) {
    const uuid = url.pathname.slice(7);
    const thumb = getThumbnail(uuid);
    if (thumb) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      res.end(thumb);
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  const libLabel = LIBRARY_PATH ? basename(LIBRARY_PATH) : 'System Library';
  console.log(`\n  NUKE Photo Review`);
  console.log(`  Library: ${libLabel}`);
  console.log(`  Since:   ${SINCE}`);
  console.log(`  URL:     http://localhost:${PORT}\n`);

  // Open browser
  execSync(`open http://localhost:${PORT}`);

  // Start scan in background
  scanLibrary();
});
