#!/usr/bin/env node
/**
 * Question Taxonomy Discovery Pipeline
 *
 * Phase 1 of the "What Do Buyers Actually Want To Know?" pipeline.
 * Discovers question categories from 1.6M auction comment questions.
 *
 * Steps:
 *   1A. Stratified sample (~15K diverse questions)
 *   1B. LLM taxonomy discovery (Gemini Flash, free)
 *   1C. Taxonomy consolidation (1 Sonnet call, ~$0.14)
 *   1D. Regex pattern extraction from classified questions
 *
 * Usage:
 *   dotenvx run -- node scripts/question-taxonomy-discovery.mjs
 *   dotenvx run -- node scripts/question-taxonomy-discovery.mjs --step sample
 *   dotenvx run -- node scripts/question-taxonomy-discovery.mjs --step discover
 *   dotenvx run -- node scripts/question-taxonomy-discovery.mjs --step consolidate
 *   dotenvx run -- node scripts/question-taxonomy-discovery.mjs --step extract-patterns
 *   dotenvx run -- node scripts/question-taxonomy-discovery.mjs --step all
 *   dotenvx run -- node scripts/question-taxonomy-discovery.mjs --sample-size 5000
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Run with: dotenvx run -- node scripts/question-taxonomy-discovery.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Parse CLI args
const args = process.argv.slice(2);
const step = args.includes('--step') ? args[args.indexOf('--step') + 1] : 'all';
const sampleSize = args.includes('--sample-size')
  ? parseInt(args[args.indexOf('--sample-size') + 1])
  : 15000;
const perCell = Math.ceil(sampleSize / 20); // 5 price bands x 4 era bands = 20 cells

// ═══════════════════════════════════════════════════
// STEP 1A: Stratified Sample
// ═══════════════════════════════════════════════════

async function stepSample() {
  console.log(`\n[1A] Pulling stratified sample (~${sampleSize} questions)...`);

  // Strategy: pull random question IDs first (cheap), then batch-join to vehicles.
  // random() < threshold avoids ORDER BY random() which requires full sort.
  const oversample = Math.min(sampleSize * 5, 50000);
  const threshold = Math.min(0.05, oversample / 1650000 * 2); // 2x oversample

  console.log(`  Sampling questions (random < ${threshold.toFixed(4)}, targeting ~${oversample})...`);

  // Step 1: Get random question IDs via direct psql (avoids RPC timeout issues on 12M rows)
  const { execSync } = await import('child_process');
  const pgCmd = `PGPASSWORD="${process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ'}" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -F '|' -c "SELECT id, vehicle_id, comment_text, is_seller FROM auction_comments WHERE has_question = true AND random() < ${threshold} LIMIT ${oversample}"`;

  let rawOutput;
  try {
    rawOutput = execSync(pgCmd, { maxBuffer: 100 * 1024 * 1024, timeout: 120000 }).toString();
  } catch (e) {
    throw new Error(`psql sample failed: ${e.message?.slice(0, 200)}`);
  }

  const idRows = rawOutput.trim().split('\n').filter(Boolean).map(line => {
    const [id, vehicle_id, comment_text, is_seller] = line.split('|');
    return { id, vehicle_id, comment_text, is_seller: is_seller === 't' };
  }).filter(r => r.comment_text && r.comment_text.length > 20 && r.vehicle_id);
  const questionPool = Array.isArray(idRows) ? idRows : [];
  console.log(`  Got ${questionPool.length} question IDs`);

  // Step 2: Get vehicle info for sampled questions (batch by vehicle_id)
  const vehicleIds = [...new Set(questionPool.map(q => q.vehicle_id))];
  const vehicleMap = new Map();

  // Batch in chunks of 200 vehicle IDs
  for (let i = 0; i < vehicleIds.length; i += 200) {
    const chunk = vehicleIds.slice(i, i + 200);
    const idList = chunk.map(id => `'${id}'`).join(',');
    const { data: vRows } = await supabase.rpc('execute_sql', {
      query: `
        SELECT id, year, make, model,
          COALESCE(sale_price, winning_bid, high_bid, bat_sold_price) AS sale_price
        FROM vehicles
        WHERE id IN (${idList})
          AND year IS NOT NULL
          AND COALESCE(sale_price, winning_bid, high_bid, bat_sold_price) IS NOT NULL
      `,
    });
    for (const v of (vRows || [])) {
      vehicleMap.set(v.id, v);
    }
  }

  // Step 3: Merge
  const rawSample = questionPool
    .filter(q => vehicleMap.has(q.vehicle_id))
    .map(q => {
      const v = vehicleMap.get(q.vehicle_id);
      return { ...q, year: v.year, make: v.make, model: v.model, sale_price: v.sale_price };
    });

  console.log(`  Merged ${rawSample.length} questions with vehicle data (${vehicleMap.size} vehicles)`);

  const pool = Array.isArray(rawSample) ? rawSample : [];
  console.log(`  Got ${pool.length} questions from TABLESAMPLE`);

  // Step 2: Stratify in memory
  const cells = {};
  for (const row of pool) {
    const pb = row.sale_price < 10000 ? 'u10k' : row.sale_price < 25000 ? '10_25' : row.sale_price < 50000 ? '25_50' : row.sale_price < 100000 ? '50_100' : 'o100k';
    const eb = row.year < 1970 ? 'pre70' : row.year < 1990 ? '70_90' : row.year < 2010 ? '90_10' : 'post10';
    const key = `${pb}/${eb}`;
    if (!cells[key]) cells[key] = [];
    cells[key].push(row);
  }

  // Step 3: Take perCell from each cell
  const samples = [];
  for (const [key, rows] of Object.entries(cells)) {
    // Shuffle and take perCell
    const shuffled = rows.sort(() => Math.random() - 0.5);
    samples.push(...shuffled.slice(0, perCell));
  }

  console.log(`  Stratified to ${samples.length} questions across ${Object.keys(cells).length} cells`);

  // Show distribution
  const pbCounts = {};
  const ebCounts = {};
  for (const s of samples) {
    const pb = s.sale_price < 10000 ? 'u10k' : s.sale_price < 25000 ? '10_25' : s.sale_price < 50000 ? '25_50' : s.sale_price < 100000 ? '50_100' : 'o100k';
    const eb = s.year < 1970 ? 'pre70' : s.year < 1990 ? '70_90' : s.year < 2010 ? '90_10' : 'post10';
    pbCounts[pb] = (pbCounts[pb] || 0) + 1;
    ebCounts[eb] = (ebCounts[eb] || 0) + 1;
  }
  console.log('  Price bands:', pbCounts);
  console.log('  Era bands:', ebCounts);

  return samples;
}

// ═══════════════════════════════════════════════════
// STEP 1B: LLM Taxonomy Discovery (Gemini Flash)
// ═══════════════════════════════════════════════════

const DISCOVERY_PROMPT = `You are analyzing auction comment questions from collector vehicle listings.
For each question, classify:
- topic: a granular topic (e.g. "engine_compression", "paint_originality", "service_records", "shipping_logistics", "reserve_price"). Use snake_case, be specific not generic.
- intent: one of: information_request | evidence_request | clarification | challenge | logistics | negotiation
- data_field: what database field would answer this question? Use snake_case (e.g. "engine_type", "mileage", "transmission_type", "vin", "paint_code"). null if subjective/unanswerable from data.

Return a JSON array where each element corresponds to a question by index:
[
  {"index": 1, "topic": "engine_originality", "intent": "evidence_request", "data_field": "matching_numbers"},
  ...
]

Return ONLY the JSON array.

QUESTIONS:
`;

async function callGeminiFlash(prompt, { maxTokens = 8192 } = {}) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callConsolidationLLM(systemPrompt, userMessage) {
  // Try Sonnet first (better quality), fall back to Gemini Flash (free)
  if (ANTHROPIC_KEY) {
    console.log('  Using Claude Sonnet for consolidation...');
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const cost = ((data.usage?.input_tokens || 0) * 3 + (data.usage?.output_tokens || 0) * 15) / 1_000_000;
      console.log(`  Sonnet cost: $${cost.toFixed(4)} (${data.usage?.input_tokens}in/${data.usage?.output_tokens}out)`);
      return data.content?.[0]?.text || '';
    }
    const errText = await resp.text().catch(() => '');
    console.log(`  Sonnet failed (${resp.status}), falling back to Gemini Flash...`);
  } else {
    console.log('  ANTHROPIC_API_KEY not set, using Gemini Flash for consolidation (free)...');
  }

  // Gemini Flash fallback — use higher token limit for consolidation
  if (!GEMINI_KEY) throw new Error('Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY available');
  const fullPrompt = systemPrompt + '\n\n' + userMessage;
  return await callGeminiFlash(fullPrompt, { maxTokens: 65536 });
}

function parseJsonFromLLM(raw) {
  try { return JSON.parse(raw); } catch { /* */ }
  const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock) try { return JSON.parse(codeBlock[1].trim()); } catch { /* */ }
  const jsonMatch = raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) try { return JSON.parse(jsonMatch[1]); } catch { /* */ }
  return null;
}

