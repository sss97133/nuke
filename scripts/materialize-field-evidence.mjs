#!/usr/bin/env node
/**
 * materialize-field-evidence.mjs
 *
 * Materializes field_evidence into the vehicles table.
 * Reads pending field_evidence grouped by (vehicle_id, field_name),
 * applies data_source_trust_hierarchy to select the winning value,
 * writes to vehicles columns, records provenance, and marks evidence as accepted/superseded.
 *
 * Usage:
 *   dotenvx run -- node scripts/materialize-field-evidence.mjs           # dry-run (default)
 *   dotenvx run -- node scripts/materialize-field-evidence.mjs --apply   # actually write
 *   dotenvx run -- node scripts/materialize-field-evidence.mjs --limit 500
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;
const limitIdx = args.indexOf('--limit');
const VEHICLE_LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : null;
const BATCH_SIZE = 100; // vehicles per chunk

// ─── Field name → vehicles column mapping ────────────────────────────────────
// Only fields that map directly to a vehicles column are materialized.
// Fields like body_condition, paint_condition, etc. are evidence-only (no direct column).
const FIELD_TO_COLUMN = {
  year: { column: 'year', type: 'integer' },
  make: { column: 'make', type: 'text' },
  model: { column: 'model', type: 'text' },
  trim: { column: 'trim', type: 'text' },
  vin: { column: 'vin', type: 'text' },
  mileage: { column: 'mileage', type: 'integer' },
  color: { column: 'color', type: 'text' },
  exterior_color: { column: 'color', type: 'text' },  // maps to vehicles.color
  interior_color: { column: 'interior_color', type: 'text' },
  transmission: { column: 'transmission', type: 'text' },
  engine_type: { column: 'engine_type', type: 'text' },
  engine_size: { column: 'engine_size', type: 'text' },
  fuel_type: { column: 'fuel_type', type: 'text' },
  drivetrain: { column: 'drivetrain', type: 'text' },
  body_style: { column: 'body_style', type: 'text' },
  doors: { column: 'doors', type: 'integer' },
  horsepower: { column: 'horsepower', type: 'integer' },
  torque: { column: 'torque', type: 'integer' },
  asking_price: { column: 'asking_price', type: 'numeric' },
  sale_price: { column: 'sale_price', type: 'integer' },
};

// Fields that exist in field_evidence but have no vehicles column target.
// These are recorded in provenance but not materialized.
const EVIDENCE_ONLY_FIELDS = new Set([
  'body_condition', 'interior_condition', 'paint_condition',
  'rust_condition', 'mechanical_condition', 'matching_numbers',
  'option_codes', 'production_count',
]);

// ─── Load trust hierarchy ────────────────────────────────────────────────────
let trustMap = {};

async function loadTrustHierarchy() {
  const { data, error } = await supabase
    .from('data_source_trust_hierarchy')
    .select('source_type, trust_level')
    .order('trust_level', { ascending: false });

  if (error) throw new Error(`Failed to load trust hierarchy: ${error.message}`);

  for (const row of data) {
    trustMap[row.source_type] = row.trust_level;
  }
  console.log(`  Loaded ${data.length} trust hierarchy entries`);
}

// ─── Select winner from competing evidence ───────────────────────────────────
function selectWinner(evidenceRows) {
  // Sort by: trust_level DESC, source_confidence DESC, extracted_at DESC
  const scored = evidenceRows.map(row => ({
    ...row,
    trust_level: trustMap[row.source_type] ?? 0,
  }));

  scored.sort((a, b) => {
    if (b.trust_level !== a.trust_level) return b.trust_level - a.trust_level;
    if (b.source_confidence !== a.source_confidence) return b.source_confidence - a.source_confidence;
    return new Date(b.extracted_at || b.created_at) - new Date(a.extracted_at || a.created_at);
  });

  return scored[0];
}

// ─── Cast value to column type ───────────────────────────────────────────────
function castValue(value, type) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!s) return null;

  switch (type) {
    case 'integer': {
      // Extract numeric portion (handles "32,000 miles" etc.)
      const cleaned = s.replace(/[,\s]/g, '').match(/-?\d+/);
      if (!cleaned) return null;
      const n = parseInt(cleaned[0]);
      return isNaN(n) ? null : n;
    }
    case 'numeric': {
      const cleaned = s.replace(/[$,\s]/g, '').match(/-?\d+(\.\d+)?/);
      if (!cleaned) return null;
      const n = parseFloat(cleaned[0]);
      return isNaN(n) ? null : n;
    }
    case 'text':
      return s;
    default:
      return s;
  }
}

// ─── Fetch pending evidence in batches of distinct vehicle_ids ────────────────
async function fetchPendingVehicleIds() {
  // Paginate through all pending evidence to collect distinct vehicle_ids.
  // Supabase JS has a default row limit of 1000, so we must paginate.
  const seen = new Set();
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  console.log('  Fetching distinct vehicle IDs from pending evidence...');

  while (hasMore) {
    const { data, error } = await supabase
      .from('field_evidence')
      .select('vehicle_id')
      .eq('status', 'pending')
      .order('vehicle_id')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to fetch vehicle IDs at offset ${offset}: ${error.message}`);

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of data) {
      seen.add(row.vehicle_id);
    }

    offset += data.length;
    hasMore = data.length === PAGE_SIZE;

    // If we have a vehicle limit and enough unique IDs, stop early
    if (VEHICLE_LIMIT && seen.size >= VEHICLE_LIMIT) break;
  }

  console.log(`  Scanned ${offset} evidence rows to find ${seen.size} unique vehicles`);

  let ids = Array.from(seen).sort();
  if (VEHICLE_LIMIT) ids = ids.slice(0, VEHICLE_LIMIT);
  return ids;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Materialize Field Evidence ===${DRY_RUN ? ' [DRY RUN]' : ' [APPLY MODE]'}`);
  console.log(`  Batch size: ${BATCH_SIZE} vehicles per chunk`);
  if (VEHICLE_LIMIT) console.log(`  Vehicle limit: ${VEHICLE_LIMIT}`);

  // Load trust hierarchy
  await loadTrustHierarchy();

  // Get distinct vehicle IDs with pending evidence
  const vehicleIds = await fetchPendingVehicleIds();
  console.log(`  Found ${vehicleIds.length} vehicles with pending evidence\n`);

  if (vehicleIds.length === 0) {
    console.log('  Nothing to materialize.');
    return;
  }

  // Stats
  const stats = {
    vehiclesProcessed: 0,
    fieldsMateriaiized: 0,
    fieldsMapped: 0,
    fieldsEvidenceOnly: 0,
    fieldsSkippedNoColumn: 0,
    conflictsResolved: 0,
    evidenceAccepted: 0,
    evidenceSuperseded: 0,
    errors: 0,
    fieldCounts: {},
    sourceWins: {},
  };

  // Process in batches
  const totalBatches = Math.ceil(vehicleIds.length / BATCH_SIZE);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * BATCH_SIZE;
    const batchVehicleIds = vehicleIds.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = batchIdx + 1;

    console.log(`  Batch ${batchNum}/${totalBatches} (${batchVehicleIds.length} vehicles)...`);

    // Fetch all pending evidence for this batch of vehicles
    const { data: evidence, error: evidenceError } = await supabase
      .from('field_evidence')
      .select('id, vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, extracted_at, created_at, supporting_signals, contradicting_signals')
      .eq('status', 'pending')
      .in('vehicle_id', batchVehicleIds);

    if (evidenceError) {
      console.error(`    ERROR fetching evidence: ${evidenceError.message}`);
      stats.errors++;
      continue;
    }

    if (!evidence || evidence.length === 0) {
      console.log('    No pending evidence in this batch.');
      continue;
    }

    // Group by (vehicle_id, field_name)
    const grouped = {};
    for (const row of evidence) {
      const key = `${row.vehicle_id}::${row.field_name}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }

    // Process each (vehicle_id, field_name) group
    const vehicleUpdates = {}; // vehicle_id -> { column: value }
    const provenanceRecords = []; // vehicle_field_provenance upserts
    const acceptedIds = [];
    const supersededIds = [];

    for (const [key, rows] of Object.entries(grouped)) {
      const [vehicleId, fieldName] = key.split('::');
      const mapping = FIELD_TO_COLUMN[fieldName];

      // Skip fields that have no column mapping and aren't evidence-only
      if (!mapping && !EVIDENCE_ONLY_FIELDS.has(fieldName)) {
        stats.fieldsSkippedNoColumn++;
        continue;
      }

      // Select winner
      const winner = selectWinner(rows);
      const losers = rows.filter(r => r.id !== winner.id);

      // Track conflicts
      if (rows.length > 1) {
        stats.conflictsResolved++;
      }

      // If there is a column mapping, prepare the vehicle update
      if (mapping) {
        const castedValue = castValue(winner.proposed_value, mapping.type);
        if (castedValue !== null) {
          if (!vehicleUpdates[vehicleId]) vehicleUpdates[vehicleId] = {};
          vehicleUpdates[vehicleId][mapping.column] = castedValue;
          stats.fieldsMapped++;
          stats.fieldCounts[fieldName] = (stats.fieldCounts[fieldName] || 0) + 1;
        }
      } else {
        stats.fieldsEvidenceOnly++;
      }

      // Track source wins
      const srcType = winner.source_type || 'unknown';
      stats.sourceWins[srcType] = (stats.sourceWins[srcType] || 0) + 1;

      // Prepare provenance record
      provenanceRecords.push({
        vehicle_id: vehicleId,
        field_name: fieldName,
        current_value: winner.proposed_value,
        total_confidence: winner.trust_level ?? (trustMap[winner.source_type] || 0),
        confidence_factors: {
          trust_level: trustMap[winner.source_type] || 0,
          source_confidence: winner.source_confidence,
          competing_evidence: rows.length,
          extraction_context: winner.extraction_context,
        },
        primary_source: winner.source_type,
        supporting_sources: rows.length > 1
          ? rows.filter(r => r.id !== winner.id && r.proposed_value === winner.proposed_value).map(r => r.source_type)
          : [],
        conflicting_sources: rows.length > 1
          ? Object.fromEntries(
              rows.filter(r => r.id !== winner.id && r.proposed_value !== winner.proposed_value)
                .map(r => [r.source_type, r.proposed_value])
            )
          : null,
        updated_at: new Date().toISOString(),
      });

      // Mark winner as accepted, losers as superseded
      acceptedIds.push(winner.id);
      for (const loser of losers) {
        supersededIds.push(loser.id);
      }
    }

    stats.evidenceAccepted += acceptedIds.length;
    stats.evidenceSuperseded += supersededIds.length;

    if (DRY_RUN) {
      const updateCount = Object.keys(vehicleUpdates).length;
      console.log(`    Would update ${updateCount} vehicles, ${provenanceRecords.length} provenance records`);
      console.log(`    Would accept ${acceptedIds.length} evidence rows, supersede ${supersededIds.length}`);
      stats.vehiclesProcessed += batchVehicleIds.length;
      stats.fieldsMateriaiized += Object.values(vehicleUpdates).reduce((sum, u) => sum + Object.keys(u).length, 0);
      continue;
    }

    // ─── APPLY: Write to vehicles ─────────────────────────────────────────
    let batchUpdateCount = 0;
    for (const [vehicleId, updates] of Object.entries(vehicleUpdates)) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicleId);

      if (updateError) {
        console.error(`    ERROR updating vehicle ${vehicleId}: ${updateError.message}`);
        stats.errors++;
      } else {
        batchUpdateCount++;
        stats.fieldsMateriaiized += Object.keys(updates).length;
      }
    }

    // ─── APPLY: Upsert provenance ─────────────────────────────────────────
    if (provenanceRecords.length > 0) {
      // Batch in chunks of 500 for upsert
      for (let i = 0; i < provenanceRecords.length; i += 500) {
        const chunk = provenanceRecords.slice(i, i + 500);
        const { error: provError } = await supabase
          .from('vehicle_field_provenance')
          .upsert(chunk, { onConflict: 'vehicle_id,field_name' });

        if (provError) {
          console.error(`    ERROR upserting provenance: ${provError.message}`);
          stats.errors++;
        }
      }
    }

    // ─── APPLY: Mark evidence accepted/superseded ─────────────────────────
    if (acceptedIds.length > 0) {
      for (let i = 0; i < acceptedIds.length; i += 500) {
        const chunk = acceptedIds.slice(i, i + 500);
        const { error: accError } = await supabase
          .from('field_evidence')
          .update({ status: 'accepted', assigned_at: new Date().toISOString(), assigned_by: 'materialize-field-evidence' })
          .in('id', chunk);

        if (accError) {
          console.error(`    ERROR marking accepted: ${accError.message}`);
          stats.errors++;
        }
      }
    }

    if (supersededIds.length > 0) {
      for (let i = 0; i < supersededIds.length; i += 500) {
        const chunk = supersededIds.slice(i, i + 500);
        const { error: supError } = await supabase
          .from('field_evidence')
          .update({ status: 'superseded', assigned_at: new Date().toISOString(), assigned_by: 'materialize-field-evidence' })
          .in('id', chunk);

        if (supError) {
          console.error(`    ERROR marking superseded: ${supError.message}`);
          stats.errors++;
        }
      }
    }

    // Check lock impact after writes
    const { data: lockData } = await supabase.rpc('exec_sql', {
      query: "SELECT count(*) as lock_count FROM pg_stat_activity WHERE wait_event_type='Lock'"
    }).catch(() => ({ data: null }));

    if (lockData && lockData[0]?.lock_count > 0) {
      console.log(`    WARNING: ${lockData[0].lock_count} queries waiting on locks — pausing extra`);
      await sleep(1000);
    }

    stats.vehiclesProcessed += batchVehicleIds.length;
    console.log(`    Updated ${batchUpdateCount} vehicles`);

    // pg_sleep(0.1) between batches
    if (batchIdx < totalBatches - 1) {
      await sleep(100);
    }
  }

  // ─── Report ─────────────────────────────────────────────────────────────
  console.log('\n=== Results ===');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLIED'}`);
  console.log(`  Vehicles processed: ${stats.vehiclesProcessed}`);
  console.log(`  Fields materialized: ${stats.fieldsMateriaiized}`);
  console.log(`  Fields mapped to columns: ${stats.fieldsMapped}`);
  console.log(`  Fields evidence-only (no column): ${stats.fieldsEvidenceOnly}`);
  console.log(`  Fields skipped (unmapped): ${stats.fieldsSkippedNoColumn}`);
  console.log(`  Conflicts resolved: ${stats.conflictsResolved}`);
  console.log(`  Evidence accepted: ${stats.evidenceAccepted}`);
  console.log(`  Evidence superseded: ${stats.evidenceSuperseded}`);
  console.log(`  Errors: ${stats.errors}`);

  if (Object.keys(stats.fieldCounts).length > 0) {
    console.log('\n  Top fields materialized:');
    const sorted = Object.entries(stats.fieldCounts).sort((a, b) => b[1] - a[1]);
    for (const [field, count] of sorted.slice(0, 15)) {
      console.log(`    ${field}: ${count}`);
    }
  }

  if (Object.keys(stats.sourceWins).length > 0) {
    console.log('\n  Winning sources:');
    const sorted = Object.entries(stats.sourceWins).sort((a, b) => b[1] - a[1]);
    for (const [source, count] of sorted) {
      console.log(`    ${source}: ${count}`);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
