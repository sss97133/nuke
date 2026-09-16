#!/usr/bin/env node
/**
 * vision-loop-daemon.mjs — Always-on image analysis using local Ollama qwen2.5vl.
 *
 * Pulls pending vehicle_images (ai_processing_status NULL or 'pending') for Skylar's
 * fleet, classifies each via Ollama qwen2.5vl:7b, writes:
 *   - ai_processing_status='completed'
 *   - ai_caption (one-line description)
 *   - ai_analysis (full JSON: scene_class, area, action, parts_visible, vehicle_match_basis, confidence)
 *   - ai_detected_angle (front/rear/side/interior/engine_bay/undercarriage/detail)
 *
 * Sleeps 60s when the queue is empty. Runs forever. Log to /tmp/vision_loop.log.
 *
 * Usage:
 *   nohup dotenvx run -- node scripts/vision-loop-daemon.mjs > /tmp/vision_loop.log 2>&1 &
 */
import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

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
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, KEY, { global: { fetch: nodeFetch } });
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MODEL = process.env.VISION_MODEL || 'qwen2.5vl:7b';
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const BATCH = parseInt(process.env.BATCH || '8');
const IDLE_SLEEP = parseInt(process.env.IDLE_SLEEP || '60');
// Order = chronological by default (start at Day 1 — Skylar's earliest photo)
// Set ORDER=newest to revert to the older behavior of grinding recent uploads first.
const ORDER_MODE = (process.env.ORDER || 'chronological').toLowerCase();

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

const PROMPT = `You are a forensic vehicle photo classifier. Analyze the image and respond with ONLY JSON, no prose:
{
  "scene_class": "exterior_front" | "exterior_rear" | "exterior_side" | "exterior_3q" | "interior" | "engine_bay" | "undercarriage" | "wheel" | "detail" | "document" | "title" | "receipt" | "person" | "non_vehicle",
  "area": "front" | "rear" | "left" | "right" | "engine" | "interior" | "underbody" | "wheel" | "trunk" | "other",
  "action": "static" | "in_progress_work" | "delivery" | "show" | "auction" | "documentation",
  "parts_visible": [list of distinct parts/components you can identify],
  "caption": "one factual sentence describing the photo",
  "make_guess": null | "Ford" | "Chevrolet" | "GMC" | "Dodge" | "Porsche" | "Pontiac" | etc.,
  "model_guess": null | string,
  "year_guess": null | number,
  "color_visible": null | string,
  "confidence": 0.0-1.0
}
Be honest with confidence — if you can't see clearly, drop it.`;

async function classifyImage(imageUrl) {
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`fetch ${imgResp.status}`);
  const buf = Buffer.from(await imgResp.arrayBuffer());
  const b64 = buf.toString('base64');

  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: PROMPT,
      images: [b64],
      stream: false,
      format: 'json',
      options: { temperature: 0.1, num_ctx: 4096 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return JSON.parse(data.response);
}

async function getBatch() {
  // Pull pending images for Skylar's vehicles.
  //   chronological (default): start at Day 1 — earliest taken_at first, then by created_at
  //   newest: prefer the most recently uploaded
  let query = supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, source, taken_at, created_at')
    .eq('user_id', USER_ID)
    .or('ai_processing_status.is.null,ai_processing_status.eq.pending')
    .not('image_url', 'is', null)
    .not('vehicle_id', 'is', null);

  if (ORDER_MODE === 'newest') {
    query = query.order('created_at', { ascending: false });
  } else {
    // Chronological: dated photos first (earliest), then undated by upload time
    query = query
      .order('taken_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
  }

  const { data, error } = await query.limit(BATCH);
  if (error) { log(`queue err: ${error.message}`); return []; }
  return data || [];
}

async function processOne(row) {
  const start = Date.now();
  let result, err;
  try { result = await classifyImage(row.image_url); }
  catch (e) { err = e; }
  const elapsed_ms = Date.now() - start;

  if (err || !result) {
    await supabase.from('vehicle_images').update({
      ai_processing_status: 'failed',
      ai_scan_metadata: { error: String(err?.message || err || 'no result').slice(0, 500), classifier: MODEL, failed_at: new Date().toISOString() },
    }).eq('id', row.id);
    log(`  FAIL  ${row.id.slice(0,8)}  ${elapsed_ms}ms  ${err?.message?.slice(0,80)}`);
    return false;
  }

  const angleMap = {
    exterior_front: 'front', exterior_rear: 'rear',
    exterior_side: 'side', exterior_3q: 'side',
    interior: 'interior', engine_bay: 'engine_bay',
    undercarriage: 'undercarriage', wheel: 'wheel',
    detail: 'detail', document: 'document',
  };
  const partsCsv = Array.isArray(result.parts_visible)
    ? result.parts_visible.join(', ').slice(0, 500) : null;

  await supabase.from('vehicle_images').update({
    ai_processing_status: 'completed',
    ai_processing_completed_at: new Date().toISOString(),
    ai_last_scanned: new Date().toISOString(),
    caption: (result.caption || '').slice(0, 500) || null,
    area: result.area || null,
    operation: result.action || null,
    part: partsCsv,
    ai_detected_angle: angleMap[result.scene_class] || null,
    ai_avg_confidence: typeof result.confidence === 'number' ? result.confidence : null,
    ai_scan_metadata: {
      ...result,
      classifier: MODEL,
      classified_at: new Date().toISOString(),
      latency_ms: elapsed_ms,
    },
  }).eq('id', row.id);

  log(`  OK    ${row.id.slice(0,8)}  ${elapsed_ms}ms  ${result.scene_class}/${result.area} — ${(result.caption||'').slice(0,60)}`);
  return true;
}

async function main() {
  log(`vision-loop-daemon starting · model=${MODEL} · batch=${BATCH} · idle=${IDLE_SLEEP}s · order=${ORDER_MODE}`);
  let totalDone = 0, totalFail = 0;
  while (true) {
    const batch = await getBatch();
    if (batch.length === 0) {
      log(`queue empty · done=${totalDone} fail=${totalFail} · sleeping ${IDLE_SLEEP}s`);
      await new Promise(r => setTimeout(r, IDLE_SLEEP * 1000));
      continue;
    }
    log(`processing ${batch.length} pending`);
    for (const row of batch) {
      const ok = await processOne(row);
      if (ok) totalDone++; else totalFail++;
    }
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
