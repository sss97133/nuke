#!/usr/bin/env node
/**
 * extract-bat-v3.mjs — BaT Description Extraction via Claude Haiku
 *
 * Forensic extraction with code library injection and validation.
 *
 * Usage:
 *   dotenvx run -- node scripts/extract-bat-v3.mjs --test 5
 *   dotenvx run -- node scripts/extract-bat-v3.mjs --run 2000
 *   dotenvx run -- node scripts/extract-bat-v3.mjs --stats
 */

import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';

const API_KEY = process.env.VITE_NUKE_CLAUDE_API;
const MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 10;  // Haiku can handle parallel requests
const DB_HOST = '54.177.55.191'; // Direct IP — DNS is flaky

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

// ─── Code Library Lookup ────────────────────────────────────────────────────
async function getCodesForVehicle(db, year, make) {
  // Map make to manufacturer
  const mfgMap = {
    'Chevrolet': 'GM', 'Pontiac': 'GM', 'Buick': 'GM', 'Oldsmobile': 'GM',
    'Cadillac': 'GM', 'GMC': 'GM',
    'Ford': 'Ford', 'Lincoln': 'Ford', 'Mercury': 'Ford', 'Shelby': 'Ford',
    'Dodge': 'Mopar', 'Plymouth': 'Mopar', 'Chrysler': 'Mopar',
    'Porsche': 'Porsche', 'BMW': 'BMW', 'Ferrari': 'Ferrari',
    'Mercedes-Benz': 'Mercedes-Benz', 'Toyota': 'Toyota', 'Nissan': 'Nissan',
    'Datsun': 'Nissan', 'AMC': 'AMC', 'Jeep': 'AMC',
  };
  const mfg = mfgMap[make];
  if (!mfg) return { codes: [], rules: [] };

  const codesResult = await db.query(`
    SELECT rpo_code, category, description, detail, displacement_ci, horsepower,
           rarity, price_impact, mandatory_with, incompatible_with, notes
    FROM vintage_rpo_codes
    WHERE manufacturer = $1 AND $2 BETWEEN first_year AND last_year
      AND ($3 = ANY(makes) OR makes IS NULL)
    ORDER BY category, rpo_code
  `, [mfg, year, make]);

  const rulesResult = await db.query(`
    SELECT rule_type, code_a, code_b, description, severity, action, detail
    FROM code_validation_rules
    WHERE manufacturer = $1
      AND (year_start IS NULL OR $2 >= year_start)
      AND (year_end IS NULL OR $2 <= year_end)
    ORDER BY rule_type, severity DESC
  `, [mfg, year]);

  return { codes: codesResult.rows, rules: rulesResult.rows };
}

// ─── System Prompt ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You extract vehicle data from auction listings. Return a single JSON object. No markdown fences. No explanation. No text outside the JSON.

Use this EXACT schema. Every field must be present. Use null for unknown values.

