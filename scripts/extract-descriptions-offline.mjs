#!/usr/bin/env node
/**
 * extract-descriptions-offline.mjs — Offline-capable description extraction
 *
 * Phase 1: Dump descriptions from DB to local JSONL (requires network)
 * Phase 2: Process JSONL with Ollama locally (no network needed)
 * Phase 3: Write results back to DB (requires network)
 *
 * Usage:
 *   dotenvx run -- node scripts/extract-descriptions-offline.mjs dump [--limit 10000]
 *   node scripts/extract-descriptions-offline.mjs process [--resume] [--limit 1000]
 *   dotenvx run -- node scripts/extract-descriptions-offline.mjs writeback [--dry-run]
 *   dotenvx run -- node scripts/extract-descriptions-offline.mjs stats
 */

import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'fs';
import { createInterface } from 'readline';
import { writeFile, appendFile } from 'fs/promises';

const OLLAMA_URL = 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const DATA_DIR = '/Users/skylar/nuke/data';
const DUMP_FILE = `${DATA_DIR}/descriptions-dump.jsonl`;
const RESULTS_FILE = `${DATA_DIR}/descriptions-results.jsonl`;
const PROGRESS_FILE = `${DATA_DIR}/descriptions-progress.json`;

// ─── System Prompt (compact for speed) ───────────────────────────────────────
const SYSTEM_PROMPT = `Extract vehicle data from a listing description as JSON. Output ONLY valid JSON.
Use null for unknown fields. For enums, use ONLY listed values.

{
  "transmission_type": "automatic|manual|semi-automatic|cvt|dual-clutch|sequential",
  "transmission_speeds": number,
  "engine_type": "V8|V6|V4|V10|V12|I4|I6|I3|H4|H6|W12|W16|rotary|electric|hybrid|other",
  "engine_displacement_liters": number,
  "engine_displacement_ci": number,
  "engine_forced_induction": "turbo|supercharged|twin-turbo|none",
  "engine_fuel_system": "carbureted|fuel-injected|diesel|electric|hybrid",
  "engine_horsepower": number,
  "engine_torque_lb_ft": number,
  "drivetrain": "RWD|FWD|AWD|4WD",
  "exterior_color": "string",
  "interior_color": "string",
  "interior_material": "leather|vinyl|cloth|alcantara|other",
  "body_style": "Coupe|Convertible|Sedan|Pickup|SUV|Wagon|Van|Fastback|Roadster|Targa|Hatchback|Truck|Saloon|Tourer|Speedster|Other",
  "doors": number,
  "mileage": number,
  "vin": "string",
  "title_state": "string",
  "title_status": "clean|salvage|rebuilt|bonded|exempt|none",
  "fuel_type": "gasoline|diesel|electric|hybrid|flex-fuel|propane",
  "is_modified": boolean,
  "modifications": ["list"],
  "matching_numbers": boolean,
  "owner_count": number,
  "condition_summary": "1-2 sentences",
  "condition_grade": "excellent|very-good|good|fair|poor|project",
  "notable_equipment": ["list"],
  "documentation_included": ["list"],
  "work_history": [{"description":"","date":"","shop":""}],
  "red_flags": ["list"]
}`;

// ─── Preprocessing ───────────────────────────────────────────────────────────
function preprocessDescription(text, source) {
  if (!text || text.length < 30) return null;
  text = text.replace(/^QR Code Link to This Post\s*/i, '');
  if (source === 'craigslist' || source === 'craigslist_scrape') {
    text = text.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '');
    text = text.replace(/se habla espa[ñn]ol/gi, '');
    text = text.replace(/(?:bad credit|no credit|guaranteed approval|easy financing|ITIN|in-house financing)[^.!]*/gi, '');
    text = text.replace(/https?:\/\/\S+/g, '');
  }
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 50) return null;
  if (text.length > 2500) text = text.substring(0, 2500);
  return text;
}

