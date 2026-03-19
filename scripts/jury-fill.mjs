#!/usr/bin/env node
/**
 * jury-fill.mjs — Multi-model ensemble verification for digital twin filling
 *
 * Runs fill-vehicle-form logic against multiple models, diffs outputs per field,
 * and writes consensus to vehicle tables.
 *
 * Consensus = fact. Divergence = flag. Empty = gap.
 *
 * Usage:
 *   dotenvx run -- node scripts/jury-fill.mjs --vehicle-id <uuid> --source bat_listing --layer engine
 *   dotenvx run -- node scripts/jury-fill.mjs --vehicle-id <uuid> --source bat_listing --layer engine --dry-run
 *   dotenvx run -- node scripts/jury-fill.mjs --vehicle-id <uuid> --source all --all-layers --dry-run
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// Config
// ============================================================

const DB_HOST = '54.177.55.191';

const JURY_MODELS = [
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', name: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-6-20250514', provider: 'anthropic', name: 'Claude Sonnet 4.6' },
];

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
// Layer definitions (same as fill-vehicle-form.mjs)
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
};

// ============================================================
// Schema and source loading (reused from fill-vehicle-form.mjs)
// ============================================================

async function loadTableDDL(db, tables) {
  const ddlParts = [];
  for (const table of tables) {
    const colRes = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
      ORDER BY ordinal_position
    `, [table]);
    if (colRes.rows.length === 0) continue;

    const commentRes = await db.query(`
      SELECT a.attname AS column_name, d.description AS comment
      FROM pg_description d
      JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
      WHERE d.objoid = $1::regclass AND a.attnum > 0
      ORDER BY a.attnum
    `, [table]);
    const comments = {};
    for (const r of commentRes.rows) comments[r.column_name] = r.comment;

    const checkRes = await db.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'
    `, [table]);

    let ddl = `-- TABLE: ${table}\nCREATE TABLE ${table} (\n`;
    ddl += colRes.rows.map(col => {
      let line = `  ${col.column_name} ${col.data_type.toUpperCase()}`;
      if (col.is_nullable === 'NO') line += ' NOT NULL';
      return line;
    }).join(',\n');
    ddl += '\n);\n';
    for (const chk of checkRes.rows) ddl += `-- CONSTRAINT: ${chk.def}\n`;
    for (const col of colRes.rows) {
      if (comments[col.column_name]) ddl += `COMMENT ON COLUMN ${table}.${col.column_name} IS '${comments[col.column_name].replace(/'/g, "''")}';` + '\n';
    }
    ddlParts.push(ddl + '\n');
  }
  return ddlParts.join('\n');
}

async function loadSourceMaterial(db, vehicleId, sourceType) {
  const parts = [];
  const vRes = await db.query(`
    SELECT id, year, make, model, trim, vin, engine_type, engine_size, transmission,
           drivetrain, color, interior_color, mileage, description, sale_price, status
    FROM vehicles WHERE id = $1
  `, [vehicleId]);
  if (vRes.rows.length === 0) throw new Error(`Vehicle ${vehicleId} not found`);
  const v = vRes.rows[0];
  parts.push(`## VEHICLE IDENTITY\nYear: ${v.year}\nMake: ${v.make}\nModel: ${v.model}\nTrim: ${v.trim || 'unknown'}\nVIN: ${v.vin || 'unknown'}\nEngine Type: ${v.engine_type || 'unknown'}\nEngine Size: ${v.engine_size || 'unknown'}\nTransmission: ${v.transmission || 'unknown'}\nDrivetrain: ${v.drivetrain || 'unknown'}\nExterior Color: ${v.color || 'unknown'}\nInterior Color: ${v.interior_color || 'unknown'}\nMileage: ${v.mileage || 'unknown'}\nSale Price: ${v.sale_price ? '$' + v.sale_price : 'unknown'}\n`);

  if (sourceType === 'bat_listing' || sourceType === 'all') {
    const extRes = await db.query(`
      SELECT raw_extraction, total_fields FROM description_discoveries
      WHERE vehicle_id = $1 ORDER BY total_fields DESC NULLS LAST, discovered_at DESC LIMIT 1
    `, [vehicleId]);
    if (extRes.rows.length > 0) {
      parts.push(`## EXTRACTION (${extRes.rows[0].total_fields} fields)\n${JSON.stringify(extRes.rows[0].raw_extraction, null, 2)}\n`);
    }
    if (v.description) parts.push(`## LISTING DESCRIPTION\n${v.description.substring(0, 4000)}\n`);

    const feRes = await db.query(`
      SELECT field_name, proposed_value, source_confidence, source_type FROM field_evidence
      WHERE vehicle_id = $1 AND status = 'accepted' ORDER BY source_confidence DESC NULLS LAST LIMIT 100
    `, [vehicleId]);
    if (feRes.rows.length > 0) {
      parts.push(`## FIELD EVIDENCE (${feRes.rows.length} accepted facts)\n${feRes.rows.map(r => `- ${r.field_name}: ${r.proposed_value} (conf: ${r.source_confidence}, src: ${r.source_type})`).join('\n')}\n`);
    }
  }
  return parts.join('\n---\n\n');
}

// ============================================================
// LLM call — same prompt as fill-vehicle-form
// ============================================================

async function callModel(modelConfig, ddl, sourceMaterial, vehicleId, layerName) {
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
12. For numeric measurements, convert to the units specified in column comments (mm, cc, etc.).
13. If a component is mentioned but has few details, create a row with known values and NULL for the rest.

OUTPUT FORMAT: One INSERT per line, each ending with a semicolon.`;

  const userPrompt = `## TABLE SCHEMAS (Layer: ${layerName})\n${ddl}\n\n## SOURCE MATERIAL\n${sourceMaterial}\n\nGenerate INSERT statements to fill the tables above with data from the source material.`;

  if (modelConfig.provider === 'anthropic') {
    const response = await anthropic.messages.create({
      model: modelConfig.id,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return response.content[0].text;
  }

  throw new Error(`Unsupported provider: ${modelConfig.provider}`);
}

// ============================================================
// Parse INSERTs into structured field data
// ============================================================

function parseInserts(llmOutput) {
  const lines = llmOutput.split('\n').filter(l => l.trim().startsWith('INSERT'));
  return lines.map(line => {
    const tableMatch = line.match(/INSERT\s+INTO\s+(\w+)/i);
    return { table: tableMatch?.[1] || 'unknown', sql: line.trim().replace(/;?\s*$/, ';'), raw: line };
  }).filter(i => i.table !== 'unknown');
}

function extractFieldsFromInsert(sql) {
  const colMatch = sql.match(/\(([^)]+)\)\s*VALUES\s*\(/i);
  const valMatch = sql.match(/VALUES\s*\((.+)\);?\s*$/i);
  if (!colMatch || !valMatch) return {};

  const cols = colMatch[1].split(',').map(c => c.trim());
  // Simple value splitting (handles quoted strings with commas)
  const valStr = valMatch[1];
  const vals = [];
  let current = '';
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < valStr.length; i++) {
    const ch = valStr[i];
    if (ch === "'" && valStr[i - 1] !== '\\') inQuote = !inQuote;
    if (!inQuote && ch === '(') depth++;
    if (!inQuote && ch === ')') depth--;
    if (!inQuote && depth === 0 && ch === ',') {
      vals.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  vals.push(current.trim());

  const fields = {};
  for (let i = 0; i < cols.length; i++) {
    fields[cols[i]] = vals[i] || 'NULL';
  }
  return fields;
}

// ============================================================
// Diff and consensus
// ============================================================

function diffJuryResults(modelResults) {
  // modelResults: Array of { model, inserts: [{ table, sql, fields }] }
  const consensus = [];
  const divergences = [];
  const gaps = [];

  // Group by table
  const tableMap = {};
  for (const { model, inserts } of modelResults) {
    for (const insert of inserts) {
      if (!tableMap[insert.table]) tableMap[insert.table] = {};
      if (!tableMap[insert.table][model]) tableMap[insert.table][model] = [];
      tableMap[insert.table][model].push({
        fields: extractFieldsFromInsert(insert.sql),
        sql: insert.sql,
      });
    }
  }

  for (const [table, modelData] of Object.entries(tableMap)) {
    const models = Object.keys(modelData);

    if (models.length === 1) {
      // Only one model produced this — flag as low confidence
      const [model] = models;
      for (const row of modelData[model]) {
        divergences.push({
          table,
          type: 'single_model_only',
          model,
          sql: row.sql,
          fields: row.fields,
        });
      }
      continue;
    }

    // Multiple models produced rows for this table — compare fields
    // Take first row from each model for simplicity (could be expanded)
    const fieldSets = models.map(m => ({
      model: m,
      fields: modelData[m][0]?.fields || {},
      sql: modelData[m][0]?.sql,
    }));

    // Find all unique field names
    const allFields = new Set();
    for (const fs of fieldSets) {
      for (const f of Object.keys(fs.fields)) allFields.add(f);
    }

    const consensusFields = {};
    const divergentFields = {};

    for (const field of allFields) {
      if (['vehicle_id', 'id', 'created_at', 'updated_at'].includes(field)) continue;

      const values = fieldSets.map(fs => ({ model: fs.model, value: fs.fields[field] || 'NULL' }));
      const nonNull = values.filter(v => v.value !== 'NULL');

      if (nonNull.length === 0) {
        gaps.push({ table, field });
        continue;
      }

      // Check consensus (all non-null values match)
      const uniqueVals = [...new Set(nonNull.map(v => v.value))];
      if (uniqueVals.length === 1) {
        consensusFields[field] = uniqueVals[0];
      } else {
        divergentFields[field] = values;
      }
    }

    if (Object.keys(consensusFields).length > 0) {
      consensus.push({ table, fields: consensusFields, source_sql: fieldSets[0].sql });
    }
    if (Object.keys(divergentFields).length > 0) {
      divergences.push({ table, type: 'field_disagreement', fields: divergentFields });
    }
  }

  return { consensus, divergences, gaps };
}

// ============================================================
// Write results
// ============================================================

async function writeJuryDeliberations(db, vehicleId, layerName, modelResults, diffResult, dryRun) {
  // Create jury_deliberations table if not exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS jury_deliberations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      layer TEXT NOT NULL,
      table_name TEXT NOT NULL,
      field_name TEXT,
      verdict TEXT NOT NULL,
      consensus_value TEXT,
      model_values JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  if (dryRun) return;

  // Write consensus
  for (const c of diffResult.consensus) {
    for (const [field, value] of Object.entries(c.fields)) {
      await db.query(`
        INSERT INTO jury_deliberations (vehicle_id, layer, table_name, field_name, verdict, consensus_value)
        VALUES ($1, $2, $3, $4, 'consensus', $5)
      `, [vehicleId, layerName, c.table, field, value]);
    }
  }

  // Write divergences
  for (const d of diffResult.divergences) {
    if (d.type === 'field_disagreement') {
      for (const [field, values] of Object.entries(d.fields)) {
        await db.query(`
          INSERT INTO jury_deliberations (vehicle_id, layer, table_name, field_name, verdict, model_values)
          VALUES ($1, $2, $3, $4, 'divergence', $5)
        `, [vehicleId, layerName, d.table, field, JSON.stringify(values)]);
      }
    } else {
      await db.query(`
        INSERT INTO jury_deliberations (vehicle_id, layer, table_name, field_name, verdict, model_values)
        VALUES ($1, $2, $3, NULL, 'single_model', $4)
      `, [vehicleId, layerName, d.table, JSON.stringify({ model: d.model, sql: d.sql })]);
    }
  }

  // Write gaps
  for (const g of diffResult.gaps) {
    await db.query(`
      INSERT INTO jury_deliberations (vehicle_id, layer, table_name, field_name, verdict)
      VALUES ($1, $2, $3, $4, 'gap')
    `, [vehicleId, layerName, g.table, g.field]);
  }
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

  if (!vehicleId) {
    console.error('Usage: dotenvx run -- node scripts/jury-fill.mjs --vehicle-id <uuid> --source bat_listing [--layer engine] [--all-layers] [--dry-run]');
    console.error('\nModels in jury:', JURY_MODELS.map(m => m.name).join(', '));
    process.exit(1);
  }

  const db = await getDb();

  try {
    console.log(`\n=== JURY FILL (Multi-Model Ensemble) ===`);
    console.log(`Vehicle: ${vehicleId}`);
    console.log(`Source:  ${sourceType}`);
    console.log(`Models:  ${JURY_MODELS.map(m => m.name).join(', ')}`);
    console.log(`Mode:    ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

    const sourceMaterial = await loadSourceMaterial(db, vehicleId, sourceType);
    console.log(`Source material: ${sourceMaterial.length} chars\n`);

    const layersToFill = allLayers ? Object.keys(LAYERS) : layerName ? [layerName] : ['engine'];

    for (const layer of layersToFill) {
      if (!LAYERS[layer]) { console.error(`Unknown layer: ${layer}`); continue; }

      const tables = LAYERS[layer];
      console.log(`--- Layer: ${layer} (${tables.length} tables) ---`);

      const ddl = await loadTableDDL(db, tables);
      if (!ddl.trim()) { console.log('  No tables found.\n'); continue; }

      // Call each model
      const modelResults = [];
      for (const model of JURY_MODELS) {
        console.log(`  Calling ${model.name}...`);
        try {
          const output = await callModel(model, ddl, sourceMaterial, vehicleId, layer);
          const inserts = parseInserts(output);
          console.log(`    → ${inserts.length} INSERTs`);
          modelResults.push({ model: model.name, inserts });
        } catch (err) {
          console.error(`    → ERROR: ${err.message}`);
          modelResults.push({ model: model.name, inserts: [] });
        }
      }

      // Diff
      const diff = diffJuryResults(modelResults);
      console.log(`\n  Jury verdict:`);
      console.log(`    Consensus:   ${diff.consensus.reduce((s, c) => s + Object.keys(c.fields).length, 0)} fields`);
      console.log(`    Divergences: ${diff.divergences.length} items`);
      console.log(`    Gaps:        ${diff.gaps.length} fields`);

      // Write
      if (!dryRun) {
        // Execute consensus INSERTs
        let success = 0, failed = 0;
        for (const c of diff.consensus) {
          try {
            await db.query(c.source_sql);
            success++;
          } catch (err) {
            failed++;
            console.error(`    INSERT failed [${c.table}]: ${err.message}`);
          }
        }
        console.log(`\n    Executed: ${success} success, ${failed} failed`);
      }

      await writeJuryDeliberations(db, vehicleId, layer, modelResults, diff, dryRun);
      console.log(`    Deliberations recorded.\n`);
    }
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
