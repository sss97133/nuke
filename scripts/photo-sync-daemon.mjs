#!/usr/bin/env node
/**
 * NUKE PHOTO SYNC DAEMON — the passive capture organ.
 *
 * iPhone → iCloud → this Mac's Photos library → nuke. Zero phone touches.
 * Runs every 15 min via LaunchAgent (scripts/install-photo-sync.sh).
 *
 * Unlike iphoto-intake.mjs (album-driven, manual, needs a human to curate
 * albums and run commands), this daemon asks one question: "what photos were
 * added to the library since my last sync?" — exports them with GPS/EXIF,
 * uploads to the personal library (vehicle_id NULL), and lets the SERVER
 * pipeline file them: photo-pipeline-orchestrator classifies, then resolves
 * the vehicle via GPS proximity (auto_match_image_to_vehicles) and rolling
 * user context. Strays surface at /inbox.
 *
 * State: ~/.nuke/photo-sync-state.json   Log: ~/.nuke/photo-sync.log
 * Engine: osxphotos (same as iphoto-intake.mjs). Row shape cloned from
 * iphoto-intake so downstream behavior (hero trust, pipeline) is identical.
 *
 * Usage:
 *   dotenvx run -- node scripts/photo-sync-daemon.mjs            # sync new
 *   dotenvx run -- node scripts/photo-sync-daemon.mjs --dry-run  # preview
 *   dotenvx run -- node scripts/photo-sync-daemon.mjs --since 2026-06-01
 */

import { createClient } from '@supabase/supabase-js';
import { spawnSync, execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync, appendFileSync } from 'fs';
import { join, extname } from 'path';
import { homedir, tmpdir } from 'os';
import dns from 'dns';

