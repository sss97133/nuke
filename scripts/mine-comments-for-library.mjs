#!/usr/bin/env node
/**
 * mine-comments-for-library.mjs — Extract library-grade reference data from auction comments
 *
 * Mines BaT comments grouped by make/model for general technical knowledge:
 * option codes, engine specs, transmission specs, paint codes, production facts,
 * known issues, trim packages.
 *
 * Prioritizes non-GM makes (biggest library gaps) and 1960-2000 + supercars.
 *
 * Usage:
 *   dotenvx run -- node scripts/mine-comments-for-library.mjs --test 3
 *   dotenvx run -- node scripts/mine-comments-for-library.mjs --run 80
 *   dotenvx run -- node scripts/mine-comments-for-library.mjs --stats
 *   dotenvx run -- node scripts/mine-comments-for-library.mjs --run 80 --cap=5
 */

import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
import crypto from 'crypto';

const API_KEY = process.env.VITE_NUKE_CLAUDE_API;
const MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 5;
const DB_HOST = '54.177.55.191';
const BATCH_ID = `mine-${new Date().toISOString().slice(0,10)}-${crypto.randomBytes(3).toString('hex')}`;

const anthropic = new Anthropic({ apiKey: API_KEY });

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
const SYSTEM_PROMPT = `You are a vehicle specification librarian mining auction comments for FACTUAL REFERENCE DATA.

Return a single JSON object. No markdown fences. No explanation. No text outside the JSON.

Extract ONLY facts that are GENERALLY TRUE for this make/model class — not about one specific car's condition or history.

Use this EXACT schema. Return empty arrays for categories with no findings:

{"option_codes":[{"code":"string","system":"RPO|DSO|VIN|broadcast|fender_tag|chassis_plate|other","category":"engine|transmission|axle|paint|interior|suspension|brakes|electrical|package|body|wheels|cooling|exhaust|option","description":"what this code means","specs":{"displacement_ci":null,"displacement_liters":null,"horsepower":null,"torque":null,"compression":null,"gear_count":null,"ratio":null},"years":[1970,1975],"rarity":"common|uncommon|rare|very-rare","price_impact":"none|low|moderate|high|very-high","notes":null}],"engine_specs":[{"name":"common name","code":null,"displacement_ci":null,"displacement_liters":null,"horsepower":null,"torque":null,"compression":null,"valvetrain":null,"fuel_system":null,"block_material":null,"head_material":null,"years":[1970,1975],"variants":[],"notes":null}],"transmission_specs":[{"name":"common name","code":null,"type":"manual|automatic","gears":null,"paired_engines":[],"years":[1970,1975],"notes":null}],"paint_codes":[{"code":"string","name":"color name","color_family":"red|blue|green|black|white|silver|gold|yellow|orange|brown|purple|other","years":[1970,1975],"notes":null}],"production_facts":[{"fact":"description","count":null,"year":null,"source_context":"brief reference"}],"known_issues":[{"issue":"description","affected_years":[1970,1975],"affected_components":[],"severity":"low|medium|high|critical","common_fix":null}],"trim_packages":[{"name":"package name","code":null,"standard_features":[],"years":[1970,1975],"notes":null}]}

RULES:
1. ONLY include facts multiple knowledgeable commenters would agree on
2. If commenters DEBATE a fact, note the disagreement in "notes"
3. Prefer facts CONFIRMED or CORRECTED by community discussion
4. Include casting numbers, date codes, factory stampings when mentioned
5. Distinguish factory options from aftermarket modifications
6. DO NOT include opinions, price predictions, condition assessments, or individual car details
7. Be precise with numbers — note approximations
8. For option codes: include the CODE SYSTEM (RPO for GM, DSO for Ford, broadcast for Mopar, etc.)`;