{"e_type":"V8|V6|I4|I6|H4|H6|V10|V12|rotary|electric|other","e_ci":null,"e_liters":null,"e_hp":null,"e_torque":null,"e_forced":"turbo|supercharged|twin-turbo|none","e_fuel":"carbureted|fuel-injected|diesel|electric","e_code":null,"e_detail":"free text engine description","t_type":"manual|automatic|semi-automatic|dual-clutch|cvt|sequential","t_speeds":null,"t_code":null,"t_detail":"free text","drive":"RWD|FWD|AWD|4WD","color":"string","int_color":"string","int_mat":"leather|vinyl|cloth|alcantara|other","body":"Coupe|Convertible|Sedan|Pickup|SUV|Wagon|Van|Fastback|Roadster|Targa|Hatchback|Truck|Other","doors":null,"miles":null,"mi_unit":"miles|km","vin":"string","fuel":"gasoline|diesel|electric|hybrid","title_st":"state","title":"clean|salvage|rebuilt|exempt","cond":"excellent|very-good|good|fair|poor|project","cond_note":"1-2 sentence condition summary","mods":["list of modifications or empty array"],"matching":null,"owners":null,"docs":["list of documentation included"],"equip":["notable equipment list"],"work":[{"w":"what was done","d":"date","s":"shop"}],"flags":[{"f":"concern text","sev":"low|medium|high"}],"codes":[{"c":"RPO code found","d":"resolved description","r":"common|uncommon|rare|very-rare|ultra-rare","p":"none|low|moderate|high|very-high"}],"auth":0.82,"price_pos":["positive value signals"],"price_neg":["negative value signals"]}`;

// ─── Build User Prompt ──────────────────────────────────────────────────────
function buildPrompt(vehicle, codes, rules) {
  let prompt = `Analyze this ${vehicle.year} ${vehicle.make} ${vehicle.model}.`;
  if (vehicle.vin) prompt += `\nVIN: ${vehicle.vin}`;
  if (vehicle.sale_price) prompt += `\nSale Price: $${vehicle.sale_price.toLocaleString()}`;

  if (codes.length > 0) {
    prompt += `\n\nFACTORY CODE LIBRARY (${vehicle.year} ${vehicle.make}):`;
    // Only include most relevant codes (limit prompt size)
    const topCodes = codes.slice(0, 30);
    for (const c of topCodes) {
      prompt += `\n- ${c.rpo_code}: ${c.description}${c.detail ? ' (' + c.detail + ')' : ''} [${c.rarity}, ${c.price_impact}]`;
    }
  }

  if (rules.length > 0) {
    prompt += `\n\nVALIDATION RULES:`;
    for (const r of rules.slice(0, 15)) {
      prompt += `\n- ${r.rule_type}: ${r.description} [${r.severity}]`;
    }
  }

  // Preprocess description
  let desc = vehicle.description || '';
  if (desc.length > 3000) desc = desc.substring(0, 3000) + '...';
  desc = desc.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  prompt += `\n\nDESCRIPTION:\n${desc}`;
  return prompt;
}

// ─── Call Claude ─────────────────────────────────────────────────────────────
async function extractVehicle(vehicle, codes, rules) {
  const userPrompt = buildPrompt(vehicle, codes.codes, codes.rules);

  const startMs = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let text = response.content[0]?.text?.trim();
    // Strip markdown fences if present
    text = text.replace(/^```json?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    // Extract first complete JSON object (Haiku sometimes appends commentary)
    let depth = 0, start = -1, end = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') { if (start === -1) start = i; depth++; }
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (start === -1 || end === -1) throw new Error('No JSON object found');
    const parsed = JSON.parse(text.substring(start, end));
    const elapsed = Date.now() - startMs;

    return {
      success: true,
      extraction: parsed,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost: (response.usage.input_tokens * 1.0 + response.usage.output_tokens * 5.0) / 1_000_000,
      elapsed_ms: elapsed,
    };
  } catch (err) {
    return { success: false, error: err.message?.substring(0, 200) || 'unknown' };
  }
}

// ─── Write Results ──────────────────────────────────────────────────────────
function mapToDbColumns(ext) {
  const fills = {};
  if (ext.e_type) fills.engine_type = ext.e_type;
  if (ext.e_liters) fills.engine_size = `${ext.e_liters}L`;
  if (ext.e_ci) fills.displacement = `${ext.e_ci}`;
  if (ext.e_hp && typeof ext.e_hp === 'number') fills.horsepower = ext.e_hp;
  if (ext.e_torque && typeof ext.e_torque === 'number') fills.torque = ext.e_torque;
  if (ext.t_type) fills.transmission = ext.t_type;
  if (ext.drive) fills.drivetrain = ext.drive;
  if (ext.color) fills.color = ext.color;
  if (ext.int_color) fills.interior_color = ext.int_color;
  if (ext.body) fills.body_style = ext.body;
  if (ext.miles && typeof ext.miles === 'number') fills.mileage = ext.miles;
  if (ext.vin && ext.vin.length > 5) fills.vin = ext.vin;
  if (ext.fuel) fills.fuel_type = ext.fuel;
  if (ext.doors && typeof ext.doors === 'number') fills.doors = ext.doors;
  if (ext.title) fills.title_status = ext.title;
  if (ext.cond) {
    const cm = { 'excellent': 9, 'very-good': 7, 'good': 5, 'fair': 3, 'poor': 2, 'project': 1 };
    if (cm[ext.cond]) fills.condition_rating = cm[ext.cond];
  }
  if (ext.mods?.length > 0) fills.modifications = ext.mods;
  return fills;
}

async function writeResult(db, vehicleId, extraction, fills) {
  // Only fill NULL columns
  const setClauses = [];
  const vals = [];
  let i = 1;

  for (const [k, v] of Object.entries(fills)) {
    if (v === null || v === undefined) continue;
    if (k === 'modifications') {
      setClauses.push(`${k} = $${i}::jsonb`);
      vals.push(JSON.stringify(v));
    } else {
      setClauses.push(`${k} = COALESCE(${k}, $${i})`);  // Only fill if NULL
      vals.push(v);
    }
    i++;
  }

  if (setClauses.length > 0) {
    await db.query(
      `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${i} AND status = 'active'`,
      [...vals, vehicleId]
    );
  }

  // Write discovery row
  await db.query(
    `INSERT INTO description_discoveries (vehicle_id, discovered_at, model_used, prompt_version, raw_extraction, keys_found, total_fields)
     VALUES ($1, now(), $2, 'v3', $3::jsonb, $4, $5)
     ON CONFLICT (vehicle_id) DO UPDATE SET raw_extraction = EXCLUDED.raw_extraction,
       discovered_at = EXCLUDED.discovered_at, keys_found = EXCLUDED.keys_found,
       model_used = EXCLUDED.model_used, prompt_version = EXCLUDED.prompt_version`,
    [vehicleId, MODEL, JSON.stringify(extraction), Object.keys(fills).length, 30]
  );
}

