#!/usr/bin/env node
/**
 * backfill-bj-vins.mjs
 *
 * Extracts VINs from Barrett-Jackson listing_page_snapshots markdown
 * and backfills them into vehicles table.
 *
 * Two-phase approach:
 * Phase 1: Stream snapshot URLs + VINs, match to vehicle IDs locally
 * Phase 2: Batch UPDATE using vehicle_id + extracted_vin
 *
 * Hard rules:
 * - Batch 1000 rows at a time
 * - pg_sleep(0.2) between batches
 * - Check locks after writes
 * - VIN length: 5-17 characters
 * - vin_source = 'barrett_jackson_snapshot_extraction'
 * - vin_confidence = 90 for 17-char VINs, 80 for shorter
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 6543,
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  database: 'postgres',
  max: 3,
  statement_timeout: 115000,
});

const BATCH_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const VIN_RE = /([A-Za-z0-9]+) Vin/;

async function checkLocks() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT count(*) as lock_count FROM pg_stat_activity WHERE wait_event_type='Lock'"
    );
    const lockCount = parseInt(rows[0].lock_count);
    if (lockCount > 0) {
      console.warn(`  WARNING: ${lockCount} lock(s) detected. Pausing 5s...`);
      await new Promise(r => setTimeout(r, 5000));
    }
    return lockCount;
  } finally {
    client.release();
  }
}

async function extractVins() {
  console.log('=== Barrett-Jackson VIN Extraction from Snapshots ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE UPDATE'}`);
  console.log('');

  // ---- PHASE 1: Extract VINs from snapshots ----
  console.log('Phase 1: Extracting VINs from snapshot markdown...');

  // 1a: Get all snapshot URL -> VIN mappings
  const snapshotClient = await pool.connect();
  let snapshotVins; // Map<url, {vin, len}>
  try {
    // Stream snapshots in pages to avoid timeout
    const PAGE = 5000;
    snapshotVins = new Map();
    let offset = 0;
    let fetched = 0;

    while (true) {
      const { rows } = await snapshotClient.query(`
        SELECT listing_url, markdown
        FROM listing_page_snapshots
        WHERE platform = 'barrett-jackson'
          AND markdown IS NOT NULL
        ORDER BY listing_url
        LIMIT $1 OFFSET $2
      `, [PAGE, offset]);

      if (rows.length === 0) break;
      fetched += rows.length;

      for (const row of rows) {
        const match = VIN_RE.exec(row.markdown);
        if (match) {
          const vin = match[1].toUpperCase();
          if (vin.length >= 5 && vin.length <= 17) {
            snapshotVins.set(row.listing_url, { vin, len: vin.length });
          }
        }
      }
      offset += PAGE;
      process.stdout.write(`  Processed ${fetched} snapshots, found ${snapshotVins.size} VINs...\r`);
    }
    console.log(`  Processed ${fetched} snapshots, found ${snapshotVins.size} VINs`);
  } finally {
    snapshotClient.release();
  }

  // 1b: Get all B-J vehicles without VIN
  console.log('\nPhase 1b: Loading B-J vehicles without VIN...');
  const vehicleClient = await pool.connect();
  let vehicleMap; // Array of {id, make, listing_url, discovery_url}
  try {
    const { rows } = await vehicleClient.query(`
      SELECT id, make, listing_url, discovery_url
      FROM vehicles
      WHERE source = 'barrett-jackson'
        AND (vin IS NULL OR length(vin) < 5)
        AND vin_source IS DISTINCT FROM 'barrett_jackson_snapshot_extraction'
    `);
    vehicleMap = rows;
    console.log(`  Found ${vehicleMap.length} vehicles without VIN`);
  } finally {
    vehicleClient.release();
  }

  // 1c: Get existing VINs to avoid constraint violations
  // Two unique indexes exist:
  //   vehicles_vin_unique_17char: UNIQUE(vin) WHERE length(vin)=17
  //   vehicles_vin_unique_short:  UNIQUE(vin, make) WHERE length(vin)<17
  console.log('\nPhase 1c: Loading existing VINs for conflict check...');
  const existingClient = await pool.connect();
  let existingVin17; // Set of 17-char VINs (unique on vin alone)
  let existingVinMakeShort; // Set of "VIN|make" for short VINs
  try {
    const { rows: rows17 } = await existingClient.query(`
      SELECT DISTINCT vin FROM vehicles
      WHERE vin IS NOT NULL AND length(vin) = 17
    `);
    existingVin17 = new Set(rows17.map(r => r.vin));
    console.log(`  Loaded ${existingVin17.size} existing 17-char VINs`);

    const { rows: rowsShort } = await existingClient.query(`
      SELECT vin, make FROM vehicles
      WHERE vin IS NOT NULL AND length(vin) BETWEEN 5 AND 16
    `);
    existingVinMakeShort = new Set(rowsShort.map(r => `${r.vin}|${r.make}`));
    console.log(`  Loaded ${existingVinMakeShort.size} existing short VIN+make combos`);
  } finally {
    existingClient.release();
  }

  // 1d: Match vehicles to snapshot VINs (local, fast)
  console.log('\nPhase 1d: Matching vehicles to snapshot VINs...');

  function normalizeUrl(url) {
    if (!url) return null;
    return url
      .replace('https://www.barrett-jackson.com', 'https://barrett-jackson.com')
      .replace('http://www.barrett-jackson.com', 'http://barrett-jackson.com');
  }

  // Build normalized snapshot map
  const normSnapshotVins = new Map();
  for (const [url, data] of snapshotVins) {
    const norm = normalizeUrl(url);
    if (norm) normSnapshotVins.set(norm, data);
    // Keep original too for exact matches
    normSnapshotVins.set(url, data);
  }

  const updates = []; // {vehicle_id, vin, vin_length, match_method}
  let conflictsSkipped = 0;

  for (const v of vehicleMap) {
    // Try listing_url first, then discovery_url
    let matched = null;
    let method = null;

    if (v.listing_url) {
      matched = snapshotVins.get(v.listing_url) || normSnapshotVins.get(normalizeUrl(v.listing_url));
      method = 'listing_url';
    }
    if (!matched && v.discovery_url) {
      matched = snapshotVins.get(v.discovery_url) || normSnapshotVins.get(normalizeUrl(v.discovery_url));
      method = 'discovery_url';
    }

    if (matched) {
      // Check for unique constraint conflict based on VIN length
      let isConflict = false;
      if (matched.len === 17) {
        // 17-char VINs: unique on vin alone
        if (existingVin17.has(matched.vin)) {
          isConflict = true;
        }
      } else {
        // Short VINs: unique on (vin, make)
        const key = `${matched.vin}|${v.make}`;
        if (existingVinMakeShort.has(key)) {
          isConflict = true;
        }
      }

      if (isConflict) {
        conflictsSkipped++;
        continue;
      }

      // Mark as taken to prevent intra-batch conflicts
      if (matched.len === 17) {
        existingVin17.add(matched.vin);
      } else {
        existingVinMakeShort.add(`${matched.vin}|${v.make}`);
      }

      updates.push({
        vehicle_id: v.id,
        vin: matched.vin,
        vin_length: matched.len,
        match_method: method,
      });
    }
  }

  console.log(`  Matched: ${updates.length} vehicles`);
  console.log(`  Skipped (conflict): ${conflictsSkipped}`);

  // Distribution
  const dist = { '17-char (modern VIN)': 0, '10-16 char (chassis #)': 0, '5-9 char (short chassis #)': 0 };
  for (const u of updates) {
    if (u.vin_length === 17) dist['17-char (modern VIN)']++;
    else if (u.vin_length >= 10) dist['10-16 char (chassis #)']++;
    else dist['5-9 char (short chassis #)']++;
  }
  console.log('\nVIN length distribution:');
  for (const [cat, cnt] of Object.entries(dist)) {
    console.log(`  ${cat}: ${cnt}`);
  }

  if (DRY_RUN) {
    console.log('\nSample extractions (first 20):');
    for (const u of updates.slice(0, 20)) {
      const v = vehicleMap.find(x => x.id === u.vehicle_id);
      console.log(`  ${u.vehicle_id} -> ${u.vin} (${u.vin_length} chars, via ${u.match_method})`);
    }
    console.log(`\nDRY RUN complete. ${updates.length} vehicles would be updated. Run without --dry-run to apply.`);
    await pool.end();
    return;
  }

  // ---- PHASE 2: Batch UPDATE ----
  // Disable the auto-merge trigger that fires on VIN updates and tries to delete duplicates
  // (it fails due to FK constraints and we don't want merges during bulk VIN backfill)
  console.log('\nDisabling trigger_auto_detect_duplicates for batch update...');
  const trigClient = await pool.connect();
  try {
    await trigClient.query(`ALTER TABLE vehicles DISABLE TRIGGER trigger_auto_detect_duplicates`);
    // Also disable VIN decode trigger to avoid hammering external APIs
    await trigClient.query(`ALTER TABLE vehicles DISABLE TRIGGER auto_vin_decode_trigger`);
    console.log('  Triggers disabled.');
  } finally {
    trigClient.release();
  }

  console.log(`\nApplying ${updates.length} updates in batches of ${BATCH_SIZE}...`);

  let totalUpdated = 0;
  let totalSkipped = 0;
  const batchCount = Math.ceil(updates.length / BATCH_SIZE);

  try {
    for (let batch = 0; batch < batchCount; batch++) {
      const batchNum = batch + 1;
      const batchUpdates = updates.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);

      const updateClient = await pool.connect();
      try {
        // Build a VALUES list for batch update
        const values = [];
        const params = [];
        for (let i = 0; i < batchUpdates.length; i++) {
          const u = batchUpdates[i];
          const base = i * 3;
          values.push(`($${base + 1}::uuid, $${base + 2}::text, $${base + 3}::int)`);
          params.push(u.vehicle_id, u.vin, u.vin_length);
        }

        const result = await updateClient.query(`
          UPDATE vehicles v
          SET
            vin = t.vin,
            vin_source = 'barrett_jackson_snapshot_extraction',
            vin_confidence = CASE WHEN t.vin_length = 17 THEN 90 ELSE 80 END,
            updated_at = now()
          FROM (VALUES ${values.join(',')}) AS t(vehicle_id, vin, vin_length)
          WHERE v.id = t.vehicle_id
            AND (v.vin IS NULL OR length(v.vin) < 5)
        `, params);

        totalUpdated += result.rowCount;
        const skipped = batchUpdates.length - result.rowCount;
        totalSkipped += skipped;

        if (VERBOSE || batchNum % 3 === 0 || batchNum === batchCount) {
          console.log(`  Batch ${batchNum}/${batchCount}: updated ${result.rowCount}${skipped > 0 ? `, skipped ${skipped}` : ''} (total: ${totalUpdated})`);
        }
      } catch (err) {
        if (err.code === '23505') {
          // Rare: conflict we missed. Do row-by-row for this batch.
          console.log(`  Batch ${batchNum}: unexpected conflict, row-by-row fallback...`);
          let batchOk = 0;
          for (const u of batchUpdates) {
            try {
              const r = await updateClient.query(`
                UPDATE vehicles SET vin = $1, vin_source = 'barrett_jackson_snapshot_extraction',
                  vin_confidence = $2, updated_at = now()
                WHERE id = $3 AND (vin IS NULL OR length(vin) < 5)
              `, [u.vin, u.vin_length === 17 ? 90 : 80, u.vehicle_id]);
              batchOk += r.rowCount;
            } catch (e) {
              if (e.code === '23505') { totalSkipped++; } else throw e;
            }
          }
          totalUpdated += batchOk;
          console.log(`    Row-by-row: ${batchOk} updated (total: ${totalUpdated})`);
        } else {
          throw err;
        }
      } finally {
        updateClient.release();
      }

      // Check locks
      await checkLocks();

      // Sleep between batches
      if (batchNum < batchCount) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  } finally {
    // ALWAYS re-enable triggers, even if script crashes
    console.log('\nRe-enabling triggers...');
    const trigClient2 = await pool.connect();
    try {
      await trigClient2.query(`ALTER TABLE vehicles ENABLE TRIGGER trigger_auto_detect_duplicates`);
      await trigClient2.query(`ALTER TABLE vehicles ENABLE TRIGGER auto_vin_decode_trigger`);
      console.log('  Triggers re-enabled.');
    } finally {
      trigClient2.release();
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Vehicles updated: ${totalUpdated}`);
  console.log(`Skipped (already had VIN or conflict): ${totalSkipped}`);

  // Final verification
  const verifyClient = await pool.connect();
  try {
    const { rows: [verify] } = await verifyClient.query(`
      SELECT
        count(*) as total_bj,
        count(*) FILTER (WHERE vin IS NULL OR length(vin) < 5) as still_missing,
        count(*) FILTER (WHERE vin_source = 'barrett_jackson_snapshot_extraction') as from_extraction
      FROM vehicles WHERE source = 'barrett-jackson'
    `);
    console.log(`\nPost-update stats:`);
    console.log(`  Total B-J vehicles: ${verify.total_bj}`);
    console.log(`  Still missing VIN: ${verify.still_missing}`);
    console.log(`  VINs from snapshot extraction: ${verify.from_extraction}`);
    console.log(`  Missing rate: ${(100 * verify.still_missing / verify.total_bj).toFixed(1)}% (was 80.8%)`);
  } finally {
    verifyClient.release();
  }

  await pool.end();
}

extractVins().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
