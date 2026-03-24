#!/usr/bin/env node
/**
 * bridge-extractions-to-field-evidence.mjs
 *
 * Converts ALL description_discoveries into field_evidence rows
 * so the frontend FieldProvenanceDrawer can display AI-extracted data.
 *
 * Handles prompt versions: v3, testimony-v3, local-v1, discovery-v1,
 * discovery-v2, v1-discovery, discovery-v1-local
 *
 * Usage:
 *   dotenvx run -- node scripts/bridge-extractions-to-field-evidence.mjs
 *   dotenvx run -- node scripts/bridge-extractions-to-field-evidence.mjs --dry-run
 *   dotenvx run -- node scripts/bridge-extractions-to-field-evidence.mjs --limit 100
 */

import pg from 'pg';

const DB_HOST = 'aws-0-us-west-1.pooler.supabase.com';

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

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : null;

// ─── Shared helper ──────────────────────────────────────────────────────────

function makeAdder(rows, vehicleId, defaultConfidence) {
  return (fieldName, value, context) => {
    if (value == null || value === 'null' || value === 'unknown' || value === 'N/A' || value === 'string') return;
    const strVal = String(value).trim();
    if (!strVal || strVal.length > 500) return;
    rows.push({
      vehicle_id: vehicleId,
      field_name: fieldName,
      proposed_value: strVal,
      source_confidence: defaultConfidence,
      extraction_context: context || null,
    });
  };
}

// ─── v3 extractor (flat e_detail/e_type or nested specs format) ─────────────

function extractV3(raw, vehicleId) {
  const rows = [];
  const auth = raw.auth ?? raw.authenticity_score ?? 50;
  const confidence = Math.round(Math.min(100, Math.max(0, (auth * 100))));
  const add = makeAdder(rows, vehicleId, confidence);
  const isNested = !!raw.specs;

  if (isNested) {
    const s = raw.specs || {};
    const eng = s.engine || {};
    add('vin', s.vin, 'Extracted from BaT listing description');
    add('engine_type', eng.claimed || eng.type, `${eng.displacement_ci || ''}ci ${eng.type || ''} ${eng.hp ? eng.hp + 'hp' : ''}`.trim());
    add('horsepower', eng.hp, eng.claimed);
    add('engine_size', eng.displacement_liters ? `${eng.displacement_liters}L` : (eng.displacement_ci ? `${eng.displacement_ci}ci` : null), eng.claimed);
    add('transmission', s.transmission?.claimed || s.transmission?.type, `${s.transmission?.speeds || ''}-speed ${s.transmission?.type || ''}`);
    add('drivetrain', s.drivetrain);
    add('color', s.exterior_color);
    add('interior_color', s.interior_color);
    add('mileage', s.mileage, `${s.mileage_unit || 'miles'}`);
    add('body_style', s.body_style);
    add('fuel_type', s.fuel_type);
    add('doors', s.doors);
    if (eng.torque) add('torque', eng.torque, eng.claimed);
  } else {
    add('vin', raw.vin, 'Extracted from BaT listing description');
    const engDesc = [raw.e_detail, raw.e_type].filter(Boolean).join(' — ');
    add('engine_type', raw.e_detail || raw.e_type, engDesc.substring(0, 200));
    add('horsepower', raw.e_hp, raw.e_detail);
    add('engine_size', raw.e_liters ? `${raw.e_liters}L` : (raw.e_ci ? `${raw.e_ci}ci` : null), raw.e_detail);
    add('transmission', raw.t_detail || raw.t_type, `${raw.t_speeds || ''}-speed ${raw.t_type || ''}`);
    add('drivetrain', raw.drive);
    add('color', raw.color);
    add('interior_color', raw.int_color);
    add('mileage', raw.miles, raw.mi_unit || 'miles');
    add('body_style', raw.body);
    add('fuel_type', raw.fuel);
    add('doors', raw.doors);
    if (raw.e_torque) add('torque', raw.e_torque, raw.e_detail);
  }

  return rows;
}

// ─── testimony-v3 extractor (specification with {value, confidence, quote}) ──

