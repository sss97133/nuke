#!/usr/bin/env node
/**
 * promote-discoveries-to-observations.mjs
 *
 * Decomposes description_discoveries JSON blobs into individual
 * vehicle_observations rows, then materializes spec fields to vehicles table.
 *
 * The gut: extraction ate the data, this digests it into the observation system
 * and fills NULL fields on vehicle profiles.
 *
 * Usage:
 *   dotenvx run -- node scripts/promote-discoveries-to-observations.mjs
 *   dotenvx run -- node scripts/promote-discoveries-to-observations.mjs --dry-run
 *   dotenvx run -- node scripts/promote-discoveries-to-observations.mjs --limit 500
 *   dotenvx run -- node scripts/promote-discoveries-to-observations.mjs --materialize-only
 */

import pg from 'pg';
import crypto from 'crypto';

const DB_HOST = '54.177.55.191';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MATERIALIZE_ONLY = args.includes('--materialize-only');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : null;
const BATCH_SIZE = 200;

// ─── DB ──────────────────────────────────────────────────────────────────────

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

// ─── Confidence ──────────────────────────────────────────────────────────────

const MODEL_QUALITY = {
  'claude-haiku-4-5-20251001': 1.0,
  'claude-3-haiku': 0.95,
  'qwen2.5:7b': 0.85,
  'qwen2.5:7b-modal': 0.85,
  'qwen2.5-7b': 0.85,
  'llama3.1:8b': 0.75,
  'llama3.2:3b': 0.70,
};
const BASE_TRUST = 0.65;

function confidence(modelUsed) {
  const q = MODEL_QUALITY[modelUsed] || 0.80;
  return Math.round(BASE_TRUST * q * 100) / 100;
}

function contentHash(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// ─── Format Detection ────────────────────────────────────────────────────────

function detectFormat(raw, promptVersion) {
  if (promptVersion === 'v3') {
    return raw.specs ? 'v3-nested' : 'v3-flat';
  }
  if (promptVersion === 'v1-discovery') return 'v1-discovery';
  // discovery-v1, local-v1, discovery-v1-local
  return 'discovery-freeform';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function val(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s || s === 'null' || s === 'unknown' || s === 'N/A' || s === 'n/a' || s === 'none' || s === 'None') return null;
    return s;
  }
  return v;
}

function num(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.-]/g, '')) : Number(v);
  return isNaN(n) ? null : Math.round(n);
}

