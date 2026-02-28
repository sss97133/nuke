#!/usr/bin/env node
/**
 * test-perplexity-enrichment.mjs
 *
 * A/B test: Compare Perplexity Sonar API enrichment against
 * the Perplexity Computer results from phase1_combined.csv.
 *
 * Takes 5 orgs, calls Sonar with a structured research prompt,
 * and compares output quality + measures cost.
 *
 * Usage:
 *   dotenvx run -- node scripts/test-perplexity-enrichment.mjs
 *
 * Requires: PERPLEXITY_API_KEY in .env
 */

import { readFileSync } from 'fs';
// Simple CSV parser — handles quoted fields with commas/newlines
function parseCsvToObjects(text) {
  const rows = [];
  let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i+1] === '"') { field += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      row.push(field); field = '';
    } else if ((c === '\n' || c === '\r') && !inQ) {
      row.push(field); field = '';
      if (row.some(f => f)) rows.push(row);
      row = [];
      if (c === '\r' && text[i+1] === '\n') i++;
    } else { field += c; }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

const PERPLEXITY_API_KEY = process.env.PERPL_API_KEY || process.env.PERPLEXITY_API_KEY;
if (!PERPLEXITY_API_KEY) {
  console.error('❌ PERPL_API_KEY not set. Add it to .env');
  process.exit(1);
}

// ── Load Phase 1 ground truth ────────────────────────────────────────────

const phase1Raw = readFileSync('/Users/skylar/Downloads/phase1_combined.csv', 'utf-8');
const phase1 = parseCsvToObjects(phase1Raw);

// Pick 5 diverse test orgs
const TEST_INDICES = [0, 49, 99, 199, 299];
const testOrgs = TEST_INDICES.map(i => phase1[i]).filter(Boolean);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  PERPLEXITY SONAR vs PERPLEXITY COMPUTER A/B TEST');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Testing ${testOrgs.length} orgs from Phase 1 ground truth`);
console.log('');

// ── Research prompt template ─────────────────────────────────────────────

function buildPrompt(url, businessName) {
  return `Research this automotive business thoroughly and return structured data.

Business URL: ${url}
Business Name (if known): ${businessName || 'Unknown'}

Find and return ALL of the following information in JSON format:
{
  "business_name": "official business name",
  "description": "2-3 sentence description of what this business does",
  "address": "full street address",
  "city": "city",
  "state": "state/province",
  "zip_code": "postal code",
  "country": "country",
  "phone": "phone number (digits only, no annotations)",
  "email": "primary contact email",
  "logo_url": "URL to their logo image if findable",
  "inventory_url": "URL to their vehicle inventory page",
  "services_offered": ["list", "of", "services"],
  "specializations": ["list", "of", "specializations"],
  "brands_carried": ["list", "of", "brands"],
  "social_facebook": "facebook URL or null",
  "social_instagram": "instagram URL or null",
  "social_twitter": "twitter/X URL or null",
  "social_youtube": "youtube URL or null",
  "social_linkedin": "linkedin URL or null",
  "year_established": "year or null",
  "employee_count_estimate": "estimate or null",
  "hours_of_operation": "business hours or null"
}

Search their website, Google, social media, and business directories. Return ONLY the JSON object, no other text.`;
}

// ── Call Perplexity Sonar API ────────────────────────────────────────────

async function callSonar(url, businessName) {
  const startTime = Date.now();

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: 'You are a business research assistant. Return only valid JSON. No markdown, no explanations.',
        },
        {
          role: 'user',
          content: buildPrompt(url, businessName),
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  const elapsed = Date.now() - startTime;
  const data = await response.json();

  if (!response.ok) {
    return { error: data, elapsed, tokens: null };
  }

  const usage = data.usage || {};
  const content = data.choices?.[0]?.message?.content || '';

  // Try to parse JSON from response
  let parsed = null;
  try {
    // Handle markdown-wrapped JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    parsed = { _parse_error: e.message, _raw: content.substring(0, 500) };
  }

  return {
    result: parsed,
    raw: content,
    elapsed,
    tokens: {
      input: usage.prompt_tokens || 0,
      output: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
    },
  };
}

// ── Compare fields ───────────────────────────────────────────────────────

