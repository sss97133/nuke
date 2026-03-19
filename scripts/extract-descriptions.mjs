#!/usr/bin/env node
/**
 * extract-descriptions.mjs — Local LLM description extraction
 *
 * Uses Ollama (Qwen 2.5 14B) to extract structured vehicle data from descriptions.
 * Writes results back to vehicles table + stores full extraction in description_discoveries.
 *
 * Usage:
 *   dotenvx run -- node scripts/extract-descriptions.mjs --test          # 10 samples, print results
 *   dotenvx run -- node scripts/extract-descriptions.mjs --validate 50   # 50 samples, score quality
 *   dotenvx run -- node scripts/extract-descriptions.mjs --batch 1000    # process 1000 vehicles
 *   dotenvx run -- node scripts/extract-descriptions.mjs --batch all     # process all unextracted
 */

import { createClient } from '@supabase/supabase-js';

const OLLAMA_URL = 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const BATCH_SIZE = 50; // DB fetch batch
const CONCURRENCY = 1; // Ollama requests at a time (local model = 1)

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a vehicle listing data extractor. Given a vehicle description, extract structured data as JSON.

RULES:
- Output ONLY valid JSON. No markdown fences, no explanation.
- Use null for any field you cannot determine from the text.
- Be literal — extract what is stated, not what you infer.
- For enum fields, use ONLY the listed values or null.

