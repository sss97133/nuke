#!/usr/bin/env node
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

import Anthropic from '@anthropic-ai/sdk';
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

const LIMIT = parseInt(getArg('limit', '100'), 10);
const PUBLISHER = getArg('publisher', null);
const DAILY_CAP = parseFloat(getArg('daily-cap', '20'));
const CONCURRENCY = parseInt(getArg('concurrency', '5'), 10);

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.NUKE_CLAUDE_API;
if (!apiKey) {
  console.error('ERROR: No Anthropic API key found. Set ANTHROPIC_API_KEY, CLAUDE_API_KEY, or NUKE_CLAUDE_API.');
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey });

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------
const COST_PER_MTOK = {
  'claude-haiku-4-5-20251001':  { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6':          { input: 3.00, output: 15.00 },
};

function calculateCost(model, inputTokens, outputTokens) {
  const rates = COST_PER_MTOK[model] || COST_PER_MTOK['claude-haiku-4-5-20251001'];
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
let totalProcessed = 0;
let totalCompleted = 0;
let totalFailed = 0;
let totalCostUsd = 0;
let totalEscalated = 0;

// ---------------------------------------------------------------------------
// Fetch page image as base64
// ---------------------------------------------------------------------------
async function fetchImageBase64(imageUrl) {
  const resp = await nodeFetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
  const buffer = await resp.buffer();
  return buffer.toString('base64');
}

// ---------------------------------------------------------------------------
// Parse JSON from model response (handles markdown fences)
// ---------------------------------------------------------------------------
function parseJsonResponse(text) {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to fix common JSON issues: trailing commas, single quotes, unquoted keys
    let fixed = cleaned
      .replace(/,\s*([}\]])/g, '$1')           // trailing commas
      .replace(/'/g, '"')                       // single quotes → double
      .replace(/(\w+)\s*:/g, '"$1":')           // unquoted keys
      .replace(/""+/g, '"');                     // collapsed double-quotes
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      // Last resort: extract the largest {...} block
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
        // Try with fixes on the extracted block
        const fixedBlock = match[0].replace(/,\s*([}\]])/g, '$1');
        try { return JSON.parse(fixedBlock); } catch {}
      }
      throw e; // re-throw original error
    }
  }
}

// ---------------------------------------------------------------------------
// Analyze a single page
// ---------------------------------------------------------------------------
async function analyzePage(page) {
  const { id: pageId, page_number, image_url, attempts, pub_title, publisher_slug, page_count } = page;
  const startTime = Date.now();

  try {
    // 1. Fetch image
    const base64Data = await fetchImageBase64(image_url);

    // Determine media type from URL
    let mediaType = 'image/jpeg';
    if (image_url.includes('.png')) mediaType = 'image/png';
    else if (image_url.includes('.webp')) mediaType = 'image/webp';

    // 2. Build prompts
    const userPrompt = buildUserPrompt(page_number, page_count, pub_title, publisher_slug);

    // 3. Call Haiku first
    let model = 'claude-haiku-4-5-20251001';
    let response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: userPrompt }
        ]
      }],
      system: SYSTEM_PROMPT
    });

    let inputTokens = response.usage.input_tokens;
    let outputTokens = response.usage.output_tokens;
    let costUsd = calculateCost(model, inputTokens, outputTokens);

    // 4. Parse response
    const responseText = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    let parsedJson = parseJsonResponse(responseText);

    // 5. Escalate to Sonnet if low confidence
    if (parsedJson.confidence != null && parsedJson.confidence < 0.6) {
      console.log(`  [ESCALATE] Page ${page_number}: confidence ${parsedJson.confidence} < 0.6, re-analyzing with Sonnet`);
      totalEscalated++;

      const sonnetModel = 'claude-sonnet-4-6';
      const sonnetResponse = await anthropic.messages.create({
        model: sonnetModel,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: userPrompt }
          ]
        }],
        system: SYSTEM_PROMPT
      });

      const sonnetText = sonnetResponse.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('');

      parsedJson = parseJsonResponse(sonnetText);
      model = sonnetModel;
      inputTokens = sonnetResponse.usage.input_tokens;
      outputTokens = sonnetResponse.usage.output_tokens;
      costUsd = calculateCost(sonnetModel, inputTokens, outputTokens);
    }

    const durationMs = Date.now() - startTime;

    // 6. Write results
    const { error } = await supabase.from('publication_pages').update({
      spatial_tags: parsedJson,
      ai_scan_metadata: { model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd, duration_ms: durationMs },
      extracted_text: parsedJson.raw_text || null,
      page_type: parsedJson.page_type || null,
      extraction_confidence: parsedJson.confidence || null,
      analysis_model: model,
      analysis_cost: costUsd,
      ai_processing_status: 'completed',
      ai_last_scanned: new Date().toISOString(),
      locked_by: null,
      locked_at: null,
      error_message: null
    }).eq('id', pageId);

    if (error) throw new Error(`DB update failed: ${error.message}`);

    totalCompleted++;
    totalCostUsd += costUsd;
    console.log(`  [OK] Page ${page_number} (${pub_title}) — ${model} — $${costUsd.toFixed(4)} — ${durationMs}ms`);

    return costUsd;
  } catch (err) {
    totalFailed++;
    console.error(`  [FAIL] Page ${page_number} (${pub_title}): ${err.message}`);

    // Increment attempts, reset lock, set error
    const newAttempts = (attempts || 0) + 1;
    const maxAttempts = 3;
    await supabase.from('publication_pages').update({
      attempts: newAttempts,
      ai_processing_status: newAttempts >= maxAttempts ? 'failed' : 'pending',
      error_message: err.message.slice(0, 500),
      locked_by: null,
      locked_at: null
    }).eq('id', pageId);

    return 0;
  }
}

