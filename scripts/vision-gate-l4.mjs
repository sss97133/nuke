#!/usr/bin/env node
/**
 * Vision Gate L4 — Agent-driven vision verdict for review_needed rows.
 *
 * Two modes:
 *   prepare  — claim rows in review_needed for vehicle V, emit JSONL worklist
 *              with image_url + vehicle context. Marks claimed rows so concurrent
 *              runs don't double-pick (uses vision_gate_processed_at as claim ts).
 *   ingest   — read JSONL of verdicts back, write to vehicle_images.
 *
 * Designed for Claude Code Agent tool to consume the worklist, fan out subagent
 * Read calls per batch, append verdicts to sink. Free at margin per Skylar's
 * BYOK directive (no Anthropic API spend).
 *
 * Usage:
 *   prepare:  node scripts/vision-gate-l4.mjs prepare \
 *               --vehicle-id <uuid> --limit 25 --batch-size 5 \
 *               --worklist /tmp/vg-l4/<id>/work.jsonl
 *
 *   ingest:   node scripts/vision-gate-l4.mjs ingest \
 *               --sink /tmp/vg-l4/<id>/verdicts.jsonl
 *
 * Worklist line schema:  {batch_id, target, rows:[{id,image_url,file_name,caption,source}]}
 * Verdict line schema:   {image_id, verdict, confidence, reasoning, batch_id}
 *   verdict ∈ approved | rejected_personal | rejected_misattributed | review_needed
 */

import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const mode = args[0];
const flag = (n) => args.includes(n);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

if (mode !== 'prepare' && mode !== 'ingest') {
  console.error('mode must be "prepare" or "ingest"');
  process.exit(1);
}

// Stale-claim window: if a row was last "processed" (claimed) more than this
// many minutes ago and is still review_needed, treat it as abandoned and re-claim.
const STALE_MIN = parseInt(arg('--stale-min', '30'));