// ─── Fetch Batch ────────────────────────────────────────────────────────────
async function fetchBatch(db, limit, offset, highValueFirst) {
  const orderBy = highValueFirst ? 'sale_price DESC NULLS LAST' : 'id';
  // Check for targeted make/year filter via env
  const targetMakes = process.env.TARGET_MAKES ? process.env.TARGET_MAKES.split(',') : null;
  const targetYearMin = process.env.TARGET_YEAR_MIN ? parseInt(process.env.TARGET_YEAR_MIN) : null;
  const targetYearMax = process.env.TARGET_YEAR_MAX ? parseInt(process.env.TARGET_YEAR_MAX) : null;

  let whereExtra = '';
  const params = [limit, offset];
  let paramIdx = 3;

  if (targetMakes) {
    whereExtra += ` AND v.make = ANY($${paramIdx})`;
    params.push(targetMakes);
    paramIdx++;
  }
  if (targetYearMin) {
    whereExtra += ` AND v.year >= $${paramIdx}`;
    params.push(targetYearMin);
    paramIdx++;
  }
  if (targetYearMax) {
    whereExtra += ` AND v.year <= $${paramIdx}`;
    params.push(targetYearMax);
    paramIdx++;
  }

  const result = await db.query(`
    SELECT v.id, v.year, v.make, v.model, v.vin, v.sale_price, v.description,
           v.discovery_source, v.engine_type, v.transmission, v.drivetrain,
           v.color, v.interior_color, v.body_style, v.mileage, v.fuel_type,
           v.horsepower, v.torque, v.doors, v.title_status, v.displacement,
           v.condition_rating, v.modifications, v.engine_size
    FROM vehicles v
    LEFT JOIN description_discoveries dd ON dd.vehicle_id = v.id AND dd.prompt_version = 'v3'
    WHERE v.status = 'active'
      AND v.discovery_source IN ('bat', 'bat_core')
      AND v.description IS NOT NULL AND length(v.description) > 100
      AND dd.id IS NULL
      ${whereExtra}
    ORDER BY ${orderBy}
    LIMIT $1 OFFSET $2
  `, params);
  return result.rows;
}

// ─── Main Modes ─────────────────────────────────────────────────────────────
async function runTest(count) {
  const db = await getDb();
  console.log(`\n=== TEST: ${count} BaT vehicles (high-value first) ===\n`);

  const vehicles = await fetchBatch(db, count, 0, true);
  let totalCost = 0;

  for (const v of vehicles) {
    const codes = await getCodesForVehicle(db, v.year, v.make);
    const result = await extractVehicle(v, codes);

    if (!result.success) {
      console.log(`FAIL ${v.year} ${v.make} ${v.model}: ${result.error}`);
      if (result.raw) console.log(`  Raw: ${result.raw.substring(0, 200)}`);
      continue;
    }

    const fills = mapToDbColumns(result.extraction);
    const ext = result.extraction;
    totalCost += result.cost;

    console.log(`$${v.sale_price?.toLocaleString() || '?'} | ${v.year} ${v.make} ${v.model}`);
    console.log(`  ${result.elapsed_ms}ms | $${result.cost.toFixed(4)} | ${result.input_tokens}in/${result.output_tokens}out`);
    console.log(`  Codes: ${ext.codes?.length || 0} | Fills: ${Object.keys(fills).length} | Auth: ${ext.auth}`);

    if (ext.codes?.length > 0) {
      console.log(`  Found: ${ext.codes.map(c => `${c.c}[${c.r}]`).join(', ')}`);
    }
    if (ext.flags?.length > 0) {
      console.log(`  Flags: ${ext.flags.map(f => f.f).join('; ')}`);
    }
    if (ext.price_pos?.length > 0) console.log(`  +: ${ext.price_pos.join(', ')}`);
    if (ext.price_neg?.length > 0) console.log(`  -: ${ext.price_neg.join(', ')}`);
    console.log();
  }

  console.log(`\nTotal cost: $${totalCost.toFixed(4)} for ${vehicles.length} vehicles`);
  console.log(`Projected cost for 7000: $${(totalCost / vehicles.length * 7000).toFixed(2)}`);
  await db.end();
}