// ---------------------------------------------------------------------------
// Concurrency pool (simple semaphore)
// ---------------------------------------------------------------------------
async function processWithConcurrency(pages, concurrency) {
  let index = 0;

  async function worker() {
    while (index < pages.length) {
      // Check daily cap
      if (totalCostUsd >= DAILY_CAP) {
        console.log(`\n[CAP] Daily cost cap of $${DAILY_CAP.toFixed(2)} reached ($${totalCostUsd.toFixed(4)} spent). Stopping.`);
        return;
      }

      const i = index++;
      if (i >= pages.length) return;
      totalProcessed++;
      await analyzePage(pages[i]);
    }
  }

  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Publication Page Vision Analysis ===');
  console.log(`Config: limit=${LIMIT}, concurrency=${CONCURRENCY}, daily-cap=$${DAILY_CAP.toFixed(2)}${PUBLISHER ? `, publisher=${PUBLISHER}` : ''}`);
  console.log('');

  // 1. Query pending pages
  let query = supabase.rpc('execute_raw_query', {
    query_text: `
      SELECT pp.id, pp.page_number, pp.image_url, pp.attempts,
             p.title as pub_title, p.publisher_slug, p.page_count
      FROM publication_pages pp
      JOIN publications p ON pp.publication_id = p.id
      WHERE pp.ai_processing_status = 'pending'
        AND pp.locked_by IS NULL
        AND pp.attempts < pp.max_attempts
        ${PUBLISHER ? `AND p.publisher_slug = '${PUBLISHER.replace(/'/g, "''")}'` : ''}
      ORDER BY p.publication_date DESC NULLS LAST, pp.page_number
      LIMIT ${LIMIT}
    `
  });

  // Fallback: use supabase query builder if RPC not available
  let pages;
  const { data: rpcData, error: rpcError } = await query;

  if (rpcError) {
    // Fallback to direct query approach
    console.log('RPC not available, using direct query...');

    let q = supabase
      .from('publication_pages')
      .select(`
        id, page_number, image_url, attempts,
        publications!inner(title, publisher_slug, page_count, publication_date)
      `)
      .eq('ai_processing_status', 'pending')
      .is('locked_by', null)
      .lt('attempts', 3)
      .order('page_number', { ascending: true })
      .limit(LIMIT);

    if (PUBLISHER) {
      q = q.eq('publications.publisher_slug', PUBLISHER);
    }

    const { data, error } = await q;
    if (error) {
      console.error('Failed to query pages:', error.message);
      process.exit(1);
    }

    pages = (data || []).map(row => ({
      id: row.id,
      page_number: row.page_number,
      image_url: row.image_url,
      attempts: row.attempts,
      pub_title: row.publications.title,
      publisher_slug: row.publications.publisher_slug,
      page_count: row.publications.page_count
    }));
  } else {
    pages = rpcData || [];
  }

  if (pages.length === 0) {
    console.log('No pending pages found. Nothing to do.');
    return;
  }

  console.log(`Found ${pages.length} pending pages to analyze.\n`);

  // 2. Lock all pages
  const workerName = `analyze-worker-${process.pid}`;
  const pageIds = pages.map(p => p.id);

  const { error: lockError } = await supabase
    .from('publication_pages')
    .update({
      locked_by: workerName,
      locked_at: new Date().toISOString(),
      ai_processing_status: 'processing'
    })
    .in('id', pageIds)
    .is('locked_by', null);

  if (lockError) {
    console.error('Failed to lock pages:', lockError.message);
    process.exit(1);
  }

  console.log(`Locked ${pages.length} pages as ${workerName}\n`);

  // 3. Process with concurrency
  await processWithConcurrency(pages, CONCURRENCY);

  // 4. Release any remaining locks (in case of early cap stop)
  const { error: unlockError } = await supabase
    .from('publication_pages')
    .update({
      locked_by: null,
      locked_at: null,
      ai_processing_status: 'pending'
    })
    .eq('locked_by', workerName)
    .eq('ai_processing_status', 'processing');

  if (unlockError) {
    console.error('Warning: failed to release remaining locks:', unlockError.message);
  }

  // 5. Print summary
  console.log('\n=== Summary ===');
  console.log(`Processed:  ${totalProcessed}`);
  console.log(`Completed:  ${totalCompleted}`);
  console.log(`Failed:     ${totalFailed}`);
  console.log(`Escalated:  ${totalEscalated} (low confidence → Sonnet)`);
  console.log(`Total cost: $${totalCostUsd.toFixed(4)}`);
  if (totalCostUsd >= DAILY_CAP) {
    console.log(`\n*** Stopped early: daily cost cap of $${DAILY_CAP.toFixed(2)} reached ***`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
