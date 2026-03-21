#!/usr/bin/env node
/**
 * compute-description-corroboration.mjs
 *
 * For vehicles with 2+ model extractions in description_discoveries,
 * computes field-level agreement and flags contradictions.
 *
 * When Claude and Qwen both say "V8 350" → corroboration bonus (confidence increases).
 * When they disagree → contradiction flagged as a separate observation.
 *
 * Formula (from library/theoreticals/observation-half-life-model.md):
 *   corroboration_factor = 1.0 + (0.15 * (agreeing_sources - 1))
 *   Capped at 1.50x
 *
 * Usage:
 *   dotenvx run -- node scripts/compute-description-corroboration.mjs
 *   dotenvx run -- node scripts/compute-description-corroboration.mjs --dry-run
 */

import pg from 'pg';
import crypto from 'crypto';

const DB_HOST = '54.177.55.191';
const DRY_RUN = process.argv.includes('--dry-run');

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

// Corroboration fields — the ones we can meaningfully compare across models
const SPEC_FIELDS = [
  // v3-flat keys
  { keys: ['e_type', 'engine_type', 'engine'], norm: 'engine_type', type: 'text' },
  { keys: ['e_hp', 'horsepower', 'engine_horsepower'], norm: 'horsepower', type: 'number' },
  { keys: ['e_torque', 'torque', 'engine_torque'], norm: 'torque', type: 'number' },
  { keys: ['e_ci', 'displacement_ci', 'engine_displacement_ci'], norm: 'displacement_ci', type: 'number' },
  { keys: ['t_type', 'transmission', 'transmission_type'], norm: 'transmission', type: 'text' },
  { keys: ['t_speeds', 'transmission_speeds'], norm: 'transmission_speeds', type: 'number' },
  { keys: ['drive', 'drivetrain', 'drive_train'], norm: 'drivetrain', type: 'text' },
  { keys: ['color', 'exterior_color', 'paint_color'], norm: 'exterior_color', type: 'text' },
  { keys: ['int_color', 'interior_color', 'interior'], norm: 'interior_color', type: 'text' },
  { keys: ['body', 'body_style', 'body_type', 'vehicle_type'], norm: 'body_style', type: 'text' },
  { keys: ['miles', 'mileage', 'odometer'], norm: 'mileage', type: 'number' },
  { keys: ['doors'], norm: 'doors', type: 'number' },
  { keys: ['fuel', 'fuel_type'], norm: 'fuel_type', type: 'text' },
  { keys: ['matching', 'matching_numbers'], norm: 'matching_numbers', type: 'boolean' },
];

function extractField(raw, fieldDef) {
  // Handle v3-nested format
  const specs = raw.specs || {};
  const engine = specs.engine || {};
  const trans = specs.transmission || {};

  for (const key of fieldDef.keys) {
    // Direct top-level
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '' && raw[key] !== 'unknown' && raw[key] !== 'N/A') {
      return raw[key];
    }
    // Nested in specs
    if (specs[key] !== undefined && specs[key] !== null) return specs[key];
    // Engine sub-object
    if (engine[key] !== undefined && engine[key] !== null) return engine[key];
    if (trans[key] !== undefined && trans[key] !== null) return trans[key];
    // Nested objects (mechanical_info, vehicle_info, etc.)
    for (const sub of [raw.mechanical_info, raw.vehicle_info, raw.exterior_info]) {
      if (sub && sub[key] !== undefined && sub[key] !== null) return sub[key];
    }
  }
  // Handle object-type engine/transmission
  if (fieldDef.norm === 'engine_type' && typeof raw.engine === 'object' && raw.engine) {
    return raw.engine.type || raw.engine.name || raw.engine.description;
  }
  if (fieldDef.norm === 'transmission' && typeof raw.transmission === 'object' && raw.transmission) {
    return raw.transmission.type || raw.transmission.name;
  }
  return null;
}

function normalizeValue(val, type) {
  if (val === null || val === undefined) return null;
  if (type === 'number') {
    const n = typeof val === 'string' ? parseFloat(val.replace(/[^0-9.-]/g, '')) : Number(val);
    return isNaN(n) ? null : Math.round(n);
  }
  if (type === 'boolean') {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === 'yes';
    return null;
  }
  // text: lowercase, trim, normalize common variations
  let s = String(val).toLowerCase().trim();
  // Normalize common engine type variations
  s = s.replace(/\binline[- ]?/g, 'I').replace(/\bstraight[- ]?/g, 'I');
  s = s.replace(/\bcylinder/g, '').replace(/\s+/g, ' ').trim();
  return s || null;
}

function valuesAgree(a, b, type) {
  if (a === null || b === null) return null; // can't compare
  if (type === 'number') return a === b; // exact match for numbers
  if (type === 'boolean') return a === b;
  // Text: check if one contains the other or they match
  const sa = String(a), sb = String(b);
  if (sa === sb) return true;
  if (sa.includes(sb) || sb.includes(sa)) return true;
  return false;
}