// ─── Fetch Make/Model Groups to Mine ────────────────────────────────────────
async function fetchGroups(db, limit) {
  // Use pre-aggregated vehicle_events.comment_count — no join to auction_comments
  const result = await db.query(`
    SELECT v.make, v.model,
           count(*) as vehicle_count,
           sum(ve.comment_count) as total_comments,
           min(v.year) as min_year, max(v.year) as max_year
    FROM vehicle_events ve
    JOIN vehicles v ON v.id = ve.vehicle_id
    WHERE ve.source_platform = 'bat'
      AND ve.comment_count > 10
      AND v.make IS NOT NULL
      AND (
        (v.year BETWEEN 1960 AND 2000)
        OR v.make IN ('Ferrari', 'Lamborghini', 'Porsche', 'McLaren', 'Aston Martin',
                      'Maserati', 'Lotus', 'Alfa Romeo', 'BMW', 'Mercedes-Benz')
      )
    GROUP BY v.make, v.model
    HAVING sum(ve.comment_count) > 500
      AND NOT EXISTS (
        SELECT 1 FROM comment_library_extractions cle
        WHERE cle.make = v.make AND cle.model = v.model
      )
    ORDER BY
      CASE WHEN v.make IN ('Chevrolet','Pontiac','Buick','Oldsmobile','Cadillac','GMC') THEN 1 ELSE 0 END,
      sum(ve.comment_count) DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

// ─── Fetch Top Comments for a Make/Model ────────────────────────────────────
async function fetchComments(db, make, model, maxComments = 60) {
  // Two-step: find vehicle IDs first (fast index lookup), then grab best comments
  const result = await db.query(`
    WITH target_vehicles AS (
      SELECT id, year FROM vehicles
      WHERE make = $1 AND model = $2 AND status = 'active'
      LIMIT 200
    )
    SELECT ac.comment_text, ac.author_username, ac.is_seller,
           ac.expertise_score, ac.comment_likes,
           tv.year
    FROM target_vehicles tv
    JOIN auction_comments ac ON ac.vehicle_id = tv.id
    WHERE length(ac.comment_text) > 150
    ORDER BY
      COALESCE(ac.expertise_score, 0) DESC,
      length(ac.comment_text) DESC
    LIMIT $3
  `, [make, model, maxComments]);
  return result.rows;
}

// ─── Build User Prompt ──────────────────────────────────────────────────────
function buildPrompt(make, model, minYear, maxYear, comments) {
  let prompt = `Extract reference library data from these auction comments about ${make} ${model} vehicles (${minYear}-${maxYear}).\n\n`;
  prompt += `COMMENTS (${comments.length} selected, sorted by expertise):\n\n`;

  let totalChars = 0;
  const MAX_CHARS = 12000; // Keep under token limits

  for (const c of comments) {
    const prefix = c.is_seller ? '[SELLER] ' : '';
    const expertise = c.expertise_score ? ` [exp:${parseFloat(c.expertise_score).toFixed(1)}]` : '';
    const year = c.year ? ` (re: ${c.year})` : '';
    const entry = `${prefix}@${c.author_username}${expertise}${year}: ${c.comment_text}\n\n`;

    if (totalChars + entry.length > MAX_CHARS) break;
    prompt += entry;
    totalChars += entry.length;
  }

  return prompt;
}

// ─── Call Claude ─────────────────────────────────────────────────────────────
async function mineGroup(make, model, minYear, maxYear, comments) {
  const userPrompt = buildPrompt(make, model, minYear, maxYear, comments);
  const startMs = Date.now();

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let text = response.content[0]?.text?.trim();
    text = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    // Extract first complete JSON object
    let depth = 0, start = -1, end = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') { if (start === -1) start = i; depth++; }
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (start === -1 || end === -1) throw new Error('No JSON object found');
    const parsed = JSON.parse(text.substring(start, end));

    return {
      success: true,
      extraction: parsed,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost: (response.usage.input_tokens * 1.0 + response.usage.output_tokens * 5.0) / 1_000_000,
      elapsed_ms: Date.now() - startMs,
    };
  } catch (err) {
    return { success: false, error: err.message?.substring(0, 300) || 'unknown' };
  }
}

// ─── Write Extractions to Staging Table ─────────────────────────────────────
async function writeExtractions(db, make, model, minYear, maxYear, extraction, commentCount, vehicleCount) {
  let totalRows = 0;

  const types = [
    ['option_code', extraction.option_codes],
    ['engine_spec', extraction.engine_specs],
    ['transmission_spec', extraction.transmission_specs],
    ['paint_code', extraction.paint_codes],
    ['production_fact', extraction.production_facts],
    ['known_issue', extraction.known_issues],
    ['trim_package', extraction.trim_packages],
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
        make, model,
        item.years?.[0] || minYear,
        item.years?.[1] || maxYear,
        type,
        JSON.stringify(item),
        commentCount,
        vehicleCount,
        item.rarity === 'very-rare' ? 0.7 : 0.8, // conservative default
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
  console.log(`\n=== TEST: Mining ${count} make/model groups ===`);
  console.log(`Batch ID: ${BATCH_ID}\n`);

  const groups = await fetchGroups(db, count);
  if (groups.length === 0) { console.log('No groups to mine.'); await db.end(); return; }

  let totalCost = 0, totalExtractions = 0;

  for (const g of groups) {
    console.log(`\n── ${g.make} ${g.model} (${g.min_year}-${g.max_year}) ──`);
    console.log(`   ${g.vehicle_count} vehicles, ${g.substantive_comments} substantive comments`);

    const comments = await fetchComments(db, g.make, g.model);
    console.log(`   Fetched ${comments.length} top comments`);

    const result = await mineGroup(g.make, g.model, g.min_year, g.max_year, comments);

    if (!result.success) {
      console.log(`   FAIL: ${result.error}`);
      continue;
    }

    totalCost += result.cost;
    const ext = result.extraction;

    // Count findings
    const counts = {
      codes: ext.option_codes?.length || 0,
      engines: ext.engine_specs?.length || 0,
      trans: ext.transmission_specs?.length || 0,
      paint: ext.paint_codes?.length || 0,
      facts: ext.production_facts?.length || 0,
      issues: ext.known_issues?.length || 0,
      trims: ext.trim_packages?.length || 0,
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    console.log(`   ${result.elapsed_ms}ms | $${result.cost.toFixed(4)} | ${result.input_tokens}in/${result.output_tokens}out`);
    console.log(`   Found: ${total} items (${counts.codes} codes, ${counts.engines} engines, ${counts.trans} trans, ${counts.paint} paint, ${counts.facts} facts, ${counts.issues} issues, ${counts.trims} trims)`);

    // Show highlights
    if (ext.option_codes?.length > 0) {
      console.log(`   Codes: ${ext.option_codes.map(c => `${c.code}[${c.category}]`).join(', ')}`);
    }
    if (ext.engine_specs?.length > 0) {
      console.log(`   Engines: ${ext.engine_specs.map(e => `${e.name}${e.horsepower ? ' '+e.horsepower+'hp' : ''}`).join(', ')}`);
    }
    if (ext.known_issues?.length > 0) {
      console.log(`   Issues: ${ext.known_issues.map(i => i.issue.substring(0, 60)).join('; ')}`);
    }

    // Write to staging
    const rows = await writeExtractions(db, g.make, g.model, g.min_year, g.max_year, ext, comments.length, g.vehicle_count);
    totalExtractions += rows;
    console.log(`   Wrote ${rows} rows to staging`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Groups: ${groups.length} | Extractions: ${totalExtractions} | Cost: $${totalCost.toFixed(4)}`);
  console.log(`Projected cost for 80 groups: $${(totalCost / groups.length * 80).toFixed(2)}`);
  await db.end();
}

