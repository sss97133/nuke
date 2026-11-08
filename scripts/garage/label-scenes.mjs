#!/usr/bin/env node
// Scene producer: labels each photo session with what the photos show, so derive_vehicle_relationships can use the scene as
// cited evidence (supports or contradicts an organization; the pre-auction rule). A label is the model's testimony, not a fact:
// model, confidence and rationale are kept, and no vehicle id, organization name or user label is an input anywhere.
//
//   node scripts/garage/label-scenes.mjs --sessions-json /workspace/scene_sessions.json
//        [--out /workspace/scene_labels.jsonl] [--cte-out /workspace/scene_labels.cte.sql] [--cache-dir /tmp/label-scenes-cache]
//        [--backend claude-cli] [--model <name>] [--limit n] [--apply]
//
// Input rows (from scripts/garage/scene-sessions.mjs): vehicle_id, session_key, image_ids, sample_urls (up to 4 are used).
// Per session: download the samples to the cache dir (HEIC -> JPEG with python3 + pillow_heif, else sharp when installed), then ask
// the backend. Backend 'claude-cli' (default) runs `claude -p` (~/.local/bin/claude; CLAUDE_CODE_OAUTH_TOKEN comes from the
// caller's environment) with the image paths in the prompt and the Read tool allowed; it must answer strict JSON
// {scene_label, confidence, rationale}. The reply is validated; one retry on invalid output; a session that still fails is
// reported on stderr and skipped (never guessed).
// Output: JSONL of cited inferences and a `scene_labels` VALUES CTE (paste over the scene_labels placeholder of
// supabase/sql/derive_vehicle_relationships_preview.sql). --apply POSTs the rows to vehicle_photo_session_scenes through PostgREST
// with SUPABASE_SERVICE_ROLE_KEY (append-only table, UNIQUE (run_id, vehicle_id, session_key)); without --apply nothing is written.
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SCENE_LABELS = ['dealer_lot', 'showroom', 'shop_interior', 'upholstery_work', 'paint_body', 'outdoor_street', 'other'];
export const PRODUCER = 'scripts/garage/label-scenes.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const MAX_SAMPLES = 4;

// ---- pure helpers (tested) -------------------------------------------------------------------------------------------------

// A session row from scene-sessions.mjs (sample_urls / image_ids) or from an older file (sample_image_urls / sample_image_ids).
export function normalizeSession(r) {
  const urls = (r.sample_urls ?? r.sample_image_urls ?? []).filter((u) => typeof u === 'string' && u).slice(0, MAX_SAMPLES);
  const ids = r.image_ids ?? r.sample_image_ids ?? [];
  if (!UUID.test(r.vehicle_id ?? '')) throw new Error(`session without a valid vehicle_id: ${JSON.stringify(r).slice(0, 120)}`);
  if (!r.session_key) throw new Error(`session ${r.vehicle_id} has no session_key`);
  return { vehicle_id: r.vehicle_id.toLowerCase(), session_key: String(r.session_key), image_ids: ids.filter((i) => UUID.test(i)), sample_urls: urls };
}

export function buildPrompt(files) {
  return `You are labelling ONE photo session of a vehicle so a database can record where the photos were taken. Use the Read tool on each image file below, then look at what is visible (buildings, signage, floor, lifts and tools, other cars, backdrops).

Files:
${files.map((f) => `- ${f}`).join('\n')}

Choose exactly one scene_label for the session as a whole:
- dealer_lot: cars parked outside in rows or on a sales lot, price boards or dealer signage
- showroom: indoor display floor, polished floor, staged cars in a sales space
- shop_interior: workshop bays, lifts, tool chests, a car on stands or partly disassembled
- upholstery_work: seats, door cards, headliner, trim or leather being cut, sewn or fitted
- paint_body: body filler, sanding, masking, primer or a paint booth
- outdoor_street: ordinary street, driveway, parking lot or scenery with no business setting
- other: none of the above, or you cannot tell
Do not infer from anything but the pixels. If the images are unreadable or uninformative use "other" with a low confidence.

Answer with ONLY one JSON object on one line, no markdown and no other text:
{"scene_label":"<one of dealer_lot|showroom|shop_interior|upholstery_work|paint_body|outdoor_street|other>","confidence":<0 to 1>,"rationale":"<one or two sentences naming what you saw>"}`;
}