// ─── DNS fix (same as iphoto-intake/hd-intake — some networks break supabase DNS) ─
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) return origLookup(hostname, options, callback);
    if (options?.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing SUPABASE_URL / SERVICE_ROLE_KEY env'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const BUCKET = 'vehicle-photos';                                  // same as iphoto-intake
const USER_ID = process.env.NUKE_USER_ID || '0b9f107a-d124-49de-9ded-94698f63c1c4';
const STATE_DIR = join(homedir(), '.nuke');
const STATE_FILE = join(STATE_DIR, 'photo-sync-state.json');
const LOG_FILE = join(STATE_DIR, 'photo-sync.log');
const MAX_PER_RUN = 200;                                          // safety valve
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const INCLUDE_UNLABELED = args.includes('--include-unlabeled');
const sinceArg = (() => { const i = args.indexOf('--since'); return i >= 0 ? args[i + 1] : null; })();

// ─── On-device privacy gate ──────────────────────────────────────────────────
// Per docs/architecture/IMAGE_OWNERSHIP_ONTOLOGY.md: a photo library contains
// people, places, and private life — not vehicle evidence. The cloud must
// never see those. Apple Photos has ALREADY classified every photo on-device
// (free, private); we sync only what its labels say is plausibly vehicle
// evidence. Everything else never leaves this Mac. Server-side vision_gate /
// classification remains as the second pass for what does get through.
const VEHICLE_LABEL_RE = /vehicle|car|truck|automobile|motorcycle|van|jeep|tractor|trailer|wheel|tire|engine|machine|garage|workshop|tool|boat|text|document|receipt|paper/i;

// Known shop coordinates — GPS at a work location is a STRONGER vehicle signal
// than any Apple label. Apple frequently leaves work photos unlabeled (all 106
// June 2026 photos: zero labels, 84 of them at Ernie's), so a label-only gate
// holds back the actual build work. A photo shot at a shop is work evidence by
// definition; home/personal GPS is never on this list, so the privacy gate holds.
// Add shops here as they're confirmed (lat, lon, ~550m tolerance).
const SHOP_LOCATIONS = [
  { name: 'ernies_upholstery', lat: 35.977, lon: -114.854 },
];
const SHOP_TOL = 0.005;

function isAtShop(photo) {
  const lat = photo.latitude, lon = photo.longitude;
  if (lat == null || lon == null) return false;
  return SHOP_LOCATIONS.some((s) => Math.abs(lat - s.lat) < SHOP_TOL && Math.abs(lon - s.lon) < SHOP_TOL);
}

function isVehicleish(photo) {
  // GPS-at-shop passes regardless of labels — work location beats Apple's tagging.
  if (isAtShop(photo)) return true;
  const labels = photo.labels || photo.labels_normalized || [];
  if (labels.length === 0) return INCLUDE_UNLABELED; // unlabeled off-shop: private by default
  return labels.some((l) => VEHICLE_LABEL_RE.test(String(l)));
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { mkdirSync(STATE_DIR, { recursive: true }); appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── 1. What's new in the Photos library? ────────────────────────────────────
function queryNewPhotos(sinceISO) {
  const sinceDate = sinceISO.slice(0, 10);
  const result = spawnSync('osxphotos', [
    'query', '--added-after', sinceDate, '--json',
    '--not-hidden', '--photos-library-last',
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

  if (result.status !== 0) {
    // --photos-library-last / --not-hidden may not exist on older osxphotos; retry minimal
    const retry = spawnSync('osxphotos', ['query', '--added-after', sinceDate, '--json'],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (retry.status !== 0) {
      log(`FATAL osxphotos query failed: ${(retry.stderr || result.stderr || '').slice(0, 300)}`);
      process.exit(1);
    }
    return JSON.parse(retry.stdout || '[]');
  }
  return JSON.parse(result.stdout || '[]');
}

// ─── 2. Export originals (downloads iCloud-only) ────────────────────────────
function exportPhotos(uuids, destDir) {
  mkdirSync(destDir, { recursive: true });
  const uuidArgs = uuids.flatMap(u => ['--uuid', u]);
  const result = spawnSync('osxphotos', [
    'export', destDir, ...uuidArgs,
    '--download-missing', '--overwrite', '--filename', '{original_name}',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  if (result.status !== 0) log(`export warnings: ${(result.stderr || '').slice(0, 300)}`);
  return readdirSync(destDir).filter(f => IMAGE_EXT.has(extname(f).toLowerCase()));
}

// ─── 3. Upload one photo (row shape cloned from iphoto-intake.mjs) ───────────
async function uploadPhoto(filePath, filename, meta) {
  const fileSize = statSync(filePath).size;
  const ext = extname(filename).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.heic' ? 'image/heic' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  // Personal library namespace — no vehicle yet; server pipeline resolves it
  const storagePath = `users/${USER_ID}/photo-sync/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, readFileSync(filePath), { contentType: mimeType, upsert: false });
  if (uploadError && !String(uploadError.message || '').includes('already exists')) {
    return { ok: false, err: uploadError.message };
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  const row = {
    vehicle_id: null,                              // pipeline files it (GPS → rolling context)
    image_url: publicUrl,
    storage_path: storagePath,
    source: 'iphoto',                              // owner-trust source (hero selection, provenance)
    mime_type: mimeType,
    file_name: filename,
    file_size: fileSize,
    is_external: false,
    ai_processing_status: 'pending',               // INSERT trigger + drain cron take over
    user_id: USER_ID,
    documented_by_user_id: USER_ID,
    ...(meta.latitude != null && { latitude: meta.latitude }),
    ...(meta.longitude != null && { longitude: meta.longitude }),
    ...(meta.place?.name && { location_name: meta.place.name }),
    ...(meta.date && { taken_at: meta.date }),
    exif_data: {
      ...(meta.exif_info || {}),
      uuid: meta.uuid,
      original_filename: meta.original_filename,
      synced_by: 'photo-sync-daemon',
    },
    // Pass Apple's on-device labels through — photo-pipeline-orchestrator
    // reads apple_ml_labels for its non-automotive fast-path.
    ...(Array.isArray(meta.labels) && meta.labels.length > 0 && { apple_ml_labels: meta.labels }),
  };

  const { error: insertError } = await supabase.from('vehicle_images').insert(row);
  if (insertError) {
    const m = String(insertError.message || '');
    if (m.includes('duplicate') || m.includes('unique')) return { ok: true, dup: true };
    return { ok: false, err: m };
  }
  return { ok: true };
}

// ─── Label audit: measure Apple's classification before trusting it ─────────
// Usage: node scripts/photo-sync-daemon.mjs --audit-labels [days]
// Scans the library (no export, no upload, nothing leaves the Mac), writes
// per-photo decisions to ~/.nuke/label-audit.jsonl and prints the summary
// that answers: how many photos have labels at all, what are the labels,
// what would the gate sync vs hold back. This is the dataset for tuning
// VEHICLE_LABEL_RE — measure, don't guess.
async function auditLabels(days) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const photos = queryNewPhotos(since).filter(p => !p.ismovie && !p.hidden);
  const auditFile = join(STATE_DIR, 'label-audit.jsonl');
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(auditFile, '');

  const labelCounts = new Map();
  let labeled = 0, wouldSync = 0;
  for (const p of photos) {
    const labels = p.labels || p.labels_normalized || [];
    if (labels.length > 0) labeled++;
    const sync = isVehicleish(p);
    if (sync) wouldSync++;
    for (const l of labels) labelCounts.set(l, (labelCounts.get(l) || 0) + 1);
    appendFileSync(auditFile, JSON.stringify({
      file: p.original_filename, taken: p.date, gps: p.latitude != null,
      labels, decision: sync ? 'sync' : 'hold',
    }) + '\n');
  }

  const top = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(`\n── LABEL AUDIT (last ${days}d) ─────────────────────────`);
  console.log(`photos:        ${photos.length}`);
  console.log(`with labels:   ${labeled} (${photos.length ? Math.round(labeled / photos.length * 100) : 0}%)`);
  console.log(`would sync:    ${wouldSync}`);
  console.log(`held on-device:${photos.length - wouldSync}`);
  console.log(`top labels:`);
  for (const [l, n] of top) console.log(`  ${String(n).padStart(5)}  ${l}${VEHICLE_LABEL_RE.test(l) ? '   ← gate matches' : ''}`);
  console.log(`\nper-photo decisions: ${auditFile}`);
  console.log(`If real vehicle photos show under "held", widen VEHICLE_LABEL_RE with the labels you see here.`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const auditIdx = args.indexOf('--audit-labels');
  if (auditIdx >= 0) {
    await auditLabels(parseInt(args[auditIdx + 1] || '30', 10));
    return;
  }
  const state = readState();
  const since = sinceArg || state.last_sync || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const runStartedAt = new Date().toISOString();
  log(`sync start — photos added since ${since}${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const photos = queryNewPhotos(since);
  const candidates = photos.filter(p => !p.ismovie && !p.hidden);
  const images = candidates.filter(isVehicleish).slice(0, MAX_PER_RUN);
  const heldBack = candidates.filter(p => !isVehicleish(p));
  if (heldBack.length > 0) {
    log(`${heldBack.length} photo(s) held back on-device (no vehicle-ish labels — never uploaded)`);
    // Decision log (local only): the dataset for auditing gate quality later.
    const heldFile = join(STATE_DIR, 'held-back.jsonl');
    for (const p of heldBack) {
      appendFileSync(heldFile, JSON.stringify({
        at: runStartedAt, file: p.original_filename, taken: p.date,
        labels: p.labels || [], gps: p.latitude != null,
      }) + '\n');
    }
  }

  if (images.length === 0) {
    log('nothing new');
    if (!DRY_RUN) writeState({ ...state, last_sync: runStartedAt, last_run: runStartedAt, last_result: 'nothing_new' });
    return;
  }

  log(`${images.length} new photo(s) (${images.filter(p => p.latitude != null).length} with GPS)`);
  if (DRY_RUN) {
    images.forEach(p => log(`  would sync: ${p.original_filename} taken=${p.date} gps=${p.latitude != null}`));
    return;
  }

  const destDir = join(tmpdir(), `nuke-photo-sync-${Date.now()}`);
  const exported = exportPhotos(images.map(p => p.uuid), destDir);
  const metaByName = new Map();
  for (const p of images) metaByName.set(p.original_filename, p);

  let ok = 0, dup = 0, failed = 0;
  for (const filename of exported) {
    const meta = metaByName.get(filename) || {};
    const res = await uploadPhoto(join(destDir, filename), filename, meta);
    if (res.ok && res.dup) dup++;
    else if (res.ok) ok++;
    else { failed++; if (failed <= 3) log(`  upload failed [${filename}]: ${res.err}`); }
  }

  try { rmSync(destDir, { recursive: true, force: true }); } catch { /* ignore */ }

  // Advance state ONLY past what succeeded: if anything failed, do not move
  // the watermark — next run retries. (Silent-failure law: the daemon must
  // never claim progress it didn't make.)
  const newState = { ...state, last_run: runStartedAt, last_result: `${ok} uploaded, ${dup} dup, ${failed} failed` };
  if (failed === 0) newState.last_sync = runStartedAt;
  writeState(newState);

  log(`sync done — ${ok} uploaded, ${dup} duplicates, ${failed} failed${failed > 0 ? ' (watermark NOT advanced — will retry)' : ''}`);

  // Heartbeat into the mesh so the pulse board sees this organ
  try {
    await supabase.from('app_events').insert({
      event: 'photo_sync_run',
      props: { uploaded: ok, duplicates: dup, failed, queried: images.length },
      session_key: 'photo-sync-daemon',
      user_id: USER_ID,
      path: 'daemon',
    });
  } catch { /* heartbeat is best-effort */ }
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