OUTPUT SCHEMA:
{
  "transmission_type": "automatic|manual|semi-automatic|cvt|dual-clutch|sequential" or null,
  "transmission_speeds": number or null,
  "transmission_detail": "free text, e.g. Muncie M21 four-speed" or null,
  "engine_type": "V8|V6|V4|V10|V12|I4|I6|I3|H4|H6|W12|W16|rotary|electric|hybrid|other" or null (H4=flat-four, H6=flat-six),
  "engine_displacement_liters": number or null (must be in liters, e.g. 5.7 not 5700),
  "engine_displacement_ci": number (cubic inches) or null (e.g. 350, 454),
  "engine_forced_induction": "turbo|supercharged|twin-turbo|none" or null,
  "engine_fuel_system": "carbureted|fuel-injected|diesel|electric|hybrid" or null,
  "engine_horsepower": number or null,
  "engine_torque_lb_ft": number or null,
  "engine_detail": "free text summary, e.g. LS3 6.2L V8" or null,
  "drivetrain": "RWD|FWD|AWD|4WD" or null,
  "exterior_color": "color name as stated" or null,
  "interior_color": "color name as stated" or null,
  "interior_material": "leather|vinyl|cloth|alcantara|other" or null,
  "body_style": "Coupe|Convertible|Sedan|Pickup|SUV|Wagon|Van|Fastback|Roadster|Targa|Hatchback|Truck|Saloon|Tourer|Speedster|Cab & Chassis|Limousine|Bus|Other" or null,
  "doors": number or null,
  "mileage": number or null,
  "mileage_unit": "miles|kilometers" or null,
  "vin": "string" or null,
  "title_state": "US state name" or null,
  "title_status": "clean|salvage|rebuilt|bonded|exempt|none" or null,
  "fuel_type": "gasoline|diesel|electric|hybrid|flex-fuel|propane" or null,
  "is_modified": boolean or null,
  "modifications": ["list of modifications"] or null,
  "matching_numbers": boolean or null,
  "owner_count": number or null,
  "condition_summary": "1-2 sentence condition assessment" or null,
  "condition_grade": "excellent|very-good|good|fair|poor|project" or null,
  "notable_equipment": ["list of notable options/equipment"] or null,
  "documentation_included": ["list of documents included in sale"] or null,
  "work_history": [{"description": "what was done", "date": "when", "shop": "who did it"}] or null,
  "red_flags": ["list of concerns"] or null
}`;

// ─── CL Boilerplate Stripping ────────────────────────────────────────────────
function preprocessDescription(text, source) {
  if (!text || text.length < 30) return null;

  // Strip QR code prefix
  text = text.replace(/^QR Code Link to This Post\s*/i, '');

  // Strip common CL dealer boilerplate patterns
  if (source === 'craigslist' || source === 'craigslist_scrape') {
    // Strip phone numbers
    text = text.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '');
    // Strip "Se Habla Español" and similar
    text = text.replace(/se habla espa[ñn]ol/gi, '');
    // Strip financing pitches
    text = text.replace(/(?:bad credit|no credit|guaranteed approval|easy financing|ITIN|in-house financing)[^.!]*/gi, '');
    // Strip URL patterns
    text = text.replace(/https?:\/\/\S+/g, '');
    // Strip repeated disclaimer blocks (3+ lines of legal text)
    text = text.replace(/(?:(?:all vehicles|prices|disclaimer|warranty)[^\n]*\n?){3,}/gi, '');
  }

  // Trim excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  // If after cleaning it's too short, skip
  if (text.length < 50) return null;

  // Cap at 2500 chars for speed (beyond this, diminishing returns)
  if (text.length > 2500) {
    text = text.substring(0, 2500) + '...';
  }

  return text;
}

// ─── Ollama API ──────────────────────────────────────────────────────────────
async function callOllama(systemPrompt, userPrompt, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt: userPrompt,
          system: systemPrompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 1024,        // Reduced — most extractions are <800 tokens
            top_p: 0.9,
            num_ctx: 4096,            // Reduced context window for speed
          },
          format: 'json',            // Ollama native JSON mode
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Ollama ${resp.status}: ${errText}`);
      }

      const data = await resp.json();
      const raw = data.response.trim();

      // Parse JSON
      const parsed = JSON.parse(raw);
      // Post-process: normalize engine type aliases
      if (parsed.engine_type) {
        const typeMap = { 'flat-four': 'H4', 'flat-six': 'H6', 'flat-4': 'H4', 'flat-6': 'H6', 'flat-8': 'H8', 'inline-4': 'I4', 'inline-6': 'I6', 'inline-3': 'I3', 'i2': 'I2' };
        parsed.engine_type = typeMap[parsed.engine_type.toLowerCase()] || parsed.engine_type;
      }
      // Post-process: fix displacement > 20L (probably CC, convert to liters)
      if (parsed.engine_displacement_liters && parsed.engine_displacement_liters > 20) {
        parsed.engine_displacement_liters = Math.round(parsed.engine_displacement_liters / 100) / 10;
      }
      return { parsed, raw, tokens: data.eval_count || 0, duration_ms: data.total_duration ? data.total_duration / 1e6 : 0 };
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  Retry ${attempt + 1}: ${err.message}`);
        continue;
      }
      return { error: err.message, raw: null, parsed: null };
    }
  }
}

// ─── Extract One Vehicle ─────────────────────────────────────────────────────
async function extractVehicle(vehicle) {
  const desc = preprocessDescription(vehicle.description, vehicle.discovery_source);
  if (!desc) return { skipped: true, reason: 'too_short' };

  const userPrompt = `Extract vehicle data from this listing description. The vehicle is a ${vehicle.year || 'unknown year'} ${vehicle.make || 'unknown make'} ${vehicle.model || 'unknown model'}.