// Pull the JSON object out of a model reply (it may arrive in a code fence or with a stray sentence) and validate it.
export function parseLabel(text) {
  const raw = String(text ?? '');
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in reply');
  let j;
  try { j = JSON.parse(raw.slice(a, b + 1)); } catch (e) { throw new Error(`reply is not JSON: ${e.message}`); }
  if (!SCENE_LABELS.includes(j.scene_label)) throw new Error(`scene_label ${JSON.stringify(j.scene_label)} is not one of ${SCENE_LABELS.join(', ')}`);
  const c = typeof j.confidence === 'string' && j.confidence.trim() !== '' ? Number(j.confidence) : j.confidence;
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) throw new Error('confidence must be a number between 0 and 1');
  const rationale = typeof j.rationale === 'string' ? j.rationale.trim() : '';
  if (!rationale) throw new Error('rationale is required');
  return { scene_label: j.scene_label, confidence: c, rationale: rationale.slice(0, 1000) };
}

export function toInference(session, label, { runId, model, createdAt = new Date().toISOString() }) {
  return { run_id: runId, vehicle_id: session.vehicle_id, session_key: session.session_key, image_ids: session.image_ids,
    scene_label: label.scene_label, model, confidence: label.confidence, rationale: label.rationale, producer: PRODUCER, created_at: createdAt };
}

const q = (t) => (t == null ? 'NULL::text' : `'${String(t).replace(/'/g, "''")}'`);

// The scene_labels CTE, same columns as the placeholder in the preview (WHERE true marks it as filled).
export function valuesCte(rows) {
  const head = 'scene_labels AS (\n  SELECT t.run_id, t.vehicle_id, t.session_key, t.image_ids, t.scene_label, t.model, t.confidence, t.rationale\n';
  const cols = 't(run_id, vehicle_id, session_key, image_ids, scene_label, model, confidence, rationale)';
  if (!rows.length) {
    return head + `    FROM (VALUES (NULL::uuid, NULL::uuid, NULL::text, NULL::uuid[], NULL::text, NULL::text, NULL::numeric, NULL::text))\n         ${cols}\n   WHERE false -- (scene_labels)\n),`;
  }
  const vals = rows.map((r) => `(${q(r.run_id)}::uuid, ${q(r.vehicle_id)}::uuid, ${q(r.session_key)}, `
    + `${r.image_ids.length ? `ARRAY[${r.image_ids.map((i) => `${q(i)}::uuid`).join(', ')}]` : 'ARRAY[]::uuid[]'}, ${q(r.scene_label)}, ${q(r.model)}, ${Number(r.confidence)}::numeric, ${q(r.rationale)})`);
  return head + `    FROM (VALUES\n      ${vals.join(',\n      ')})\n         ${cols}\n   WHERE true -- (scene_labels)\n),`;
}

// Body of the PostgREST insert for --apply (vehicle_photo_session_scenes columns only).
export function applyBody(rows) {
  return rows.map((r) => ({ run_id: r.run_id, vehicle_id: r.vehicle_id, session_key: r.session_key, image_ids: r.image_ids,
    scene_label: r.scene_label, model: r.model, confidence: r.confidence, rationale: r.rationale }));
}

// ---- images ----------------------------------------------------------------------------------------------------------------