async function stepDiscover(samples) {
  console.log(`\n[1B] Discovering taxonomy from ${samples.length} questions via Gemini Flash...`);

  const batchSize = 200;
  const allClassifications = [];
  const batches = Math.ceil(samples.length / batchSize);
  let errors = 0;

  for (let i = 0; i < samples.length; i += batchSize) {
    const batch = samples.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    const questionBlock = batch
      .map((q, idx) => `[${idx + 1}] (${q.year} ${q.make} ${q.model}, $${Math.round(q.sale_price).toLocaleString()}) ${q.comment_text.substring(0, 300)}`)
      .join('\n');

    const prompt = DISCOVERY_PROMPT + questionBlock;

    try {
      const raw = await callGeminiFlash(prompt);
      const parsed = parseJsonFromLLM(raw);

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const idx = (item.index || 0) - 1;
          if (idx >= 0 && idx < batch.length) {
            allClassifications.push({
              comment_id: batch[idx].id,
              comment_text: batch[idx].comment_text,
              topic: item.topic,
              intent: item.intent,
              data_field: item.data_field,
              year: batch[idx].year,
              make: batch[idx].make,
              sale_price: batch[idx].sale_price,
            });
          }
        }
        process.stdout.write(`  Batch ${batchNum}/${batches}: ${parsed.length} classified\r`);
      } else {
        errors++;
        console.log(`  Batch ${batchNum}/${batches}: parse failed`);
      }
    } catch (e) {
      errors++;
      console.log(`  Batch ${batchNum}/${batches}: ${e.message.slice(0, 100)}`);
    }

    // Rate limit: Gemini free tier = 15 RPM for flash-lite, be conservative
    if (batchNum % 14 === 0) {
      console.log(`\n  Rate limit pause (60s)...`);
      await new Promise(r => setTimeout(r, 60000));
    } else {
      await new Promise(r => setTimeout(r, 4200)); // ~14 req/min
    }
  }

  console.log(`\n  Total classified: ${allClassifications.length}, errors: ${errors}`);
  return allClassifications;
}

