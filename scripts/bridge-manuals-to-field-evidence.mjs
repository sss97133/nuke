#!/usr/bin/env node
/**
 * bridge-manuals-to-field-evidence.mjs
 *
 * Pure data transform — maps oem_vehicle_specs columns to field_evidence rows
 * for matching vehicles. No LLM.
 *
 * Factory service manual specs have trust 95 in data_source_trust_hierarchy,
 * so they WIN over ai_extraction (65) and scraped_listing (70) when
 * materialize-field-evidence.mjs runs.
 *
 * Fields bridged: engine_size, horsepower, torque, transmission, drivetrain,
 *                 fuel_type, curb_weight_lbs, wheelbase_inches
 *
 * Usage:
 *   dotenvx run -- node scripts/bridge-manuals-to-field-evidence.mjs              # dry-run
 *   dotenvx run -- node scripts/bridge-manuals-to-field-evidence.mjs --apply      # write
 *   dotenvx run -- node scripts/bridge-manuals-to-field-evidence.mjs --limit 100  # limit vehicles
 *   dotenvx run -- node scripts/bridge-manuals-to-field-evidence.mjs --stats      # show existing
 */

import pg from 'pg';

const DB_HOST = '54.177.55.191';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STATS_ONLY = args.includes('--stats');
const limitIdx = args.indexOf('--limit');
const VEHICLE_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : null;

const SOURCE_TYPE = 'factory_service_manual';
const SOURCE_CONFIDENCE = 95;
const BATCH_SIZE = 500;

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

// ─── OEM spec column → field_evidence field_name mapping ─────────────────────
const SPEC_TO_FIELD = [
  { specCol: 'engine_size', fieldName: 'engine_size', format: v => v },
  { specCol: 'horsepower', fieldName: 'horsepower', format: v => String(v) },
  { specCol: 'torque_ft_lbs', fieldName: 'torque', format: v => String(v) },
  { specCol: 'transmission', fieldName: 'transmission', format: v => v },
  { specCol: 'drivetrain', fieldName: 'drivetrain', format: v => v },
  { specCol: 'fuel_type', fieldName: 'fuel_type', format: v => v },
  { specCol: 'curb_weight_lbs', fieldName: 'curb_weight', format: v => String(v) },
  { specCol: 'wheelbase_inches', fieldName: 'wheelbase', format: v => String(v) },
];

// ─── Stats Mode ─────────────────────────────────────────────────────────────
async function showStats(db) {
  const existing = await db.query(`
    SELECT field_name, count(*) as cnt, count(DISTINCT vehicle_id) as vehicles
    FROM field_evidence
    WHERE source_type = $1
    GROUP BY field_name ORDER BY cnt DESC
  `, [SOURCE_TYPE]);

  console.log(`\n=== Factory Service Manual → field_evidence Stats ===\n`);
  if (existing.rows.length === 0) {
    console.log('  No factory_service_manual field_evidence rows yet.');
  } else {
    for (const r of existing.rows) {
      console.log(`  ${r.field_name}: ${r.cnt} rows (${r.vehicles} vehicles)`);
    }
    const totalRows = existing.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
    const totalVehicles = await db.query(
      `SELECT count(DISTINCT vehicle_id) FROM field_evidence WHERE source_type = $1`, [SOURCE_TYPE]
    );
    console.log(`\n  Total: ${totalRows} rows across ${totalVehicles.rows[0].count} vehicles`);
  }

  // Show potential
  const potential = await db.query(`
    SELECT o.make, count(DISTINCT v.id) as vehicles,
           count(*) FILTER (WHERE o.horsepower IS NOT NULL) as has_hp,
           count(*) FILTER (WHERE o.engine_size IS NOT NULL) as has_engine,
           count(*) FILTER (WHERE o.transmission IS NOT NULL) as has_trans
    FROM oem_vehicle_specs o
    JOIN vehicles v ON v.make ILIKE o.make
      AND v.year BETWEEN o.year_start AND COALESCE(o.year_end, o.year_start)
      AND v.status = 'active'
    GROUP BY o.make
    ORDER BY count(DISTINCT v.id) DESC
    LIMIT 15
  `);
  console.log('\n  Potential matches (oem_vehicle_specs → vehicles):');
  for (const r of potential.rows) {
    console.log(`    ${r.make}: ${r.vehicles} vehicles (hp:${r.has_hp} engine:${r.has_engine} trans:${r.has_trans})`);
  }
}