function extractTestimonyV3(raw, vehicleId) {
  const rows = [];
  const spec = raw.specification;
  if (!spec || typeof spec !== 'object') return rows;

  // Each field in spec has {value, confidence, quote}
  const fieldMap = {
    vin: 'vin',
    engine_type: 'engine_type',
    engine_detail: 'engine_type',  // fallback if engine_type not present
    horsepower: 'horsepower',
    torque: 'torque',
    displacement_liters: 'engine_size',
    displacement_ci: 'engine_size',
    transmission_type: 'transmission',
    transmission_detail: 'transmission',
    transmission_speeds: 'transmission_speeds',
    drivetrain: 'drivetrain',
    exterior_color: 'color',
    interior_color: 'interior_color',
    interior_material: 'interior_material',
    mileage: 'mileage',
    body_style: 'body_style',
    fuel_type: 'fuel_type',
    doors: 'doors',
    matching_numbers: 'matching_numbers',
    engine_code: 'engine_code',
  };

  const seen = new Set();
  for (const [specKey, fieldName] of Object.entries(fieldMap)) {
    const entry = spec[specKey];
    if (!entry) continue;

    let value, confidence, context;
    if (typeof entry === 'object' && entry !== null && 'value' in entry) {
      // {value, confidence, quote} format
      value = entry.value;
      confidence = typeof entry.confidence === 'number'
        ? Math.round(entry.confidence * 100)
        : 70;
      context = entry.quote || null;
    } else {
      // Direct value
      value = entry;
      confidence = 70;
      context = null;
    }

    if (value == null || value === 'null' || value === 'unknown' || value === 'N/A') continue;
    if (confidence === 0) continue; // confidence 0 = field not found

    const strVal = String(value).trim();
    if (!strVal || strVal.length > 500) return rows;

    // Don't double-add the same field_name (e.g. engine_type from engine_detail fallback)
    if (seen.has(fieldName)) continue;
    seen.add(fieldName);

    // For displacement_liters, format as "XL"
    let finalValue = strVal;
    if (specKey === 'displacement_liters' && !strVal.includes('L')) {
      finalValue = `${strVal}L`;
    } else if (specKey === 'displacement_ci' && !strVal.includes('ci')) {
      finalValue = `${strVal}ci`;
    }

    rows.push({
      vehicle_id: vehicleId,
      field_name: fieldName,
      proposed_value: finalValue,
      source_confidence: Math.min(100, Math.max(0, confidence)),
      extraction_context: context ? String(context).substring(0, 500) : null,
    });
  }

  return rows;
}

// ─── local-v1 extractor (flat keys: engine_type, mileage, vin, etc.) ────────

function extractLocalV1(raw, vehicleId) {
  const rows = [];
  const add = makeAdder(rows, vehicleId, 70);

  add('vin', raw.vin, 'AI-extracted from listing description');
  add('engine_type', raw.engine_type, raw.engine_fuel_system || null);
  add('horsepower', raw.engine_horsepower, raw.engine_type);
  add('torque', raw.engine_torque_lb_ft, raw.engine_type);
  add('engine_size',
    raw.engine_displacement_liters ? `${raw.engine_displacement_liters}L`
    : (raw.engine_displacement_ci ? `${raw.engine_displacement_ci}ci` : null),
    raw.engine_type);
  add('transmission', raw.transmission_type, raw.transmission_speeds ? `${raw.transmission_speeds}-speed` : null);
  add('transmission_speeds', raw.transmission_speeds);
  add('drivetrain', raw.drivetrain);
  add('color', raw.exterior_color);
  add('interior_color', raw.interior_color);
  add('interior_material', raw.interior_material);
  add('mileage', raw.mileage);
  add('body_style', raw.body_style);
  add('fuel_type', raw.fuel_type);
  add('doors', raw.doors);
  add('matching_numbers', raw.matching_numbers);
  add('condition_grade', raw.condition_grade);
  add('title_status', raw.title_status);
  add('owner_count', raw.owner_count);

  return rows;
}

// ─── discovery-v1/v2 extractor (nested vehicle_info + flat keys) ────────────

