#!/usr/bin/env node
/**
 * mine-manuals-for-library.mjs — Extract structured specs from factory service manual chunks
 *
 * Mines service_manual_chunks grouped by document for factory-authoritative reference data:
 * torque specs, fluid capacities, service intervals, part numbers,
 * plus standard types (engine_spec, transmission_spec, production_fact).
 *
 * Uses same staging table (comment_library_extractions) and CLI pattern as mine-comments-for-library.mjs.
 * batch_id prefix: "manual-"
 *
 * Usage:
 *   dotenvx run -- node scripts/mine-manuals-for-library.mjs --test 3
 *   dotenvx run -- node scripts/mine-manuals-for-library.mjs --run 50
 *   dotenvx run -- node scripts/mine-manuals-for-library.mjs --stats
 *   dotenvx run -- node scripts/mine-manuals-for-library.mjs --run 50 --provider ollama
 *   dotenvx run -- node scripts/mine-manuals-for-library.mjs --run 50 --provider gemini
 */

import pg from 'pg';
import crypto from 'crypto';

// ─── CLI arg helpers ────────────────────────────────────────────────────────
const cliArgs = process.argv.slice(2);
const getArg = (name, def) => { const i = cliArgs.indexOf(`--${name}`); return i === -1 ? def : cliArgs[i + 1] || def; };

// ─── Provider Config ────────────────────────────────────────────────────────
const PROVIDER = getArg('provider', 'ollama');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODAL_URL = process.env.MODAL_LLM_URL || 'https://sss97133--nuke-vllm-serve.modal.run';

const PROVIDER_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  ollama: 'qwen2.5:7b',
  gemini: 'gemini-2.0-flash-lite',
  modal: 'qwen2.5-7b',
};
const MODEL = getArg('model', PROVIDER_MODELS[PROVIDER] || 'qwen2.5:7b');

const PROVIDER_CONCURRENCY = { anthropic: 5, ollama: 2, gemini: 5, modal: 6 };
const CONCURRENCY = parseInt(getArg('concurrency', String(PROVIDER_CONCURRENCY[PROVIDER] || 2)));

const DB_HOST = '54.177.55.191';
const BATCH_ID = `manual-${new Date().toISOString().slice(0,10)}-${crypto.randomBytes(3).toString('hex')}`;

// Lazy-load Anthropic only when needed
let anthropic = null;
async function getAnthropic() {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.VITE_NUKE_CLAUDE_API });
  }
  return anthropic;
}