// ─── Main Bridge ────────────────────────────────────────────────────────────
async function bridge(db) {
  console.log(`\n=== Bridge: oem_vehicle_specs → field_evidence ===${APPLY ? ' [APPLY]' : ' [DRY RUN]'}\n`);

  // Single efficient JOIN — produce all (vehicle, spec-field, value) tuples at once
  // This avoids N+1 queries (was 57K spec rows × vehicle lookups)
  const limitClause = VEHICLE_LIMIT ? `LIMIT ${VEHICLE_LIMIT * 8}` : 'LIMIT 500000';
  const joinResult = await db.query(`
    SELECT v.id as vehicle_id, o.make, o.model, o.year_start, o.year_end,
           o.engine_size, o.horsepower, o.torque_ft_lbs, o.transmission,
           o.drivetrain, o.fuel_type, o.curb_weight_lbs, o.wheelbase_inches
    FROM oem_vehicle_specs o
    JOIN vehicles v ON v.make ILIKE o.make
      AND v.year BETWEEN o.year_start AND COALESCE(o.year_end, o.year_start)
      AND v.status = 'active'
    WHERE (o.horsepower IS NOT NULL OR o.engine_size IS NOT NULL
           OR o.transmission IS NOT NULL OR o.drivetrain IS NOT NULL
           OR o.fuel_type IS NOT NULL OR o.torque_ft_lbs IS NOT NULL
           OR o.curb_weight_lbs IS NOT NULL OR o.wheelbase_inches IS NOT NULL)
    ${limitClause}
  `);
  console.log(`  JOIN produced ${joinResult.rows.length} vehicle×spec matches`);

  const totalVehicles = new Set();
  const fieldCounts = {};
  const pendingInserts = [];

  for (const row of joinResult.rows) {
    totalVehicles.add(row.vehicle_id);

    for (const mapping of SPEC_TO_FIELD) {
      const rawValue = row[mapping.specCol];
      if (rawValue === null || rawValue === undefined) continue;

      const formattedValue = mapping.format(rawValue);
      if (!formattedValue) continue;

      pendingInserts.push({
        vehicle_id: row.vehicle_id,
        field_name: mapping.fieldName,
        proposed_value: formattedValue,
        source_type: SOURCE_TYPE,
        source_confidence: SOURCE_CONFIDENCE,
        extraction_context: `oem_vehicle_specs (${row.make} ${row.model || ''} ${row.year_start}${row.year_end && row.year_end !== row.year_start ? '-'+row.year_end : ''})`,
        status: 'pending',
      });

      fieldCounts[mapping.fieldName] = (fieldCounts[mapping.fieldName] || 0) + 1;
    }
  }

  console.log(`  Prepared ${pendingInserts.length} field_evidence rows for ${totalVehicles.size} vehicles\n`);

  // Show breakdown
  console.log('  By field:');
  for (const [field, count] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${field}: ${count}`);
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — no rows written. Run with --apply to insert.`);
    return;
  }

  // Insert in batches using INSERT ... ON CONFLICT to skip dupes efficiently
  console.log(`\n  Writing ${pendingInserts.length} rows in batches of ${BATCH_SIZE}...`);
  let written = 0, dupes = 0;

  for (let i = 0; i < pendingInserts.length; i += BATCH_SIZE) {
    const batch = pendingInserts.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      try {
        const res = await db.query(`
          INSERT INTO field_evidence
            (vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
        `, [row.vehicle_id, row.field_name, row.proposed_value, row.source_type,
            row.source_confidence, row.extraction_context, row.status]);
        if (res.rowCount > 0) written++;
        else dupes++;
      } catch (err) {
        dupes++; // treat errors as skips
      }
    }

    process.stdout.write(`\r  [${Math.min(i + BATCH_SIZE, pendingInserts.length)}/${pendingInserts.length}] written: ${written} dupes: ${dupes}`);

    // Check lock impact
    const locks = await db.query(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'`);
    if (parseInt(locks.rows[0].count) > 0) {
      console.log(`\n  WARNING: ${locks.rows[0].count} lock waiters — pausing 1s`);
      await new Promise(r => setTimeout(r, 1000));
    } else {
      await new Promise(r => setTimeout(r, 100)); // standard batch pause
    }
  }

  console.log(`\n\n  === COMPLETE ===`);
  console.log(`  Written: ${written} | Duplicates skipped: ${dupes} | Vehicles: ${totalVehicles.size}`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────
async function main() {
  const db = await getDb();
  try {
    if (STATS_ONLY) {
      await showStats(db);
    } else {
      await bridge(db);
    }
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
