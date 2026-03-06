#!/usr/bin/env node
/**
 * Vision Model Comparison — Haiku vs GPT-4o vs Gemini
 *
 * Runs the same 20 publication pages through all 3 models and compares:
 *   - Entity count (brands, locations, people, artworks, businesses)
 *   - Raw text extraction completeness
 *   - Confidence scores
 *   - Cost per page
 *   - Latency
 *   - JSON parse success rate
 *
 * Usage:
 *   cd /Users/skylar/nuke && dotenvx run -- node scripts/stbarth/compare-vision-models.mjs
 *   dotenvx run -- node scripts/stbarth/compare-vision-models.mjs --pages 10
 *   dotenvx run -- node scripts/stbarth/compare-vision-models.mjs --models haiku,gemini
 */

import { createClient } from '@supabase/supabase-js';
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

import { SYSTEM_PROMPT, buildUserPrompt } from './vision-prompt.mjs';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}
const NUM_PAGES = parseInt(getArg('pages', '20'), 10);
const MODELS_ARG = getArg('models', 'haiku,gpt4o,gemini');
const ENABLED_MODELS = new Set(MODELS_ARG.split(',').map(s => s.trim().toLowerCase()));

// ---------------------------------------------------------------------------
// Model configs
// ---------------------------------------------------------------------------
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.NUKE_CLAUDE_API;
const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

const MODELS = {
  haiku: {
    name: 'Claude Haiku 4.5',
    id: 'claude-haiku-4-5-20251001',
    enabled: ENABLED_MODELS.has('haiku') && !!ANTHROPIC_KEY,
    costPerMTok: { input: 0.80, output: 4.00 },
  },
  gpt4o: {
    name: 'GPT-4o',
    id: 'gpt-4o',
    enabled: ENABLED_MODELS.has('gpt4o') && !!OPENAI_KEY,
    costPerMTok: { input: 2.50, output: 10.00 },
  },
  gemini: {
    name: 'Gemini 2.0 Flash',
    id: 'gemini-2.0-flash',
    enabled: ENABLED_MODELS.has('gemini') && !!GEMINI_KEY,
    costPerMTok: { input: 0.10, output: 0.40 },
  },
};

// ---------------------------------------------------------------------------
// Image fetcher
// ---------------------------------------------------------------------------
async function fetchImageBase64(url) {
  const resp = await nodeFetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return buffer.toString('base64');
}

// ---------------------------------------------------------------------------
// JSON parser (robust)
// ---------------------------------------------------------------------------
function parseJsonResponse(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try { return JSON.parse(cleaned); } catch {}
  const fixed = cleaned.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(fixed); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
    try { return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// Model callers
// ---------------------------------------------------------------------------
async function callHaiku(base64Data, userPrompt) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const start = Date.now();
  const response = await client.messages.create({
    model: MODELS.haiku.id,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
        { type: 'text', text: userPrompt },
      ]
    }],
  });
  const duration = Date.now() - start;
  const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const cost = (inputTokens * MODELS.haiku.costPerMTok.input + outputTokens * MODELS.haiku.costPerMTok.output) / 1_000_000;
  return { text, inputTokens, outputTokens, cost, duration };
}

async function callGPT4o(base64Data, userPrompt) {
  const start = Date.now();
  const resp = await nodeFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODELS.gpt4o.id,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
          { type: 'text', text: userPrompt },
        ]},
      ],
    }),
  });
  const json = await resp.json();
  const duration = Date.now() - start;
  if (json.error) throw new Error(json.error.message);
  const text = json.choices[0].message.content;
  const inputTokens = json.usage?.prompt_tokens || 0;
  const outputTokens = json.usage?.completion_tokens || 0;
  const cost = (inputTokens * MODELS.gpt4o.costPerMTok.input + outputTokens * MODELS.gpt4o.costPerMTok.output) / 1_000_000;
  return { text, inputTokens, outputTokens, cost, duration };
}