async function runBatch(limit) {
  const db = await getDb();
  console.log(`\n=== BATCH: ${limit} BaT vehicles ===\n`);

  let processed = 0, errors = 0, totalCost = 0, totalFills = 0;
  let offset = 0;
  const startTime = Date.now();

  const COST_CAP = parseFloat(process.env.COST_CAP || '30');
  while (processed + errors < limit) {
    if (totalCost >= COST_CAP) { console.log(`\nCOST CAP HIT: $${totalCost.toFixed(2)} >= $${COST_CAP}`); break; }
    const batchSize = Math.min(50, limit - processed - errors);
    const vehicles = await fetchBatch(db, batchSize, 0, true);
    if (vehicles.length === 0) { console.log('No more vehicles.'); break; }

    // Process batch with concurrency
    const chunks = [];
    for (let i = 0; i < vehicles.length; i += CONCURRENCY) {
      chunks.push(vehicles.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.all(chunk.map(async (v) => {
        const codes = await getCodesForVehicle(db, v.year, v.make);
        const result = await extractVehicle(v, codes);
        return { vehicle: v, result, codes };
      }));

      for (const { vehicle, result } of results) {
        if (!result.success) {
          errors++;
          if (errors <= 10) console.error(`\nERR ${vehicle.id}: ${result.error}`);
          if (errors === 50 && processed === 0) { console.error('\n50 consecutive errors with 0 success. Aborting.'); await db.end(); return; }
          continue;
        }

        const fills = mapToDbColumns(result.extraction);
        // Only write fills for NULL columns
        const actualFills = {};
        for (const [k, val] of Object.entries(fills)) {
          if (vehicle[k] === null || vehicle[k] === undefined || vehicle[k] === '') {
            actualFills[k] = val;
          }
        }

        try {
          await writeResult(db, vehicle.id, result.extraction, actualFills);
          processed++;
          totalFills += Object.keys(actualFills).length;
          totalCost += result.cost;
        } catch (err) {
          errors++;
          if (errors <= 5) console.error(`Write error: ${err.message}`);
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      process.stdout.write(`\r  [${processed}/${limit}] ${rate.toFixed(1)}/s | $${totalCost.toFixed(2)} spent | ${totalFills} fills | ${errors} err`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n=== COMPLETE ===`);
  console.log(`Processed: ${processed} | Errors: ${errors}`);
  console.log(`Cost: $${totalCost.toFixed(2)} | Fills: ${totalFills}`);
  console.log(`Rate: ${(processed / elapsed).toFixed(1)}/s | Time: ${(elapsed / 60).toFixed(1)}min`);
  await db.end();
}

async function showStats() {
  const db = await getDb();
  const stats = await db.query(`
    SELECT
      count(*) FILTER (WHERE dd.prompt_version = 'v3') as v3_done,
      count(*) FILTER (WHERE dd.prompt_version = 'local-v1') as v1_done,
      count(*) FILTER (WHERE dd.id IS NULL AND v.description IS NOT NULL AND length(v.description) > 100) as remaining
    FROM vehicles v
    LEFT JOIN description_discoveries dd ON dd.vehicle_id = v.id
    WHERE v.status = 'active' AND v.discovery_source IN ('bat', 'bat_core')
  `);
  console.log('BaT extraction stats:', stats.rows[0]);
  await db.end();
}

// ─── Entry ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd = args[0];

// Parse --makes=Chevrolet,GMC --year-min=1967 --year-max=1991 --cap=30
for (const arg of args) {
  if (arg.startsWith('--makes=')) process.env.TARGET_MAKES = arg.split('=')[1];
  if (arg.startsWith('--year-min=')) process.env.TARGET_YEAR_MIN = arg.split('=')[1];
  if (arg.startsWith('--year-max=')) process.env.TARGET_YEAR_MAX = arg.split('=')[1];
  if (arg.startsWith('--cap=')) process.env.COST_CAP = arg.split('=')[1];
}

switch (cmd) {
  case '--test': runTest(parseInt(args[1]) || 5); break;
  case '--run': runBatch(parseInt(args.find(a => /^\d+$/.test(a))) || 1000); break;
  case '--stats': showStats(); break;
  default:
    console.log('Usage: --test N | --run N | --stats');
    console.log('  --makes=Chevrolet,GMC  --year-min=1967  --year-max=1991  --cap=30');
}
