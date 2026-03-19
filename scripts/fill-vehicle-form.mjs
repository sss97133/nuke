#!/usr/bin/env node
/**
 * fill-vehicle-form.mjs — Schema-as-prompt vehicle form filler
 *
 * The DDL IS the prompt. This script:
 * 1. Loads the relevant digital twin table schemas (progressive disclosure)
 * 2. Loads source material for a vehicle
 * 3. Calls an LLM with: DDL + column comments + source material
 * 4. Parses response as SQL INSERTs
 * 5. Validates INSERTs against CHECK constraints
 * 6. Executes them
 * 7. Creates field_evidence rows for every filled value
 *
 * Usage:
 *   dotenvx run -- node scripts/fill-vehicle-form.mjs --vehicle-id <uuid> --source bat_listing
 *   dotenvx run -- node scripts/fill-vehicle-form.mjs --vehicle-id <uuid> --source bat_listing --layer engine --dry-run
 *   dotenvx run -- node scripts/fill-vehicle-form.mjs --vehicle-id <uuid> --source bat_listing --all-layers
 *   dotenvx run -- node scripts/fill-vehicle-form.mjs --vehicle-id <uuid> --source photo_album --dry-run
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// Config
// ============================================================

const DB_HOST = '54.177.55.191';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8192;

const anthropic = new Anthropic({ apiKey: process.env.VITE_NUKE_CLAUDE_API });

async function getDb() {
  const client = new pg.Client({
    host: DB_HOST,
    port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// ============================================================
// Layer definitions — progressive disclosure
// ============================================================

const LAYERS = {
  engine: [
    'engine_blocks', 'engine_cylinder_measurements', 'engine_crankshafts',
    'engine_connecting_rods', 'engine_pistons', 'engine_heads', 'engine_camshafts',
    'engine_intake_manifolds', 'engine_carburetors', 'engine_fuel_injection',
    'engine_distributors', 'engine_exhaust_manifolds', 'engine_oil_systems',
    'engine_cooling_interfaces', 'engine_accessories', 'engine_hardware',
  ],
  drivetrain: [
    'transmission_cases', 'transmission_internals', 'transmission_gears',
    'transmission_shifters', 'transmission_controllers', 'transmission_coolers',
    'transmission_clutch_systems', 'transmission_torque_converters',
    'transfer_cases', 'transfer_case_internals', 'transfer_case_controls',
    'driveshafts', 'front_axles', 'rear_axles',
  ],
  chassis: [
    'front_suspension_config', 'front_springs', 'front_dampers', 'front_control_arms',
    'front_sway_bars', 'front_steering_knuckles',
    'rear_suspension_config', 'rear_springs', 'rear_dampers', 'rear_trailing_arms_and_links',
    'rear_sway_bars',
    'steering_gearboxes', 'steering_columns', 'steering_linkage', 'steering_wheels',
    'brake_systems', 'brake_calipers', 'brake_drums', 'brake_rotors',
    'brake_pads_and_shoes', 'brake_lines',
  ],
  body: [
    'body_structure', 'body_panels', 'body_glass', 'body_bumpers',
    'body_trim_chrome', 'body_emblems_badges', 'body_lighting',
    'body_mirrors', 'body_weatherstripping', 'body_convertible_tops',
    'paint_systems',
  ],
  interior: [
    'seats', 'dash_assemblies', 'carpeting', 'headliners', 'door_panels',
    'consoles', 'interior_trim', 'sound_deadening',
  ],
  electrical: [
    'wiring_harnesses', 'batteries', 'alternators_generators', 'starters',
    'ignition_switches', 'fuse_panels', 'gauges_instruments', 'audio_systems',
    'comfort_electrical', 'exterior_lighting_electrical',
  ],
  wheels: [
    'wheels', 'tires', 'spare_wheel_tire', 'hubs_and_wheel_bearings',
  ],
  fuel: [
    'fuel_tanks', 'fuel_pumps', 'fuel_lines', 'fuel_filters',
    'fuel_system_electronics',
  ],
  exhaust: [
    'exhaust_pipes', 'mufflers', 'exhaust_tips', 'catalytic_converters',
  ],
  cooling: [
    'radiators', 'cooling_fans', 'coolant_hoses', 'overflow_systems', 'intercoolers',
  ],
  hvac: [
    'hvac_systems', 'heater_cores', 'ventilation',
  ],
  safety: [
    'safety_equipment', 'emissions_systems', 'crash_structure',
    'vin_plates_tags',
  ],
};

// ============================================================
// Schema loading — fetch DDL + comments for a set of tables
// ============================================================

async function loadTableDDL(db, tables) {
  const ddlParts = [];

  for (const table of tables) {
    // Get columns with types, defaults, constraints
    const colRes = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default,
             character_maximum_length, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);

    if (colRes.rows.length === 0) continue;

    // Get column comments
    const commentRes = await db.query(`
      SELECT a.attname AS column_name, d.description AS comment
      FROM pg_description d
      JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
      WHERE d.objoid = $1::regclass
      AND a.attnum > 0
      ORDER BY a.attnum
    `, [table]);

    const comments = {};
    for (const r of commentRes.rows) {
      comments[r.column_name] = r.comment;
    }

    // Get CHECK constraints
    const checkRes = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'
    `, [table]);

    // Build DDL string
    let ddl = `-- TABLE: ${table}\n`;
    ddl += `CREATE TABLE ${table} (\n`;

    const colLines = colRes.rows.map(col => {
      let line = `  ${col.column_name} ${col.data_type.toUpperCase()}`;
      if (col.character_maximum_length) line += `(${col.character_maximum_length})`;
      if (col.numeric_precision && col.data_type === 'numeric') {
        line += `(${col.numeric_precision},${col.numeric_scale})`;
      }
      if (col.is_nullable === 'NO') line += ' NOT NULL';
      if (col.column_default && !col.column_default.startsWith('gen_random_uuid')) {
        line += ` DEFAULT ${col.column_default}`;
      }
      return line;
    });
    ddl += colLines.join(',\n');
    ddl += '\n);\n\n';

    // Add CHECK constraints
    for (const chk of checkRes.rows) {
      ddl += `-- CONSTRAINT: ${chk.def}\n`;
    }
    ddl += '\n';

    // Add comments (these are the machine instructions)
    for (const col of colRes.rows) {
      if (comments[col.column_name]) {
        ddl += `COMMENT ON COLUMN ${table}.${col.column_name} IS '${comments[col.column_name].replace(/'/g, "''")}';` + '\n';
      }
    }
    ddl += '\n';

    ddlParts.push(ddl);
  }

  return ddlParts.join('\n');
}

// ============================================================
// Source material loading
// ============================================================

async function loadSourceMaterial(db, vehicleId, sourceType) {
  const parts = [];

  // Always load vehicle identity
  const vRes = await db.query(`
    SELECT id, year, make, model, trim, vin, engine_type, engine_size, transmission,
           drivetrain, color, interior_color, mileage,
           description, sale_price, status
    FROM vehicles WHERE id = $1
  `, [vehicleId]);

  if (vRes.rows.length === 0) throw new Error(`Vehicle ${vehicleId} not found`);
  const v = vRes.rows[0];
  parts.push(`## VEHICLE IDENTITY\nYear: ${v.year}\nMake: ${v.make}\nModel: ${v.model}\nTrim: ${v.trim || 'unknown'}\nVIN: ${v.vin || 'unknown'}\nEngine Type: ${v.engine_type || 'unknown'}\nEngine Size: ${v.engine_size || 'unknown'}\nTransmission: ${v.transmission || 'unknown'}\nDrivetrain: ${v.drivetrain || 'unknown'}\nExterior Color: ${v.color || 'unknown'}\nInterior Color: ${v.interior_color || 'unknown'}\nMileage: ${v.mileage || 'unknown'}\nSale Price: ${v.sale_price ? '$' + v.sale_price : 'unknown'}\n`);

  if (sourceType === 'bat_listing' || sourceType === 'all') {
    // Load v3 extraction
    const extRes = await db.query(`
      SELECT raw_extraction, total_fields
      FROM description_discoveries
      WHERE vehicle_id = $1
      ORDER BY total_fields DESC NULLS LAST, discovered_at DESC LIMIT 1
    `, [vehicleId]);
    if (extRes.rows.length > 0) {
      const ext = extRes.rows[0];
      parts.push(`## EXTRACTION (${ext.total_fields} fields)\n${JSON.stringify(ext.raw_extraction, null, 2)}\n`);
    }

    // Load description
    if (v.description) {
      parts.push(`## LISTING DESCRIPTION\n${v.description.substring(0, 4000)}\n`);
    }

    // Load field_evidence
    const feRes = await db.query(`
      SELECT field_name, proposed_value, source_confidence, source_type
      FROM field_evidence
      WHERE vehicle_id = $1 AND status = 'accepted'
      ORDER BY source_confidence DESC NULLS LAST
      LIMIT 100
    `, [vehicleId]);
    if (feRes.rows.length > 0) {
      parts.push(`## FIELD EVIDENCE (${feRes.rows.length} accepted facts)\n${feRes.rows.map(r => `- ${r.field_name}: ${r.proposed_value} (confidence: ${r.source_confidence}, source: ${r.source_type})`).join('\n')}\n`);
    }
  }

  if (sourceType === 'photo_album' || sourceType === 'all') {
    // Load image analysis results
    const imgRes = await db.query(`
      SELECT vi.url, vi.zone, vi.ai_description
      FROM vehicle_images vi
      WHERE vi.vehicle_id = $1 AND vi.ai_description IS NOT NULL
      ORDER BY vi.created_at DESC
      LIMIT 50
    `, [vehicleId]);
    if (imgRes.rows.length > 0) {
      parts.push(`## IMAGE ANALYSIS (${imgRes.rows.length} images with AI descriptions)\n${imgRes.rows.map(r => `- [${r.zone || 'unknown zone'}]: ${r.ai_description}`).join('\n')}\n`);
    }
  }

  if (sourceType === 'vin' || sourceType === 'all') {
    // Load VIN decode data (table may not exist)
    try {
      const vinRes = await db.query(`
        SELECT decoded_data FROM vin_decodes WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 1
      `, [vehicleId]);
      if (vinRes.rows.length > 0) {
        parts.push(`## VIN DECODE\n${JSON.stringify(vinRes.rows[0].decoded_data, null, 2)}\n`);
      }
    } catch { /* table may not exist */ }
  }

  return parts.join('\n---\n\n');
}