// ═══════════════════════════════════════════════════
// STEP 1C: Taxonomy Consolidation (Sonnet)
// ═══════════════════════════════════════════════════

async function stepConsolidate(classifications) {
  console.log(`\n[1C] Consolidating taxonomy from ${classifications.length} classifications...`);

  // Aggregate topics
  const topicCounts = {};
  const intentCounts = {};
  const dataFieldCounts = {};
  const topicExamples = {};

  for (const c of classifications) {
    if (!c.topic) continue;
    const t = c.topic.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    topicCounts[t] = (topicCounts[t] || 0) + 1;
    intentCounts[c.intent] = (intentCounts[c.intent] || 0) + 1;
    if (c.data_field) dataFieldCounts[c.data_field] = (dataFieldCounts[c.data_field] || 0) + 1;
    if (!topicExamples[t]) topicExamples[t] = [];
    if (topicExamples[t].length < 3) {
      topicExamples[t].push(c.comment_text.substring(0, 150));
    }
  }

  // Sort by frequency
  const topicList = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, count]) => ({
      topic,
      count,
      examples: topicExamples[topic] || [],
    }));

  console.log(`  Unique topics: ${topicList.length}`);
  console.log(`  Intent distribution:`, intentCounts);
  console.log(`  Top 20 topics:`, topicList.slice(0, 20).map(t => `${t.topic} (${t.count})`).join(', '));

  // Sonnet consolidation call
  const consolidationPrompt = `You are designing a question taxonomy for collector vehicle auction comments.
Below are ${topicList.length} granular topics with their frequencies, discovered by classifying ~${classifications.length} real buyer questions.

Your job: create a 2-level taxonomy.
- L1: 8-15 broad categories (e.g. "mechanical", "provenance", "logistics")
- L2: 3-10 subcategories per L1 (e.g. "mechanical.engine_originality", "mechanical.transmission_type")

For each L2:
- id: "l1.l2" format (snake_case)
- display_name: human-readable
- description: 1-sentence
- example_questions: 2-3 from the data
- answerable_from_db: can a structured DB field answer this? (true/false)
- data_fields: array of DB field names that would answer it (e.g. ["engine_type", "matching_numbers"])
- keywords: top distinguishing words for regex matching

Return JSON:
{
  "taxonomy": [
    {
      "id": "mechanical.engine_originality",
      "l1_category": "mechanical",
      "l2_subcategory": "engine_originality",
      "display_name": "Engine Originality & Matching Numbers",
      "description": "Questions about whether engine/drivetrain numbers match the original build sheet",
      "example_questions": ["Are the numbers matching?", "Is this the original engine?"],
      "answerable_from_db": true,
      "data_fields": ["matching_numbers", "engine_type", "engine_number"],
      "keywords": ["matching", "numbers", "original engine", "numbers match", "block number", "stamping"]
    }
  ]
}

Return ONLY the JSON.`;

  const topicSummary = topicList.map(t =>
    `${t.topic} (${t.count}): ${t.examples.map(e => `"${e}"`).join(' | ')}`
  ).join('\n');

  const raw = await callConsolidationLLM(consolidationPrompt, topicSummary);
  const parsed = parseJsonFromLLM(raw);

  // Handle various response structures
  let taxonomy;
  if (parsed?.taxonomy && Array.isArray(parsed.taxonomy)) {
    taxonomy = parsed.taxonomy;
  } else if (Array.isArray(parsed)) {
    taxonomy = parsed;
  } else if (parsed && typeof parsed === 'object') {
    // Try to find an array in the response
    const arrays = Object.values(parsed).filter(v => Array.isArray(v));
    if (arrays.length > 0) {
      taxonomy = arrays.sort((a, b) => b.length - a.length)[0]; // Largest array
    }
  }

  if (!taxonomy || taxonomy.length === 0) {
    console.log('  Raw LLM response (first 500 chars):', raw?.substring(0, 500));
    throw new Error('Consolidation failed to return taxonomy array');
  }

  // Validate and normalize entries
  taxonomy = taxonomy.filter(t => t.l1_category && t.l2_subcategory).map(t => ({
    id: t.id || `${t.l1_category}.${t.l2_subcategory}`,
    l1_category: t.l1_category,
    l2_subcategory: t.l2_subcategory,
    display_name: t.display_name || `${t.l1_category} / ${t.l2_subcategory}`,
    description: t.description || null,
    example_questions: t.example_questions || [],
    answerable_from_db: t.answerable_from_db ?? false,
    data_fields: t.data_fields || [],
    keywords: t.keywords || [],
  }));

  console.log(`  Taxonomy: ${taxonomy.length} L2 categories`);
  const l1s = [...new Set(taxonomy.map(t => t.l1_category))];
  console.log(`  L1 categories (${l1s.length}): ${l1s.join(', ')}`);

  return taxonomy;
}