function numFloat(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.-]/g, '')) : Number(v);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function makeObs(kind, suffix, discoveryId, vehicleId, observedAt, contentText, structuredData) {
  const cleaned = {};
  for (const [k, v] of Object.entries(structuredData)) {
    if (v !== null && v !== undefined) cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return null;
  return {
    kind,
    source_identifier: `dd-${discoveryId}-${suffix}`,
    vehicle_id: vehicleId,
    content_text: contentText ? String(contentText).slice(0, 2000) : null,
    structured_data: cleaned,
    observed_at: observedAt,
    content_hash: contentHash(cleaned),
  };
}

// ─── Decompose: v3-flat ──────────────────────────────────────────────────────

function decomposeV3Flat(raw, id, vid, at) {
  const obs = [];

  // Specification
  const spec = makeObs('specification', 'spec', id, vid, at,
    [raw.e_detail, raw.t_detail].filter(Boolean).join('; '),
    {
      engine_type: val(raw.e_type), engine_detail: val(raw.e_detail),
      horsepower: num(raw.e_hp), torque: num(raw.e_torque),
      displacement_ci: num(raw.e_ci), displacement_liters: num(raw.e_liters),
      fuel_system: val(raw.e_fuel), forced_induction: val(raw.e_forced),
      engine_code: val(raw.e_code),
      transmission_type: val(raw.t_type), transmission_detail: val(raw.t_detail),
      transmission_speeds: num(raw.t_speeds), transmission_code: val(raw.t_code),
      drivetrain: val(raw.drive), exterior_color: val(raw.color),
      interior_color: val(raw.int_color), interior_material: val(raw.int_mat),
      body_style: val(raw.body), fuel_type: val(raw.fuel),
      doors: num(raw.doors), mileage: num(raw.miles), mileage_unit: val(raw.mi_unit),
      matching_numbers: raw.matching,
    });
  if (spec) obs.push(spec);

  // Condition
  const cond = makeObs('condition', 'cond', id, vid, at,
    val(raw.cond_note),
    {
      condition_grade: val(raw.cond), condition_notes: val(raw.cond_note),
      title_status: val(raw.title), title_state: val(raw.title_st),
      red_flags: Array.isArray(raw.flags) && raw.flags.length > 0 ? raw.flags : null,
    });
  if (cond) obs.push(cond);

  // Work records
  if (Array.isArray(raw.work)) {
    raw.work.forEach((w, i) => {
      let obsDate = at;
      try { if (w.d) { const d = new Date(w.d); if (!isNaN(d.getTime())) obsDate = d.toISOString(); } } catch { /* use default */ }
      const o = makeObs('work_record', `work-${i}`, id, vid, obsDate,
        w.w || JSON.stringify(w),
        { work_description: val(w.w), date: val(w.d), shop: val(w.s) });
      if (o) obs.push(o);
    });
  }
  if (Array.isArray(raw.mods) && raw.mods.length > 0) {
    const o = makeObs('work_record', 'mods', id, vid, at,
      raw.mods.join('; '),
      { type: 'modifications', items: raw.mods });
    if (o) obs.push(o);
  }

  // Provenance
  const prov = makeObs('provenance', 'prov', id, vid, at,
    Array.isArray(raw.docs) ? `Documentation: ${raw.docs.join(', ')}` : null,
    {
      documentation: Array.isArray(raw.docs) && raw.docs.length > 0 ? raw.docs : null,
      owner_count: num(raw.owners) || num(raw.owner_count),
      authenticity_score: num(raw.auth),
      matching_numbers: raw.matching,
    });
  if (prov) obs.push(prov);

  // Listing
  const listing = makeObs('listing', 'listing', id, vid, at, null, {
    equipment: Array.isArray(raw.equip) && raw.equip.length > 0 ? raw.equip : null,
    option_codes: Array.isArray(raw.codes) && raw.codes.length > 0 ? raw.codes :
      (Array.isArray(raw.codes_found) && raw.codes_found.length > 0 ? raw.codes_found : null),
    price_positives: Array.isArray(raw.price_pos) && raw.price_pos.length > 0 ? raw.price_pos : null,
    price_negatives: Array.isArray(raw.price_neg) && raw.price_neg.length > 0 ? raw.price_neg : null,
  });
  if (listing) obs.push(listing);

  return obs;
}

// ─── Decompose: v3-nested ────────────────────────────────────────────────────

function decomposeV3Nested(raw, id, vid, at) {
  const s = raw.specs || {};
  const eng = s.engine || {};
  const trn = s.transmission || {};

  // Convert to flat format and reuse
  const flat = {
    e_type: eng.type, e_detail: eng.claimed || eng.detail,
    e_hp: eng.hp, e_torque: eng.torque,
    e_ci: eng.displacement_ci, e_liters: eng.displacement_liters,
    e_fuel: eng.fuel_system, e_forced: eng.forced_induction, e_code: eng.code,
    t_type: trn.type || trn.claimed, t_detail: trn.detail || trn.claimed,
    t_speeds: trn.speeds, t_code: trn.code,
    drive: s.drivetrain, color: s.exterior_color,
    int_color: s.interior_color, int_mat: s.interior_material,
    body: s.body_style, fuel: s.fuel_type,
    doors: s.doors, miles: s.mileage, mi_unit: s.mileage_unit,
    vin: s.vin, matching: raw.matching_numbers,
    cond: raw.condition?.grade || raw.condition?.overall,
    cond_note: raw.condition?.notes || raw.condition?.summary,
    title: raw.validation?.title_status,
    flags: raw.red_flags,
    work: raw.work_history, mods: raw.modifications,
    docs: raw.documentation, owners: raw.owner_count,
    auth: raw.authenticity_score,
    equip: raw.notable_equipment, codes: raw.codes_found,
    price_pos: raw.price_signals?.positives, price_neg: raw.price_signals?.negatives,
  };
  return decomposeV3Flat(flat, id, vid, at);
}

// ─── Decompose: discovery-freeform ───────────────────────────────────────────

function decomposeDiscoveryFreeform(raw, id, vid, at) {
  const obs = [];

  // Specification — pull from many possible key names
  const specData = {};
  const trySpec = (target, ...keys) => {
    for (const k of keys) {
      const v = raw[k]; if (v !== null && v !== undefined && v !== '' && v !== 'unknown') { specData[target] = v; return; }
    }
    // Try nested
    for (const k of keys) {
      const nested = raw.mechanical_info?.[k] || raw.vehicle_info?.[k] || raw.exterior_info?.[k];
      if (nested) { specData[target] = nested; return; }
    }
  };

  trySpec('engine_type', 'engine', 'engine_type', 'engine_details', 'engine_and_transmission');
  trySpec('horsepower', 'horsepower', 'engine_horsepower', 'hp');
  trySpec('torque', 'torque', 'engine_torque', 'engine_torque_lb_ft');
  trySpec('displacement_ci', 'displacement_ci', 'engine_displacement_ci');
  trySpec('displacement_liters', 'displacement_liters', 'engine_displacement_liters', 'engine_size');
  trySpec('transmission_type', 'transmission', 'transmission_type', 'transmission_details');
  trySpec('drivetrain', 'drivetrain', 'drive_train', 'drive_type');
  trySpec('exterior_color', 'color', 'exterior_color', 'paint_color', 'finish_color');
  trySpec('interior_color', 'interior_color', 'interior');
  trySpec('body_style', 'body_style', 'body_type', 'vehicle_type');
  trySpec('fuel_type', 'fuel_type', 'fuel');
  trySpec('doors', 'doors');
  trySpec('mileage', 'mileage', 'odometer', 'miles');
  trySpec('matching_numbers', 'matching_numbers');

  // Handle nested engine objects
  if (!specData.engine_type && typeof raw.engine === 'object' && raw.engine) {
    specData.engine_type = raw.engine.type || raw.engine.name || raw.engine.description;
    if (raw.engine.horsepower) specData.horsepower = num(raw.engine.horsepower);
    if (raw.engine.torque) specData.torque = num(raw.engine.torque);
    if (raw.engine.displacement) specData.displacement_ci = num(raw.engine.displacement);
  }
  if (!specData.transmission_type && typeof raw.transmission === 'object' && raw.transmission) {
    specData.transmission_type = raw.transmission.type || raw.transmission.name || raw.transmission.description;
  }

  // Normalize numeric fields
  if (specData.horsepower) specData.horsepower = num(specData.horsepower);
  if (specData.torque) specData.torque = num(specData.torque);
  if (specData.displacement_ci) specData.displacement_ci = num(specData.displacement_ci);
  if (specData.displacement_liters) specData.displacement_liters = num(specData.displacement_liters);
  if (specData.doors) specData.doors = num(specData.doors);
  if (specData.mileage) specData.mileage = num(specData.mileage);

  const spec = makeObs('specification', 'spec', id, vid, at,
    [specData.engine_type, specData.transmission_type].filter(Boolean).join('; '),
    specData);
  if (spec) obs.push(spec);

  // Condition
  const condKeys = ['condition', 'condition_notes', 'condition_overview', 'current_condition', 'known_flaws', 'flaws'];
  const condData = {};
  for (const k of condKeys) {
    if (raw[k]) {
      if (typeof raw[k] === 'string') condData.condition_notes = (condData.condition_notes || '') + raw[k] + '. ';
      else if (typeof raw[k] === 'object') Object.assign(condData, raw[k]);
    }
  }
  if (condData.condition_notes && typeof condData.condition_notes === 'string') condData.condition_notes = condData.condition_notes.trim();
  else if (condData.condition_notes && typeof condData.condition_notes !== 'string') condData.condition_notes = JSON.stringify(condData.condition_notes);
  const cond = makeObs('condition', 'cond', id, vid, at, condData.condition_notes, condData);
  if (cond) obs.push(cond);

  // Work records
  const workKeys = ['service_history', 'recent_service_history', 'work_done', 'restoration', 'restoration_details', 'restoration_history'];
  for (const k of workKeys) {
    const arr = raw[k];
    if (Array.isArray(arr) && arr.length > 0) {
      arr.forEach((w, i) => {
        const text = typeof w === 'string' ? w : (w.work_done || w.description || w.w || JSON.stringify(w));
        let obsDate = at;
        try {
          const rawDate = w.date || w.d || (w.year ? `${w.year}-01-01` : null);
          if (rawDate) { const d = new Date(rawDate); if (!isNaN(d.getTime())) obsDate = d.toISOString(); }
        } catch { /* use default */ }
        const o = makeObs('work_record', `${k}-${i}`, id, vid, obsDate, text,
          typeof w === 'object' ? w : { work_description: w });
        if (o) obs.push(o);
      });
    }
  }
  const modKeys = ['modifications', 'modifications_and_upgrades'];
  for (const k of modKeys) {
    const arr = raw[k];
    if (Array.isArray(arr) && arr.length > 0) {
      const o = makeObs('work_record', 'mods', id, vid, at,
        arr.map(m => typeof m === 'string' ? m : m.description || JSON.stringify(m)).join('; '),
        { type: 'modifications', items: arr });
      if (o) obs.push(o);
    }
  }

  // Provenance
  const provData = {};
  const provKeys = ['ownership_history', 'provenance', 'documentation', 'documentation_and_history', 'documentation_and_records', 'awards_or_certifications'];
  for (const k of provKeys) {
    if (raw[k]) provData[k] = raw[k];
  }
  const provObs = makeObs('provenance', 'prov', id, vid, at,
    provData.documentation ? String(provData.documentation) : null,
    provData);
  if (provObs) obs.push(provObs);

  // Listing
  const listingData = {};
  const listKeys = ['equipment', 'features', 'features_and_equipment', 'factory_equipment', 'options', 'notable_equipment', 'rarity', 'production_numbers'];
  for (const k of listKeys) {
    if (raw[k]) listingData[k] = raw[k];
  }
  const listObs = makeObs('listing', 'listing', id, vid, at, null, listingData);
  if (listObs) obs.push(listObs);

  return obs;
}

// ─── Decompose: v1-discovery ─────────────────────────────────────────────────

function decomposeV1Discovery(raw, id, vid, at) {
  // Similar structure to discovery-freeform but with more predictable keys
  return decomposeDiscoveryFreeform(raw, id, vid, at);
}

// ─── Master decompose ────────────────────────────────────────────────────────

function decompose(raw, promptVersion, id, vid, at) {
  const format = detectFormat(raw, promptVersion);
  switch (format) {
    case 'v3-flat': return decomposeV3Flat(raw, id, vid, at);
    case 'v3-nested': return decomposeV3Nested(raw, id, vid, at);
    case 'v1-discovery': return decomposeV1Discovery(raw, id, vid, at);
    default: return decomposeDiscoveryFreeform(raw, id, vid, at);
  }
}

// ─── Extract materialization fields from spec observation ─────────────────────

function extractMaterializationFields(specData) {
  return {
    engine_type: val(specData.engine_type) || val(specData.engine_detail),
    horsepower: num(specData.horsepower),
    torque: num(specData.torque),
    transmission: val(specData.transmission_type) || val(specData.transmission_detail),
    drivetrain: val(specData.drivetrain),
    color: val(specData.exterior_color),
    interior_color: val(specData.interior_color),
    body_style: val(specData.body_style),
    fuel_type: val(specData.fuel_type),
    doors: num(specData.doors),
    mileage: num(specData.mileage),
    engine_liters: numFloat(specData.displacement_liters),
    engine_displacement: specData.displacement_ci ? `${specData.displacement_ci}ci` : null,
    engine_code: val(specData.engine_code),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = await getDb();
  console.log('\n  Promote Description Discoveries → Observations + Vehicles\n');

  // Get source ID
  const srcRes = await db.query("SELECT id FROM observation_sources WHERE slug = 'ai-description-extraction'");
  if (!srcRes.rows.length) { console.error('ERROR: source not registered'); process.exit(1); }
  const sourceId = srcRes.rows[0].id;

  // Count work
  const countRes = await db.query(`
    SELECT count(*) as total,
           count(*) FILTER (WHERE promoted_at IS NOT NULL) as promoted,
           count(*) FILTER (WHERE promoted_at IS NULL AND (raw_extraction->>'parse_failed') IS NULL) as pending
    FROM description_discoveries`);
  const { total, promoted, pending } = countRes.rows[0];
  console.log(`  Total: ${total} | Promoted: ${promoted} | Pending: ${pending}`);

  if (MATERIALIZE_ONLY) {
    console.log('  --materialize-only: skipping observation insert, materializing only');
    await materializeAll(db, sourceId);
    await db.end();
    return;
  }

  const target = LIMIT ? Math.min(LIMIT, Number(pending)) : Number(pending);
  console.log(`  Target: ${target}${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  if (target === 0) { console.log('  Nothing to promote.'); await db.end(); return; }

  let totalPromoted = 0, totalObs = 0, totalSkipped = 0, totalMaterialized = 0;
  const kindCounts = {};

  while (totalPromoted < target) {
    const batchLimit = Math.min(BATCH_SIZE, target - totalPromoted);

    // Fetch batch
    const batch = await db.query(`
      SELECT id, vehicle_id, raw_extraction, prompt_version, model_used, discovered_at
      FROM description_discoveries
      WHERE promoted_at IS NULL AND (raw_extraction->>'parse_failed') IS NULL
      ORDER BY discovered_at DESC
      LIMIT $1`, [batchLimit]);

    if (batch.rows.length === 0) break;

    // Decompose
    const allObs = [];
    const matFields = new Map(); // vehicle_id → materialization fields
    const discoveryIds = [];

    for (const row of batch.rows) {
      const observations = decompose(row.raw_extraction, row.prompt_version, row.id, row.vehicle_id, row.discovered_at);
      const conf = confidence(row.model_used);

      for (const obs of observations) {
        obs.source_id = sourceId;
        obs.confidence_score = conf;
        obs.confidence = conf >= 0.60 ? 'medium' : (conf >= 0.40 ? 'low' : 'low');
        allObs.push(obs);
        kindCounts[obs.kind] = (kindCounts[obs.kind] || 0) + 1;

        // Extract materialization fields from spec observations
        if (obs.kind === 'specification') {
          matFields.set(row.vehicle_id, extractMaterializationFields(obs.structured_data));
        }
      }
      discoveryIds.push(row.id);
    }

    if (DRY_RUN) {
      totalPromoted += batch.rows.length;
      totalObs += allObs.length;
      process.stdout.write(`  [${totalPromoted}/${target}] ${allObs.length} observations (dry run)\r`);
      continue;
    }

    // Insert observations in sub-batches
    const subBatch = 200;
    for (let i = 0; i < allObs.length; i += subBatch) {
      const sub = allObs.slice(i, i + subBatch);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const o of sub) {
        values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        params.push(o.vehicle_id, o.source_id, o.source_identifier, o.kind,
          o.content_text, JSON.stringify(o.structured_data), o.content_hash,
          o.confidence_score, o.observed_at);
      }

      const insertSql = `
        INSERT INTO vehicle_observations
          (vehicle_id, source_id, source_identifier, kind, content_text, structured_data, content_hash, confidence_score, observed_at)
        VALUES ${values.join(',\n')}
        ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING`;

      try {
        const res = await db.query(insertSql, params);
        totalObs += res.rowCount;
        totalSkipped += sub.length - res.rowCount;
      } catch (err) {
        console.error(`\n  Insert error: ${err.message.slice(0, 200)}`);
        // Try individual inserts on batch failure
        for (const o of sub) {
          try {
            const r = await db.query(`
              INSERT INTO vehicle_observations
                (vehicle_id, source_id, source_identifier, kind, content_text, structured_data, content_hash, confidence_score, observed_at)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
              ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING`,
              [o.vehicle_id, o.source_id, o.source_identifier, o.kind,
                o.content_text, JSON.stringify(o.structured_data), o.content_hash,
                o.confidence_score, o.observed_at]);
            totalObs += r.rowCount;
            totalSkipped += 1 - r.rowCount;
          } catch (e2) {
            totalSkipped++;
          }
        }
      }
    }

    // Mark promoted
    await db.query(`UPDATE description_discoveries SET promoted_at = now() WHERE id = ANY($1)`, [discoveryIds]);
    totalPromoted += discoveryIds.length;

    // Materialize to vehicles (fill NULLs only)
    const vehicleIds = [...matFields.keys()];
    for (let i = 0; i < vehicleIds.length; i += 500) {
      const chunk = vehicleIds.slice(i, i + 500);
      for (const vid of chunk) {
        const f = matFields.get(vid);
        if (!f) continue;
        const setClauses = [];
        const setParams = [];
        let pi = 1;

        const fields = [
          ['engine_type', f.engine_type, 'text'],
          ['horsepower', f.horsepower, 'int'],
          ['torque', f.torque, 'int'],
          ['transmission', f.transmission, 'text'],
          ['drivetrain', f.drivetrain, 'text'],
          ['color', f.color, 'text'],
          ['interior_color', f.interior_color, 'text'],
          ['body_style', f.body_style, 'text'],
          ['fuel_type', f.fuel_type, 'text'],
          ['doors', f.doors, 'int'],
          ['mileage', f.mileage, 'int'],
          ['engine_liters', f.engine_liters, 'numeric'],
          ['engine_displacement', f.engine_displacement, 'text'],
          ['engine_code', f.engine_code, 'text'],
        ];

        for (const [col, value] of fields) {
          if (value !== null && value !== undefined) {
            setClauses.push(`${col} = COALESCE(${col}, $${pi++})`);
            setParams.push(value);
          }
        }

        if (setClauses.length > 0) {
          setClauses.push(`updated_at = now()`);
          setParams.push(vid);
          await db.query(
            `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${pi}`,
            setParams);
          totalMaterialized++;
        }
      }

      // Lock check
      const locks = await db.query("SELECT count(*)::int as c FROM pg_stat_activity WHERE wait_event_type='Lock'");
      if (locks.rows[0].c > 5) {
        console.warn(`\n  WARNING: ${locks.rows[0].c} lock waiters, pausing 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    process.stdout.write(`  [${totalPromoted}/${target}] ${totalObs} obs inserted, ${totalMaterialized} vehicles materialized\r`);
    await new Promise(r => setTimeout(r, 100)); // breathe
  }

  // Report
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`  PROMOTION COMPLETE${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Discoveries promoted: ${totalPromoted}`);
  console.log(`  Observations inserted: ${totalObs}`);
  console.log(`  Observations skipped (dedup): ${totalSkipped}`);
  console.log(`  Vehicles materialized: ${totalMaterialized}`);
  console.log(`  By kind:`);
  for (const [k, c] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(20)} ${c}`);
  }
  console.log();

  await db.end();
}

async function materializeAll(db, sourceId) {
  // Re-materialize all promoted discoveries to vehicles
  const res = await db.query(`
    SELECT dd.vehicle_id, dd.raw_extraction, dd.prompt_version
    FROM description_discoveries dd
    WHERE dd.promoted_at IS NOT NULL AND (dd.raw_extraction->>'parse_failed') IS NULL`);

  console.log(`  Materializing from ${res.rows.length} promoted discoveries...\n`);
  let count = 0;

  for (const row of res.rows) {
    const observations = decompose(row.raw_extraction, row.prompt_version, 'x', row.vehicle_id, new Date().toISOString());
    const specObs = observations.find(o => o.kind === 'specification');
    if (!specObs) continue;

    const f = extractMaterializationFields(specObs.structured_data);
    const setClauses = [];
    const setParams = [];
    let pi = 1;

    for (const [col, value] of Object.entries({
      engine_type: f.engine_type, horsepower: f.horsepower, torque: f.torque,
      transmission: f.transmission, drivetrain: f.drivetrain, color: f.color,
      interior_color: f.interior_color, body_style: f.body_style, fuel_type: f.fuel_type,
      doors: f.doors, mileage: f.mileage, engine_liters: f.engine_liters,
      engine_displacement: f.engine_displacement, engine_code: f.engine_code,
    })) {
      if (value !== null && value !== undefined) {
        setClauses.push(`${col} = COALESCE(${col}, $${pi++})`);
        setParams.push(value);
      }
    }

    if (setClauses.length > 0) {
      setClauses.push(`updated_at = now()`);
      setParams.push(row.vehicle_id);
      await db.query(`UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${pi}`, setParams);
      count++;
    }

    if (count % 500 === 0 && count > 0) {
      process.stdout.write(`  ${count} vehicles materialized...\r`);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`\n  Done: ${count} vehicles materialized.`);
}

main().catch(err => { console.error(err); process.exit(1); });