export function isHeic(buf) {
  if (buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(buf.toString('latin1', 8, 12));
}

function heicToJpeg(inPath, outPath) {
  try {
    execFileSync('python3', ['-c', 'import sys, pillow_heif\nfrom PIL import Image\npillow_heif.register_heif_opener()\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "JPEG", quality=88)', inPath, outPath], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

async function heicToJpegSharp(inPath, outPath) {
  try { const sharp = (await import('sharp')).default; await sharp(inPath).jpeg({ quality: 88 }).toFile(outPath); return true; } catch { return false; }
}

// Download one sample to the cache (content-addressed by URL); HEIC becomes JPEG. Returns the local path or null.
export async function fetchSample(url, cacheDir) {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 24);
  const jpg = join(cacheDir, `${key}.jpg`);
  if (existsSync(jpg)) return jpg;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (isHeic(buf)) {
    const raw = join(cacheDir, `${key}.heic`);
    writeFileSync(raw, buf);
    if (heicToJpeg(raw, jpg) || await heicToJpegSharp(raw, jpg)) return jpg;
    throw new Error(`could not convert HEIC (pillow_heif and sharp both failed): ${url}`);
  }
  const ext = buf[0] === 0x89 ? 'png' : buf.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : 'jpg';
  const out = ext === 'jpg' ? jpg : join(cacheDir, `${key}.${ext}`);
  writeFileSync(out, buf);
  return out;
}

// ---- backends --------------------------------------------------------------------------------------------------------------

// Each backend: async ({ files, cacheDir, model }) -> raw reply text. Add a backend here; the rest of the script is unchanged.
export const BACKENDS = {
  'claude-cli': async ({ files, cacheDir, model, bin = process.env.CLAUDE_BIN ?? join(homedir(), '.local/bin/claude') }) => {
    const args = ['-p', '--allowedTools', 'Read', '--add-dir', cacheDir, '--output-format', 'text'];
    if (model) args.push('--model', model);
    return await new Promise((resolve, reject) => {
      const p = execFile(bin, args, { env: process.env, maxBuffer: 1 << 24, timeout: 240000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`claude -p failed: ${err.message}${stderr ? ` | ${String(stderr).slice(0, 300)}` : ''}`)); else resolve(stdout);
      });
      p.stdin.end(buildPrompt(files));
    });
  },
};

export async function labelSession(session, { backend, cacheDir, model, fetchFn = fetchSample }) {
  if (!session.sample_urls.length) throw new Error('session has no sample urls');
  const files = [];
  for (const u of session.sample_urls) { try { files.push(await fetchFn(u, cacheDir)); } catch (e) { console.error(`  skip sample: ${e.message}`); } }
  if (!files.length) throw new Error('no sample image could be downloaded');
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) { // one retry on invalid output
    try { return parseLabel(await backend({ files, cacheDir, model })); } catch (e) { lastErr = e; }
  }
  throw new Error(`invalid model output after retry: ${lastErr.message}`);
}

// ---- main ------------------------------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
  const inFile = opt('sessions-json');
  if (!inFile) { console.error('usage: label-scenes.mjs --sessions-json <file> [--out f.jsonl] [--cte-out f.sql] [--backend claude-cli] [--model m] [--limit n] [--apply]'); process.exit(2); }
  const backendName = opt('backend', 'claude-cli');
  const backend = BACKENDS[backendName];
  if (!backend) { console.error(`unknown backend ${backendName}; available: ${Object.keys(BACKENDS).join(', ')}`); process.exit(2); }
  const out = opt('out', '/workspace/scene_labels.jsonl');
  const cteOut = opt('cte-out', out.replace(/\.jsonl$/, '') + '.cte.sql');
  const cacheDir = opt('cache-dir', '/tmp/label-scenes-cache');
  mkdirSync(cacheDir, { recursive: true });
  const limit = Number(opt('limit', '0')) || Infinity;
  const apply = args.includes('--apply');
  const modelOpt = opt('model');
  const model = `${backendName}:${modelOpt ?? 'default'}`;
  const sessions = JSON.parse(readFileSync(inFile, 'utf8')).map(normalizeSession).slice(0, limit);
  const runId = randomUUID();
  const rows = []; const failed = [];
  for (const [i, s] of sessions.entries()) {
    try {
      const label = await labelSession(s, { backend, cacheDir, model: modelOpt });
      rows.push(toInference(s, label, { runId, model }));
      console.error(`[${i + 1}/${sessions.length}] ${s.session_key} -> ${label.scene_label} (${label.confidence})`);
    } catch (e) { failed.push({ session_key: s.session_key, vehicle_id: s.vehicle_id, error: e.message }); console.error(`[${i + 1}/${sessions.length}] ${s.session_key} FAILED: ${e.message}`); }
  }
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  writeFileSync(cteOut, valuesCte(rows) + '\n');
  console.error(`run ${runId}: ${rows.length} labelled, ${failed.length} failed -> ${out}, ${cteOut}${apply ? '' : ' (dry run, no database write)'}`);
  if (apply && rows.length) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
    const base = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? PROJECT_URL;
    const res = await fetch(`${base}/rest/v1/vehicle_photo_session_scenes`, { method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(applyBody(rows)), signal: AbortSignal.timeout(60000) });
    console.error(res.ok ? `inserted ${rows.length} rows` : `insert failed: ${res.status} ${await res.text()}`);
    if (!res.ok) process.exit(1);
  }
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