// ═══════════════════════════════════════════════════
// STEP 1D: Regex Pattern Extraction
// ═══════════════════════════════════════════════════

function stepExtractPatterns(taxonomy, classifications) {
  console.log(`\n[1D] Extracting regex patterns from classified questions...`);

  // Build a map: topic -> L2 id (for mapping classifications to taxonomy)
  const topicToL2 = {};
  for (const t of taxonomy) {
    // Map both the full l2 and common variations
    topicToL2[t.l2_subcategory] = t.id;
    topicToL2[`${t.l1_category}_${t.l2_subcategory}`] = t.id;
  }

  // For each L2 category, collect all question texts that were classified into it
  const categoryTexts = {};
  for (const t of taxonomy) {
    categoryTexts[t.id] = [];
  }

  // Map classifications to taxonomy categories
  for (const c of classifications) {
    if (!c.topic) continue;
    const topic = c.topic.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    // Try exact match first, then partial match
    let matchedId = topicToL2[topic];
    if (!matchedId) {
      // Find best keyword overlap
      for (const t of taxonomy) {
        const kws = (t.keywords || []).map(k => k.toLowerCase());
        const text = c.comment_text.toLowerCase();
        const matches = kws.filter(k => text.includes(k)).length;
        if (matches > 0 && (!matchedId || matches > (categoryTexts[matchedId]?._bestScore || 0))) {
          matchedId = t.id;
          if (!categoryTexts[matchedId]) categoryTexts[matchedId] = [];
          categoryTexts[matchedId]._bestScore = matches;
        }
      }
    }

    if (matchedId && categoryTexts[matchedId]) {
      categoryTexts[matchedId].push(c.comment_text);
    }
  }

  // Extract n-grams per category
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'this', 'that', 'these',
    'those', 'it', 'its', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
    'by', 'from', 'and', 'or', 'but', 'not', 'if', 'what', 'how', 'when',
    'where', 'who', 'which', 'there', 'here', 'any', 'some', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'than',
    'too', 'very', 'just', 'about', 'up', 'out', 'so', 'no', 'as',
    'into', 'also', 'your', 'you', 'they', 'them', 'their', 'we', 'our',
    'i', 'my', 'me', 'he', 'she', 'him', 'her', 'his', 'car', 'vehicle',
  ]);

  function extractBigrams(text) {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    const bigrams = [];
    for (let i = 0; i < words.length - 1; i++) {
      if (!stopWords.has(words[i]) || !stopWords.has(words[i + 1])) {
        bigrams.push(`${words[i]} ${words[i + 1]}`);
      }
    }
    return bigrams;
  }

  // Global bigram frequencies (for TF-IDF)
  const globalBigramCounts = {};
  const allTexts = classifications.map(c => c.comment_text);
  for (const text of allTexts) {
    const seen = new Set();
    for (const bg of extractBigrams(text)) {
      if (!seen.has(bg)) {
        globalBigramCounts[bg] = (globalBigramCounts[bg] || 0) + 1;
        seen.add(bg);
      }
    }
  }

  const totalDocs = allTexts.length;

  // For each category, find distinguishing bigrams
  for (const t of taxonomy) {
    const texts = categoryTexts[t.id] || [];
    if (texts.length < 5) {
      // Not enough data for pattern extraction, rely on keywords from Sonnet
      t.regex_patterns = buildRegexFromKeywords(t.keywords || []);
      continue;
    }

    const catBigramCounts = {};
    for (const text of texts) {
      const seen = new Set();
      for (const bg of extractBigrams(text)) {
        if (!seen.has(bg)) {
          catBigramCounts[bg] = (catBigramCounts[bg] || 0) + 1;
          seen.add(bg);
        }
      }
    }

    // TF-IDF: term frequency in category * inverse document frequency
    const scored = Object.entries(catBigramCounts)
      .filter(([_, count]) => count >= 3) // At least 3 occurrences
      .map(([bigram, count]) => {
        const tf = count / texts.length;
        const idf = Math.log(totalDocs / (globalBigramCounts[bigram] || 1));
        return { bigram, score: tf * idf, count, tf };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // Build regex patterns from top bigrams
    const patterns = scored.map(s => ({
      pattern: s.bigram.replace(/\s+/g, '\\s+'),
      weight: Math.round(s.score * 100) / 100,
      bigram: s.bigram,
      count: s.count,
    }));

    // Merge keyword patterns from Sonnet with data-driven patterns
    const keywordPatterns = buildRegexFromKeywords(t.keywords || []);

    t.regex_patterns = {
      data_driven: patterns,
      keyword_based: keywordPatterns,
    };

    // Update keywords with data-driven terms
    const dataKeywords = scored.slice(0, 8).map(s => s.bigram);
    t.keywords = [...new Set([...(t.keywords || []), ...dataKeywords])];
  }

  // Report
  let totalPatterns = 0;
  for (const t of taxonomy) {
    const dp = t.regex_patterns?.data_driven?.length || 0;
    const kp = t.regex_patterns?.keyword_based?.length || 0;
    totalPatterns += dp + kp;
  }
  console.log(`  Total regex patterns: ${totalPatterns} across ${taxonomy.length} categories`);

  return taxonomy;
}

function buildRegexFromKeywords(keywords) {
  return keywords
    .filter(k => k && k.length > 2)
    .map(k => ({
      pattern: k.replace(/\s+/g, '\\s+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      weight: 1.0,
      source: 'keyword',
    }));
}

// ═══════════════════════════════════════════════════
// WRITE TAXONOMY TO DB
// ═══════════════════════════════════════════════════

async function writeTaxonomyToDb(taxonomy) {
  console.log(`\n[DB] Writing ${taxonomy.length} taxonomy entries to question_taxonomy...`);

  // Clear existing
  await supabase.from('question_taxonomy').delete().neq('id', '___never___');

  // Insert in chunks
  const rows = taxonomy.map(t => ({
    id: t.id,
    l1_category: t.l1_category,
    l2_subcategory: t.l2_subcategory,
    display_name: t.display_name,
    description: t.description || null,
    example_questions: t.example_questions || [],
    regex_patterns: t.regex_patterns || {},
    keywords: t.keywords || [],
    answerable_from_db: t.answerable_from_db ?? false,
    data_fields: t.data_fields || [],
    question_count: 0,
  }));

  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await supabase.from('question_taxonomy').upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.error(`  Insert error at ${i}:`, error.message);
    }
  }

  console.log(`  Written ${rows.length} taxonomy entries`);

  // Show summary
  const l1Summary = {};
  for (const t of taxonomy) {
    if (!l1Summary[t.l1_category]) l1Summary[t.l1_category] = 0;
    l1Summary[t.l1_category]++;
  }
  console.log('  L1 summary:', l1Summary);
}

// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

async function main() {
  console.log('=== Question Taxonomy Discovery Pipeline ===');
  console.log(`Step: ${step}, Sample size: ${sampleSize}`);

  let samples;
  let classifications;
  let taxonomy;

  try {
    if (step === 'all' || step === 'sample') {
      samples = await stepSample();
      if (step === 'sample') {
        console.log('\nSample step complete. Rerun with --step discover to continue.');
        return;
      }
    }

    if (step === 'all' || step === 'discover') {
      if (!samples) {
        console.log('Loading fresh sample...');
        samples = await stepSample();
      }
      classifications = await stepDiscover(samples);

      // Save intermediate results
      const fs = await import('fs');
      fs.writeFileSync('/tmp/question-taxonomy-classifications.json', JSON.stringify(classifications, null, 2));
      console.log('  Saved intermediate results to /tmp/question-taxonomy-classifications.json');

      if (step === 'discover') {
        console.log('\nDiscovery step complete. Rerun with --step consolidate to continue.');
        return;
      }
    }

    if (step === 'all' || step === 'consolidate') {
      if (!classifications) {
        // Load from intermediate file
        const fs = await import('fs');
        try {
          classifications = JSON.parse(fs.readFileSync('/tmp/question-taxonomy-classifications.json', 'utf8'));
          console.log(`Loaded ${classifications.length} classifications from intermediate file`);
        } catch {
          throw new Error('No classifications available. Run --step discover first.');
        }
      }
      taxonomy = await stepConsolidate(classifications);

      // Save intermediate
      const fs = await import('fs');
      fs.writeFileSync('/tmp/question-taxonomy-consolidated.json', JSON.stringify(taxonomy, null, 2));
      console.log('  Saved taxonomy to /tmp/question-taxonomy-consolidated.json');

      if (step === 'consolidate') {
        console.log('\nConsolidation step complete. Rerun with --step extract-patterns to continue.');
        return;
      }
    }

    if (step === 'all' || step === 'extract-patterns') {
      if (!taxonomy) {
        const fs = await import('fs');
        try {
          taxonomy = JSON.parse(fs.readFileSync('/tmp/question-taxonomy-consolidated.json', 'utf8'));
          console.log(`Loaded ${taxonomy.length} taxonomy entries from intermediate file`);
        } catch {
          throw new Error('No taxonomy available. Run --step consolidate first.');
        }
      }
      if (!classifications) {
        const fs = await import('fs');
        try {
          classifications = JSON.parse(fs.readFileSync('/tmp/question-taxonomy-classifications.json', 'utf8'));
        } catch {
          classifications = []; // Pattern extraction will use keywords only
        }
      }

      taxonomy = stepExtractPatterns(taxonomy, classifications);

      // Write to DB
      await writeTaxonomyToDb(taxonomy);

      // Save final version
      const fs = await import('fs');
      fs.writeFileSync('/tmp/question-taxonomy-final.json', JSON.stringify(taxonomy, null, 2));
      console.log('  Saved final taxonomy to /tmp/question-taxonomy-final.json');
    }

    console.log('\n=== Pipeline Complete ===');

    if (taxonomy) {
      console.log(`\nTaxonomy summary:`);
      const l1s = [...new Set(taxonomy.map(t => t.l1_category))];
      for (const l1 of l1s) {
        const l2s = taxonomy.filter(t => t.l1_category === l1);
        const answerable = l2s.filter(t => t.answerable_from_db).length;
        console.log(`  ${l1}: ${l2s.length} subcategories (${answerable} answerable from DB)`);
      }
      console.log(`\nNext: Run question classification:`);
      console.log(`  curl -X POST $VITE_SUPABASE_URL/functions/v1/analyze-comments-fast \\`);
      console.log(`    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \\`);
      console.log(`    -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"mode": "question_classify", "batch_size": 1000, "continue": true}'`);
    }

  } catch (e) {
    console.error('\nFATAL:', e.message);
    process.exit(1);
  }
}

main();
