#!/usr/bin/env node
/**
 * Schema-Guided Extraction — The Core Digital Twin Machine
 *
 * The DDL IS the prompt. The schema IS the specification.
 *
 * Flow:
 * 1. Read target table DDL (CREATE TABLE + CHECK constraints + column comments)
 * 2. Gather source material for a vehicle (descriptions, comments, field_evidence, observations)
 * 3. Send DDL + source material to LLM → get INSERT statements back
 * 4. Validate INSERTs against constraints
 * 5. Execute INSERTs with provenance tracking
 *
 * Usage:
 *   dotenvx run -- node scripts/schema-guided-extract.mjs --vehicle-id <uuid> --tables engine_blocks,engine_heads
 *   dotenvx run -- node scripts/schema-guided-extract.mjs --vehicle-id <uuid> --subsystem engine
 *   dotenvx run -- node scripts/schema-guided-extract.mjs --vehicle-id <uuid> --subsystem engine --provider kimi
 *   dotenvx run -- node scripts/schema-guided-extract.mjs --vehicle-id <uuid> --subsystem engine --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const DRY_RUN = args.includes('--dry-run');
const VEHICLE_ID = getArg('vehicle-id', null);
const SUBSYSTEM = getArg('subsystem', 'engine');
const PROVIDER = getArg('provider', 'qwen3');
const TABLES = getArg('tables', null);

// ── Subsystem → Table mapping ──

const SUBSYSTEMS = {
  engine: [
    'engine_blocks', 'engine_heads', 'engine_crankshafts', 'engine_camshafts',
    'engine_carburetors', 'engine_intake_manifolds', 'engine_distributors',
    'engine_oil_systems', 'engine_pistons', 'engine_connecting_rods',
    'engine_exhaust_manifolds', 'engine_fuel_injection', 'engine_cooling_interfaces',
    'engine_accessories', 'engine_hardware', 'engine_cylinder_measurements',
  ],
  // Future subsystems:
  // transmission: ['transmission_cases', 'transmission_gears', ...],
  // axle: ['axle_housings', 'axle_shafts', ...],
  // suspension: ['suspension_front', 'suspension_rear', ...],
  // electrical: ['electrical_harness', 'electrical_alternator', ...],
  // body: ['body_panels', 'body_trim', 'body_glass', ...],
};

// ── LLM Provider dispatch ──

async function callLLM(systemPrompt, userPrompt) {
  if (PROVIDER === 'qwen3' || PROVIDER === 'ollama') {
    return callOllama('qwen3:30b-a3b', systemPrompt, userPrompt);
  }
  if (PROVIDER === 'kimi') {
    return callOllama('kimi-k2.5:cloud', systemPrompt, userPrompt);
  }
  if (PROVIDER === 'qwen2.5') {
    return callOllama('qwen2.5:7b', systemPrompt, userPrompt);
  }
  if (PROVIDER === 'modal') {
    return callModal(systemPrompt, userPrompt);
  }
  throw new Error(`Unknown provider: ${PROVIDER}`);
}

async function callOllama(model, system, user) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    signal: controller.signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      options: { temperature: 0, num_predict: 8192 },
      keep_alive: '10m',
    }),
  });
  clearTimeout(timeout);
  const data = await res.json();
  return data.message?.content || '';
}

async function callModal(system, user) {
  const res = await fetch('https://sss97133--nuke-vllm-serve.modal.run/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 8192,
      temperature: 0,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── DDL Extraction ──

async function execSQL(sql) {
  const base = SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/functions/v1/execute-raw-sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    // Fallback: PostgREST RPC
    const res2 = await fetch(`${base}/rest/v1/rpc/execute_sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
      body: JSON.stringify({ query: sql }),
    });
    if (!res2.ok) throw new Error(`SQL failed: ${res2.status}`);
    return res2.json();
  }
  return res.json();
}

async function getTableDDL(tableName) {
  const cols = await execSQL(`
    SELECT column_name, data_type, is_nullable, column_default,
      col_description('"${tableName}"'::regclass, ordinal_position) as comment
    FROM information_schema.columns
    WHERE table_name = '${tableName}' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);

  const checks = await execSQL(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = '"${tableName}"'::regclass AND contype = 'c'
  `);

  const fks = await execSQL(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = '"${tableName}"'::regclass AND contype = 'f'
  `);

  // Format as CREATE TABLE DDL
  let ddl = `CREATE TABLE ${tableName} (\n`;
  for (const col of cols) {
    ddl += `  ${col.column_name} ${col.data_type}`;
    if (col.is_nullable === 'NO') ddl += ' NOT NULL';
    if (col.column_default) ddl += ` DEFAULT ${col.column_default}`;
    if (col.comment) ddl += ` -- ${col.comment}`;
    ddl += ',\n';
  }
  for (const chk of (checks || [])) {
    ddl += `  CONSTRAINT ${chk.conname} ${chk.def},\n`;
  }
  for (const fk of (fks || [])) {
    ddl += `  CONSTRAINT ${fk.conname} ${fk.def},\n`;
  }
  ddl = ddl.replace(/,\n$/, '\n') + ');';
  return ddl;
}

// ── Source Material Gathering ──

async function gatherSourceMaterial(vehicleId) {
  const material = {};

  // Vehicle identity
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model, vin, engine, transmission, drivetrain, description')
    .eq('id', vehicleId)
    .single();
  material.identity = vehicle;

  // Description discoveries (rich AI extractions)
  const { data: descDisc } = await supabase
    .from('description_discoveries')
    .select('raw_extraction')
    .eq('vehicle_id', vehicleId)
    .order('discovered_at', { ascending: false })
    .limit(3);
  if (descDisc?.length) {
    material.description_extractions = descDisc.map(d => d.raw_extraction);
  }

  // Field evidence (cited facts)
  const { data: evidence } = await supabase
    .from('field_evidence')
    .select('field_name, proposed_value, source_type, source_confidence')
    .eq('vehicle_id', vehicleId)
    .order('source_confidence', { ascending: false })
    .limit(100);
  if (evidence?.length) {
    material.field_evidence = evidence;
  }

  // Vehicle observations (raw text)
  const { data: obs } = await supabase
    .from('vehicle_observations')
    .select('kind, content_text, confidence_score, observed_at')
    .eq('vehicle_id', vehicleId)
    .eq('is_superseded', false)
    .not('content_text', 'is', null)
    .order('confidence_score', { ascending: false })
    .limit(20);
  if (obs?.length) {
    material.observations = obs;
  }

  // Comment discoveries (sentiment + facts from comments)
  const { data: commDisc } = await supabase
    .from('comment_discoveries')
    .select('raw_extraction')
    .eq('vehicle_id', vehicleId)
    .limit(3);
  if (commDisc?.length) {
    material.comment_extractions = commDisc.map(d => d.raw_extraction);
  }

  return material;
}

// ── The Core: Schema-Guided Generation ──

function buildSystemPrompt() {
  return `You are a vehicle data extraction specialist. You extract structured facts from source material and output ONLY valid PostgreSQL INSERT statements.

RULES:
1. Output ONLY INSERT statements. No explanations. No markdown. No comments.
2. Every value must come from the source material. If a value is not mentioned, use NULL.
3. Use the exact column names from the DDL.
4. Respect all CHECK constraints — only use allowed enum values.
5. The vehicle_id is provided — use it in every INSERT.
6. For boolean columns, use true/false based on evidence. If uncertain, use NULL.
7. For numeric measurements, convert to the DDL's unit (mm, cc, etc.).
8. For casting_number/part_number fields, extract the exact alphanumeric code mentioned.
9. Set provenance to 'original' if source says original/factory/stock, 'aftermarket' if modified, 'unknown' if unclear.
10. Set condition_grade based on described condition, or 'unknown' if not mentioned.
11. Set is_original to true if factory/original, false if replaced/upgraded, NULL if unknown.
12. Use ON CONFLICT DO NOTHING at the end of each INSERT.
13. If the source material doesn't contain enough information for a table, output nothing for that table.`;
}

function buildUserPrompt(vehicleId, tableDDLs, sourceMaterial) {
  let prompt = `VEHICLE ID: ${vehicleId}\n\n`;
  prompt += `=== SOURCE MATERIAL ===\n`;
  prompt += JSON.stringify(sourceMaterial, null, 2).slice(0, 12000); // Cap at 12K chars
  prompt += `\n\n=== TARGET SCHEMAS (fill these with INSERTs) ===\n\n`;
  for (const [table, ddl] of Object.entries(tableDDLs)) {
    prompt += `--- ${table} ---\n${ddl}\n\n`;
  }
  prompt += `\nGenerate INSERT statements for the tables above using ONLY facts from the source material. Output raw SQL only.`;
  return prompt;
}

// ── INSERT Validation & Execution ──

function extractInserts(llmOutput) {
  // Parse INSERT statements from LLM output
  const inserts = [];
  const lines = llmOutput.split('\n');
  let current = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toUpperCase().startsWith('INSERT INTO')) {
      if (current) inserts.push(current.trim());
      current = trimmed;
    } else if (current) {
      current += ' ' + trimmed;
      if (trimmed.endsWith(';')) {
        inserts.push(current.trim());
        current = '';
      }
    }
  }
  if (current) inserts.push(current.trim());

  return inserts.filter(s => s.length > 10);
}

async function executeInsert(sql) {
  try {
    await execSQL(sql);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Main ──

async function main() {
  if (!VEHICLE_ID) {
    console.error('Usage: --vehicle-id <uuid> [--subsystem engine] [--provider qwen3|kimi|modal] [--dry-run]');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('  Schema-Guided Extraction — Digital Twin Machine');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Vehicle: ${VEHICLE_ID}`);
  console.log(`  Subsystem: ${SUBSYSTEM}`);
  console.log(`  Provider: ${PROVIDER}`);
  if (DRY_RUN) console.log('  MODE: DRY RUN\n');

  // 1. Determine target tables
  const targetTables = TABLES
    ? TABLES.split(',')
    : SUBSYSTEMS[SUBSYSTEM] || [];

  if (!targetTables.length) {
    console.error(`No tables for subsystem: ${SUBSYSTEM}`);
    process.exit(1);
  }

  // 2. Get DDL for each table
  console.log(`\n  Extracting DDL for ${targetTables.length} tables...`);
  const tableDDLs = {};
  for (const table of targetTables) {
    try {
      tableDDLs[table] = await getTableDDL(table);
      console.log(`    ✓ ${table}`);
    } catch {
      console.log(`    ✗ ${table} (not found)`);
    }
  }

  // 3. Gather source material
  console.log('\n  Gathering source material...');
  const material = await gatherSourceMaterial(VEHICLE_ID);
  // Also fetch vehicle directly via REST as fallback
  if (!material.identity?.year) {
    const base = SUPABASE_URL.replace(/\/$/, '');
    const vRes = await fetch(`${base}/rest/v1/vehicles?id=eq.${VEHICLE_ID}&select=year,make,model,vin,description,highlights,equipment,modifications,known_flaws,recent_service_history&limit=1`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    });
    const vData = await vRes.json();
    if (vData?.[0]) material.identity = vData[0];
  }
  const identity = material.identity;
  console.log(`    Vehicle: ${identity?.year} ${identity?.make} ${identity?.model}`);
  console.log(`    Evidence: ${material.field_evidence?.length || 0} facts`);
  console.log(`    Observations: ${material.observations?.length || 0}`);
  console.log(`    Description extractions: ${material.description_extractions?.length || 0}`);

  // 4. Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(VEHICLE_ID, tableDDLs, material);

  console.log(`\n  Prompt size: ${(userPrompt.length / 1024).toFixed(1)} KB`);
  console.log(`  Calling ${PROVIDER}...`);

  // 5. Call LLM
  const startTime = Date.now();
  const response = await callLLM(systemPrompt, userPrompt);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Response: ${response.length} chars in ${elapsed}s`);

  // 6. Parse INSERTs
  const inserts = extractInserts(response);
  console.log(`  Parsed: ${inserts.length} INSERT statements\n`);

  if (inserts.length === 0) {
    console.log('  No INSERTs generated. Source material may lack detail for this subsystem.');
    console.log('\n  Raw LLM response (first 500 chars):');
    console.log('  ' + response.slice(0, 500));
    return;
  }

  // 7. Execute or display
  let executed = 0, failed = 0;
  for (const sql of inserts) {
    const table = sql.match(/INSERT INTO (\w+)/i)?.[1] || '?';
    if (DRY_RUN) {
      console.log(`  [DRY] ${table}: ${sql.slice(0, 120)}...`);
    } else {
      const result = await executeInsert(sql);
      if (result.ok) {
        console.log(`  ✓ ${table}`);
        executed++;
      } else {
        console.log(`  ✗ ${table}: ${result.error}`);
        failed++;
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Results: ${executed} executed, ${failed} failed, ${inserts.length} total`);
  console.log(`  Provider: ${PROVIDER} | Time: ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