DESCRIPTION:
${desc}`;

  const result = await callOllama(SYSTEM_PROMPT, userPrompt);
  if (result.error) return { error: result.error };

  // Count non-null fields
  const fields = result.parsed;
  const nonNull = Object.entries(fields).filter(([_, v]) => v !== null && v !== undefined).length;

  return {
    fields,
    raw: result.raw,
    tokens: result.tokens,
    duration_ms: result.duration_ms,
    non_null_count: nonNull,
    description_length: desc.length,
  };
}

// ─── Column Mapping ──────────────────────────────────────────────────────────
const CONDITION_MAP = { 'excellent': 9, 'very-good': 7, 'good': 5, 'fair': 3, 'poor': 1, 'project': 0 };

function buildVehicleUpdate(fields, existingVehicle) {
  const update = {};

  // Only fill NULL columns — never overwrite existing data
  const maybeSet = (dbCol, value) => {
    if (value !== null && value !== undefined && (existingVehicle[dbCol] === null || existingVehicle[dbCol] === undefined || existingVehicle[dbCol] === '')) {
      update[dbCol] = value;
    }
  };

  maybeSet('transmission', fields.transmission_type);
  maybeSet('engine_type', fields.engine_type);
  maybeSet('engine_size', fields.engine_displacement_liters ? `${fields.engine_displacement_liters}L` : fields.engine_displacement_ci ? `${fields.engine_displacement_ci}ci` : null);
  maybeSet('horsepower', fields.engine_horsepower);
  maybeSet('torque', fields.engine_torque_lb_ft);
  maybeSet('drivetrain', fields.drivetrain);
  maybeSet('color', fields.exterior_color);
  maybeSet('interior_color', fields.interior_color);
  maybeSet('body_style', fields.body_style);
  maybeSet('mileage', fields.mileage);
  maybeSet('vin', fields.vin);
  maybeSet('fuel_type', fields.fuel_type);
  maybeSet('doors', fields.doors);
  maybeSet('title_status', fields.title_status);
  maybeSet('displacement', fields.engine_displacement_ci ? `${fields.engine_displacement_ci}` : null);
  maybeSet('condition_rating', fields.condition_grade ? CONDITION_MAP[fields.condition_grade] : null);

  // Modifications — always update if extraction found them and vehicle has none
  if (fields.modifications && fields.modifications.length > 0 && !existingVehicle.modifications) {
    update.modifications = fields.modifications;
  }
  if (fields.is_modified !== null && fields.is_modified !== undefined) {
    // is_modified is always set (default false), so only set to true
    if (fields.is_modified === true && !existingVehicle.is_modified) {
      update.is_modified = true;
    }
  }

  return update;
}

// ─── Fetch Batch ─────────────────────────────────────────────────────────────
const VEHICLE_COLS = 'id, year, make, model, description, discovery_source, transmission, engine_type, engine_size, horsepower, torque, drivetrain, color, interior_color, body_style, mileage, vin, fuel_type, doors, title_status, displacement, condition_rating, modifications, is_modified';

async function fetchBatch(limit, offset = 0) {
  // Prioritize: BaT + CaB first (best descriptions), then Barrett-Jackson, then rest
  // Only fetch vehicles with descriptions and missing key fields
  const { data: vehicles, error } = await sb
    .from('vehicles')
    .select(VEHICLE_COLS)
    .eq('status', 'active')
    .not('description', 'is', null)
    .gt('description', '')
    .is('engine_type', null)  // Proxy for "not yet extracted"
    .in('discovery_source', ['bat', 'carsandbids', 'bat_core', 'barrett-jackson', 'mecum', 'bonhams', 'rmsothebys', 'craigslist', 'collecting_cars', 'gooding', 'broad_arrow'])
    .order('id')
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return vehicles || [];
}

// ─── Write Results ───────────────────────────────────────────────────────────
async function writeResults(vehicleId, extraction, vehicleUpdate) {
  const promises = [];

  // Write to description_discoveries
  promises.push(
    sb.from('description_discoveries').upsert({
      vehicle_id: vehicleId,
      discovered_at: new Date().toISOString(),
      model_used: MODEL,
      prompt_version: 'local-v1',
      raw_extraction: extraction.fields,
      keys_found: extraction.non_null_count,
      total_fields: Object.keys(extraction.fields).length,
      description_length: extraction.description_length,
    }, { onConflict: 'vehicle_id' })
  );

  // Update vehicle columns (only non-null fills)
  if (Object.keys(vehicleUpdate).length > 0) {
    promises.push(
      sb.from('vehicles').update(vehicleUpdate).eq('id', vehicleId)
    );
  }

  const results = await Promise.all(promises);
  return results.every(r => !r.error);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────
function scoreExtraction(extraction, vehicle) {
  if (!extraction.fields) return { score: 0, issues: ['no fields'] };

  const f = extraction.fields;
  let score = 0;
  const issues = [];
  const wins = [];

  // Score each field by reliability
  const checks = [
    ['transmission_type', ['automatic', 'manual', 'semi-automatic', 'cvt', 'dual-clutch', 'sequential']],
    ['engine_type', ['V8', 'V6', 'V4', 'V10', 'V12', 'I4', 'I6', 'I3', 'H4', 'H6', 'W12', 'W16', 'rotary', 'electric', 'hybrid', 'other', 'flat-four', 'flat-six', 'flat-8']],
    ['drivetrain', ['RWD', 'FWD', 'AWD', '4WD']],
    ['body_style', ['Coupe', 'Convertible', 'Sedan', 'Pickup', 'SUV', 'Wagon', 'Van', 'Fastback', 'Roadster', 'Targa', 'Hatchback', 'Truck', 'Saloon', 'Tourer', 'Speedster', 'Cab & Chassis', 'Limousine', 'Bus', 'Other', 'speedster']],
    ['condition_grade', ['excellent', 'very-good', 'good', 'fair', 'poor', 'project']],
    ['fuel_type', ['gasoline', 'diesel', 'electric', 'hybrid', 'flex-fuel', 'propane']],
  ];

  for (const [field, validValues] of checks) {
    if (f[field] !== null && f[field] !== undefined) {
      if (validValues.includes(f[field])) {
        score += 10;
        wins.push(field);
      } else {
        score -= 5;
        issues.push(`invalid ${field}: "${f[field]}"`);
      }
    }
  }

  // Numeric fields
  if (f.engine_horsepower !== null && typeof f.engine_horsepower === 'number') {
    if (f.engine_horsepower > 0 && f.engine_horsepower < 3000) { score += 10; wins.push('hp'); }
    else { issues.push(`suspicious hp: ${f.engine_horsepower}`); }
  }
  if (f.mileage !== null && typeof f.mileage === 'number') {
    if (f.mileage >= 0 && f.mileage < 1000000) { score += 10; wins.push('mileage'); }
    else { issues.push(`suspicious mileage: ${f.mileage}`); }
  }
  if (f.engine_displacement_liters !== null && typeof f.engine_displacement_liters === 'number') {
    if (f.engine_displacement_liters > 0 && f.engine_displacement_liters < 20) { score += 10; wins.push('displacement'); }
    else { issues.push(`suspicious displacement: ${f.engine_displacement_liters}L`); }
  }

  // String fields (just check non-empty)
  if (f.exterior_color && typeof f.exterior_color === 'string') { score += 5; wins.push('color'); }
  if (f.interior_color && typeof f.interior_color === 'string') { score += 5; wins.push('int_color'); }
  if (f.condition_summary && typeof f.condition_summary === 'string') { score += 5; wins.push('condition'); }
  if (f.vin && typeof f.vin === 'string' && f.vin.length >= 11) { score += 10; wins.push('vin'); }

  // Array fields
  if (Array.isArray(f.modifications) && f.modifications.length > 0) { score += 5; wins.push('mods'); }
  if (Array.isArray(f.notable_equipment) && f.notable_equipment.length > 0) { score += 5; wins.push('equipment'); }
  if (Array.isArray(f.red_flags) && f.red_flags.length > 0) { score += 5; wins.push('red_flags'); }
  if (Array.isArray(f.work_history) && f.work_history.length > 0) { score += 5; wins.push('work_history'); }

  return { score, issues, wins, non_null: extraction.non_null_count };
}

// ─── Test Mode ───────────────────────────────────────────────────────────────
async function runTest(count = 10) {
  console.log(`\n=== TEST MODE: ${count} samples ===\n`);

  // Fetch diverse samples
  const { data: vehicles, error } = await sb
    .from('vehicles')
    .select('id, year, make, model, description, discovery_source, transmission, engine_type, engine_size, horsepower, torque, drivetrain, color, interior_color, body_style, mileage, vin, fuel_type, doors, title_status, displacement, condition_rating, modifications, is_modified')
    .eq('status', 'active')
    .not('description', 'is', null)
    .gt('description', '')
    .order('id')  // deterministic for reproducibility
    .limit(count);

  if (error) { console.error('Fetch error:', error); return; }

  let totalScore = 0;
  let totalTime = 0;
  let processed = 0;

  for (const v of vehicles) {
    process.stdout.write(`\n[${++processed}/${count}] ${v.year} ${v.make} ${v.model} (${v.discovery_source}, ${v.description?.length || 0} chars)... `);

    const result = await extractVehicle(v);
    if (result.skipped) { console.log('SKIPPED:', result.reason); continue; }
    if (result.error) { console.log('ERROR:', result.error); continue; }

    const scoreResult = scoreExtraction(result, v);
    totalScore += scoreResult.score;
    totalTime += result.duration_ms;

    const update = buildVehicleUpdate(result.fields, v);
    const newCols = Object.keys(update).length;

    console.log(`${result.duration_ms.toFixed(0)}ms, score=${scoreResult.score}, ${result.non_null_count} fields, ${newCols} new cols`);

    if (scoreResult.issues.length > 0) {
      console.log(`  Issues: ${scoreResult.issues.join(', ')}`);
    }
    console.log(`  Wins: ${scoreResult.wins.join(', ')}`);
    if (newCols > 0) {
      console.log(`  Would fill: ${Object.keys(update).join(', ')}`);
    }

    // Print key extractions
    const f = result.fields;
    const highlights = [];
    if (f.transmission_type) highlights.push(`trans=${f.transmission_type}`);
    if (f.engine_type) highlights.push(`engine=${f.engine_type}`);
    if (f.engine_horsepower) highlights.push(`hp=${f.engine_horsepower}`);
    if (f.drivetrain) highlights.push(`drive=${f.drivetrain}`);
    if (f.exterior_color) highlights.push(`color=${f.exterior_color}`);
    if (f.mileage) highlights.push(`miles=${f.mileage}`);
    if (f.condition_grade) highlights.push(`condition=${f.condition_grade}`);
    if (f.matching_numbers !== null) highlights.push(`matching=${f.matching_numbers}`);
    if (highlights.length > 0) console.log(`  Extracted: ${highlights.join(', ')}`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Avg score: ${(totalScore / processed).toFixed(1)}`);
  console.log(`Avg time: ${(totalTime / processed).toFixed(0)}ms per vehicle`);
  console.log(`Estimated time for 250K: ${((totalTime / processed) * 250000 / 3600000).toFixed(1)} hours`);
}

