#!/usr/bin/env node
/**
 * Deep Resolve Vehicle — Full Resolution Depth on a Single Target
 *
 * Runs every enrichment filter on ONE vehicle. Inspects output quality.
 * Reports a spectral quality card showing what's filled, what's confident,
 * what's garbage.
 *
 * The goal: make one vehicle reach maximum resolution, then inspect.
 * Rolling start — run on 1, inspect, run on 5, inspect, scale to 50.
 *
 * Usage:
 *   dotenvx run -- node scripts/deep-resolve-vehicle.mjs --vehicle-id <uuid>
 *   dotenvx run -- node scripts/deep-resolve-vehicle.mjs --pick-best           # auto-pick richest unresolved
 *   dotenvx run -- node scripts/deep-resolve-vehicle.mjs --pick-best --count 5  # resolve 5 vehicles
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const YONO_URL = 'https://sss97133--yono-serve-fastapi-app.modal.run';
const OLLAMA_URL = 'http://127.0.0.1:11434';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const VEHICLE_ID = getArg('vehicle-id', null);
const PICK_BEST = args.includes('--pick-best');
const COUNT = parseInt(getArg('count', '1'));

function log(msg) { console.log(msg); }
function header(msg) { log(`\n${'═'.repeat(60)}\n  ${msg}\n${'═'.repeat(60)}`); }
function section(msg) { log(`\n── ${msg} ──`); }

// ── Helpers ──

async function sql(query) {
  const { data, error } = await supabase.rpc('execute_sql', { query });
  if (error) throw new Error(error.message);
  // Always return array
  return Array.isArray(data) ? data : data ? [data] : [];
}

function first(rows) { return rows?.[0] || {}; }

async function callYONO(endpoint, body) {
  try {
    const res = await fetch(`${YONO_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function callOllama(system, user) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        stream: false,
        options: { temperature: 0, num_predict: 4096 },
      }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json();
    return data.message?.content || '';
  } catch { return ''; }
}

// ── Pick best candidate ──

async function pickBestVehicle() {
  const rows = await sql(`
    SELECT v.id, v.year, v.make, v.model, v.description IS NOT NULL as has_desc,
      length(v.description) as desc_len,
      (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id AND vi.image_url LIKE '%supabase%') as image_count,
      ar.composite_score
    FROM vehicles v
    LEFT JOIN auction_readiness ar ON v.id = ar.vehicle_id
    WHERE v.status = 'active' AND v.description IS NOT NULL AND length(v.description) > 200
    ORDER BY
      (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id AND vi.image_url LIKE '%supabase%') DESC,
      ar.composite_score DESC NULLS LAST
    LIMIT ${COUNT}
  `);
  return rows;
}

// ── Resolution Filters ──

async function resolveVehicle(vehicleId) {
  header('DEEP RESOLVE — Full Resolution Depth');

  // ── STEP 0: Load current state ──
  section('CURRENT STATE');
  // Use PostgREST directly (more reliable than execute_sql for wide selects)
  const { data: vehicleRows } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .limit(1);
  const vehicle = vehicleRows?.[0];

  if (!vehicle) { log('Vehicle not found'); return; }
  log(`  ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  log(`  VIN: ${vehicle.vin || 'NONE'} | Price: $${vehicle.sale_price || vehicle.asking_price || '?'}`);
  log(`  Source: ${vehicle.source} | Location: ${vehicle.city || '?'}, ${vehicle.state || '?'}`);
  log(`  Description: ${vehicle.description ? vehicle.description.length + ' chars' : 'NONE'}`);

  // Count existing enrichment
  const imgCountRows = await sql(`SELECT count(*) as n FROM vehicle_images WHERE vehicle_id = '${vehicleId}'`);
  const obsCountRows = await sql(`SELECT count(*) as n FROM vehicle_observations WHERE vehicle_id = '${vehicleId}' AND NOT is_superseded`);
  const evCountRows = await sql(`SELECT count(*) as n FROM field_evidence WHERE vehicle_id = '${vehicleId}'`);
  const arsRows = await sql(`SELECT composite_score, tier FROM auction_readiness WHERE vehicle_id = '${vehicleId}'`) || [{}];

  const imgCount = first(imgCountRows);
  const obsCount = first(obsCountRows);
  const evCount = first(evCountRows);
  const arsRow = first(arsRows);

  log(`  Images: ${imgCount.n} | Observations: ${obsCount.n} | Evidence: ${evCount.n}`);
  log(`  ARS: ${arsRow?.composite_score || 'unscored'} (${arsRow?.tier || 'N/A'})`);

  const quality = {
    identity: { year: !!vehicle.year, make: !!vehicle.make, model: !!vehicle.model, vin: !!vehicle.vin },
    description: { exists: !!vehicle.description, length: vehicle.description?.length || 0 },
    rich_fields: {
      highlights: !!vehicle.highlights,
      equipment: !!vehicle.equipment,
      modifications: !!vehicle.modifications,
      known_flaws: !!vehicle.known_flaws,
      service_history: !!vehicle.recent_service_history,
    },
    images: { count: parseInt(imgCount.n || 0), zoned: 0, condition_scored: 0 },
    observations: parseInt(obsCount.n || 0),
    evidence: parseInt(evCount.n || 0),
  };

  // ── STEP 1: DESCRIPTION EXTRACTION (if description exists but no rich fields) ──
  const needsExtraction = vehicle.description && vehicle.description.length > 50
    && !vehicle.highlights && !vehicle.equipment;

  if (needsExtraction) {
    section('FILTER 1: Description Extraction (Ollama, $0)');
    const prompt = `Extract structured facts from this vehicle listing description. Return JSON with these fields (null if not mentioned): highlights (array of strings), equipment (array), modifications (array), known_flaws (array), service_history (array), engine (string), transmission (string), drivetrain (string), mileage (number), exterior_color (string), interior_color (string), title_status (string), ownership_history (string), condition_notes (string).

Description:
${vehicle.description.slice(0, 3000)}`;

    const result = await callOllama('Extract vehicle data as JSON only. No explanations.', prompt);

    // Parse JSON from LLM output
    let extracted = null;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
    } catch {}

    if (extracted) {
      const fields = Object.entries(extracted).filter(([k, v]) => v && v !== 'null' && (Array.isArray(v) ? v.length > 0 : true));
      log(`  Extracted ${fields.length} fields:`);
      for (const [k, v] of fields.slice(0, 8)) {
        const val = Array.isArray(v) ? `[${v.length} items]` : String(v).slice(0, 60);
        log(`    ${k}: ${val}`);
      }
      quality.extraction = { fields_extracted: fields.length, raw: extracted };

      // Write rich fields to vehicle (only fill NULLs)
      const updates = {};
      if (extracted.highlights?.length && !vehicle.highlights) updates.highlights = extracted.highlights;
      if (extracted.equipment?.length && !vehicle.equipment) updates.equipment = extracted.equipment;
      if (extracted.modifications?.length && !vehicle.modifications) updates.modifications = extracted.modifications;
      if (extracted.known_flaws?.length && !vehicle.known_flaws) updates.known_flaws = extracted.known_flaws;
      if (extracted.service_history?.length && !vehicle.recent_service_history)
        updates.recent_service_history = extracted.service_history.join('; ');
      if (extracted.mileage && !vehicle.mileage) updates.mileage = extracted.mileage;
      if (extracted.exterior_color && !vehicle.exterior_color) updates.exterior_color = extracted.exterior_color;
      if (extracted.transmission && !vehicle.transmission) updates.transmission = extracted.transmission;

      if (Object.keys(updates).length > 0) {
        await supabase.from('vehicles').update(updates).eq('id', vehicleId);
        log(`  → Wrote ${Object.keys(updates).length} fields to vehicle record`);
      }
    } else {
      log(`  ✗ Extraction failed (no valid JSON)`);
      quality.extraction = { fields_extracted: 0 };
    }
  } else if (vehicle.highlights) {
    section('FILTER 1: Description Extraction — SKIP (already extracted)');
    quality.extraction = { fields_extracted: 'already_done' };
  } else {
    section('FILTER 1: Description Extraction — SKIP (no description)');
    quality.extraction = { fields_extracted: 0, reason: 'no_description' };
  }

  // ── STEP 2: IMAGE ANALYSIS (condition + quality per image) ──
  section('FILTER 2: Image Analysis (YONO Florence-2, $0)');
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, condition_score, photo_quality_score, vehicle_zone')
    .eq('vehicle_id', vehicleId)
    .like('image_url', '%supabase%')
    .limit(20);

  const unanalyzed = (images || []).filter(i => !i.condition_score);
  log(`  ${images?.length || 0} images total, ${unanalyzed.length} need analysis`);

  let analyzed = 0;
  for (const img of unanalyzed.slice(0, 10)) { // Max 10 per vehicle per burst
    const result = await callYONO('/analyze', { image_url: img.image_url });
    if (result && !result.error) {
      const updates = {};
      if (result.condition_score) updates.condition_score = result.condition_score;
      if (result.photo_quality) updates.photo_quality_score = result.photo_quality;
      if (result.photo_type) updates.vehicle_zone = result.photo_type; // Coarse but reliable
      if (result.zone_confidence >= 0.30 && result.vehicle_zone) {
        updates.vehicle_zone = result.vehicle_zone;
        updates.zone_confidence = result.zone_confidence;
      }
      updates.vision_analyzed_at = new Date().toISOString();
      updates.vision_model_version = 'florence-2-finetuned-v2';

      await supabase.from('vehicle_images').update(updates).eq('id', img.id);
      analyzed++;
      log(`    ✓ condition=${result.condition_score} quality=${result.photo_quality} type=${result.photo_type || '?'} zone=${result.vehicle_zone || '?'}(${(result.zone_confidence*100).toFixed(0)}%)`);
    } else {
      log(`    ✗ ${result?.error?.slice(0, 60) || 'failed'}`);
    }
  }
  quality.images.condition_scored = (images || []).filter(i => i.condition_score).length + analyzed;
  log(`  → ${analyzed} newly analyzed`);

  // ── STEP 3: OBSERVATION BRIDGE ──
  section('FILTER 3: Observation Bridge');
  if (quality.observations === 0 && vehicle.description) {
    const { error } = await supabase.from('vehicle_observations').insert({
      vehicle_id: vehicleId,
      kind: 'listing',
      observed_at: new Date().toISOString(),
      source_url: vehicle.listing_url,
      content_text: vehicle.description?.slice(0, 2000),
      structured_data: { year: vehicle.year, make: vehicle.make, model: vehicle.model, price: vehicle.sale_price || vehicle.asking_price },
      confidence_score: vehicle.source === 'bat' ? 0.85 : 0.50,
      confidence: vehicle.source === 'bat' ? 'high' : 'medium',
      vehicle_match_confidence: 1.0,
      vehicle_match_signals: { source: 'deep_resolve' },
    });
    if (!error) {
      log(`  → Created listing observation`);
      quality.observations = 1;
    }
  } else {
    log(`  ${quality.observations} observations exist — skip`);
  }

  // ── STEP 4: ARS RECOMPUTE ──
  section('FILTER 4: ARS Recompute');
  try {
    await supabase.rpc('persist_auction_readiness', { p_vehicle_id: vehicleId });
    const newArsRows = await sql(`SELECT composite_score, tier, identity_score, photo_score, doc_score, desc_score, market_score, condition_score FROM auction_readiness WHERE vehicle_id = '${vehicleId}'`);
    const newArs = first(newArsRows);
    log(`  Score: ${newArs.composite_score} (${newArs.tier})`);
    log(`  Identity: ${newArs.identity_score} | Photo: ${newArs.photo_score} | Doc: ${newArs.doc_score} | Desc: ${newArs.desc_score} | Market: ${newArs.market_score} | Condition: ${newArs.condition_score}`);
    quality.ars = newArs;
  } catch (err) {
    log(`  ✗ ARS failed: ${err.message}`);
  }

  // ── QUALITY CARD ──
  header('QUALITY CARD');
  const id = quality.identity;
  log(`  Identity:    ${id.year ? '✓' : '✗'} year  ${id.make ? '✓' : '✗'} make  ${id.model ? '✓' : '✗'} model  ${id.vin ? '✓' : '✗'} VIN`);
  log(`  Description: ${quality.description.exists ? quality.description.length + ' chars' : '✗ none'}`);
  const rf = quality.rich_fields;
  log(`  Rich fields: ${rf.highlights ? '✓' : '✗'} highlights  ${rf.equipment ? '✓' : '✗'} equipment  ${rf.modifications ? '✓' : '✗'} mods  ${rf.known_flaws ? '✓' : '✗'} flaws  ${rf.service_history ? '✓' : '✗'} service`);
  log(`  Images:      ${quality.images.count} total, ${quality.images.condition_scored} condition-scored`);
  log(`  Observations: ${quality.observations}`);
  log(`  Evidence:    ${quality.evidence} facts`);
  log(`  ARS:         ${quality.ars?.composite_score || '?'} (${quality.ars?.tier || '?'})`);

  // Resolution depth score (0-100)
  let depth = 0;
  if (id.year) depth += 5; if (id.make) depth += 5; if (id.model) depth += 5; if (id.vin) depth += 10;
  if (quality.description.length > 500) depth += 10; else if (quality.description.length > 100) depth += 5;
  if (rf.highlights) depth += 5; if (rf.equipment) depth += 5; if (rf.modifications) depth += 5;
  if (rf.known_flaws) depth += 5; if (rf.service_history) depth += 5;
  if (quality.images.count >= 10) depth += 10; else if (quality.images.count >= 3) depth += 5;
  if (quality.images.condition_scored >= 5) depth += 10; else if (quality.images.condition_scored > 0) depth += 5;
  if (quality.observations > 0) depth += 5;
  if (quality.evidence > 10) depth += 10; else if (quality.evidence > 0) depth += 5;

  log(`\n  RESOLUTION DEPTH: ${depth}/100`);
  log(`  ${depth >= 70 ? '██████████' : depth >= 50 ? '██████░░░░' : depth >= 30 ? '████░░░░░░' : '██░░░░░░░░'} ${depth}%`);

  return { vehicleId, vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, depth, quality };
}

// ── Main ──

async function main() {
  const targets = [];

  if (VEHICLE_ID) {
    targets.push(VEHICLE_ID);
  } else if (PICK_BEST) {
    const best = await pickBestVehicle();
    for (const v of best) {
      log(`Picked: ${v.year} ${v.make} ${v.model} (${v.image_count} images, desc: ${v.desc_len} chars)`);
      targets.push(v.id);
    }
  } else {
    console.error('Usage: --vehicle-id <uuid> or --pick-best [--count N]');
    process.exit(1);
  }

  const results = [];
  for (const vid of targets) {
    const r = await resolveVehicle(vid);
    if (r) results.push(r);
    log('');
  }

  if (results.length > 1) {
    header('BATCH SUMMARY');
    for (const r of results) {
      log(`  ${r.depth}/100  ${r.vehicle}`);
    }
    log(`  Average depth: ${(results.reduce((a, r) => a + r.depth, 0) / results.length).toFixed(0)}/100`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