// ─── Post-processing ─────────────────────────────────────────────────────────
function postProcess(parsed) {
  // Engine type normalization
  if (parsed.engine_type) {
    const m = { 'flat-four': 'H4', 'flat-six': 'H6', 'flat-4': 'H4', 'flat-6': 'H6', 'flat-8': 'H8',
                'inline-4': 'I4', 'inline-6': 'I6', 'inline-3': 'I3', 'v4': 'I4' }; // V4 almost always means I4
    parsed.engine_type = m[parsed.engine_type.toLowerCase()] || parsed.engine_type;
  }
  // Displacement normalization
  if (parsed.engine_displacement_liters && parsed.engine_displacement_liters > 20) {
    parsed.engine_displacement_liters = Math.round(parsed.engine_displacement_liters / 100) / 10;
  }
  // Body style normalization
  if (parsed.body_style) {
    const bs = parsed.body_style.toLowerCase();
    const bsMap = { 'speedster': 'Speedster', 'saloon': 'Saloon', 'tourer': 'Tourer', 'truck': 'Truck' };
    if (bsMap[bs]) parsed.body_style = bsMap[bs];
  }
  // Drivetrain normalization — strip verbose suffixes
  if (parsed.drivetrain) {
    parsed.drivetrain = parsed.drivetrain.split('/')[0].trim(); // "RWD/Rear-Wheel Drive" → "RWD"
    if (!['RWD', 'FWD', 'AWD', '4WD'].includes(parsed.drivetrain)) parsed.drivetrain = null;
  }
  // Transmission — strip verbose suffixes
  if (parsed.transmission_type) {
    const t = parsed.transmission_type.toLowerCase();
    if (t.includes('automatic') || t === 'auto') parsed.transmission_type = 'automatic';
    else if (t.includes('manual')) parsed.transmission_type = 'manual';
    else if (t.includes('cvt')) parsed.transmission_type = 'cvt';
    else if (t.includes('dual-clutch') || t.includes('dct') || t.includes('pdk')) parsed.transmission_type = 'dual-clutch';
    else if (t.includes('sequential')) parsed.transmission_type = 'sequential';
    else if (t.includes('semi')) parsed.transmission_type = 'semi-automatic';
    // Filter out garbage
    if (!['automatic','manual','semi-automatic','cvt','dual-clutch','sequential'].includes(parsed.transmission_type)) {
      parsed.transmission_type = null;
    }
  }
  // Filter undefined/null strings
  for (const key of Object.keys(parsed)) {
    if (parsed[key] === 'undefined' || parsed[key] === 'null' || parsed[key] === 'None' || parsed[key] === 'N/A') {
      parsed[key] = null;
    }
  }
  return parsed;
}

// ─── Ollama ──────────────────────────────────────────────────────────────────
async function callOllama(desc, year, make, model) {
  const userPrompt = `Vehicle: ${year || '?'} ${make || '?'} ${model || '?'}\n\nDESCRIPTION:\n${desc}`;

  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: userPrompt,
      system: SYSTEM_PROMPT,
      stream: false,
      options: { temperature: 0.1, num_predict: 1024, top_p: 0.9, num_ctx: 4096 },
      format: 'json',
    }),
  });

  if (!resp.ok) throw new Error(`Ollama ${resp.status}`);
  const data = await resp.json();
  const parsed = JSON.parse(data.response.trim());
  return {
    fields: postProcess(parsed),
    tokens: data.eval_count || 0,
    duration_ms: data.total_duration ? data.total_duration / 1e6 : 0,
  };
}