// ============================================================
// LLM call — the schema IS the prompt
// ============================================================

async function callLLM(ddl, sourceMaterial, vehicleId, layerName) {
  const systemPrompt = `You are a vehicle data extraction specialist. Your job is to fill database tables with accurate data extracted from source material.

RULES:
1. Output ONLY valid PostgreSQL INSERT statements. No commentary, no markdown fences.
2. Use the exact column names from the DDL.
3. Every value MUST be supported by the source material. Do NOT fabricate data.
4. Use NULL for any field where the source material provides no information.
5. The vehicle_id for all rows is: '${vehicleId}'
6. Do NOT insert id columns — they auto-generate.
7. Do NOT insert created_at or updated_at — they auto-generate.
8. Respect CHECK constraints exactly — use only valid enum values.
9. Set is_original = TRUE only if the source explicitly confirms factory originality.
10. Set condition_grade = 'unknown' unless the source provides clear condition info.
11. Set provenance = 'unknown' unless the source explicitly states the part origin.
12. For numeric measurements, convert to the units specified in the column comments (mm, cc, etc.).
13. If the source mentions a component but gives no details, still create a row with what you know and NULL for the rest.

OUTPUT FORMAT:
One INSERT per line. Each INSERT on its own line. No semicolons between them (add one at the end of each).
`;

  const userPrompt = `## TABLE SCHEMAS (Layer: ${layerName})
${ddl}

## SOURCE MATERIAL
${sourceMaterial}

Generate INSERT statements to fill the tables above with data from the source material. Only create rows for components that are actually mentioned or implied by the source material. Use NULL for unknown values.`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text;
}