async function main() {
  const db = await getDb();
  console.log('\n  Multi-Model Corroboration Scoring\n');

  // Get source ID for writing corroborated observations
  const srcRes = await db.query("SELECT id FROM observation_sources WHERE slug = 'ai-description-extraction'");
  const sourceId = srcRes.rows[0]?.id;
  if (!sourceId) { console.error('Source not found'); process.exit(1); }

  // Get vehicles with 2+ model extractions
  const multiRes = await db.query(`
    SELECT vehicle_id, array_agg(DISTINCT model_used) as models,
           count(DISTINCT model_used) as model_count
    FROM description_discoveries
    WHERE (raw_extraction->>'parse_failed') IS NULL AND promoted_at IS NOT NULL
    GROUP BY vehicle_id
    HAVING count(DISTINCT model_used) >= 2
    ORDER BY count(DISTINCT model_used) DESC`);

  console.log(`  Vehicles with 2+ models: ${multiRes.rows.length}`);
  if (DRY_RUN) console.log('  (DRY RUN)\n');

  let totalAgreements = 0, totalContradictions = 0, totalVehicles = 0;
  const fieldStats = {};

  for (const row of multiRes.rows) {
    const vid = row.vehicle_id;
    const models = row.models;

    // Load all extractions for this vehicle
    const extractionsRes = await db.query(`
      SELECT model_used, raw_extraction FROM description_discoveries
      WHERE vehicle_id = $1 AND (raw_extraction->>'parse_failed') IS NULL
      ORDER BY model_used`, [vid]);

    const extractions = extractionsRes.rows;
    const agreements = [];
    const contradictions = [];

    // Compare each field across models
    for (const fieldDef of SPEC_FIELDS) {
      const values = {};
      for (const ext of extractions) {
        const val = extractField(ext.raw_extraction, fieldDef);
        const normalized = normalizeValue(val, fieldDef.type);
        if (normalized !== null) {
          values[ext.model_used] = { raw: val, normalized };
        }
      }

      const modelNames = Object.keys(values);
      if (modelNames.length < 2) continue; // need 2+ models to compare

      // Check agreement
      const normalized = modelNames.map(m => values[m].normalized);
      const allAgree = normalized.every(v => valuesAgree(v, normalized[0], fieldDef.type));

      if (allAgree) {
        agreements.push({
          field: fieldDef.norm,
          value: values[modelNames[0]].raw,
          models: modelNames,
          agreement: 1.0,
        });
        totalAgreements++;
      } else {
        contradictions.push({
          field: fieldDef.norm,
          values: Object.fromEntries(modelNames.map(m => [m, values[m].raw])),
          models: modelNames,
        });
        totalContradictions++;
      }

      fieldStats[fieldDef.norm] = fieldStats[fieldDef.norm] || { agree: 0, contradict: 0 };
      fieldStats[fieldDef.norm][allAgree ? 'agree' : 'contradict']++;
    }

    if (agreements.length === 0 && contradictions.length === 0) continue;
    totalVehicles++;

    if (!DRY_RUN) {
      // Write corroborated specification observation with boosted confidence
      const corroborationFactor = Math.min(1.5, 1.0 + 0.15 * (models.length - 1));
      const baseConfidence = 0.55; // avg across models
      const boostedConfidence = Math.min(1.0, baseConfidence * corroborationFactor);

      // Build consensus structured_data from agreed fields
      const consensusData = {};
      for (const a of agreements) {
        consensusData[a.field] = a.value;
      }
      consensusData._corroboration = {
        models,
        agreements: agreements.length,
        contradictions: contradictions.length,
        corroboration_factor: corroborationFactor,
        agreement_rate: agreements.length / (agreements.length + contradictions.length),
      };

      // Upsert corroborated spec observation
      const identifier = `dd-corroborated-${vid}`;
      const hash = crypto.createHash('sha256').update(JSON.stringify(consensusData)).digest('hex');

      await db.query(`
        INSERT INTO vehicle_observations
          (vehicle_id, source_id, source_identifier, kind, content_text, structured_data,
           content_hash, confidence_score, observed_at, agent_tier, extraction_method, extracted_by)
        VALUES ($1, $2, $3, 'specification', $4, $5, $6, $7, now(), 'system', 'multi_model_consensus', 'compute-description-corroboration')
        ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING`,
        [vid, sourceId, identifier,
         `Corroborated by ${models.length} models: ${models.join(', ')}`,
         JSON.stringify(consensusData), hash, boostedConfidence]);

      // Write contradiction observations
      for (const c of contradictions) {
        const cIdentifier = `dd-contradiction-${vid}-${c.field}`;
        const cHash = crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');

        await db.query(`
          INSERT INTO vehicle_observations
            (vehicle_id, source_id, source_identifier, kind, content_text, structured_data,
             content_hash, confidence_score, observed_at, agent_tier, extraction_method, extracted_by)
          VALUES ($1, $2, $3, 'condition', $4, $5, $6, 0.30, now(), 'system', 'contradiction_detection', 'compute-description-corroboration')
          ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING`,
          [vid, sourceId, cIdentifier,
           `Contradiction on ${c.field}: ${Object.entries(c.values).map(([m,v]) => `${m}="${v}"`).join(' vs ')}`,
           JSON.stringify({ contradiction: true, field: c.field, values: c.values, models: c.models }),
           cHash]);
      }
    }
  }

  // Report
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  CORROBORATION COMPLETE${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Vehicles analyzed:    ${totalVehicles}`);
  console.log(`  Field agreements:     ${totalAgreements}`);
  console.log(`  Field contradictions: ${totalContradictions}`);
  console.log(`  Agreement rate:       ${totalAgreements > 0 ? Math.round(totalAgreements / (totalAgreements + totalContradictions) * 100) : 0}%`);
  console.log(`\n  Per-field breakdown:`);
  for (const [field, stats] of Object.entries(fieldStats).sort((a, b) => (b[1].agree + b[1].contradict) - (a[1].agree + a[1].contradict))) {
    const total = stats.agree + stats.contradict;
    const rate = Math.round(stats.agree / total * 100);
    console.log(`    ${field.padEnd(22)} ${stats.agree} agree / ${stats.contradict} contradict (${rate}%)`);
  }
  console.log();

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