// ─── DB Connection ──────────────────────────────────────────────────────────
async function getDb() {
  const client = new pg.Client({
    host: DB_HOST, port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// ─── System Prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Extract vehicle specs from service manual text. Return JSON only, no markdown.

Schema:
{"engine_specs":[{"name":"string","horsepower":0,"torque":0,"displacement_ci":0,"displacement_liters":0,"fuel_system":"string","notes":"string"}],"transmission_specs":[{"name":"string","type":"manual or automatic","gears":0,"notes":"string"}],"torque_specs":[{"component":"what part","torque_ft_lbs":0,"torque_nm":0,"sequence":"tightening pattern","notes":"string"}],"fluid_capacities":[{"system":"engine_oil/coolant/transmission/differential/fuel_tank/other","capacity_quarts":0,"capacity_liters":0,"fluid_type":"string","notes":"string"}],"service_intervals":[{"service":"what maintenance","interval_miles":0,"interval_months":0,"notes":"string"}],"part_numbers":[{"part_number":"string","description":"string","notes":"string"}],"production_facts":[{"fact":"string","source_context":"string"}]}

Rules: Only extract facts explicitly stated. Use exact numbers from the text. Return empty arrays for missing categories.`;

// ─── Fetch Document Groups to Mine ──────────────────────────────────────────
function extractYearFromTitle(title) {
  // Match 4-digit years that look like vehicle years (1940-2030), prefer leading position
  const m = title.match(/\b(19[4-9]\d|20[0-3]\d)\b/);
  return m ? parseInt(m[1]) : null;
}

async function fetchGroups(db, limit) {
  // Aggregate by document_id to avoid duplicates from multiple reference_libraries entries.
  // Pick the first make alphabetically (most have one make anyway).
  // Filter to actual service/workshop manuals (not brochures, fan specs, etc.)
  const result = await db.query(`
    SELECT min(ld.id::text)::uuid as document_id, ld.title,
           min(rl.make) as make,
           count(DISTINCT smc.id) as chunk_count,
           sum(length(smc.content)) as total_chars
    FROM service_manual_chunks smc
    JOIN library_documents ld ON ld.id = smc.document_id
    JOIN reference_libraries rl ON rl.id = ld.library_id
    WHERE rl.make IS NOT NULL
      AND smc.content_type IN ('specification', 'chart', 'reference')
      AND (ld.title ILIKE '%service%' OR ld.title ILIKE '%workshop%'
           OR ld.title ILIKE '%repair%' OR ld.title ILIKE '%owner%manual%'
           OR ld.title ILIKE '%technical%' OR ld.title ILIKE '%overhaul%'
           OR ld.document_type IN ('service_manual', 'workshop_manual', 'owners_manual'))
      AND ld.title NOT ILIKE '%brochure%'
      AND NOT EXISTS (
        SELECT 1 FROM comment_library_extractions cle
        WHERE cle.batch_id LIKE 'manual-%'
          AND cle.model = ld.title
      )
    GROUP BY ld.title
    HAVING count(DISTINCT smc.id) >= 3
    ORDER BY count(DISTINCT smc.id) DESC
    LIMIT $1
  `, [limit]);

  // Extract year from title JS-side since rl.year is unreliable
  return result.rows.map(r => ({ ...r, year: extractYearFromTitle(r.title) }));
}

// ─── Fetch Chunks for a Document ────────────────────────────────────────────
async function fetchChunks(db, title, maxChunks = 20) {
  // Query by title to capture chunks across all ld.id duplicates
  const result = await db.query(`
    SELECT DISTINCT ON (smc.content) smc.section_heading, smc.content_type, LEFT(smc.content, 1200) as content
    FROM service_manual_chunks smc
    JOIN library_documents ld ON ld.id = smc.document_id
    WHERE ld.title = $1
      AND smc.content_type IN ('specification', 'chart', 'reference')
    ORDER BY smc.content,
      CASE smc.content_type WHEN 'specification' THEN 1 WHEN 'chart' THEN 2 ELSE 3 END,
      smc.page_number
    LIMIT $2
  `, [title, maxChunks]);
  return result.rows;
}

// ─── Build User Prompt ──────────────────────────────────────────────────────
function buildPrompt(make, year, title, chunks) {
  let prompt = `Extract structured specifications from this factory service manual:\n`;
  prompt += `Manual: "${title}" | Make: ${make} | Year: ${year || 'unknown'}\n\n`;
  prompt += `MANUAL SECTIONS (${chunks.length} excerpts):\n\n`;

  let totalChars = 0;
  const MAX_CHARS = PROVIDER === 'ollama' ? 6000 : 12000;

  for (const c of chunks) {
    const entry = `[${c.content_type}] ${c.section_heading || 'General'}:\n${c.content}\n\n`;
    if (totalChars + entry.length > MAX_CHARS) break;
    prompt += entry;
    totalChars += entry.length;
  }

  return prompt;
}

// ─── Provider Call Functions ─────────────────────────────────────────────────

async function callAnthropic(systemPrompt, userPrompt) {
  const client = await getAnthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return {
    text: response.content[0]?.text?.trim() || '',
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cost: (response.usage.input_tokens * 1.0 + response.usage.output_tokens * 5.0) / 1_000_000,
  };
}

async function callOllama(systemPrompt, userPrompt) {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      stream: false,
      options: { temperature: 0.1, num_predict: 4096 },
    }),
  });
  if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const r = await resp.json();
  return { text: r.response || '', input_tokens: 0, output_tokens: 0, cost: 0 };
}

async function callGemini(systemPrompt, userPrompt) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('GOOGLE_AI_API_KEY not set');
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
  }
  const r = await resp.json();
  return { text: r.candidates?.[0]?.content?.parts?.[0]?.text || '', input_tokens: 0, output_tokens: 0, cost: 0 };
}

async function callModal(systemPrompt, userPrompt) {
  const resp = await fetch(`${MODAL_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5-7b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Modal ${resp.status}: ${text.slice(0, 200)}`);
  }
  const r = await resp.json();
  return { text: r.choices?.[0]?.message?.content || '', input_tokens: 0, output_tokens: 0, cost: 0 };
}

const PROVIDERS = { anthropic: callAnthropic, ollama: callOllama, gemini: callGemini, modal: callModal };

// ─── Parse JSON from LLM output ─────────────────────────────────────────────
function parseJsonResponse(text) {
  text = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (start === -1) start = i; depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (start === -1 || end === -1) throw new Error('No JSON object found');

  let jsonStr = text.substring(start, end);
  try {
    return JSON.parse(jsonStr);
  } catch {
    jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    return JSON.parse(jsonStr);
  }
}

// ─── Normalize extraction to expected schema ────────────────────────────────
function normalizeExtraction(parsed) {
  // Handle alternate key names the LLM might use
  return {
    engine_specs: parsed.engine_specs || parsed.engines || [],
    transmission_specs: parsed.transmission_specs || parsed.transmissions || [],
    torque_specs: parsed.torque_specs || parsed.torque || [],
    fluid_capacities: parsed.fluid_capacities || parsed.fluids || [],
    service_intervals: parsed.service_intervals || parsed.intervals || parsed.maintenance || [],
    part_numbers: parsed.part_numbers || parsed.parts || [],
    production_facts: parsed.production_facts || parsed.facts || [],
  };
}

// ─── Mine Document ──────────────────────────────────────────────────────────
async function mineDocument(make, year, title, chunks) {
  const userPrompt = buildPrompt(make, year, title, chunks);
  const startMs = Date.now();
  const callFn = PROVIDERS[PROVIDER];
  if (!callFn) throw new Error(`Unknown provider: ${PROVIDER}`);

  try {
    const { text, input_tokens, output_tokens, cost } = await callFn(SYSTEM_PROMPT, userPrompt);
    const parsed = parseJsonResponse(text);
    const extraction = normalizeExtraction(parsed);
    return { success: true, extraction, input_tokens, output_tokens, cost, elapsed_ms: Date.now() - startMs };
  } catch (err) {
    return { success: false, error: err.message?.substring(0, 300) || 'unknown' };
  }
}

// ─── Write Extractions to Staging Table ─────────────────────────────────────
async function writeExtractions(db, make, docTitle, year, extraction, chunkCount) {
  let totalRows = 0;

  const types = [
    ['engine_spec', extraction.engine_specs],
    ['transmission_spec', extraction.transmission_specs],
    ['torque_spec', extraction.torque_specs],
    ['fluid_capacity', extraction.fluid_capacities],
    ['service_interval', extraction.service_intervals],
    ['part_number', extraction.part_numbers],
    ['production_fact', extraction.production_facts],
  ];

  for (const [type, items] of types) {
    if (!items?.length) continue;
    for (const item of items) {
      await db.query(`
        INSERT INTO comment_library_extractions
          (make, model, year_start, year_end, extraction_type, extracted_data,
           source_comment_count, source_vehicle_count, confidence, model_used, batch_id)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
      `, [
        make,
        docTitle,  // model column stores document title for manual extractions
        year || null,
        year || null,
        type,
        JSON.stringify(item),
        chunkCount,  // source_comment_count = chunk count for manuals
        0,
        0.95,  // factory-authoritative confidence
        MODEL,
        BATCH_ID,
      ]);
      totalRows++;
    }
  }
  return totalRows;
}

// ─── Test Mode ──────────────────────────────────────────────────────────────
async function runTest(count) {
  const db = await getDb();
  console.log(`\n=== TEST: Mining ${count} service manual documents ===`);
  console.log(`Batch ID: ${BATCH_ID}\n`);

  const groups = await fetchGroups(db, count);
  if (groups.length === 0) { console.log('No documents to mine.'); await db.end(); return; }

  let totalCost = 0, totalExtractions = 0;

  for (const g of groups) {
    console.log(`\n── ${g.make} — ${g.title} (year: ${g.year || '?'}) ──`);
    console.log(`   ${g.chunk_count} spec/chart/ref chunks, ${(g.total_chars / 1024).toFixed(0)}KB`);

    const chunks = await fetchChunks(db, g.title);
    console.log(`   Fetched ${chunks.length} chunks`);

    const result = await mineDocument(g.make, g.year, g.title, chunks);

    if (!result.success) {
      console.log(`   FAIL: ${result.error}`);
      continue;
    }

    totalCost += result.cost;
    const ext = result.extraction;

    const counts = {
      engines: ext.engine_specs?.length || 0,
      trans: ext.transmission_specs?.length || 0,
      torque: ext.torque_specs?.length || 0,
      fluids: ext.fluid_capacities?.length || 0,
      intervals: ext.service_intervals?.length || 0,
      parts: ext.part_numbers?.length || 0,
      facts: ext.production_facts?.length || 0,
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    console.log(`   ${result.elapsed_ms}ms | $${result.cost.toFixed(4)} | ${result.input_tokens}in/${result.output_tokens}out`);
    console.log(`   Found: ${total} items (${counts.engines} engines, ${counts.trans} trans, ${counts.torque} torque, ${counts.fluids} fluids, ${counts.intervals} intervals, ${counts.parts} parts, ${counts.facts} facts)`);

    if (ext.torque_specs?.length > 0) {
      console.log(`   Torque: ${ext.torque_specs.slice(0, 3).map(t => `${t.component}: ${t.torque_ft_lbs}ft-lbs`).join(', ')}`);
    }
    if (ext.fluid_capacities?.length > 0) {
      console.log(`   Fluids: ${ext.fluid_capacities.map(f => `${f.system}: ${f.capacity_quarts}qt`).join(', ')}`);
    }

    const rows = await writeExtractions(db, g.make, g.title, g.year, ext, chunks.length);
    totalExtractions += rows;
    console.log(`   Wrote ${rows} rows to staging`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Documents: ${groups.length} | Extractions: ${totalExtractions} | Cost: $${totalCost.toFixed(4)}`);
  await db.end();
}

// ─── Batch Mode ─────────────────────────────────────────────────────────────
async function runBatch(limit) {
  const db = await getDb();
  console.log(`\n=== BATCH: Mining ${limit} service manual documents ===`);
  console.log(`Batch ID: ${BATCH_ID}\n`);

  const COST_CAP = PROVIDER === 'anthropic' ? parseFloat(process.env.COST_CAP || '10') : Infinity;
  const groups = await fetchGroups(db, limit);
  if (groups.length === 0) { console.log('No documents to mine (all done?).'); await db.end(); return; }
  const capStr = COST_CAP === Infinity ? 'none (free)' : `$${COST_CAP}`;
  console.log(`Found ${groups.length} documents to mine (cost cap: ${capStr})\n`);

  let processed = 0, errors = 0, totalCost = 0, totalExtractions = 0;
  const startTime = Date.now();

  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    if (totalCost >= COST_CAP) { console.log(`\nCOST CAP: $${totalCost.toFixed(2)} >= $${COST_CAP}`); break; }

    const chunk = groups.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (g) => {
      const chunks = await fetchChunks(db, g.title);
      const result = await mineDocument(g.make, g.year, g.title, chunks);
      return { group: g, chunks, result };
    }));

    for (const { group, chunks, result } of results) {
      if (!result.success) {
        errors++;
        console.error(`  ERR ${group.make} ${group.title}: ${result.error}`);
        continue;
      }

      try {
        const rows = await writeExtractions(
          db, group.make, group.title, group.year,
          result.extraction, chunks.length
        );
        processed++;
        totalExtractions += rows;
        totalCost += result.cost;

        const ext = result.extraction;
        const total = (ext.engine_specs?.length||0) + (ext.transmission_specs?.length||0) +
                      (ext.torque_specs?.length||0) + (ext.fluid_capacities?.length||0) +
                      (ext.service_intervals?.length||0) + (ext.part_numbers?.length||0) +
                      (ext.production_facts?.length||0);

        console.log(`  ${group.make} "${group.title.slice(0, 50)}" → ${total} items (${rows} rows) | $${result.cost.toFixed(4)}`);
      } catch (err) {
        errors++;
        console.error(`  WRITE ERR ${group.make}: ${err.message}`);
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    process.stdout.write(`\r  [${processed}/${groups.length}] ${(processed/elapsed).toFixed(1)}/s | $${totalCost.toFixed(3)} | ${totalExtractions} extractions | ${errors} err`);
    console.log();
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== COMPLETE ===`);
  console.log(`Documents: ${processed}/${groups.length} | Extractions: ${totalExtractions} | Errors: ${errors}`);
  console.log(`Cost: $${totalCost.toFixed(3)} | Time: ${(elapsed/60).toFixed(1)}min`);
  console.log(`Batch ID: ${BATCH_ID}`);
  await db.end();
}

// ─── Stats Mode ─────────────────────────────────────────────────────────────
async function showStats() {
  const db = await getDb();

  const totals = await db.query(`
    SELECT extraction_type, count(*) as cnt
    FROM comment_library_extractions
    WHERE batch_id LIKE 'manual-%'
    GROUP BY extraction_type
    ORDER BY cnt DESC
  `);
  console.log('\n=== Manual Mining Stats ===\n');
  if (totals.rows.length === 0) {
    console.log('  No manual extractions yet. Run --test 3 first.');
  } else {
    console.log('By type:');
    for (const r of totals.rows) {
      console.log(`  ${r.extraction_type}: ${r.cnt} items`);
    }
  }

  const byMake = await db.query(`
    SELECT make, count(*) as cnt, count(DISTINCT model) as docs
    FROM comment_library_extractions
    WHERE batch_id LIKE 'manual-%'
    GROUP BY make ORDER BY cnt DESC LIMIT 15
  `);
  if (byMake.rows.length > 0) {
    console.log('\nBy make:');
    for (const r of byMake.rows) {
      console.log(`  ${r.make}: ${r.cnt} items (${r.docs} documents)`);
    }
  }

  const remaining = await db.query(`
    SELECT count(DISTINCT ld.id) as docs,
           count(DISTINCT rl.make) as makes
    FROM service_manual_chunks smc
    JOIN library_documents ld ON ld.id = smc.document_id
    JOIN reference_libraries rl ON rl.id = ld.library_id
    WHERE rl.make IS NOT NULL
      AND smc.content_type IN ('specification', 'chart', 'reference')
      AND NOT EXISTS (
        SELECT 1 FROM comment_library_extractions cle
        WHERE cle.batch_id LIKE 'manual-%'
          AND cle.make ILIKE rl.make
          AND cle.model = ld.title
      )
  `);
  console.log(`\nRemaining: ${remaining.rows[0]?.docs} documents across ${remaining.rows[0]?.makes} makes`);
  await db.end();
}

// ─── Entry ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd = args.find(a => a.startsWith('--') && !['--provider', '--model', '--concurrency'].includes(a) && !a.startsWith('--cap='));

for (const arg of args) {
  if (arg.startsWith('--cap=')) process.env.COST_CAP = arg.split('=')[1];
}

console.log(`Provider: ${PROVIDER} | Model: ${MODEL} | Concurrency: ${CONCURRENCY}`);

switch (cmd) {
  case '--test': runTest(parseInt(args[args.indexOf('--test') + 1]) || 3); break;
  case '--run': runBatch(parseInt(args[args.indexOf('--run') + 1]) || 50); break;
  case '--stats': showStats(); break;
  default:
    console.log('Usage:');
    console.log('  --test N              Test mine N documents (default: 3)');
    console.log('  --run N               Batch mine N documents (default: 50)');
    console.log('  --stats               Show mining progress');
    console.log('  --provider <name>     anthropic|ollama|gemini|modal (default: ollama)');
    console.log('  --model <name>        Override model name');
    console.log('  --concurrency <n>     Override concurrency');
    console.log('  --cap=N               Cost cap in dollars (default: $10)');
}