function compareResults(groundTruth, sonarResult) {
  const fields = [
    'business_name', 'description', 'city', 'state', 'country',
    'phone', 'email', 'services_offered', 'specializations',
    'brands_carried', 'social_facebook', 'social_instagram',
    'social_youtube', 'year_established',
  ];

  let matched = 0;
  let sonarOnly = 0;
  let computerOnly = 0;
  let both = 0;
  const details = [];

  for (const field of fields) {
    const gtValue = groundTruth[field];
    const sonarValue = sonarResult?.[field];

    const gtHas = gtValue && gtValue !== 'Not found' && gtValue !== 'N/A' && gtValue !== '';
    const sonarHas = sonarValue && sonarValue !== null && sonarValue !== '' &&
      !(Array.isArray(sonarValue) && sonarValue.length === 0);

    if (gtHas && sonarHas) {
      both++;
      details.push(`  ✅ ${field}: BOTH have data`);
    } else if (gtHas && !sonarHas) {
      computerOnly++;
      details.push(`  🟡 ${field}: Computer only → "${String(gtValue).substring(0, 60)}..."`);
    } else if (!gtHas && sonarHas) {
      sonarOnly++;
      details.push(`  🔵 ${field}: Sonar only → "${String(sonarValue).substring(0, 60)}..."`);
    }
    // Both missing = skip
  }

  return { both, computerOnly, sonarOnly, total: fields.length, details };
}

// ── Main ─────────────────────────────────────────────────────────────────

let totalTokensIn = 0;
let totalTokensOut = 0;
let totalElapsed = 0;

for (let i = 0; i < testOrgs.length; i++) {
  const org = testOrgs[i];
  const url = org.entity;
  const name = org.business_name;

  console.log(`\n[${ i + 1}/${testOrgs.length}] ${name}`);
  console.log(`  URL: ${url}`);

  const sonar = await callSonar(url, name);

  if (sonar.error) {
    console.log(`  ❌ API Error: ${JSON.stringify(sonar.error).substring(0, 200)}`);
    continue;
  }

  console.log(`  ⏱  ${sonar.elapsed}ms | Tokens: ${sonar.tokens.input}in + ${sonar.tokens.output}out = ${sonar.tokens.total}`);

  totalTokensIn += sonar.tokens.input;
  totalTokensOut += sonar.tokens.output;
  totalElapsed += sonar.elapsed;

  const comparison = compareResults(org, sonar.result);
  console.log(`  📊 Both: ${comparison.both} | Computer-only: ${comparison.computerOnly} | Sonar-only: ${comparison.sonarOnly}`);
  comparison.details.forEach(d => console.log(d));

  // Show Sonar description vs Computer description
  if (sonar.result?.description) {
    console.log(`\n  SONAR desc: "${sonar.result.description.substring(0, 150)}..."`);
  }
  if (org.description) {
    console.log(`  COMPUTER desc: "${org.description.substring(0, 150)}..."`);
  }

  // Rate limit pause
  await new Promise(r => setTimeout(r, 1000));
}

// ── Cost summary ─────────────────────────────────────────────────────────

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  COST ANALYSIS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Total tokens: ${totalTokensIn} input + ${totalTokensOut} output = ${totalTokensIn + totalTokensOut}`);
console.log(`  Total time: ${(totalElapsed / 1000).toFixed(1)}s for ${testOrgs.length} orgs`);
console.log(`  Avg per org: ${(totalElapsed / testOrgs.length / 1000).toFixed(1)}s`);

// Sonar pricing: $1/1M input + $1/1M output + $5/1K requests
const inputCost = (totalTokensIn / 1_000_000) * 1;
const outputCost = (totalTokensOut / 1_000_000) * 1;
const requestCost = (testOrgs.length / 1000) * 5;
const totalCost = inputCost + outputCost + requestCost;

console.log(`\n  Sonar cost for ${testOrgs.length} orgs: $${totalCost.toFixed(4)}`);
console.log(`  Cost per org: $${(totalCost / testOrgs.length).toFixed(4)}`);

// Scale projections
const costPer1K = (totalCost / testOrgs.length) * 1000;
console.log(`\n  ── SCALE PROJECTIONS ──`);
console.log(`  1,000 orgs:  $${costPer1K.toFixed(2)}`);
console.log(`  10,000 orgs: $${(costPer1K * 10).toFixed(2)}`);
console.log(`  508,000 orgs: $${(costPer1K * 508).toFixed(2)}`);
console.log(`  Time for 508K: ~${((totalElapsed / testOrgs.length) * 508000 / 1000 / 3600).toFixed(0)} hours (single-threaded)`);
console.log(`  Time for 508K @ 10 concurrent: ~${((totalElapsed / testOrgs.length) * 508000 / 1000 / 3600 / 10).toFixed(0)} hours`);
