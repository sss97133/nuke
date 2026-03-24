#!/usr/bin/env node
/**
 * backfill-bj-vins.mjs
 *
 * Extracts VINs from Barrett-Jackson listing_page_snapshots markdown
 * and backfills them into vehicles table.
 *
 * Pattern: "<VIN_VALUE> Vin" in markdown content
 *
 * Hard rules:
 * - Batch 1000 rows at a time
 * - pg_sleep(0.2) between batches
 * - Check locks after writes
 * - VIN minimum length: 5 characters
 * - vin_source = 'barrett_jackson_snapshot_extraction'
 * - vin_confidence = 90 for 17-char VINs, 80 for shorter (pre-1981 chassis numbers)
 */

import pg from 'pg';
const { Pool } = pg;

// Use port 5432 (session mode) so temp tables persist across statements
const pool = new Pool({
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  database: 'postgres',
  max: 1,
  statement_timeout: 115000, // 115s per statement, under the 120s role limit
});

const BATCH_SIZE = 1000;
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

async function checkLocks(client) {
  const { rows } = await client.query(
    "SELECT count(*) as lock_count FROM pg_stat_activity WHERE wait_event_type='Lock'"
  );
  const lockCount = parseInt(rows[0].lock_count);
  if (lockCount > 0) {
    console.warn(`  WARNING: ${lockCount} lock(s) detected after write. Pausing 5s...`);
    await client.query("SELECT pg_sleep(5)");
    // Re-check
    const recheck = await client.query(
      "SELECT count(*) as lock_count FROM pg_stat_activity WHERE wait_event_type='Lock'"
    );
    if (parseInt(recheck.rows[0].lock_count) > 0) {
      console.error(`  CRITICAL: Locks still present (${recheck.rows[0].lock_count}). Stopping.`);
      process.exit(1);
    }
  }
  return lockCount;
}