function extractDiscovery(raw, vehicleId) {
  const rows = [];
  const add = makeAdder(rows, vehicleId, 70);

  // vehicle_info nested object (discovery-v1 pattern)
  const vi = raw.vehicle_info || raw.vehicle_details || raw.vehicle_specifications || raw.specifications || {};
  const addFromObj = (obj, prefix) => {
    if (!obj || typeof obj !== 'object') return;
    // Direct field mappings from nested objects
    const m = {
      vin: 'vin',
      engine_type: 'engine_type',
      engine: 'engine_type',
      horsepower: 'horsepower',
      power_output: 'horsepower',
      torque: 'torque',
      transmission: 'transmission',
      transmission_type: 'transmission',
      drivetrain: 'drivetrain',
      drive_train: 'drivetrain',
      color: 'color',
      exterior_color: 'color',
      interior_color: 'interior_color',
      interior_material: 'interior_material',
      mileage: 'mileage',
      body_style: 'body_style',
      body_type: 'body_style',
      fuel_type: 'fuel_type',
      doors: 'doors',
      door_count: 'doors',
    };
    const seen = new Set();
    for (const [key, fieldName] of Object.entries(m)) {
      if (seen.has(fieldName)) continue;
      const val = obj[key];
      if (val != null && typeof val !== 'object') {
        add(fieldName, val, prefix ? `From ${prefix}` : null);
        seen.add(fieldName);
      }
    }
  };

  addFromObj(vi, 'vehicle_info');

  // Also check top-level flat keys (some discovery formats put them at root)
  const topLevel = {
    vin: 'vin',
    engine_type: 'engine_type',
    horsepower: 'horsepower',
    torque: 'torque',
    transmission: 'transmission',
    transmission_type: 'transmission',
    drivetrain: 'drivetrain',
    color: 'color',
    exterior_color: 'color',
    interior_color: 'interior_color',
    interior_material: 'interior_material',
    mileage: 'mileage',
    body_style: 'body_style',
    body_type: 'body_style',
    fuel_type: 'fuel_type',
    doors: 'doors',
    door_count: 'doors',
    matching_numbers: 'matching_numbers',
    condition_grade: 'condition_grade',
    title_status: 'title_status',
    owner_count: 'owner_count',
  };

  // Only add top-level if not already added from nested object
  const existingFields = new Set(rows.map(r => r.field_name));
  for (const [key, fieldName] of Object.entries(topLevel)) {
    if (existingFields.has(fieldName)) continue;
    const val = raw[key];
    if (val != null && typeof val !== 'object') {
      add(fieldName, val);
      existingFields.add(fieldName);
    }
  }

  return rows;
}

// ─── Route to the right extractor based on prompt_version ───────────────────

function extractFields(raw, vehicleId, promptVersion) {
  if (!raw || typeof raw !== 'object') return [];

  switch (promptVersion) {
    case 'v3':
      return extractV3(raw, vehicleId);
    case 'testimony-v3':
      return extractTestimonyV3(raw, vehicleId);
    case 'local-v1':
    case 'discovery-v1-local':
      return extractLocalV1(raw, vehicleId);
    case 'discovery-v1':
    case 'discovery-v2':
    case 'v1-discovery':
      return extractDiscovery(raw, vehicleId);
    default:
      // Try discovery extractor as fallback (handles mixed formats)
      return extractDiscovery(raw, vehicleId);
  }
}

// ─── Determine source_type based on prompt_version ──────────────────────────

