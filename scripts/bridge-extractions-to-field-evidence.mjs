#!/usr/bin/env node
/**
 * bridge-extractions-to-field-evidence.mjs
 *
 * Converts v3 description_discoveries into field_evidence rows
 * so the frontend FieldProvenanceDrawer can display AI-extracted data.
 *
 * Usage:
 *   dotenvx run -- node scripts/bridge-extractions-to-field-evidence.mjs
 *   dotenvx run -- node scripts/bridge-extractions-to-field-evidence.mjs --dry-run
 *   dotenvx run -- node scripts/bridge-extractions-to-field-evidence.mjs --limit 100
 */

import pg from 'pg';

const DB_HOST = '54.177.55.191';

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

// ─── Extract field_evidence rows from a v3 extraction ────────────────────────

function extractFields(raw, vehicleId) {
  const rows = [];
  const auth = raw.auth ?? raw.authenticity_score ?? 50;
  const confidence = Math.round(Math.min(100, Math.max(0, (auth * 100))));
  const isNested = !!raw.specs;

  // Helper to add a row
  const add = (fieldName, value, context) => {
    if (!value || value === 'null' || value === 'unknown' || value === 'N/A') return;
    const strVal = String(value).trim();
    if (!strVal || strVal.length > 500) return;
    rows.push({ vehicle_id: vehicleId, field_name: fieldName, proposed_value: strVal,
      source_confidence: confidence, extraction_context: context || null });
  };

  if (isNested) {
    // Nested format (752 vehicles)
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
    // Flat format (majority)
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = await getDb();
  console.log('Connected to database');

  // Find v3 extractions that DON'T yet have ai_extraction field_evidence
  let query = `
    SELECT dd.vehicle_id, dd.raw_extraction, dd.discovered_at
    FROM description_discoveries dd
    WHERE dd.prompt_version = 'v3'
      AND dd.raw_extraction IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM field_evidence fe
        WHERE fe.vehicle_id = dd.vehicle_id
          AND fe.source_type = 'ai_extraction'
      )
    ORDER BY dd.discovered_at DESC
  `;
  if (LIMIT) query += ` LIMIT ${LIMIT}`;

  const { rows: extractions } = await db.query(query);
  console.log(`Found ${extractions.length} extractions without field_evidence rows`);

  if (extractions.length === 0) {
    console.log('Nothing to bridge. Done.');
    await db.end();
    return;
  }

  let totalRows = 0;
  let totalVehicles = 0;
  let errors = 0;

  // Process in batches of 100
  const BATCH = 100;
  for (let i = 0; i < extractions.length; i += BATCH) {
    const batch = extractions.slice(i, i + BATCH);
    const allRows = [];

    for (const ext of batch) {
      const fields = extractFields(ext.raw_extraction, ext.vehicle_id);
      if (fields.length > 0) {
        allRows.push(...fields);
        totalVehicles++;
      }
    }

    if (allRows.length === 0) continue;

    if (!DRY_RUN) {
      // Batch insert using multi-row VALUES
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const row of allRows) {
        values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, 'ai_extraction', $${paramIdx + 3}, $${paramIdx + 4}, 'pending')`);
        params.push(row.vehicle_id, row.field_name, row.proposed_value, row.source_confidence, row.extraction_context);
        paramIdx += 5;
      }

      try {
        await db.query(`
          INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
          VALUES ${values.join(', ')}
          ON CONFLICT DO NOTHING
        `, params);
        totalRows += allRows.length;
      } catch (e) {
        // If batch fails, try individual inserts
        for (const row of allRows) {
          try {
            await db.query(`
              INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
              VALUES ($1, $2, $3, 'ai_extraction', $4, $5, 'pending')
              ON CONFLICT DO NOTHING
            `, [row.vehicle_id, row.field_name, row.proposed_value, row.source_confidence, row.extraction_context]);
            totalRows++;
          } catch (e2) {
            errors++;
          }
        }
      }
    } else {
      totalRows += allRows.length;
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= extractions.length) {
      console.log(`  Processed ${Math.min(i + BATCH, extractions.length)}/${extractions.length} vehicles — ${totalRows} rows ${DRY_RUN ? '(dry run)' : 'inserted'}`);
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
  console.log('═══════════════════════════════════════════════════════════\n');

  await db.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