async function callGemini(base64Data, userPrompt) {
  const start = Date.now();
  const resp = await nodeFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini.id}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
            { text: userPrompt },
          ],
        }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
      }),
    }
  );
  const json = await resp.json();
  const duration = Date.now() - start;
  if (json.error) throw new Error(json.error.message);
  const text = json.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  const inputTokens = json.usageMetadata?.promptTokenCount || 0;
  const outputTokens = json.usageMetadata?.candidatesTokenCount || 0;
  const cost = (inputTokens * MODELS.gemini.costPerMTok.input + outputTokens * MODELS.gemini.costPerMTok.output) / 1_000_000;
  return { text, inputTokens, outputTokens, cost, duration };
}

const MODEL_CALLERS = { haiku: callHaiku, gpt4o: callGPT4o, gemini: callGemini };

// ---------------------------------------------------------------------------
// Score extraction results
// ---------------------------------------------------------------------------
const ENTITY_KEYS = [
  'creative_credits', 'people_in_image', 'people_mentioned', 'artist_profiles',
  'brands', 'artworks', 'food_beverages', 'products',
  'locations', 'properties', 'natural_elements', 'cultural_references',
  'literary_content', 'businesses', 'events', 'services', 'vehicles', 'identifiers',
  'uncategorized',
];

