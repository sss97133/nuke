#!/usr/bin/env node
/**
 * Vision Analysis — Ollama-compatible (local or cloud GPU)
 *
 * Analyzes publication pages using Ollama-compatible vision API.
 * Works with local Ollama OR Modal cloud GPU endpoint (same API).
 *
 * Local (free, ~150 pages/hr):
 *   dotenvx run -- node scripts/stbarth/analyze-publication-pages-local.mjs
 *   dotenvx run -- node scripts/stbarth/analyze-publication-pages-local.mjs --limit 500 --concurrency 2
 *
 * Cloud GPU via Modal (~$1.10/hr, ~1200+ pages/hr):
 *   dotenvx run -- node scripts/stbarth/analyze-publication-pages-local.mjs \
 *     --ollama-url https://sss97133--stbarth-vision-ocr-web.modal.run \
 *     --concurrency 8 --limit 1000
 *
 * Options:
 *   --publisher <slug>    Filter by publisher
 *   --model <name>        Model name (default: qwen2.5vl:7b)
 *   --auth-token <token>  Bearer token for cloud endpoints (or set MODAL_SIDECAR_TOKEN)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import dns from 'dns';

const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
    if (options && options.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const LIMIT = parseInt(getArg('limit', '200'), 10);
const PUBLISHER = getArg('publisher', null);
const CONCURRENCY = parseInt(getArg('concurrency', '2'), 10);
const MODEL = getArg('model', 'qwen2.5vl:7b');
const OLLAMA_URL = getArg('ollama-url', 'http://localhost:11434');
const AUTH_TOKEN = getArg('auth-token', process.env.MODAL_SIDECAR_TOKEN || null);
const IS_CLOUD = !OLLAMA_URL.includes('localhost') && !OLLAMA_URL.includes('127.0.0.1');

// ---------------------------------------------------------------------------
// Simplified prompt for local 7B models
// ---------------------------------------------------------------------------
const VISION_PROMPT = `Analyze this magazine/publication page image. Return ONLY a valid JSON object (no markdown fences, no explanation, no commentary). The JSON must have these keys:

{
  "page_type": "cover|editorial|advertisement|property_listing|artwork|photo_spread|directory|credits|table_of_contents|other",
  "brands": [{"name": "str", "category": "fashion|jewelry|watches|spirits|beauty|automotive|marine|hospitality|real_estate|publishing|food_beverage|other"}],
  "creative_credits": [{"name": "str", "role": "photographer|writer|art_director|designer|editor|illustrator|stylist"}],
  "people_mentioned": [{"name": "str", "role": "str"}],
  "locations": [{"name": "str", "type": "island|town|beach|bay|neighborhood|building|country|region"}],
  "businesses": [{"name": "str", "business_type": "hotel|restaurant|boutique|gallery|spa|real_estate|yacht_charter|other", "phone": "str or null", "website": "str or null"}],
  "properties": [{"name": "str", "type": "villa|hotel|estate|condo|land|restaurant", "features": ["str"]}],
  "artworks": [{"title": "str or null", "artist": "str or null", "medium": "str or null"}],
  "raw_text": "ALL visible text on the page, verbatim",
  "confidence": 0.0-1.0
}

Use empty arrays [] when no entities of that type are found. Return ONLY the JSON object.`;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
let totalProcessed = 0;
let totalCompleted = 0;
let totalFailed = 0;
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Fetch image as base64
// ---------------------------------------------------------------------------
async function fetchImageBase64(imageUrl) {
  const resp = await nodeFetch(imageUrl);
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return buffer.toString('base64');
}

// ---------------------------------------------------------------------------
// Call Ollama vision model
// ---------------------------------------------------------------------------
async function callOllama(base64Data, prompt) {
  const t0 = Date.now();
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;

  const resp = await nodeFetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      prompt,
      images: [base64Data],
      stream: false,
      options: { temperature: 0.1, num_predict: 2048 },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Vision API error: ${resp.status} ${body.slice(0, 200)}`);
  }
  const result = await resp.json();
  const duration = Date.now() - t0;
  return { text: result.response || '', duration };
}

// ---------------------------------------------------------------------------
// Parse JSON (robust — handles markdown fences, trailing commas)
// ---------------------------------------------------------------------------
function parseJson(text) {
  let cleaned = text.trim();
  // Strip markdown fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  // Try direct parse
  try { return JSON.parse(cleaned); } catch {}
  // Fix trailing commas
  try { return JSON.parse(cleaned.replace(/,\s*([}\]])/g, '$1')); } catch {}
  // Extract largest {...}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
    try { return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// Analyze one page
// ---------------------------------------------------------------------------
async function analyzePage(page) {
  const { id, page_number, image_url, attempts, pub_title, publisher_slug, page_count } = page;

  try {
    const base64Data = await fetchImageBase64(image_url);
    const prompt = `${VISION_PROMPT}\n\nThis is page ${page_number} of ${page_count} from "${pub_title}" by ${publisher_slug}.`;

    const { text, duration } = await callOllama(base64Data, prompt);
    const parsed = parseJson(text);

    if (!parsed) {
      throw new Error('JSON parse failed');
    }

    // Write results
    await supabase.from('publication_pages').update({
      spatial_tags: parsed,
      ai_scan_metadata: { model: MODEL, duration_ms: duration, cost_usd: 0, local: !IS_CLOUD, cloud_gpu: IS_CLOUD },
      extracted_text: parsed.raw_text || null,
      page_type: parsed.page_type || null,
      extraction_confidence: parsed.confidence || null,
      analysis_model: IS_CLOUD ? `modal/${MODEL}` : `ollama/${MODEL}`,
      analysis_cost: 0,
      ai_processing_status: 'completed',
      ai_last_scanned: new Date().toISOString(),
      locked_by: null,
      locked_at: null,
      error_message: null,
    }).eq('id', id);

    totalCompleted++;
    const entities = ['brands','creative_credits','people_mentioned','locations','businesses','properties','artworks']
      .reduce((s, k) => s + (Array.isArray(parsed[k]) ? parsed[k].length : 0), 0);
    console.log(`  [OK] p${page_number} "${pub_title}" — ${entities} entities — ${(duration/1000).toFixed(1)}s`);
  } catch (err) {
    totalFailed++;
    const newAttempts = (attempts || 0) + 1;
    await supabase.from('publication_pages').update({
      attempts: newAttempts,
      ai_processing_status: newAttempts >= 3 ? 'failed' : 'pending',
      error_message: err.message?.slice(0, 500),
      locked_by: null,
      locked_at: null,
    }).eq('id', id);
    console.log(`  [FAIL] p${page_number} "${pub_title}" — ${err.message?.slice(0, 80)}`);
  }
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------
async function processPool(pages, concurrency) {
  let idx = 0;
  async function worker() {
    while (idx < pages.length) {
      const i = idx++;
      if (i >= pages.length) return;
      totalProcessed++;
      await analyzePage(pages[i]);

      // Progress every 10 pages
      if (totalProcessed % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed * 3600;
        const remaining = (pages.length - totalProcessed) / (totalProcessed / elapsed);
        console.log(`\n  Progress: ${totalProcessed}/${pages.length} | ${rate.toFixed(0)}/hr | ETA: ${(remaining/3600).toFixed(1)}h\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const mode = IS_CLOUD ? 'Cloud GPU (Modal)' : 'Local (Ollama)';
  console.log(`=== Publication Page Vision Analysis — ${mode} ===`);
  console.log(`Model: ${MODEL} | Concurrency: ${CONCURRENCY} | Limit: ${LIMIT} | Endpoint: ${OLLAMA_URL}`);
  if (PUBLISHER) console.log(`Publisher filter: ${PUBLISHER}`);
  console.log('');

  // Check endpoint is running (handles cloud cold start)
  try {
    if (IS_CLOUD) console.log('Warming up cloud GPU endpoint (cold start may take ~30s)...');
    const headers = {};
    if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
    const warmStart = Date.now();
    const health = await nodeFetch(`${OLLAMA_URL}/api/tags`, { headers });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const tags = await health.json();
    const hasModel = tags.models?.some(m => m.name === MODEL || m.name.startsWith(MODEL.split(':')[0]));
    if (!hasModel) {
      console.error(`Model "${MODEL}" not found. Available: ${tags.models?.map(m => m.name).join(', ')}`);
      process.exit(1);
    }
    if (IS_CLOUD) console.log(`Cloud endpoint ready in ${((Date.now() - warmStart) / 1000).toFixed(1)}s\n`);
  } catch (err) {
    if (IS_CLOUD) {
      console.error(`Cloud endpoint not reachable at ${OLLAMA_URL}: ${err.message}`);
      console.error('Deploy with: cd /Users/skylar/nuke && modal deploy scripts/stbarth/modal_vision_server.py');
    } else {
      console.error(`Ollama not reachable at ${OLLAMA_URL}. Start with: ollama serve`);
    }
    process.exit(1);
  }

  // Query pending pages
  let q = supabase
    .from('publication_pages')
    .select('id, page_number, image_url, attempts, publications!inner(title, publisher_slug, page_count)')
    .eq('ai_processing_status', 'pending')
    .is('locked_by', null)
    .lt('attempts', 3)
    .order('page_number', { ascending: true })
    .limit(LIMIT);

  if (PUBLISHER) q = q.eq('publications.publisher_slug', PUBLISHER);

  const { data, error } = await q;
  if (error) { console.error('Query error:', error.message); process.exit(1); }

  const pages = (data || []).map(r => ({
    id: r.id, page_number: r.page_number, image_url: r.image_url, attempts: r.attempts,
    pub_title: r.publications.title, publisher_slug: r.publications.publisher_slug,
    page_count: r.publications.page_count,
  }));

  if (!pages.length) { console.log('No pending pages.'); return; }
  console.log(`Found ${pages.length} pending pages.\n`);

  // Lock pages
  const workerName = `ollama-worker-${process.pid}`;
  await supabase.from('publication_pages')
    .update({ locked_by: workerName, locked_at: new Date().toISOString(), ai_processing_status: 'processing' })
    .in('id', pages.map(p => p.id))
    .is('locked_by', null);

  console.log(`Locked ${pages.length} pages as ${workerName}\n`);

  // Process
  await processPool(pages, CONCURRENCY);

  // Release remaining locks
  await supabase.from('publication_pages')
    .update({ locked_by: null, locked_at: null, ai_processing_status: 'pending' })
    .eq('locked_by', workerName)
    .eq('ai_processing_status', 'processing');

  // Summary
  const elapsed = (Date.now() - startTime) / 1000;
  const gpuCostPerHr = IS_CLOUD ? 1.10 : 0;
  const gpuCost = (elapsed / 3600) * gpuCostPerHr;
  console.log('\n=== Summary ===');
  console.log(`Processed: ${totalProcessed} | Completed: ${totalCompleted} | Failed: ${totalFailed}`);
  console.log(`Time: ${(elapsed/60).toFixed(1)} min | Rate: ${(totalProcessed/elapsed*3600).toFixed(0)} pages/hr`);
  console.log(`Cost: ~$${gpuCost.toFixed(2)} (${IS_CLOUD ? 'A10G GPU @ $1.10/hr' : 'local inference'})`);

  const totalPages = 41592;
  const pagesPerSec = totalProcessed / elapsed;
  if (pagesPerSec > 0) {
    const hoursRemaining = (totalPages - totalCompleted) / pagesPerSec / 3600;
    const projectedCost = hoursRemaining * gpuCostPerHr;
    console.log(`\nProjected: ${hoursRemaining.toFixed(1)}h for remaining ${totalPages} pages at ${CONCURRENCY} workers`);
    if (IS_CLOUD) console.log(`Projected GPU cost: ~$${projectedCost.toFixed(0)}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