async function prepare() {
  const VEHICLE_ID = arg('--vehicle-id');
  const LIMIT = parseInt(arg('--limit', '25'));
  const BATCH = parseInt(arg('--batch-size', '5'));
  const WORKLIST = arg('--worklist');
  if (!VEHICLE_ID || !WORKLIST) {
    console.error('prepare: --vehicle-id and --worklist required');
    process.exit(1);
  }

  // Fetch target vehicle context for misattribution detection.
  const { data: vehicle, error: vErr } = await sb
    .from('vehicles')
    .select('id, year, make, model, trim, vin')
    .eq('id', VEHICLE_ID)
    .maybeSingle();
  if (vErr || !vehicle) {
    console.error(`prepare: vehicle lookup failed: ${vErr?.message || 'not found'}`);
    process.exit(1);
  }

  // Claim: take review_needed rows. The reasoning prefix differentiates
  // cheap-layer marks ("no layer produced...") from L4 in-flight ("L4-claimed:")
  // so re-runs skip already-claimed rows.
  const { data: rows, error } = await sb
    .from('vehicle_images')
    .select('id, image_url, file_name, caption, source, mime_type, vision_gate_agent_reasoning')
    .eq('vehicle_id', VEHICLE_ID)
    .eq('vision_gate_status', 'review_needed')
    .not('image_url', 'is', null)
    .not('vision_gate_agent_reasoning', 'like', 'L4-claimed:%')
    .limit(LIMIT);

  if (error) {
    console.error(`prepare: fetch failed: ${error.message}`);
    process.exit(1);
  }

  // Mark claimed: prefix reasoning with "L4-claimed:" so concurrent preps skip.
  // Status stays review_needed; ingest writes the final verdict + reasoning.
  const claimedAt = new Date().toISOString();
  const ids = rows.map(r => r.id);
  if (ids.length === 0) {
    console.log(`prepare: nothing to do for ${VEHICLE_ID}`);
    return;
  }
  const claimReasoning = `L4-claimed: ${claimedAt}`;
  const { error: claimErr } = await sb
    .from('vehicle_images')
    .update({ vision_gate_processed_at: claimedAt, vision_gate_agent_reasoning: claimReasoning })
    .in('id', ids);
  if (claimErr) {
    console.error(`prepare: claim update failed: ${claimErr.message}`);
    process.exit(1);
  }

  // Rewrite image_url to use Supabase image-transform endpoint with width=1024.
  // Avoids agent context-limit failures on >2000px source images. Render API:
  // /storage/v1/object/public/<path> → /storage/v1/render/image/public/<path>?width=1024
  const transformUrl = (url) => {
    if (!url) return url;
    const out = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    // BOTH width and height bound to 1024 with resize=contain → longest side ≤ 1024.
    // Width-only constraint left tall images at e.g. 1024×2066 — over Anthropic's
    // 2000px many-image limit.
    return out + (out.includes('?') ? '&' : '?') + 'width=1024&height=1024&resize=contain';
  };

  // Validate URLs in parallel. Skip 400/404, non-image content-types (catches
  // MP4-disguised-as-JPEG), and missing rows. Runs HEAD against the render URL.
  const validateOne = async (row) => {
    const url = transformUrl(row.image_url);
    if (!url) return { ok: false, why: 'no image_url' };
    try {
      const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return { ok: false, why: `HTTP ${resp.status}` };
      const ct = resp.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) return { ok: false, why: `content-type ${ct}` };
      return { ok: true, url };
    } catch (e) {
      return { ok: false, why: `fetch ${e.message}` };
    }
  };
  // Validate in batches of 20 to avoid socket exhaustion.
  const validRows = [];
  const droppedReasons = {};
  for (let i = 0; i < rows.length; i += 20) {
    const slice = rows.slice(i, i + 20);
    const results = await Promise.all(slice.map(r => validateOne(r).then(v => [r, v])));
    for (const [r, v] of results) {
      if (v.ok) {
        validRows.push({ ...r, _validated_url: v.url });
      } else {
        droppedReasons[v.why] = (droppedReasons[v.why] || 0) + 1;
      }
    }
  }
  if (validRows.length < rows.length) {
    console.log(`prepare: validated ${validRows.length}/${rows.length} URLs; dropped reasons:`, droppedReasons);
  }
  // Mark the dropped rows as rejected_misattributed (broken/non-image) so they
  // don't sit forever in review_needed and don't get re-claimed.
  const droppedIds = rows.filter(r => !validRows.find(v => v.id === r.id)).map(r => r.id);
  if (droppedIds.length > 0) {
    await sb.from('vehicle_images').update({
      vision_gate_status: 'rejected_misattributed',
      vision_gate_attribution_confidence: 0.99,
      vision_gate_agent_reasoning: 'L4-prevalidate: URL HEAD failed (non-image, 4xx, or unreachable) — likely MP4/video stored as image, broken upload, or content-type mismatch',
      vision_gate_processed_at: new Date().toISOString(),
    }).in('id', droppedIds);
  }
  rows.splice(0, rows.length, ...validRows);

  // Write JSONL: one line per batch.
  mkdirSync(dirname(WORKLIST), { recursive: true });
  let lines = '';
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const batch = {
      batch_id: `b${String(i / BATCH).padStart(3, '0')}`,
      target: {
        vehicle_id: vehicle.id,
        label: [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' '),
        vin: vehicle.vin,
      },
      rows: slice.map(r => ({
        id: r.id,
        image_url: r._validated_url || transformUrl(r.image_url),
        file_name: r.file_name,
        caption: r.caption,
        source: r.source,
      })),
    };
    lines += JSON.stringify(batch) + '\n';
  }
  writeFileSync(WORKLIST, lines);
  console.log(`prepare: ${rows.length} rows in ${Math.ceil(rows.length / BATCH)} batches → ${WORKLIST}`);
  console.log(`prepare: target = ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')} (${vehicle.id})`);
}

async function ingest() {
  const SINK = arg('--sink');
  if (!SINK) { console.error('ingest: --sink required'); process.exit(1); }
  if (!existsSync(SINK)) { console.error(`ingest: sink file not found: ${SINK}`); process.exit(1); }

  const lines = readFileSync(SINK, 'utf8').split('\n').filter(Boolean);
  let written = 0, failed = 0;
  const tally = { approved: 0, rejected_personal: 0, rejected_misattributed: 0, review_needed: 0 };

  const VALID = new Set(['approved', 'rejected_personal', 'rejected_misattributed', 'review_needed']);

  for (const line of lines) {
    let v;
    try { v = JSON.parse(line); } catch (e) { failed++; console.error(`ingest: parse failed: ${line.slice(0,100)}`); continue; }
    if (!v.image_id || !VALID.has(v.verdict)) { failed++; console.error(`ingest: bad row: ${JSON.stringify(v).slice(0,120)}`); continue; }

    const { error } = await sb
      .from('vehicle_images')
      .update({
        vision_gate_status: v.verdict,
        vision_gate_attribution_confidence: v.confidence ?? 0.6,
        vision_gate_agent_reasoning: `L4-agent: ${v.reasoning || '(no reasoning)'}`.slice(0, 1000),
        vision_gate_processed_at: new Date().toISOString(),
      })
      .eq('id', v.image_id);
    if (error) { failed++; console.error(`ingest: write ${v.image_id}: ${error.message}`); continue; }
    written++;
    tally[v.verdict] = (tally[v.verdict] || 0) + 1;
  }

  console.log(`ingest: wrote ${written}, failed ${failed} from ${SINK}`);
  for (const [k, n] of Object.entries(tally)) console.log(`  ${k}: ${n}`);
}

(mode === 'prepare' ? prepare() : ingest()).catch(e => { console.error(e); process.exit(1); });