async function extractVins() {
  const client = await pool.connect();

  try {
    console.log('=== Barrett-Jackson VIN Extraction from Snapshots ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE UPDATE'}`);
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log('');

    // Step 1: Create a temp table with all extractable VINs
    // This avoids running the expensive join+regex multiple times
    console.log('Step 1: Building extraction map (this may take a minute)...');

    // Drop if exists from a previous run, then create
    await client.query(`DROP TABLE IF EXISTS pg_temp.bj_vin_extractions`);
    await client.query(`
      CREATE TEMP TABLE bj_vin_extractions (
        vehicle_id uuid PRIMARY KEY,
        extracted_vin text NOT NULL,
        vin_length int NOT NULL,
        match_method text NOT NULL
      )
    `);

    // Insert matches via listing_url
    const r1 = await client.query(`
      INSERT INTO bj_vin_extractions (vehicle_id, extracted_vin, vin_length, match_method)
      SELECT DISTINCT ON (v.id)
        v.id,
        upper(substring(s.markdown from '([A-Za-z0-9]+) Vin')),
        length(substring(s.markdown from '([A-Za-z0-9]+) Vin')),
        'listing_url'
      FROM vehicles v
      JOIN listing_page_snapshots s ON s.listing_url = v.listing_url
      WHERE v.source = 'barrett-jackson'
        AND (v.vin IS NULL OR length(v.vin) < 5)
        AND s.platform = 'barrett-jackson'
        AND s.markdown IS NOT NULL
        AND s.markdown ~ '[A-Za-z0-9]+ Vin'
        AND length(substring(s.markdown from '([A-Za-z0-9]+) Vin')) BETWEEN 5 AND 17
        AND v.listing_url IS NOT NULL
      ON CONFLICT (vehicle_id) DO NOTHING
    `);
    console.log(`  listing_url matches: ${r1.rowCount}`);

    // Insert matches via discovery_url
    const r2 = await client.query(`
      INSERT INTO bj_vin_extractions (vehicle_id, extracted_vin, vin_length, match_method)
      SELECT DISTINCT ON (v.id)
        v.id,
        upper(substring(s.markdown from '([A-Za-z0-9]+) Vin')),
        length(substring(s.markdown from '([A-Za-z0-9]+) Vin')),
        'discovery_url'
      FROM vehicles v
      JOIN listing_page_snapshots s ON s.listing_url = v.discovery_url
      WHERE v.source = 'barrett-jackson'
        AND (v.vin IS NULL OR length(v.vin) < 5)
        AND s.platform = 'barrett-jackson'
        AND s.markdown IS NOT NULL
        AND s.markdown ~ '[A-Za-z0-9]+ Vin'
        AND length(substring(s.markdown from '([A-Za-z0-9]+) Vin')) BETWEEN 5 AND 17
        AND v.discovery_url IS NOT NULL
      ON CONFLICT (vehicle_id) DO NOTHING
    `);
    console.log(`  discovery_url matches: ${r2.rowCount}`);

    // Insert matches via discovery_url with www prefix
    const r3 = await client.query(`
      INSERT INTO bj_vin_extractions (vehicle_id, extracted_vin, vin_length, match_method)
      SELECT DISTINCT ON (v.id)
        v.id,
        upper(substring(s.markdown from '([A-Za-z0-9]+) Vin')),
        length(substring(s.markdown from '([A-Za-z0-9]+) Vin')),
        'discovery_url_www'
      FROM vehicles v
      JOIN listing_page_snapshots s ON
        s.listing_url = replace(v.discovery_url, 'https://barrett-jackson.com', 'https://www.barrett-jackson.com')
      WHERE v.source = 'barrett-jackson'
        AND (v.vin IS NULL OR length(v.vin) < 5)
        AND v.discovery_url LIKE 'https://barrett-jackson.com%'
        AND s.platform = 'barrett-jackson'
        AND s.markdown IS NOT NULL
        AND s.markdown ~ '[A-Za-z0-9]+ Vin'
        AND length(substring(s.markdown from '([A-Za-z0-9]+) Vin')) BETWEEN 5 AND 17
      ON CONFLICT (vehicle_id) DO NOTHING
    `);
    console.log(`  discovery_url_www matches: ${r3.rowCount}`);

    // Get total count
    const { rows: [{ total }] } = await client.query(
      'SELECT count(*) as total FROM bj_vin_extractions'
    );
    const totalCount = parseInt(total);
    console.log(`\nTotal vehicles to update: ${totalCount}`);

    // Distribution
    const { rows: distRows } = await client.query(`
      SELECT
        CASE
          WHEN vin_length = 17 THEN '17-char (modern VIN)'
          WHEN vin_length >= 10 THEN '10-16 char (chassis #)'
          WHEN vin_length >= 5 THEN '5-9 char (short chassis #)'
        END as category,
        count(*) as cnt
      FROM bj_vin_extractions
      GROUP BY 1 ORDER BY 1
    `);
    console.log('\nVIN length distribution:');
    for (const row of distRows) {
      console.log(`  ${row.category}: ${row.cnt}`);
    }

    if (DRY_RUN) {
      // Show some samples
      const { rows: samples } = await client.query(`
        SELECT e.vehicle_id, e.extracted_vin, e.vin_length, e.match_method,
               v.year, v.make, v.model
        FROM bj_vin_extractions e
        JOIN vehicles v ON v.id = e.vehicle_id
        ORDER BY e.vin_length DESC
        LIMIT 20
      `);
      console.log('\nSample extractions (top 20 by VIN length):');
      for (const s of samples) {
        console.log(`  ${s.year} ${s.make} ${s.model} → ${s.extracted_vin} (${s.vin_length} chars, via ${s.match_method})`);
      }
      console.log('\n✓ DRY RUN complete. Run without --dry-run to apply.');
      return;
    }

    // Step 2: Batch update
    console.log(`\nStep 2: Applying updates in batches of ${BATCH_SIZE}...`);

    let offset = 0;
    let totalUpdated = 0;
    const batchCount = Math.ceil(totalCount / BATCH_SIZE);

    let skippedConflicts = 0;

    while (offset < totalCount) {
      const batchNum = Math.floor(offset / BATCH_SIZE) + 1;

      try {
        const result = await client.query(`
          UPDATE vehicles v
          SET
            vin = e.extracted_vin,
            vin_source = 'barrett_jackson_snapshot_extraction',
            vin_confidence = CASE WHEN e.vin_length = 17 THEN 90 ELSE 80 END,
            updated_at = now()
          FROM (
            SELECT vehicle_id, extracted_vin, vin_length
            FROM bj_vin_extractions
            ORDER BY vehicle_id
            LIMIT $1 OFFSET $2
          ) e
          WHERE v.id = e.vehicle_id
            AND (v.vin IS NULL OR length(v.vin) < 5)
        `, [BATCH_SIZE, offset]);

        totalUpdated += result.rowCount;

        if (VERBOSE || batchNum % 5 === 0 || batchNum === batchCount) {
          console.log(`  Batch ${batchNum}/${batchCount}: updated ${result.rowCount} (total: ${totalUpdated})`);
        }
      } catch (err) {
        if (err.code === '23505') {
          // Unique constraint violation - fall back to one-by-one for this batch
          console.log(`  Batch ${batchNum}: constraint conflict, falling back to row-by-row...`);
          const { rows: batchRows } = await client.query(`
            SELECT vehicle_id, extracted_vin, vin_length
            FROM bj_vin_extractions
            ORDER BY vehicle_id
            LIMIT $1 OFFSET $2
          `, [BATCH_SIZE, offset]);

          let batchUpdated = 0;
          for (const row of batchRows) {
            try {
              const r = await client.query(`
                UPDATE vehicles
                SET vin = $1,
                    vin_source = 'barrett_jackson_snapshot_extraction',
                    vin_confidence = $2,
                    updated_at = now()
                WHERE id = $3
                  AND (vin IS NULL OR length(vin) < 5)
              `, [row.extracted_vin, row.vin_length === 17 ? 90 : 80, row.vehicle_id]);
              batchUpdated += r.rowCount;
            } catch (rowErr) {
              if (rowErr.code === '23505') {
                skippedConflicts++;
                if (VERBOSE) {
                  console.log(`    Skipped ${row.vehicle_id}: VIN ${row.extracted_vin} conflicts`);
                }
              } else {
                throw rowErr;
              }
            }
          }
          totalUpdated += batchUpdated;
          console.log(`  Batch ${batchNum}/${batchCount}: updated ${batchUpdated}, skipped ${batchRows.length - batchUpdated} conflicts (total: ${totalUpdated})`);
        } else {
          throw err;
        }
      }

      // Check locks after each batch
      await checkLocks(client);

      offset += BATCH_SIZE;

      // Sleep between batches
      if (offset < totalCount) {
        await client.query("SELECT pg_sleep(0.2)");
      }
    }

    console.log(`\n=== COMPLETE ===`);
    console.log(`Total vehicles updated with VIN: ${totalUpdated}`);

    // Final verification
    const { rows: [verify] } = await client.query(`
      SELECT
        count(*) as total_bj,
        count(*) FILTER (WHERE vin IS NULL OR length(vin) < 5) as still_missing,
        count(*) FILTER (WHERE vin_source = 'barrett_jackson_snapshot_extraction') as from_this_run
      FROM vehicles WHERE source = 'barrett-jackson'
    `);
    console.log(`\nPost-update stats:`);
    console.log(`  Total B-J vehicles: ${verify.total_bj}`);
    console.log(`  Still missing VIN: ${verify.still_missing}`);
    console.log(`  VINs from this extraction: ${verify.from_this_run}`);
    console.log(`  Missing rate: ${(100 * verify.still_missing / verify.total_bj).toFixed(1)}%`);

  } finally {
    client.release();
    await pool.end();
  }
}

extractVins().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