// ─── Phase 1: DUMP ──────────────────────────────────────────────────────────
async function dumpDescriptions(limit) {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`Dumping up to ${limit} vehicle descriptions...`);

  // Check what's already been dumped
  let existingIds = new Set();
  if (existsSync(DUMP_FILE)) {
    const rl = createInterface({ input: createReadStream(DUMP_FILE) });
    for await (const line of rl) {
      try { existingIds.add(JSON.parse(line).id); } catch {}
    }
    console.log(`  ${existingIds.size} already in dump file`);
  }

  let offset = 0;
  let dumped = 0;
  const pageSize = 500;
  const ws = createWriteStream(DUMP_FILE, { flags: 'a' });

  while (dumped < limit) {
    const { data, error } = await sb
      .from('vehicles')
      .select('id, year, make, model, description, discovery_source, transmission, engine_type, engine_size, horsepower, torque, drivetrain, color, interior_color, body_style, mileage, vin, fuel_type, doors, title_status, displacement, condition_rating, modifications, is_modified')
      .eq('status', 'active')
      .not('description', 'is', null)
      .gt('description', '')
      .is('engine_type', null)
      .order('id')
      .range(offset, offset + pageSize - 1);

    if (error) { console.error('Query error:', error.message); break; }
    if (!data || data.length === 0) break;

    for (const v of data) {
      if (existingIds.has(v.id)) continue;
      const desc = preprocessDescription(v.description, v.discovery_source);
      if (!desc) continue;

      ws.write(JSON.stringify({
        id: v.id,
        year: v.year,
        make: v.make,
        model: v.model,
        description: desc,
        source: v.discovery_source,
        existing: {
          transmission: v.transmission, engine_type: v.engine_type, engine_size: v.engine_size,
          horsepower: v.horsepower, torque: v.torque, drivetrain: v.drivetrain, color: v.color,
          interior_color: v.interior_color, body_style: v.body_style, mileage: v.mileage,
          vin: v.vin, fuel_type: v.fuel_type, doors: v.doors, title_status: v.title_status,
          displacement: v.displacement, condition_rating: v.condition_rating,
          modifications: v.modifications, is_modified: v.is_modified,
        }
      }) + '\n');
      dumped++;
    }

    offset += data.length;
    process.stdout.write(`\r  Dumped ${dumped} (scanned ${offset})...`);

    if (data.length < pageSize) break;
  }

  ws.end();
  console.log(`\n  Total dumped: ${dumped} vehicles to ${DUMP_FILE}`);
}

