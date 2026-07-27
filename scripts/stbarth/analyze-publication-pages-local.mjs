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
  "raw_text": "<transcribe here>",
  "confidence": 0.0-1.0
}

RULES:
- "raw_text": transcribe every word you can actually SEE on the page, verbatim. Never
  copy this instruction or the placeholder text into the value. If the page carries no
  legible text at all, use "".
- "page_type": "cover" means the FRONT COVER of the magazine — the outermost page
  carrying the masthead and cover lines. It is almost never any page past the first
  few. A full-bleed photograph with a logo or wordmark on it is NOT a cover: if it
  sells a product it is "advertisement", if it belongs to a feature it is
  "editorial" or "photo_spread". Do not use "cover" as a fallback for a page you
  find hard to read — use "other".

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
// attempts scales the output budget. A dense page (a French art magazine's
// body-text spread) overruns the 2048 output budget, the JSON is cut mid-object,
// and the parse fails — the SAME pages fail every time, so a flat retry burns
// three attempts and marks a readable page permanently 'failed'. Measured on
// blast-01 2026-07-26: pp.50/56/62/63/69 failed here and in analyze_pages_v2,
// which carries the same fix as V2_NUM_PREDICT. Give each retry more room.
// Base is 8192, measured not guessed: blast-01 p24 replied 6,213 chars cut
// mid-word at 2048 and 6,621 chars closing cleanly at 8192. The ceiling costs
// nothing on pages that finish early — generation stops at the stop sequence,
// so a high ceiling only buys headroom for the dense ones.
async function callOllama(base64Data, prompt, attempt = 0) {
  const t0 = Date.now();
  const numPredict = parseInt(process.env.OCR_NUM_PREDICT || '8192', 10) * (attempt + 1);
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
      options: { temperature: 0.1, num_predict: numPredict },
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
// The model transcribes a page's own punctuation verbatim into raw_text, and a
// page that quotes people ships literal " characters — which it does not escape.
// The parse then dies on the FIRST inner quote, deterministically, at any output
// budget, so retries can never help and the page is marked failed forever.
//
// Measured on blast-01 p89 (a page of quoted forum posts) 2026-07-26: the model
// emitted  pas au "vrai Mario" et au "vrai JP"  inside raw_text; the parser hit
// `"vrai` and demanded a comma. Three attempts, three identical deaths.
//
// Walk the string tracking whether we are inside a value. A quote that is not
// followed by a structural character (, } ] :) cannot be a closing quote, so it
// belongs to the text and gets escaped.
function escapeInnerQuotes(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inStr) {
      out += c;
      if (c === '"') inStr = true;
      continue;
    }
    if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === '"') {
      if (/^\s*[,}\]:]/.test(s.slice(i + 1))) { out += c; inStr = false; }
      else out += '\\"';
      continue;
    }
    out += c;
  }
  return out;
}