// ─── Validate Mode ───────────────────────────────────────────────────────────
async function runValidate(count = 50) {
  console.log(`\n=== VALIDATE MODE: ${count} diverse samples ===\n`);

  // Fetch samples across platforms and description lengths
  const sources = ['bat', 'mecum', 'barrett-jackson', 'craigslist', 'carsandbids', 'bonhams'];
  const perSource = Math.ceil(count / sources.length);
  let allVehicles = [];

  for (const source of sources) {
    const { data } = await sb
      .from('vehicles')
      .select('id, year, make, model, description, discovery_source, transmission, engine_type, engine_size, horsepower, torque, drivetrain, color, interior_color, body_style, mileage, vin, fuel_type, doors, title_status, displacement, condition_rating, modifications, is_modified')
      .eq('status', 'active')
      .eq('discovery_source', source)
      .not('description', 'is', null)
      .gt('description', '')
      .limit(perSource);

    if (data) allVehicles = allVehicles.concat(data);
  }

  console.log(`Fetched ${allVehicles.length} vehicles across ${sources.length} platforms\n`);

  let totalScore = 0;
  let totalTime = 0;
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  let fieldFills = {};
  const allScores = [];

  for (const v of allVehicles) {
    process.stdout.write(`[${processed + 1}/${allVehicles.length}] ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} (${v.discovery_source})... `);

    const result = await extractVehicle(v);
    if (result.skipped) { console.log('SKIP'); skipped++; continue; }
    if (result.error) { console.log('ERR:', result.error); errors++; continue; }
    processed++;

    const scoreResult = scoreExtraction(result, v);
    totalScore += scoreResult.score;
    totalTime += result.duration_ms;
    allScores.push({ source: v.discovery_source, score: scoreResult.score, fields: result.non_null_count });

    const update = buildVehicleUpdate(result.fields, v);
    for (const col of Object.keys(update)) {
      fieldFills[col] = (fieldFills[col] || 0) + 1;
    }

    console.log(`score=${scoreResult.score} fields=${result.non_null_count} fills=${Object.keys(update).length} ${result.duration_ms.toFixed(0)}ms`);
    if (scoreResult.issues.length > 0) console.log(`  ! ${scoreResult.issues.join(', ')}`);
  }

  // Summary by platform
  console.log(`\n${'='.repeat(60)}`);
  console.log(`VALIDATION SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);
  console.log(`Avg score: ${(totalScore / processed).toFixed(1)}`);
  console.log(`Avg time: ${(totalTime / processed).toFixed(0)}ms`);
  console.log(`Estimated 250K: ${((totalTime / processed) * 250000 / 3600000).toFixed(1)} hours\n`);

  // Per-platform scores
  const bySource = {};
  for (const s of allScores) {
    if (!bySource[s.source]) bySource[s.source] = { scores: [], fields: [] };
    bySource[s.source].scores.push(s.score);
    bySource[s.source].fields.push(s.fields);
  }
  console.log('Per-platform:');
  for (const [src, data] of Object.entries(bySource).sort((a, b) => b[1].scores.length - a[1].scores.length)) {
    const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
    const avgF = data.fields.reduce((a, b) => a + b, 0) / data.fields.length;
    console.log(`  ${src.padEnd(20)} n=${String(data.scores.length).padStart(3)} avg_score=${avg.toFixed(1).padStart(5)} avg_fields=${avgF.toFixed(1)}`);
  }

  // Column fill potential
  console.log('\nColumn fills (how many NULL columns would be filled):');
  for (const [col, count] of Object.entries(fieldFills).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / processed) * 100).toFixed(0);
    console.log(`  ${col.padEnd(20)} ${String(count).padStart(4)} / ${processed} (${pct}%)`);
  }
}

// ─── Batch Mode ──────────────────────────────────────────────────────────────
async function runBatch(targetCount) {
  const isAll = targetCount === 'all';
  const limit = isAll ? 999999 : parseInt(targetCount);
  console.log(`\n=== BATCH MODE: ${isAll ? 'ALL' : limit} vehicles ===\n`);

  let processed = 0;
  let filled = 0;
  let skipped = 0;
  let errors = 0;
  let offset = 0;

  const startTime = Date.now();

  while (processed + skipped + errors < limit) {
    const batchLimit = Math.min(BATCH_SIZE, limit - processed - skipped - errors);
    const vehicles = await fetchBatch(batchLimit, offset);
    if (!vehicles || vehicles.length === 0) {
      console.log('No more vehicles to process.');
      break;
    }

    for (const v of vehicles) {
      const result = await extractVehicle(v);

      if (result.skipped) { skipped++; continue; }
      if (result.error) { errors++; console.error(`Error on ${v.id}: ${result.error}`); continue; }

      const update = buildVehicleUpdate(result.fields, v);
      const success = await writeResults(v.id, result, update);

      if (success) {
        processed++;
        filled += Object.keys(update).length;
      } else {
        errors++;
      }

      // Progress every 10
      if (processed % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = (limit - processed - skipped - errors) / rate;
        process.stdout.write(`\r  [${processed} done, ${filled} cols filled, ${skipped} skip, ${errors} err] ${rate.toFixed(1)}/s ETA ${(remaining / 60).toFixed(0)}min  `);
      }
    }

    offset += vehicles.length;

    // Check locks every batch
    const { data: locks } = await sb.rpc('check_lock_count').catch(() => ({ data: null }));
    if (locks && locks > 2) {
      console.warn(`\n  WARNING: ${locks} lock waiters detected, pausing 5s...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n=== BATCH COMPLETE ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Columns filled: ${filled}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time: ${(elapsed / 60).toFixed(1)} minutes`);
  console.log(`Rate: ${(processed / elapsed).toFixed(1)} vehicles/sec`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];

  // Verify Ollama is running
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!resp.ok) throw new Error('Ollama not responding');
    const tags = await resp.json();
    const hasModel = tags.models?.some(m => m.name.startsWith(MODEL.split(':')[0]));
    if (!hasModel) {
      console.error(`Model ${MODEL} not found. Run: ollama pull ${MODEL}`);
      process.exit(1);
    }
    console.log(`Ollama OK, model ${MODEL} ready`);
  } catch (err) {
    console.error(`Ollama not running at ${OLLAMA_URL}. Start with: ollama serve`);
    process.exit(1);
  }

  switch (mode) {
    case '--test':
      await runTest(parseInt(args[1]) || 10);
      break;
    case '--validate':
      await runValidate(parseInt(args[1]) || 50);
      break;
    case '--batch':
      await runBatch(args[1] || '1000');
      break;
    default:
      console.log('Usage:');
      console.log('  --test [n]       Test on n samples (default 10), print detailed results');
      console.log('  --validate [n]   Validate on n diverse samples (default 50), score quality');
      console.log('  --batch <n|all>  Process n vehicles (or all), write to DB');
  }
}

main().catch(console.error);