// ─── Batch Mode ─────────────────────────────────────────────────────────────
async function runBatch(limit) {
  const db = await getDb();
  console.log(`\n=== BATCH: Mining ${limit} make/model groups ===`);
  console.log(`Batch ID: ${BATCH_ID}\n`);

  const COST_CAP = parseFloat(process.env.COST_CAP || '10');
  const groups = await fetchGroups(db, limit);
  if (groups.length === 0) { console.log('No groups to mine (all done?).'); await db.end(); return; }
  console.log(`Found ${groups.length} groups to mine (cost cap: $${COST_CAP})\n`);

  let processed = 0, errors = 0, totalCost = 0, totalExtractions = 0;
  const startTime = Date.now();

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    if (totalCost >= COST_CAP) { console.log(`\nCOST CAP: $${totalCost.toFixed(2)} >= $${COST_CAP}`); break; }

    const chunk = groups.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (g) => {
      const comments = await fetchComments(db, g.make, g.model);
      const result = await mineGroup(g.make, g.model, g.min_year, g.max_year, comments);
      return { group: g, comments, result };
    }));

    for (const { group, comments, result } of results) {
      if (!result.success) {
        errors++;
        console.error(`  ERR ${group.make} ${group.model}: ${result.error}`);
        continue;
      }

      try {
        const rows = await writeExtractions(
          db, group.make, group.model, group.min_year, group.max_year,
          result.extraction, comments.length, group.vehicle_count
        );
        processed++;
        totalExtractions += rows;
        totalCost += result.cost;

        const ext = result.extraction;
        const total = (ext.option_codes?.length||0) + (ext.engine_specs?.length||0) +
                      (ext.transmission_specs?.length||0) + (ext.paint_codes?.length||0) +
                      (ext.production_facts?.length||0) + (ext.known_issues?.length||0) +
                      (ext.trim_packages?.length||0);

        console.log(`  ${group.make} ${group.model} → ${total} items (${rows} rows) | $${result.cost.toFixed(4)}`);
      } catch (err) {
        errors++;
        console.error(`  WRITE ERR ${group.make} ${group.model}: ${err.message}`);
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    process.stdout.write(`\r  [${processed}/${groups.length}] ${(processed/elapsed).toFixed(1)}/s | $${totalCost.toFixed(3)} | ${totalExtractions} extractions | ${errors} err`);
    console.log();
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n=== COMPLETE ===`);
  console.log(`Groups: ${processed}/${groups.length} | Extractions: ${totalExtractions} | Errors: ${errors}`);
  console.log(`Cost: $${totalCost.toFixed(3)} | Time: ${(elapsed/60).toFixed(1)}min`);
  console.log(`Batch ID: ${BATCH_ID}`);
  await db.end();
}

// ─── Stats Mode ─────────────────────────────────────────────────────────────
async function showStats() {
  const db = await getDb();

  const totals = await db.query(`
    SELECT extraction_type, count(*) as cnt,
           count(DISTINCT make || '/' || model) as groups
    FROM comment_library_extractions
    GROUP BY extraction_type
    ORDER BY cnt DESC
  `);
  console.log('\n=== Library Mining Stats ===\n');
  console.log('By type:');
  for (const r of totals.rows) {
    console.log(`  ${r.extraction_type}: ${r.cnt} items across ${r.groups} make/model groups`);
  }

  const byMake = await db.query(`
    SELECT make, count(*) as cnt, count(DISTINCT model) as models
    FROM comment_library_extractions
    GROUP BY make ORDER BY cnt DESC LIMIT 20
  `);
  console.log('\nBy make (top 20):');
  for (const r of byMake.rows) {
    console.log(`  ${r.make}: ${r.cnt} items (${r.models} models)`);
  }

  const remaining = await db.query(`
    WITH groups AS (
      SELECT v.make, v.model
      FROM vehicle_events ve
      JOIN vehicles v ON v.id = ve.vehicle_id
      WHERE ve.source_platform = 'bat' AND ve.comment_count > 10
        AND v.make IS NOT NULL
        AND v.make NOT IN ('Chevrolet','Pontiac','Buick','Oldsmobile','Cadillac','GMC')
      GROUP BY v.make, v.model
      HAVING count(*) > 5
    )
    SELECT count(*) as total_groups,
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM comment_library_extractions cle
             WHERE cle.make = groups.make AND cle.model = groups.model
           )) as remaining
    FROM groups
  `);
  console.log(`\nNon-GM groups: ${remaining.rows[0]?.total_groups} total, ${remaining.rows[0]?.remaining} remaining`);
  await db.end();
}

// ─── Entry ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd = args[0];

for (const arg of args) {
  if (arg.startsWith('--cap=')) process.env.COST_CAP = arg.split('=')[1];
}

switch (cmd) {
  case '--test': runTest(parseInt(args[1]) || 3); break;
  case '--run': runBatch(parseInt(args.find(a => /^\d+$/.test(a))) || 80); break;
  case '--stats': showStats(); break;
  default:
    console.log('Usage:');
    console.log('  --test N    Test mine N make/model groups (default: 3)');
    console.log('  --run N     Batch mine N groups (default: 80)');
    console.log('  --stats     Show mining progress');
    console.log('  --cap=N     Cost cap in dollars (default: $10)');
}