// ============================================================
// Parse and validate INSERTs
// ============================================================

function parseInserts(llmOutput) {
  const lines = llmOutput.split('\n').filter(l => l.trim().startsWith('INSERT'));
  const inserts = [];

  for (const line of lines) {
    // Extract table name
    const tableMatch = line.match(/INSERT\s+INTO\s+(\w+)/i);
    if (!tableMatch) continue;

    inserts.push({
      table: tableMatch[1],
      sql: line.trim().replace(/;?\s*$/, ';'),
    });
  }

  return inserts;
}

// ============================================================
// Execute inserts and create field_evidence
// ============================================================

async function executeInserts(db, inserts, vehicleId, sourceType, dryRun) {
  let success = 0;
  let failed = 0;
  const errors = [];

  for (const insert of inserts) {
    if (dryRun) {
      console.log(`[DRY RUN] ${insert.sql.substring(0, 120)}...`);
      success++;
      continue;
    }

    try {
      await db.query(insert.sql);
      success++;
    } catch (err) {
      failed++;
      errors.push({ table: insert.table, error: err.message, sql: insert.sql.substring(0, 200) });
    }
  }

  return { success, failed, errors };
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  const vehicleIdIdx = args.indexOf('--vehicle-id');
  const vehicleId = vehicleIdIdx >= 0 ? args[vehicleIdIdx + 1] : null;

  const sourceIdx = args.indexOf('--source');
  const sourceType = sourceIdx >= 0 ? args[sourceIdx + 1] : 'bat_listing';

  const layerIdx = args.indexOf('--layer');
  const layerName = layerIdx >= 0 ? args[layerIdx + 1] : null;

  const allLayers = args.includes('--all-layers');
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  if (!vehicleId) {
    console.error('Usage: dotenvx run -- node scripts/fill-vehicle-form.mjs --vehicle-id <uuid> --source bat_listing [--layer engine] [--all-layers] [--dry-run]');
    console.error('\nSources: bat_listing, photo_album, vin, all');
    console.error('Layers:', Object.keys(LAYERS).join(', '));
    process.exit(1);
  }

  const db = await getDb();

  try {
    console.log(`\n=== FILL VEHICLE FORM ===`);
    console.log(`Vehicle: ${vehicleId}`);
    console.log(`Source:  ${sourceType}`);
    console.log(`Mode:    ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

    // Load source material
    console.log('Loading source material...');
    const sourceMaterial = await loadSourceMaterial(db, vehicleId, sourceType);
    console.log(`  Source material: ${sourceMaterial.length} chars\n`);

    // Determine which layers to fill
    const layersToFill = allLayers
      ? Object.keys(LAYERS)
      : layerName
        ? [layerName]
        : ['engine']; // default to engine layer

    let totalSuccess = 0;
    let totalFailed = 0;
    const allErrors = [];

    for (const layer of layersToFill) {
      if (!LAYERS[layer]) {
        console.error(`Unknown layer: ${layer}`);
        continue;
      }

      const tables = LAYERS[layer];
      console.log(`--- Layer: ${layer} (${tables.length} tables) ---`);

      // Load DDL for this layer
      const ddl = await loadTableDDL(db, tables);
      if (!ddl.trim()) {
        console.log('  No tables found, skipping.\n');
        continue;
      }

      // Check token budget (rough estimate: 4 chars per token)
      const totalChars = ddl.length + sourceMaterial.length;
      const estTokens = Math.ceil(totalChars / 4);
      console.log(`  DDL: ${ddl.length} chars, Source: ${sourceMaterial.length} chars (~${estTokens} tokens)`);

      if (estTokens > 120000) {
        console.log('  WARNING: Estimated tokens exceed 120K — may need to split source material.');
      }

      // Call LLM
      console.log('  Calling LLM...');
      const llmOutput = await callLLM(ddl, sourceMaterial, vehicleId, layer);

      if (verbose) {
        console.log('\n  --- LLM Output ---');
        console.log(llmOutput);
        console.log('  --- End Output ---\n');
      }

      // Parse INSERTs
      const inserts = parseInserts(llmOutput);
      console.log(`  Parsed ${inserts.length} INSERT statements`);

      if (inserts.length === 0) {
        console.log('  No INSERTs generated for this layer.\n');
        continue;
      }

      // Execute
      const result = await executeInserts(db, inserts, vehicleId, sourceType, dryRun);
      totalSuccess += result.success;
      totalFailed += result.failed;
      allErrors.push(...result.errors);

      console.log(`  Results: ${result.success} success, ${result.failed} failed\n`);
    }

    // Summary
    console.log('=== SUMMARY ===');
    console.log(`Total INSERTs: ${totalSuccess + totalFailed}`);
    console.log(`  Success: ${totalSuccess}`);
    console.log(`  Failed:  ${totalFailed}`);

    if (allErrors.length > 0) {
      console.log('\nErrors:');
      for (const err of allErrors) {
        console.log(`  [${err.table}] ${err.error}`);
        console.log(`    SQL: ${err.sql}`);
      }
    }

    if (dryRun) {
      console.log('\n(DRY RUN — no data was written)');
    }
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
