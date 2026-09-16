#!/usr/bin/env node
/**
 * analyze-capture-photos.mjs — BYOK per-image analysis for UPLOADED-BUT-UNANALYZED
 * capture_relay_ios photos (the ANALYSIS_DIRECTIVE made real).
 *
 * THE PROBLEM this solves
 *   Photos arriving via the iOS capture relay land with ai_processing_status='completed'
 *   — which means UPLOAD-done, NOT analyzed (0 labels, 0 components). The existing BYOK
 *   harness (byok-image-batch.sh) is VEHICLE-keyed and writes vehicle_observations; these
 *   capture photos have no vehicle (only a handful do), so nothing ever analyzed them.
 *   Vehicle attribution is a LATER step. This runner analyzes each image FIRST
 *   (scene / components / intent / narrative — no vehicle required) and lands the verdict
 *   in image_analysis_records (vehicle_id LEFT NULL).
 *
 * ARCHITECTURE NOTE — READ before "fixing" the network (same rule as byok-image-batch.sh)
 *   The Claude Code Bash *sandbox* silently drops the Supabase connection (HTTP 000 / 15s
 *   hang); the remote DB answers in ~0.07s from a normal shell. So:
 *     - PREPARE / DOWNLOAD / INGEST make network calls → run in a plain (un-sandboxed)
 *       login shell via `dotenvx run -- node ...`. The Supabase writes happen INSIDE this
 *       Node process (service-role client), exactly like deep-image-analysis-byok.mjs.
 *     - ANALYZE shells out to `claude --print`, which touches NO network — it only Reads
 *       already-downloaded local JPEGs and Writes a verdicts JSONL. The sandbox can't bite
 *       a step that makes no network calls.
 *
 * PIPELINE (single process, end to end):
 *   prepare worklist → download images → claude analyzes → sanitize → ingest → mark analyzed
 *   Idempotent: prepare excludes images whose ai_scan_metadata.byok_deep_analysis exists.
 *
 * LANDING — CANONICAL (reconciled 2026-06-14; was the image_analysis_records fork):
 *   vehicle_images.ai_scan_metadata.byok_deep_analysis — the SAME home the existing
 *   pipeline (deep-image-analysis-byok.mjs / byok-image-batch.sh / the launchd cron)
 *   writes, so the app, the cron, and byok-image-parallel.sh all agree on ONE place.
 *   Merge-not-replace; incomplete claims set stale=true to re-enter the queue. Also
 *   sets ai_processing_status='analyzed' + vision_model_version so reads stay cheap.
 *
 * SCOPE: --user-id (capture relay, vehicle-OPTIONAL) OR --vehicle-id (a vehicle's
 *   photos, any source — e.g. the K5's iphoto build photos). --shard-count/--shard-index
 *   let parallel workers split one pool without colliding. This file is the user/capture
 *   variant; byok-image-parallel.sh is the vehicle-scoped by-day burst drainer.
 *
 * PROVENANCE (source-DNA rule): every record stamped analyzed_by_model + analyzed_at + tier.
 *
 * Usage:
 *   prepare: dotenvx run -- node scripts/daily-receipt/analyze-capture-photos.mjs prepare \
 *              --user-id <uuid> --limit 25 --worklist /tmp/cap/work.jsonl --imgdir /tmp/cap/img
 *   ingest:  dotenvx run -- node scripts/daily-receipt/analyze-capture-photos.mjs ingest \
 *              --sink /tmp/cap/verdicts.jsonl --worklist /tmp/cap/work.jsonl
 *   run (all phases; recommended):
 *            dotenvx run -- node scripts/daily-receipt/analyze-capture-photos.mjs run \
 *              --user-id <uuid> [--limit 25] [--model claude-sonnet-4-6]
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (run under dotenvx).');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ─── Schema enums (mirror byok-vision-prompt.md). Used to COERCE invented values to
//     'unknown' rather than discard otherwise-good analysis — same forgiveness as the
//     byok-image-batch.sh sanitize stage.
const SCENE_TYPES = new Set(['engine_bay','body_exterior','body_interior','undercarriage','receipt_document','data_plate','hand_drawn_diagram','shop_context','fabrication_in_progress','paint_booth','wheel_assembly','road_test','off_property','cross_reference','product_screenshot','spreadsheet','unknown']);
const BUILD_PHASES = new Set(['discovery','teardown','metalwork','paint_prep','paint_application','mechanical_assembly','wiring','interior','final_assembly','drivable','show_finish','unknown']);
const INTENTS = new Set(['labor','inspection','parts_sourcing','communication','acquisition','documentation','unknown']);
const RUST = new Set(['none','surface','pitting','perforation','unknown']);
const PAINT = new Set(['bare_metal','primer','sealer','base','clear','aged','unknown']);
const COMPLETE = new Set(['stripped','partial','assembled','unknown']);

const CAPTURE_SOURCE = 'capture_relay_ios';
const TIER = 1; // BYOK
const MODEL_DEFAULT = 'claude-sonnet-4-6';

const args = process.argv.slice(2);
const mode = args[0];
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);

// ─────────────────────────────────────────────────────────────────────────────
// PREPARE — select a batch of capture photos NOT yet in image_analysis_records.
// ─────────────────────────────────────────────────────────────────────────────
async function prepare(opts = {}) {
  const USER_ID = opts.userId || arg('--user-id');
  // --vehicle-id scopes the pool to ONE vehicle's images (any source — iphoto,
  // user_upload, etc.), so the valuable build photos (K5's 3,602) get analyzed,
  // not just the capture relay. --shard-count/--shard-index let N parallel
  // workers chew the same pool without colliding (worker I takes every Nth
  // pending image). The app joins analysis by image_id, so vehicle linkage holds.
  const VEHICLE_ID = opts.vehicleId || arg('--vehicle-id');
  const SHARD_COUNT = parseInt(opts.shardCount || arg('--shard-count', '1'));
  const SHARD_INDEX = parseInt(opts.shardIndex || arg('--shard-index', '0'));
  const LIMIT = opts.limit ?? parseInt(arg('--limit', '25'));
  const WORKLIST = opts.worklist || arg('--worklist');
  if ((!USER_ID && !VEHICLE_ID) || !WORKLIST) {
    console.error('prepare: (--user-id OR --vehicle-id) and --worklist required');
    process.exit(1);
  }

  // Idempotency (CANONICAL): an image is "already analyzed" if its
  // ai_scan_metadata.byok_deep_analysis exists — the SAME check the existing
  // deep-image-analysis-byok.mjs uses (was a separate image_analysis_records
  // query; that fork is retired). Filtered client-side on the pool below.

  // Candidate photos. Paginate past the 1000-row PostgREST cap. Scope by vehicle
  // (any source) when --vehicle-id, else the capture relay for this user.
  const pool = [];
  for (let offset = 0; ; offset += 1000) {
    let q = sb
      .from('vehicle_images')
      .select('id, image_url, file_name, taken_at, latitude, longitude, exif_data, ai_processing_status, ai_scan_metadata')
      .order('taken_at', { ascending: true, nullsFirst: false })
      .range(offset, offset + 999);
    q = VEHICLE_ID
      ? q.eq('vehicle_id', VEHICLE_ID)
      : q.eq('source', CAPTURE_SOURCE).eq('user_id', USER_ID);
    const { data, error } = await q;
    if (error) { console.error(`prepare: pool query failed: ${error.message}`); process.exit(1); }
    if (!data || data.length === 0) break;
    pool.push(...data);
    if (data.length < 1000) break;
  }

  // Shard: worker SHARD_INDEX takes every SHARD_COUNT-th pending image — parallel
  // workers never analyze the same photo. Then cap at LIMIT.
  const pending = pool
    .filter((r) => !(r.ai_scan_metadata && r.ai_scan_metadata.byok_deep_analysis))
    .filter((_, i) => SHARD_COUNT <= 1 || (i % SHARD_COUNT) === SHARD_INDEX)
    .slice(0, LIMIT);
  if (pending.length === 0) {
    console.log(`prepare: nothing pending for user ${USER_ID} (pool=${pool.length}, already-analyzed=${pool.filter((r) => r.ai_scan_metadata && r.ai_scan_metadata.byok_deep_analysis).length})`);
    return { count: 0, worklist: WORKLIST };
  }

  mkdirSync(dirname(WORKLIST), { recursive: true });
  // file_name can be null — derive a safe local name from the URL or the id.
  const safeName = (r) => {
    if (r.file_name) return r.file_name.replace(/[^\w.\-]/g, '_');
    const fromUrl = (r.image_url || '').split('/').pop()?.split('?')[0];
    if (fromUrl && /\.(jpe?g|png|heic|webp)$/i.test(fromUrl)) return fromUrl.replace(/[^\w.\-]/g, '_');
    return `${r.id}.jpg`;
  };
  // EXIF the agent CANNOT see in the (Supabase-stripped) pixels — hand it over.
  const exifOf = (r) => {
    const e = r.exif_data || {};
    const cam = e.camera && typeof e.camera === 'object'
      ? `${e.camera.make || ''} ${e.camera.model || ''}`.trim()
      : (typeof e.camera === 'string' ? e.camera : null);
    const shotAt = e.dateTaken || e.dateTime || e.DateTimeOriginal || e.technical?.dateTaken || r.taken_at || null;
    const lat = r.latitude ?? e.gps?.latitude ?? e.location?.latitude ?? null;
    const lon = r.longitude ?? e.gps?.longitude ?? e.location?.longitude ?? null;
    return {
      shot_at: shotAt, camera: cam || null,
      gps: (lat != null && lon != null) ? { lat: Number(lat), lon: Number(lon) } : null,
      exif_present: !!(cam || shotAt || lat != null),
    };
  };
  const lines = pending.map((r) => JSON.stringify({
    image_id: r.id,
    image_url: r.image_url,
    file_name: safeName(r),
    taken_at: r.taken_at,
    exif: exifOf(r),
  }));
  writeFileSync(WORKLIST, lines.join('\n') + '\n');
  console.log(`prepare: ${pending.length} capture photos → ${WORKLIST} (pool=${pool.length}, already-analyzed=${pool.filter((r) => r.ai_scan_metadata && r.ai_scan_metadata.byok_deep_analysis).length})`);
  return { count: pending.length, worklist: WORKLIST };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD — fetch each image local with ONE pooled keep-alive session, so the
// vision step needs no network. (Node 18+ global fetch keeps connections alive.)
// ─────────────────────────────────────────────────────────────────────────────
async function download(worklist, imgdir) {
  mkdirSync(imgdir, { recursive: true });
  const rows = readFileSync(worklist, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let ok = 0, fail = 0;
  // Bounded concurrency (4) — mirrors the byok python downloader's pool_maxsize=4;
  // avoids the ephemeral-port storm that seized the TCP stack at high fan-out.
  const POOL = 4;
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      const out = join(imgdir, r.file_name);
      if (existsSync(out)) { ok++; continue; }
      try {
        const resp = await fetch(r.image_url, { redirect: 'follow' });
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
        await pipeline(resp.body, createWriteStream(out));
        ok++;
      } catch (e) {
        fail++;
        console.error(`  DL-ERR ${r.file_name}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, rows.length) }, worker));
  console.log(`download: ${ok} ok, ${fail} failed → ${imgdir}`);
  return { ok, fail };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYZE — build the prompt (byok-vision-prompt.md + per-frame worklist+EXIF) and
// invoke headless `claude --print` (NO network). One verdict JSON per image → sink.
// ─────────────────────────────────────────────────────────────────────────────
function analyze({ worklist, imgdir, sink, dir, model }) {
  const rows = readFileSync(worklist, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const promptFile = join(dir, 'prompt.txt');
  const visionPrompt = readFileSync(join(import.meta.dirname, 'byok-vision-prompt.md'), 'utf-8');

  const frameLines = rows.map((r) => {
    const e = r.exif || {};
    const gps = e.gps ? `${e.gps.lat},${e.gps.lon}` : 'none';
    const path = join(imgdir, r.file_name);
    return `- image_id=${r.image_id} file=${path}\n    shot_at=${e.shot_at || r.taken_at || '?'} | gps=${gps} | camera=${e.camera || '?'}`;
  }).join('\n');

  const prompt = [
    '# YOU ARE THE OWNER\'S EXPERT BUILD ANALYST — a knowledgeable detective working on their behalf.',
    'These are photos the owner captured on their phone (vehicle build/work/parts/shop life).',
    'There is NO vehicle context pack for these yet — vehicle attribution is a LATER step.',
    'So analyze each frame ON ITS OWN MERITS: read what is actually there. Recognize parts,',
    'read part numbers/text verbatim, judge the build phase, and reason about WHY the photo was',
    'taken (intent). Be the expert who says "new vented rotor going on the hub with an orange',
    'caliper" — not "a metal disc on a floor". When you genuinely cannot resolve a frame, say so',
    'honestly with context_complete:false + open_questions.',
    '',
    visionPrompt,
    '',
    'NOTE: vehicle_id is NOT KNOWN for these photos. Put "vehicle_id":null in every verdict',
    '(the harness handles IDs). Everything else in the schema still applies in full.',
    '',
    'WORKLIST — each frame\'s hard EXIF evidence (you CANNOT see this in the pixels; use it).',
    'Set camera_pose.exif_present=true when shot_at/gps is given. Read EACH local file with the',
    'Read tool and emit one verdict line per image:',
    frameLines,
    '',
    `Write ALL verdict lines (one compact JSON per line) to: ${sink}`,
    'Do not write anything else. When done, stop.',
  ].join('\n');

  writeFileSync(promptFile, prompt);

  const N = rows.length;
  console.log(`analyze: invoking claude (${model}) on ${N} images (no network; sandbox-safe)`);
  const t0 = Date.now();
  // Prompt via stdin (the positional-arg form is unreliable with --add-dir).
  // 150s/image ceiling as a backstop; never force CLAUDE_EFFORT=high (per-batch agent
  // run would blow 10+ min). Sonnet is the cheap, accurate bulk-drain model.
  const env = { ...process.env };
  delete env.CLAUDE_EFFORT;
  const res = spawnSync('claude', [
    '--print', '--model', model, '--permission-mode', 'bypassPermissions', '--add-dir', dir,
  ], {
    input: prompt,
    env,
    timeout: N * 150_000 + 60_000,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const ms = Date.now() - t0;
  if (res.error) console.error(`analyze: claude spawn error: ${res.error.message} (ingesting whatever landed)`);
  if (res.status !== 0) console.error(`analyze: claude exited ${res.status} (ingesting whatever landed)`);
  const V = existsSync(sink) ? readFileSync(sink, 'utf-8').split('\n').filter(Boolean).length : 0;
  console.log(`analyze: claude wrote ${V} verdict lines in ${(ms / 1000).toFixed(0)}s`);
  return { verdicts: V, ms, model };
}

// ─────────────────────────────────────────────────────────────────────────────
// INGEST — sanitize + write each verdict to image_analysis_records (vehicle_id NULL)
// + mark vehicle_images analyzed with compact labels. Idempotent + supersession.
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeVerdict(v, fallbackImageId) {
  // IDs are the harness's job. Force a real worklist image_id when the model echoed junk.
  if (!v.image_id || typeof v.image_id !== 'string') v.image_id = fallbackImageId;
  if (!SCENE_TYPES.has(v.scene_type)) v.scene_type = 'unknown';
  if (!BUILD_PHASES.has(v.build_phase_guess)) v.build_phase_guess = 'unknown';
  if (!INTENTS.has(v.intent)) { v.intent = 'unknown'; v.needs_clarification = true; }
  if (typeof v.intent_confidence !== 'number') v.intent_confidence = 0.4;
  if (v.intent === 'unknown' || v.intent_confidence < 0.6) v.needs_clarification = true; // $410 guard
  const so = v.state_observations || {};
  if (so.rust_severity && !RUST.has(so.rust_severity)) so.rust_severity = 'unknown';
  if (so.paint_state && !PAINT.has(so.paint_state)) so.paint_state = 'unknown';
  if (so.completeness && !COMPLETE.has(so.completeness)) so.completeness = 'unknown';
  v.state_observations = so;
  if (typeof v.confidence !== 'number') v.confidence = 0.5;
  // Scrub the banned "3/4"/"three-quarter" phrasing from camera_pose.
  if (v.camera_pose && typeof v.camera_pose === 'object') {
    for (const [k, val] of Object.entries(v.camera_pose)) {
      if (typeof val === 'string' && /3\s*\/\s*4|three[- ]?quarter/i.test(val)) {
        v.camera_pose[k] = val.replace(/3\s*\/\s*4|three[- ]?quarter/ig, 'angled');
      }
    }
  }
  if (!Array.isArray(v.components_seen)) v.components_seen = [];
  return v;
}

// Compact text[] for vehicle_images.labels (the column is text[], not jsonb) so the
// app can cheaply count + chip-render. scene first, then up to 8 component labels.
function compactLabels(v) {
  const out = [];
  if (v.scene_type && v.scene_type !== 'unknown') out.push(`scene:${v.scene_type}`);
  if (v.build_phase_guess && v.build_phase_guess !== 'unknown') out.push(`phase:${v.build_phase_guess}`);
  if (v.intent && v.intent !== 'unknown') out.push(`intent:${v.intent}`);
  for (const c of (v.components_seen || []).slice(0, 8)) {
    if (c && typeof c.label === 'string' && c.label.trim()) out.push(c.label.trim().slice(0, 60));
  }
  return Array.from(new Set(out)).slice(0, 12);
}

async function ingest(opts = {}) {
  const SINK = opts.sink || arg('--sink');
  const WORKLIST = opts.worklist || arg('--worklist');
  const MODEL = opts.model || arg('--model', MODEL_DEFAULT);
  if (!SINK || !existsSync(SINK)) { console.error('ingest: --sink required and file must exist'); process.exit(1); }

  const wl = WORKLIST && existsSync(WORKLIST)
    ? readFileSync(WORKLIST, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const wlIds = wl.map((w) => w.image_id);
  const wlSet = new Set(wlIds);

  const raw = readFileSync(SINK, 'utf-8').split('\n').filter(Boolean);
  const now = new Date().toISOString();
  let wrote = 0, skipped = 0, failed = 0, superseded = 0;
  const blocks = [];

  for (let i = 0; i < raw.length; i++) {
    let v;
    try { v = JSON.parse(raw[i]); } catch { failed++; continue; }
    v = sanitizeVerdict(v, wlIds[i] || wlIds[0]);
    if (!v.image_id || (wlSet.size && !wlSet.has(v.image_id))) {
      // Model echoed an id not on the worklist and we can't position-map it safely.
      v.image_id = wlIds[i] || v.image_id;
    }
    if (!v.image_id) { failed++; continue; }

    // CANONICAL LANDING — vehicle_images.ai_scan_metadata.byok_deep_analysis, the
    // SAME home the existing pipeline (deep-image-analysis-byok.mjs) writes. This
    // file previously wrote image_analysis_records — a FORK reconciled 2026-06-14 so
    // the app, the launchd cron, and byok-image-parallel.sh all agree on ONE home.
    // Accumulation, not replacement: merge into existing ai_scan_metadata; an
    // incomplete claim sets stale=true to re-enter the queue (trust invariant).
    const { data: imgRow, error: readErr } = await sb
      .from('vehicle_images')
      .select('ai_scan_metadata')
      .eq('id', v.image_id)
      .maybeSingle();
    if (readErr) { blocks.push(`read meta(${v.image_id.slice(0, 8)}): ${readErr.message}`); failed++; continue; }
    const existingMeta = (imgRow?.ai_scan_metadata) || {};
    const updatedMeta = {
      ...existingMeta,
      byok_deep_analysis: {
        scene_type: v.scene_type ?? 'unknown',
        build_phase_guess: v.build_phase_guess ?? 'unknown',
        camera_pose: v.camera_pose ?? null,
        components_seen: v.components_seen ?? [],
        damage_localized: v.damage_localized ?? [],
        text_regions: v.text_regions ?? [],
        state_observations: v.state_observations ?? {},
        workshop_signals: v.workshop_signals ?? {},
        presence: v.presence ?? {},
        narrative_one_line: v.narrative_one_line ?? null,
        confidence: typeof v.confidence === 'number' ? v.confidence : null,
        intent: v.intent ?? null,
        intent_confidence: v.intent_confidence ?? null,
        needs_review: v.needs_review ?? false,
        needs_clarification: v.needs_clarification ?? false,
        context_complete: v.context_complete ?? null,
        open_questions: Array.isArray(v.open_questions) ? v.open_questions : [],
        agent_notes: v.agent_notes ?? null,
        analyzed_at: now,
        prompt_version: 'byok_v3_camera_pose_2026-05-23',
        // Source DNA — a bare verdict without who/how is a schema failure.
        agent_model: MODEL,
        agent_tier: 'caller-byok',
        extraction_method: 'byok_claude_print_read_tool',
        agent_cost_cents: 0,
        cost_basis: 'byok_subscription_flat',
      },
    };
    const incomplete = v.context_complete === false
      || v.needs_review === true || v.needs_clarification === true
      || (typeof v.confidence === 'number' && v.confidence < 0.55)
      || (Array.isArray(v.open_questions) && v.open_questions.length > 0);

    const { error: upErr } = await sb
      .from('vehicle_images')
      .update({
        ai_scan_metadata: updatedMeta,
        stale: incomplete,
        last_rerun_at: now,
        vision_model_version: MODEL,
        ai_processing_status: 'analyzed',
        labels: compactLabels(v),
      })
      .eq('id', v.image_id);
    if (upErr) { blocks.push(`UPDATE ai_scan_metadata(${v.image_id.slice(0, 8)}): ${upErr.message}`); failed++; continue; }

    wrote++;
  }

  console.log(`ingest: wrote ${wrote}, skipped ${skipped}, superseded ${superseded}, failed ${failed} from ${SINK}`);
  if (blocks.length) {
    console.error('ingest: WRITE-PATH BLOCKS (exact):');
    for (const b of blocks.slice(0, 20)) console.error(`  - ${b}`);
  }
  return { wrote, failed, superseded, blocks };
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN — all four phases in one process.
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  const USER_ID = arg('--user-id');
  const LIMIT = parseInt(arg('--limit', '25'));
  const MODEL = arg('--model', MODEL_DEFAULT);
  if (!USER_ID) { console.error('run: --user-id required'); process.exit(1); }

  const RUN = `cap-${USER_ID.slice(0, 8)}-${process.pid}`;
  const dir = `/tmp/cap/${RUN}`;
  const worklist = join(dir, 'work.jsonl');
  const imgdir = join(dir, 'img');
  const sink = join(dir, 'verdicts.jsonl');
  mkdirSync(imgdir, { recursive: true });

  console.log(`=== analyze-capture-photos run=${RUN} user=${USER_ID} limit=${LIMIT} model=${MODEL} ===`);

  const prep = await prepare({ userId: USER_ID, limit: LIMIT, worklist });
  if (!prep.count) { console.log('run: nothing to do.'); return; }

  await download(worklist, imgdir);
  analyze({ worklist, imgdir, sink, dir, model: MODEL });

  if (!existsSync(sink) || readFileSync(sink, 'utf-8').trim() === '') {
    console.error('run: no verdicts produced — aborting ingest.');
    process.exit(1);
  }
  const res = await ingest({ sink, worklist, model: MODEL });
  console.log(`=== run done: ingested ${res.wrote}, failed ${res.failed} (sink ${sink}) ===`);
}

// ─── dispatch ────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (mode === 'prepare') {
      const worklist = arg('--worklist');
      const imgdir = arg('--imgdir');
      const r = await prepare();
      if (imgdir && r.count) await download(worklist, imgdir);
    } else if (mode === 'download') {
      await download(arg('--worklist'), arg('--imgdir'));
    } else if (mode === 'analyze') {
      const worklist = arg('--worklist');
      const dir = dirname(worklist);
      analyze({ worklist, imgdir: arg('--imgdir', join(dir, 'img')), sink: arg('--sink', join(dir, 'verdicts.jsonl')), dir, model: arg('--model', MODEL_DEFAULT) });
    } else if (mode === 'ingest') {
      await ingest();
    } else if (mode === 'run') {
      await run();
    } else {
      console.error('usage: analyze-capture-photos.mjs <prepare|download|analyze|ingest|run> [flags]');
      process.exit(1);
    }
  } catch (e) {
    console.error(`fatal: ${e.stack || e.message}`);
    process.exit(1);
  }
})();