// Mixed escaping defeats any lookahead. Measured on blast-01 p50, the model
// emitted  \\"en une semaine",  — it escaped the OPENING quote of a French
// quotation and left the closing one bare, and that bare quote is followed by a
// comma in the prose, which is exactly the shape a real end-of-string has.
// No character-walk can tell those apart.
//
// So repair structurally instead of lexically: raw_text is the only free-prose
// field in the schema and `confidence` always follows it. Lift the value between
// those two fixed landmarks, escape it properly, and splice it back.
function repairRawText(s) {
  const startM = /"raw_text"\s*:\s*"/.exec(s);
  if (!startM) return null;
  const valStart = startM.index + startM[0].length;
  const endM = /"\s*,\s*"confidence"/.exec(s.slice(valStart));
  if (!endM) return null;
  const valEnd = valStart + endM.index;
  const value = s.slice(valStart, valEnd);
  // Unescape what the model did escape, then escape the whole thing uniformly,
  // so mixed input converges on one correct encoding.
  const normalized = value
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
  return s.slice(0, valStart) + JSON.stringify(normalized).slice(1, -1) + s.slice(valEnd);
}

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
  // Escape quotes the model left loose inside transcribed text
  try { return JSON.parse(escapeInnerQuotes(cleaned)); } catch {}
  try { return JSON.parse(escapeInnerQuotes(cleaned).replace(/,\s*([}\]])/g, '$1')); } catch {}
  // Structural repair of the free-prose field (handles mixed escaping)
  const repaired = repairRawText(cleaned);
  if (repaired) {
    try { return JSON.parse(repaired); } catch {}
    try { return JSON.parse(escapeInnerQuotes(repaired)); } catch {}
    try { return JSON.parse(repaired.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  // Extract largest {...}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
    try { return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placeholder guard — the 7B VLM echoes the prompt's own schema wording back
// ("ALL visible text on the page, verbatim", "str", "str or null") instead of
// reading the page. Landing those as extracted_text fabricates content: 638
// L'Officiel pages carried the literal placeholder string as their "text"
// before this guard existed (measured 2026-07-19). Treat an echo as a failed
// read, not as content.
// ---------------------------------------------------------------------------
const TEXT_PLACEHOLDERS = new Set([
  'all visible text on the page, verbatim',
  'str', 'str or null', 'string', 'null', 'none', 'n/a', 'na',
]);
// The echo also shows up appended to genuine text (measured: stbarth-22 p3
// returned real cover text with the placeholder line glued on the end), so
// strip it line-wise rather than only rejecting whole-string matches.
function cleanRawText(v) {
  if (typeof v !== 'string') return null;
  const kept = v
    .split('\n')
    .filter(line => !TEXT_PLACEHOLDERS.has(line.trim().toLowerCase()))
    .join('\n')
    .trim();
  return kept || null;
}

// ---------------------------------------------------------------------------
// Analyze one page
// ---------------------------------------------------------------------------
async function analyzePage(page) {
  const { id, page_number, image_url, attempts, pub_title, publisher_slug, page_count } = page;

  try {
    const base64Data = await fetchImageBase64(image_url);
    const prompt = `${VISION_PROMPT}\n\nThis is page ${page_number} of ${page_count} from "${pub_title}" by ${publisher_slug}.`;

    const { text, duration } = await callOllama(base64Data, prompt, attempts || 0);
    const parsed = parseJson(text);

    if (!parsed) {
      throw new Error('JSON parse failed');
    }

    // A read that yielded neither text nor a classification is a FAILED read,
    // not a completed one. Reporting it 'completed' is what made ~10% of the
    // L'Officiel corpus silently empty AND invisible to this worker forever
    // (the queue only selects ai_processing_status='pending'). Route it down
    // the failure path so it stays retryable and legible.
    const rawText = cleanRawText(parsed.raw_text);
    const visionType = cleanRawText(parsed.page_type);
    // Printed spine outranks vision where it speaks.
    const pageType = page.spine_page_type || visionType;
    if (!rawText && !pageType) {
      throw new Error(
        cleanRawText(parsed.raw_text) === null && typeof parsed.raw_text === 'string' && parsed.raw_text.trim()
          ? 'Empty read: model echoed prompt placeholder instead of page text'
          : 'Empty read: model returned no raw_text and no page_type'
      );
    }

    // spatial_tags holds the model's VERBATIM output, including its own
    // page_type claim — that is vision testimony and is never overwritten.
    // But it is a second copy of a field the column also carries, and a stale
    // copy silently misleads anyone who queries the blob (it read 1,122
    // "cover" while the adjudicated column read 63). Carry the adjudication
    // alongside the raw claim so the blob can't be mistaken for the verdict.
    // The verdict for page_type is the COLUMN; no consumer reads
    // spatial_tags.page_type for classification (verified 2026-07-19 across
    // the mag analysis/pages routes and the enrich/crop scripts).
    // Re-read and MERGE rather than replace. This pass used to assign
    // spatial_tags wholesale, which silently destroyed anything another pass had
    // put on the page: analyze_pages_v2 lands people_in_image/garments_visible,
    // classify_image_class lands image_class, and the audit loop lands
    // suspect:true demotions the owner has signed. A page that was OCR'd second
    // lost all of it. (Same defect class fixed in analyze_pages_v2 on
    // 2026-07-26, where a stale snapshot reverted owner decisions.)
    const { data: liveRow } = await supabase
      .from('publication_pages').select('spatial_tags').eq('id', id).single();
    const live = (liveRow?.spatial_tags && typeof liveRow.spatial_tags === 'object') ? liveRow.spatial_tags : {};

    // Arrays this pass produces are unioned with what is already there, and the
    // EXISTING entry always wins on a name collision so demotions survive.
    const mergeArr = (a, b, keyFn) => {
      const out = Array.isArray(a) ? [...a] : [];
      const seen = new Set(out.map(keyFn).filter(Boolean));
      for (const it of (Array.isArray(b) ? b : [])) {
        const k = keyFn(it);
        if (k && !seen.has(k)) { seen.add(k); out.push(it); }
      }
      return out;
    };
    const nm = x => (typeof x?.name === 'string' ? x.name.trim().toLowerCase() : '');
    const spatialTags = {
      ...live,          // keys this pass does not produce (people_in_image,
      ...parsed,        // garments_visible, image_class) survive untouched
      brands:           mergeArr(live.brands, parsed.brands, nm),
      people_mentioned: mergeArr(live.people_mentioned, parsed.people_mentioned, nm),
      creative_credits: mergeArr(live.creative_credits, parsed.creative_credits,
                                 x => nm(x) + '|' + (x?.role ?? '')),
      locations:        mergeArr(live.locations, parsed.locations, nm),
      ...(Array.isArray(live.people_in_image) && live.people_in_image.length
          ? { people_in_image: live.people_in_image } : {}),
      ...(Array.isArray(live.garments_visible) && live.garments_visible.length
          ? { garments_visible: live.garments_visible } : {}),
      ...(live.image_class ? { image_class: live.image_class, image_class_detail: live.image_class_detail } : {}),
      page_type_adjudicated: pageType,
      page_type_raw_vision_claim: visionType,
      page_type_decided_by: 'publication_pages.page_type column (printed spine outranks vision)',
    };

    // Write results
    await supabase.from('publication_pages').update({
      spatial_tags: spatialTags,
      ai_scan_metadata: {
        model: MODEL, duration_ms: duration, cost_usd: 0, local: !IS_CLOUD, cloud_gpu: IS_CLOUD,
        page_type_source: page.spine_page_type ? 'printed_spine' : 'vision',
        ...(page.spine_page_type && visionType && page.spine_page_type !== visionType
          ? { vision_page_type_overridden: visionType } : {}),
      },
      extracted_text: rawText,
      page_type: pageType,
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
// Printed-spine page kinds (mag_spine_page_kinds, phash-keyed) → page_type.
// Sets page.spine_page_type; silent spine leaves it undefined so vision applies.
// ---------------------------------------------------------------------------
const SPINE_KIND_TO_PAGE_TYPE = {
  ad: 'advertisement',
  story: 'editorial',
  edito: 'editorial',
  toc: 'table_of_contents',
  cover: 'cover',
};

async function attachSpineKinds(pages) {
  const byHash = new Map();
  for (const p of pages) {
    if (!p.phash) continue;
    if (!byHash.has(p.phash)) byHash.set(p.phash, []);
    byHash.get(p.phash).push(p);
  }
  const hashes = [...byHash.keys()];
  for (let i = 0; i < hashes.length; i += 200) {
    const { data, error } = await supabase
      .from('mag_spine_page_kinds').select('vphash, kind').in('vphash', hashes.slice(i, i + 200));
    if (error) {
      console.log(`  [warn] spine lookup failed (${error.message}) — vision page_type applies`);
      return;
    }
    for (const row of (data || [])) {
      const mapped = SPINE_KIND_TO_PAGE_TYPE[row.kind];
      if (!mapped) continue;
      for (const p of (byHash.get(row.vphash) || [])) p.spine_page_type = mapped;
    }
  }
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
    .select('id, page_number, image_url, attempts, phash, publications!inner(title, publisher_slug, page_count)')
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
    phash: r.phash,
    pub_title: r.publications.title, publisher_slug: r.publications.publisher_slug,
    page_count: r.publications.page_count,
  }));

  if (!pages.length) { console.log('No pending pages.'); return; }
  console.log(`Found ${pages.length} pending pages.\n`);

  // Attach the printed story spine's page kind. The spine is a HIGHER trust tier
  // than vision (printed > vision, docs/ANALYSIS_SPEC.md), and vision is measurably
  // bad at this field: it labelled 1,071 L'Officiel pages "cover" (~26/issue) where
  // the spine said 826 story / 184 ad / 39 cover. Where the spine speaks, it wins.
  await attachSpineKinds(pages);
  const spined = pages.filter(p => p.spine_page_type).length;
  console.log(`Spine kinds attached to ${spined}/${pages.length} pages (spine outranks vision page_type).\n`);

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
