#!/usr/bin/env npx tsx
/**
 * Backfill Vehicles from VIN Truth — Phase 3 of Vehicle Taxonomy Normalization
 *
 * Fills missing vehicle fields (trim, body_style, engine_size, transmission,
 * drivetrain) from vin_decoded_data using COALESCE (only fills NULLs).
 *
 * Batched in 1000-row chunks with pg_sleep to respect DB rules.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/backfill-from-vin.ts
 *   dotenvx run -- npx tsx scripts/backfill-from-vin.ts --dry-run
 *   dotenvx run -- npx tsx scripts/backfill-from-vin.ts --override   # Overwrite non-NULL values too
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DB_HOST = 'aws-0-us-west-1.pooler.supabase.com';
const DB_PORT = '6543';
const DB_USER = 'postgres.qkgaybvrernstplzjaam';
const DB_PASS = 'RbzKq32A0uhqvJMQ';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const override = args.includes('--override');

const stats = {
  totalUpdated: 0,
  batches: 0,
  startTime: Date.now(),
};

async function executeSql(query: string): Promise<string[]> {
  const { execSync } = await import('child_process');
  const env = { ...process.env, PGPASSWORD: DB_PASS };
  const singleLine = query.replace(/\s+/g, ' ').trim();
  try {
    const result = execSync(
      `psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -t -A -c ${JSON.stringify(singleLine)}`,
      { env, timeout: 120000, encoding: 'utf-8' }
    );
    return result.trim().split('\n').filter(Boolean);
  } catch (err: any) {
    if (err.stdout) return err.stdout.trim().split('\n').filter(Boolean);
    throw err;
  }
}

async function main() {
  console.log(`\n=== Backfill Vehicles from VIN Truth ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Strategy: ${override ? 'OVERRIDE (replace existing values)' : 'COALESCE (fill NULLs only)'}`);
  console.log('');

  // Check how many vehicles have matching decoded data with missing fields
  const countResult = await executeSql(`
    SELECT count(*) FROM vehicles v
    JOIN vin_decoded_data vd ON upper(v.vin) = upper(vd.vin)
    WHERE v.deleted_at IS NULL
    AND (v.trim IS NULL OR v.body_style IS NULL OR v.engine_size IS NULL
         OR v.transmission IS NULL OR v.drivetrain IS NULL)
  `);

  const totalCandidates = parseInt(countResult[0] || '0');
  console.log(`Vehicles with decoded VIN data needing backfill: ${totalCandidates}`);

  if (totalCandidates === 0) {
    console.log('Nothing to backfill.');
    return;
  }

  if (dryRun) {
    // Show sample of what would change
    const sample = await executeSql(`
      SELECT v.id, v.make, v.model,
             v.trim as v_trim, vd.trim as vd_trim,
             v.body_style as v_body, vd.body_type as vd_body,
             v.engine_size as v_engine, vd.engine_size as vd_engine,
             v.transmission as v_trans, vd.transmission as vd_trans,
             v.drivetrain as v_drive, vd.drivetrain as vd_drive
      FROM vehicles v
      JOIN vin_decoded_data vd ON upper(v.vin) = upper(vd.vin)
      WHERE v.deleted_at IS NULL
      AND (v.trim IS NULL OR v.body_style IS NULL OR v.engine_size IS NULL)
      LIMIT 10
    `);

    console.log('\nSample (first 10):');
    for (const row of sample) {
      console.log(`  ${row}`);
    }
    console.log(`\nDRY RUN — would update up to ${totalCandidates} vehicles`);
    return;
  }

  // Batched update loop
  const BATCH_SIZE = 1000;
  const estimatedBatches = Math.ceil(totalCandidates / BATCH_SIZE);
  console.log(`\nProcessing in batches of ${BATCH_SIZE} (~${estimatedBatches} batches)...\n`);

  let totalAffected = 0;

  while (true) {
    const setClause = override
      ? `
        trim = COALESCE(NULLIF(vd.trim, ''), v.trim),
        body_style = COALESCE(NULLIF(vd.body_type, ''), v.body_style),
        engine_size = COALESCE(NULLIF(vd.engine_size, ''), v.engine_size),
        transmission = COALESCE(NULLIF(vd.transmission, ''), v.transmission),
        drivetrain = COALESCE(NULLIF(vd.drivetrain, ''), v.drivetrain)
      `
      : `
        trim = COALESCE(v.trim, NULLIF(vd.trim, '')),
        body_style = COALESCE(v.body_style, NULLIF(vd.body_type, '')),
        engine_size = COALESCE(v.engine_size, NULLIF(vd.engine_size, '')),
        transmission = COALESCE(v.transmission, NULLIF(vd.transmission, '')),
        drivetrain = COALESCE(v.drivetrain, NULLIF(vd.drivetrain, ''))
      `;

    const updateSql = `
      WITH batch AS (
        SELECT v.id
        FROM vehicles v
        JOIN vin_decoded_data vd ON upper(v.vin) = upper(vd.vin)
        WHERE v.deleted_at IS NULL
        AND (v.trim IS NULL OR v.body_style IS NULL OR v.engine_size IS NULL
             OR v.transmission IS NULL OR v.drivetrain IS NULL)
        AND (vd.trim IS NOT NULL OR vd.body_type IS NOT NULL OR vd.engine_size IS NOT NULL
             OR vd.transmission IS NOT NULL OR vd.drivetrain IS NOT NULL)
        LIMIT ${BATCH_SIZE}
      )
      UPDATE vehicles v SET ${setClause}
      FROM vin_decoded_data vd
      WHERE upper(v.vin) = upper(vd.vin)
      AND v.id IN (SELECT id FROM batch);
    `;

    const result = await executeSql(updateSql);
    // Parse "UPDATE N" result
    const affected = parseInt((result[0] || '').replace(/\D/g, '') || '0');

    if (affected === 0) break;

    totalAffected += affected;
    stats.batches++;

    if (stats.batches % 5 === 0 || affected < BATCH_SIZE) {
      const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
      console.log(`  Batch ${stats.batches}: ${affected} updated (total: ${totalAffected}, ${elapsed}s)`);
    }

    // Check for lock contention
    const locks = await executeSql(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock'`);
    const lockCount = parseInt(locks[0] || '0');
    if (lockCount > 2) {
      console.log(`  Warning: ${lockCount} locks detected, pausing 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      await new Promise(r => setTimeout(r, 100)); // pg_sleep equivalent
    }
  }

  stats.totalUpdated = totalAffected;
  const totalTime = ((Date.now() - stats.startTime) / 1000).toFixed(1);

  console.log(`\n=== Summary ===`);
  console.log(`Vehicles updated:  ${stats.totalUpdated}`);
  console.log(`Batches:           ${stats.batches}`);
  console.log(`Time:              ${totalTime}s`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