function scoreResult(parsed) {
  if (!parsed) return { totalEntities: 0, entityCounts: {}, confidence: 0, rawTextLen: 0, pageType: null };
  let totalEntities = 0;
  const entityCounts = {};
  for (const key of ENTITY_KEYS) {
    const arr = parsed[key];
    const count = Array.isArray(arr) ? arr.length : 0;
    entityCounts[key] = count;
    totalEntities += count;
  }
  return {
    totalEntities,
    entityCounts,
    confidence: parsed.confidence || 0,
    rawTextLen: (parsed.raw_text || '').length,
    pageType: parsed.page_type || null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Vision Model Comparison ===\n');

  // Check which models are available
  const activeModels = Object.entries(MODELS).filter(([k, v]) => v.enabled);
  if (activeModels.length === 0) {
    console.error('No models available. Set API keys: NUKE_CLAUDE_API, OPENAI_API_KEY, GEMINI_API_KEY');
    process.exit(1);
  }
  console.log('Active models:', activeModels.map(([k, v]) => `${v.name} (${k})`).join(', '));

  // Select pages — pick a diverse set across publishers
  const { data: pages, error } = await supabase
    .from('publication_pages')
    .select('id, page_number, image_url, publication_id')
    .eq('ai_processing_status', 'pending')
    .limit(NUM_PAGES * 3); // get extras so we can diversify

  if (error || !pages?.length) {
    console.error('Failed to fetch pages:', error?.message || 'no pages');
    process.exit(1);
  }

  // Get publication info for the pages
  const pubIds = [...new Set(pages.map(p => p.publication_id))];
  const { data: pubs } = await supabase
    .from('publications')
    .select('id, title, publisher_slug, page_count')
    .in('id', pubIds.slice(0, 100));

  const pubMap = new Map((pubs || []).map(p => [p.id, p]));

  // Pick diverse pages: mix of page 1s (covers) and inner pages, different publishers
  const selected = [];
  const usedPubs = new Set();
  // First pass: one page per publisher
  for (const page of pages) {
    if (selected.length >= NUM_PAGES) break;
    const pub = pubMap.get(page.publication_id);
    if (!pub) continue;
    if (!usedPubs.has(pub.publisher_slug)) {
      usedPubs.add(pub.publisher_slug);
      selected.push({ ...page, pub });
    }
  }
  // Fill remaining with any pages
  for (const page of pages) {
    if (selected.length >= NUM_PAGES) break;
    const pub = pubMap.get(page.publication_id);
    if (!pub) continue;
    if (!selected.find(s => s.id === page.id)) {
      selected.push({ ...page, pub });
    }
  }

  console.log(`\nSelected ${selected.length} pages from ${usedPubs.size} publishers\n`);

  // Results storage
  const results = []; // { pageId, pageNum, pubTitle, publisher, model, parsed, score, cost, duration, error }

  for (let i = 0; i < selected.length; i++) {
    const page = selected[i];
    const { pub } = page;
    console.log(`\n--- Page ${i + 1}/${selected.length}: p${page.page_number} of "${pub.title}" (${pub.publisher_slug}) ---`);

    // Fetch image once
    let base64Data;
    try {
      base64Data = await fetchImageBase64(page.image_url);
      console.log(`  Image: ${(base64Data.length * 0.75 / 1024).toFixed(0)}KB`);
    } catch (err) {
      console.log(`  SKIP: Failed to fetch image: ${err.message}`);
      continue;
    }

    const userPrompt = buildUserPrompt(page.page_number, pub.page_count, pub.title, pub.publisher_slug);

    // Run each model sequentially for this page
    for (const [modelKey, modelConfig] of activeModels) {
      try {
        const caller = MODEL_CALLERS[modelKey];
        const { text, inputTokens, outputTokens, cost, duration } = await caller(base64Data, userPrompt);
        const parsed = parseJsonResponse(text);
        const score = scoreResult(parsed);

        results.push({
          pageId: page.id, pageNum: page.page_number,
          pubTitle: pub.title, publisher: pub.publisher_slug,
          model: modelKey, modelName: modelConfig.name,
          parsed: !!parsed, score, cost, duration,
          inputTokens, outputTokens,
          error: parsed ? null : 'JSON parse failed',
        });

        const status = parsed ? `${score.totalEntities} entities, conf=${score.confidence}` : 'JSON PARSE FAIL';
        console.log(`  ${modelConfig.name}: ${status} | $${cost.toFixed(4)} | ${(duration / 1000).toFixed(1)}s`);
      } catch (err) {
        results.push({
          pageId: page.id, pageNum: page.page_number,
          pubTitle: pub.title, publisher: pub.publisher_slug,
          model: modelKey, modelName: modelConfig.name,
          parsed: false, score: scoreResult(null), cost: 0, duration: 0,
          inputTokens: 0, outputTokens: 0,
          error: err.message,
        });
        console.log(`  ${modelConfig.name}: ERROR — ${err.message.slice(0, 100)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Summary report
  // ---------------------------------------------------------------------------
  console.log('\n\n========================================');
  console.log('         COMPARISON RESULTS');
  console.log('========================================\n');

  for (const [modelKey, modelConfig] of activeModels) {
    const modelResults = results.filter(r => r.model === modelKey);
    const successful = modelResults.filter(r => r.parsed);
    const failed = modelResults.filter(r => !r.parsed);

    console.log(`--- ${modelConfig.name} (${modelKey}) ---`);
    console.log(`  Pages analyzed:    ${modelResults.length}`);
    console.log(`  JSON parse OK:     ${successful.length}/${modelResults.length} (${(100 * successful.length / modelResults.length).toFixed(0)}%)`);

    if (successful.length > 0) {
      const avgEntities = successful.reduce((s, r) => s + r.score.totalEntities, 0) / successful.length;
      const avgConfidence = successful.reduce((s, r) => s + r.score.confidence, 0) / successful.length;
      const avgRawText = successful.reduce((s, r) => s + r.score.rawTextLen, 0) / successful.length;
      const avgCost = modelResults.reduce((s, r) => s + r.cost, 0) / modelResults.length;
      const avgDuration = modelResults.reduce((s, r) => s + r.duration, 0) / modelResults.length;
      const totalCost = modelResults.reduce((s, r) => s + r.cost, 0);
      const projected41k = avgCost * 41592;

      console.log(`  Avg entities/page: ${avgEntities.toFixed(1)}`);
      console.log(`  Avg confidence:    ${avgConfidence.toFixed(3)}`);
      console.log(`  Avg raw_text len:  ${avgRawText.toFixed(0)} chars`);
      console.log(`  Avg cost/page:     $${avgCost.toFixed(4)}`);
      console.log(`  Avg latency:       ${(avgDuration / 1000).toFixed(1)}s`);
      console.log(`  Total test cost:   $${totalCost.toFixed(4)}`);
      console.log(`  Projected 41K:     $${projected41k.toFixed(2)}`);

      // Entity breakdown
      const entityTotals = {};
      for (const key of ENTITY_KEYS) {
        entityTotals[key] = successful.reduce((s, r) => s + (r.score.entityCounts[key] || 0), 0);
      }
      const topEntities = Object.entries(entityTotals)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      console.log(`  Top entity types:  ${topEntities.map(([k, v]) => `${k}(${v})`).join(', ')}`);
    }

    if (failed.length > 0) {
      console.log(`  Errors:            ${failed.map(r => r.error?.slice(0, 60)).join('; ')}`);
    }
    console.log();
  }

  // Head-to-head comparison on shared pages
  if (activeModels.length >= 2) {
    console.log('--- HEAD-TO-HEAD (same pages) ---');
    const pageIds = [...new Set(results.filter(r => r.parsed).map(r => r.pageId))];
    const sharedPages = pageIds.filter(pid => {
      return activeModels.every(([mk]) => results.find(r => r.pageId === pid && r.model === mk && r.parsed));
    });

    if (sharedPages.length > 0) {
      console.log(`  ${sharedPages.length} pages analyzed by all models\n`);
      console.log(`  ${'Page'.padEnd(50)} | ${activeModels.map(([k, v]) => v.name.padEnd(22)).join(' | ')}`);
      console.log('  ' + '-'.repeat(50 + activeModels.length * 25));

      for (const pid of sharedPages.slice(0, 15)) {
        const pageInfo = results.find(r => r.pageId === pid);
        const label = `p${pageInfo.pageNum} ${pageInfo.pubTitle}`.slice(0, 48);
        const cells = activeModels.map(([mk]) => {
          const r = results.find(r => r.pageId === pid && r.model === mk);
          return r?.parsed
            ? `${r.score.totalEntities}ent c=${r.score.confidence.toFixed(2)} $${r.cost.toFixed(4)}`.padEnd(22)
            : 'FAIL'.padEnd(22);
        });
        console.log(`  ${label.padEnd(50)} | ${cells.join(' | ')}`);
      }
    }
    console.log();
  }

  // Recommendation
  console.log('--- RECOMMENDATION ---');
  const modelScores = activeModels.map(([mk, mc]) => {
    const mr = results.filter(r => r.model === mk);
    const ok = mr.filter(r => r.parsed);
    if (ok.length === 0) return { key: mk, name: mc.name, composite: 0 };
    const parseRate = ok.length / mr.length;
    const avgEntities = ok.reduce((s, r) => s + r.score.totalEntities, 0) / ok.length;
    const avgConf = ok.reduce((s, r) => s + r.score.confidence, 0) / ok.length;
    const avgText = ok.reduce((s, r) => s + r.score.rawTextLen, 0) / ok.length;
    const avgCost = mr.reduce((s, r) => s + r.cost, 0) / mr.length;
    // Composite: higher is better. Weight entities heavily, penalize cost.
    const composite = (avgEntities * 2) + (avgConf * 20) + (avgText / 100) + (parseRate * 30) - (avgCost * 500);
    return { key: mk, name: mc.name, composite, parseRate, avgEntities, avgConf, avgCost };
  }).sort((a, b) => b.composite - a.composite);

  for (const ms of modelScores) {
    console.log(`  ${ms.name}: composite=${ms.composite?.toFixed(1) || 'N/A'}`);
  }
  if (modelScores[0]?.composite > 0) {
    console.log(`\n  Winner: ${modelScores[0].name}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