function sourceTypeFor(promptVersion) {
  if (promptVersion === 'v3') return 'ai_extraction';
  return 'ai_description_discovery';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = await getDb();
  console.log('Connected to database');

  // Find ALL extractions that DON'T yet have field_evidence for their source_type
  // v3 uses 'ai_extraction', everything else uses 'ai_description_discovery'
  let query = `
    SELECT dd.vehicle_id, dd.raw_extraction, dd.discovered_at, dd.prompt_version
    FROM description_discoveries dd
    WHERE dd.raw_extraction IS NOT NULL
      AND (
        -- v3: check ai_extraction source
        (dd.prompt_version = 'v3' AND NOT EXISTS (
          SELECT 1 FROM field_evidence fe
          WHERE fe.vehicle_id = dd.vehicle_id AND fe.source_type = 'ai_extraction'
        ))
        OR
        -- non-v3: check ai_description_discovery source
        (dd.prompt_version != 'v3' AND NOT EXISTS (
          SELECT 1 FROM field_evidence fe
          WHERE fe.vehicle_id = dd.vehicle_id AND fe.source_type = 'ai_description_discovery'
        ))
      )
    ORDER BY dd.discovered_at DESC
  `;
  if (LIMIT) query += ` LIMIT ${LIMIT}`;

  const { rows: extractions } = await db.query(query);
  console.log(`Found ${extractions.length} extractions without field_evidence rows`);

  // Show breakdown by prompt_version
  const byVersion = {};
  for (const ext of extractions) {
    byVersion[ext.prompt_version] = (byVersion[ext.prompt_version] || 0) + 1;
  }
  console.log('By prompt_version:', JSON.stringify(byVersion, null, 2));

  if (extractions.length === 0) {
    console.log('Nothing to bridge. Done.');
    await db.end();
    return;
  }

  let totalRows = 0;
  let totalVehicles = 0;
  let errors = 0;
  const fieldCounts = {};

  // Process in batches of 100 vehicles, but cap INSERT at ~1000 rows per batch
  const BATCH = 100;
  for (let i = 0; i < extractions.length; i += BATCH) {
    const batch = extractions.slice(i, i + BATCH);
    const allRows = [];

    for (const ext of batch) {
      const srcType = sourceTypeFor(ext.prompt_version);
      const fields = extractFields(ext.raw_extraction, ext.vehicle_id, ext.prompt_version);
      for (const f of fields) {
        f.source_type = srcType;
        fieldCounts[f.field_name] = (fieldCounts[f.field_name] || 0) + 1;
      }
      if (fields.length > 0) {
        allRows.push(...fields);
        totalVehicles++;
      }
    }

    if (allRows.length === 0) continue;

    if (!DRY_RUN) {
      // Sub-batch inserts to stay under ~1000 rows per INSERT (hard rule: batch 1000)
      const SUB_BATCH = 1000;
      for (let s = 0; s < allRows.length; s += SUB_BATCH) {
        const subBatch = allRows.slice(s, s + SUB_BATCH);
        const values = [];
        const params = [];
        let paramIdx = 1;

        for (const row of subBatch) {
          values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, 'pending')`);
          params.push(row.vehicle_id, row.field_name, row.proposed_value, row.source_type, row.source_confidence, row.extraction_context);
          paramIdx += 6;
        }

        try {
          await db.query(`
            INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
            VALUES ${values.join(', ')}
            ON CONFLICT DO NOTHING
          `, params);
          totalRows += subBatch.length;
        } catch (e) {
          console.error(`  Batch insert failed at offset ${i}+${s}, falling back to individual inserts:`, e.message);
          for (const row of subBatch) {
            try {
              await db.query(`
                INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
                VALUES ($1, $2, $3, $4, $5, $6, 'pending')
                ON CONFLICT DO NOTHING
              `, [row.vehicle_id, row.field_name, row.proposed_value, row.source_type, row.source_confidence, row.extraction_context]);
              totalRows++;
            } catch (e2) {
              errors++;
            }
          }
        }

        // pg_sleep between sub-batches (hard rule: sleep between batches)
        if (s + SUB_BATCH < allRows.length) {
          await db.query('SELECT pg_sleep(0.1)');
        }
      }
    } else {
      totalRows += allRows.length;
    }

    // pg_sleep between vehicle batches
    if (!DRY_RUN && i + BATCH < extractions.length) {
      await db.query('SELECT pg_sleep(0.1)');
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= extractions.length) {
      console.log(`  Processed ${Math.min(i + BATCH, extractions.length)}/${extractions.length} vehicles — ${totalRows} rows ${DRY_RUN ? '(dry run)' : 'inserted'} — errors: ${errors}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  BRIDGE REPORT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Vehicles processed: ${totalVehicles}`);
  console.log(`  Field evidence rows ${DRY_RUN ? 'would be' : ''} created: ${totalRows}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Avg fields per vehicle: ${totalVehicles > 0 ? (totalRows / totalVehicles).toFixed(1) : 0}`);
  console.log('\n  Fields breakdown:');
  const sorted = Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]);
  for (const [field, count] of sorted) {
    console.log(`    ${field}: ${count}`);
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  await db.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
