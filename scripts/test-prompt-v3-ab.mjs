#!/usr/bin/env node
/**
 * A/B test: run a single Porsche extraction with the updated v3 prompt
 * and verify every quote against the source description.
 *
 * Usage: dotenvx run -- node scripts/test-prompt-v3-ab.mjs
 */

import { buildV3Prompt } from './lib/extraction-prompt-v3.mjs';
import { buildExtractionContext, formatContextForPrompt } from './lib/build-extraction-context.mjs';
import pg from 'pg';
import OpenAI from 'openai';

const connStr = `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
const db = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
await db.connect();

// Get a Porsche with a rich description
const { rows } = await db.query(
  `SELECT id, year, make, model, sale_price, description
   FROM vehicles WHERE year=1999 AND make='Porsche' AND model LIKE '%Boxster%'
   AND description IS NOT NULL AND LENGTH(description) > 500 LIMIT 1`
);
const v = rows[0];
console.log(`Vehicle: ${v.year} ${v.make} ${v.model} | desc length: ${v.description.length}`);

// Build prompt with reference context
const ctx = await buildExtractionContext(db, v.year, v.make, v.model);
const formatted = formatContextForPrompt(ctx);
const prompt = buildV3Prompt(v.description, v, formatted);

// Call Grok via xAI
const xai = new OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: 'https://api.x.ai/v1' });
console.log('Calling grok-3-mini with UPDATED prompt...');
const resp = await xai.chat.completions.create({
  model: 'grok-3-mini',
  messages: [{ role: 'user', content: prompt }],
  temperature: 0.1
});

const text = resp.choices[0].message.content;
const match = text.match(/\{[\s\S]*\}/);
if (!match) { console.log('No JSON found in response'); process.exit(1); }
const parsed = JSON.parse(match[0]);

const descLower = v.description.toLowerCase();

function verifyQuote(quote) {
  if (!quote) return 'NO_QUOTE';
  return descLower.includes(quote.toLowerCase()) ? 'VERIFIED' : 'FABRICATED';
}

// Verify all sections
const sections = {
  option_codes: (parsed.option_codes || []).filter(c => c.code),
  equipment: (parsed.equipment || []).filter(e => e.item),
  work_history: (parsed.work_history || []).filter(w => w.description),
  known_flaws: (parsed.condition?.known_flaws || []).filter(f => f.flaw),
  modifications: (parsed.modifications || []).filter(m => m.mod),
};

for (const [section, items] of Object.entries(sections)) {
  console.log(`\n=== ${section.toUpperCase()} (${items.length} items) ===`);
  let verified = 0, fabricated = 0, noQuote = 0;
  for (const item of items) {
    const label = item.code || item.item || item.description || item.flaw || item.mod;
    const status = verifyQuote(item.quote);
    if (status === 'VERIFIED') verified++;
    else if (status === 'FABRICATED') fabricated++;
    else noQuote++;
    const marker = status === 'VERIFIED' ? '  OK' : status === 'FABRICATED' ? '  XX' : '  --';
    console.log(`${marker} | ${label} | "${(item.quote || '').substring(0, 50)}" | conf: ${item.confidence}`);
  }
  console.log(`  >> ${verified} verified, ${fabricated} fabricated, ${noQuote} no quote | ${items.length ? Math.round(100*verified/items.length) : 0}% honest`);
}

// Spec section
console.log('\n=== SPECIFICATION ===');
const spec = parsed.specification || {};
let specV = 0, specF = 0, specN = 0;
for (const [key, val] of Object.entries(spec)) {
  if (!val || !val.value) continue;
  const status = verifyQuote(val.quote);
  if (status === 'VERIFIED') specV++;
  else if (status === 'FABRICATED') specF++;
  else specN++;
  const marker = status === 'VERIFIED' ? '  OK' : status === 'FABRICATED' ? '  XX' : '  --';
  console.log(`${marker} | ${key}: ${val.value} | "${(val.quote || '').substring(0, 50)}" | conf: ${val.confidence}`);
}
console.log(`  >> ${specV} verified, ${specF} fabricated, ${specN} no quote`);

// Reference validation
const rv = parsed.reference_validation || {};
console.log('\n=== REFERENCE VALIDATION ===');
console.log(`  codes_matched: ${(rv.codes_matched || []).length}`);
console.log(`  codes_unrecognized: ${(rv.codes_unrecognized || []).length}`);
console.log(`  paint_code_match: ${rv.paint_code_match}`);
console.log(`  trim_identified: ${rv.trim_identified}`);
console.log(`  known_issues_addressed: ${JSON.stringify(rv.known_issues_addressed || [])}`);
console.log(`  known_issues_unaddressed: ${JSON.stringify(rv.known_issues_unaddressed || [])}`);

await db.end();