// ─── Phase 2: PROCESS ───────────────────────────────────────────────────────
async function processDescriptions(limit, resume) {
  if (!existsSync(DUMP_FILE)) {
    console.error(`No dump file at ${DUMP_FILE}. Run 'dump' first.`);
    return;
  }

  // Load progress
  let processed = new Set();
  if (resume && existsSync(RESULTS_FILE)) {
    const rl = createInterface({ input: createReadStream(RESULTS_FILE) });
    for await (const line of rl) {
      try { processed.add(JSON.parse(line).id); } catch {}
    }
    console.log(`Resuming: ${processed.size} already processed`);
  }

  // Count total
  const rl1 = createInterface({ input: createReadStream(DUMP_FILE) });
  let total = 0;
  for await (const _ of rl1) total++;
  console.log(`\nProcessing ${Math.min(limit, total - processed.size)} of ${total} descriptions (model: ${MODEL})\n`);

  // Process
  const rl2 = createInterface({ input: createReadStream(DUMP_FILE) });
  let done = 0;
  let errors = 0;
  let skipped = 0;
  let totalTime = 0;
  const startTime = Date.now();

  for await (const line of rl2) {
    if (done >= limit) break;

    let vehicle;
    try { vehicle = JSON.parse(line); } catch { continue; }
    if (processed.has(vehicle.id)) { skipped++; continue; }

    try {
      const result = await callOllama(vehicle.description, vehicle.year, vehicle.make, vehicle.model);

      // Count new fields that would fill NULLs
      const fills = {};
      const f = result.fields;
      const e = vehicle.existing;
      if (f.transmission_type && !e.transmission) fills.transmission = f.transmission_type;
      if (f.engine_type && !e.engine_type) fills.engine_type = f.engine_type;
      if (f.engine_displacement_liters && !e.engine_size) fills.engine_size = `${f.engine_displacement_liters}L`;
      if (f.engine_horsepower && !e.horsepower) fills.horsepower = f.engine_horsepower;
      if (f.engine_torque_lb_ft && !e.torque) fills.torque = f.engine_torque_lb_ft;
      if (f.drivetrain && !e.drivetrain) fills.drivetrain = f.drivetrain;
      if (f.exterior_color && !e.color) fills.color = f.exterior_color;
      if (f.interior_color && !e.interior_color) fills.interior_color = f.interior_color;
      if (f.body_style && !e.body_style) fills.body_style = f.body_style;
      if (f.mileage && !e.mileage) fills.mileage = f.mileage;
      if (f.vin && !e.vin) fills.vin = f.vin;
      if (f.fuel_type && !e.fuel_type) fills.fuel_type = f.fuel_type;
      if (f.doors && !e.doors) fills.doors = f.doors;
      if (f.title_status && !e.title_status) fills.title_status = f.title_status;
      if (f.engine_displacement_ci && !e.displacement) fills.displacement = `${f.engine_displacement_ci}`;
      if (f.condition_grade && !e.condition_rating) {
        const cm = { 'excellent': 9, 'very-good': 7, 'good': 5, 'fair': 3, 'poor': 2, 'project': 1 };
        fills.condition_rating = cm[f.condition_grade];
      }
      if (f.modifications?.length > 0 && !e.modifications) fills.modifications = f.modifications;
      if (f.is_modified === true && !e.is_modified) fills.is_modified = true;

      const nonNull = Object.entries(f).filter(([_, v]) => v !== null && v !== undefined).length;

      await appendFile(RESULTS_FILE, JSON.stringify({
        id: vehicle.id,
        extraction: f,
        fills,
        non_null: nonNull,
        fill_count: Object.keys(fills).length,
        tokens: result.tokens,
        duration_ms: result.duration_ms,
      }) + '\n');

      done++;
      totalTime += result.duration_ms;

      if (done % 5 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = done / elapsed;
        const eta = (Math.min(limit, total) - done - skipped) / rate;
        process.stdout.write(`\r  [${done}/${limit}] ${rate.toFixed(2)}/s ${Object.keys(fills).length} fills ${result.duration_ms.toFixed(0)}ms  ETA ${(eta / 60).toFixed(0)}min  `);
      }
    } catch (err) {
      errors++;
      if (errors % 10 === 0) console.error(`\n  Error #${errors}: ${err.message}`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n=== PROCESS COMPLETE ===`);
  console.log(`Processed: ${done}, Errors: ${errors}, Skipped (already done): ${skipped}`);
  console.log(`Time: ${(elapsed / 60).toFixed(1)} min, Rate: ${(done / elapsed).toFixed(2)}/s`);
  console.log(`Avg inference: ${(totalTime / done).toFixed(0)}ms`);

  // Save progress
  await writeFile(PROGRESS_FILE, JSON.stringify({
    last_run: new Date().toISOString(),
    processed: done + processed.size,
    errors,
    model: MODEL,
    avg_ms: totalTime / done,
  }, null, 2));
}

// ─── Phase 3: WRITEBACK ─────────────────────────────────────────────────────
async function writeBack(dryRun) {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!existsSync(RESULTS_FILE)) {
    console.error(`No results file. Run 'process' first.`);
    return;
  }

  const rl = createInterface({ input: createReadStream(RESULTS_FILE) });
  let written = 0;
  let colsFilled = 0;
  let discoveryRows = 0;
  let errors = 0;
  let batch = [];

  for await (const line of rl) {
    let result;
    try { result = JSON.parse(line); } catch { continue; }

    if (Object.keys(result.fills).length === 0 && !dryRun) {
      // Still write the discovery row even if no fills
      discoveryRows++;
      continue;
    }

    batch.push(result);

    if (batch.length >= 50) {
      if (!dryRun) {
        for (const r of batch) {
          // Write vehicle column fills
          if (Object.keys(r.fills).length > 0) {
            const { error } = await sb.from('vehicles').update(r.fills).eq('id', r.id);
            if (error) { errors++; } else { written++; colsFilled += Object.keys(r.fills).length; }
          }

          // Write discovery row
          const { error: dErr } = await sb.from('description_discoveries').upsert({
            vehicle_id: r.id,
            discovered_at: new Date().toISOString(),
            model_used: MODEL,
            prompt_version: 'local-v1',
            raw_extraction: r.extraction,
            keys_found: r.non_null,
            total_fields: Object.keys(r.extraction).length,
          }, { onConflict: 'vehicle_id' });
          if (!dErr) discoveryRows++;
        }
      } else {
        written += batch.length;
        colsFilled += batch.reduce((a, r) => a + Object.keys(r.fills).length, 0);
      }

      process.stdout.write(`\r  Written ${written} vehicles, ${colsFilled} columns, ${discoveryRows} discoveries...`);
      batch = [];

      // Throttle to avoid locks
      if (!dryRun) await new Promise(r => setTimeout(r, 100));
    }
  }

  // Final batch
  if (!dryRun) {
    for (const r of batch) {
      if (Object.keys(r.fills).length > 0) {
        const { error } = await sb.from('vehicles').update(r.fills).eq('id', r.id);
        if (error) errors++; else { written++; colsFilled += Object.keys(r.fills).length; }
      }
      const { error: dErr } = await sb.from('description_discoveries').upsert({
        vehicle_id: r.id, discovered_at: new Date().toISOString(), model_used: MODEL,
        prompt_version: 'local-v1', raw_extraction: r.extraction,
        keys_found: r.non_null, total_fields: Object.keys(r.extraction).length,
      }, { onConflict: 'vehicle_id' });
      if (!dErr) discoveryRows++;
    }
  } else {
    written += batch.length;
    colsFilled += batch.reduce((a, r) => a + Object.keys(r.fills).length, 0);
  }

  console.log(`\n\n=== WRITEBACK ${dryRun ? '(DRY RUN) ' : ''}COMPLETE ===`);
  console.log(`Vehicles updated: ${written}`);
  console.log(`Columns filled: ${colsFilled}`);
  console.log(`Discovery rows: ${discoveryRows}`);
  console.log(`Errors: ${errors}`);
}

// ─── Stats ───────────────────────────────────────────────────────────────────
async function showStats() {
  let dumpCount = 0, resultCount = 0, fillStats = {};

  if (existsSync(DUMP_FILE)) {
    const rl = createInterface({ input: createReadStream(DUMP_FILE) });
    for await (const _ of rl) dumpCount++;
  }

  if (existsSync(RESULTS_FILE)) {
    const rl = createInterface({ input: createReadStream(RESULTS_FILE) });
    for await (const line of rl) {
      resultCount++;
      try {
        const r = JSON.parse(line);
        for (const col of Object.keys(r.fills || {})) {
          fillStats[col] = (fillStats[col] || 0) + 1;
        }
      } catch {}
    }
  }

  console.log(`\n=== EXTRACTION STATS ===`);
  console.log(`Dump file: ${dumpCount} vehicles`);
  console.log(`Results: ${resultCount} processed (${((resultCount/dumpCount)*100).toFixed(1)}%)`);
  console.log(`Remaining: ${dumpCount - resultCount}`);

  if (existsSync(PROGRESS_FILE)) {
    const prog = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
    console.log(`\nLast run: ${prog.last_run}`);
    console.log(`Model: ${prog.model}`);
    console.log(`Avg inference: ${prog.avg_ms?.toFixed(0)}ms`);
  }

  if (Object.keys(fillStats).length > 0) {
    console.log(`\nColumn fills across ${resultCount} vehicles:`);
    for (const [col, count] of Object.entries(fillStats).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${col.padEnd(20)} ${count} (${((count/resultCount)*100).toFixed(0)}%)`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // Ensure data dir exists
  const { mkdirSync } = await import('fs');
  mkdirSync(DATA_DIR, { recursive: true });

  switch (cmd) {
    case 'dump':
      await dumpDescriptions(parseInt(args.find(a => a.match(/^\d+$/)) || '50000'));
      break;
    case 'process':
      const resume = args.includes('--resume');
      const limit = parseInt(args.find(a => a.match(/^\d+$/) && a !== args[0]) || '99999999');
      await processDescriptions(limit, resume);
      break;
    case 'writeback':
      await writeBack(args.includes('--dry-run'));
      break;
    case 'stats':
      await showStats();
      break;
    default:
      console.log(`Usage:
  dump [N]               Dump N descriptions from DB to local JSONL (needs network)
  process [--resume] [N] Process N descriptions with Ollama (offline)
  writeback [--dry-run]  Write results back to DB (needs network)
  stats                  Show extraction progress`);
  }
}

main().catch(console.error);
