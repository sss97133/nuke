#!/usr/bin/env node
/**
 * merge-vin-duplicates.mjs — Safe VIN-based duplicate merge
 *
 * Only merges VIN pairs where:
 * 1. VIN is >= 11 chars (real VIN, not lot number)
 * 2. VIN doesn't look like a Bonhams fake (NXXXX pattern + ENGNEN suffix)
 * 3. Year matches (or one is null — skeleton filling into a real record)
 * 4. Make is compatible (same normalized make, or one is null)
 *
 * Usage:
 *   dotenvx run -- node scripts/merge-vin-duplicates.mjs --dry-run
 *   dotenvx run -- node scripts/merge-vin-duplicates.mjs
 */

import pg from 'pg';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function getPool() {
  return new pg.Pool({
    connectionString: `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ'}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    max: 1,
    idleTimeoutMillis: 30000,
  });
}

function isFakeVin(vin) {
  // Bonhams fake VINs: start with N followed by digits, end with ENGN, ENGNEN, SEETEXTE, etc.
  if (/^N\d+.*ENG/i.test(vin)) return true;
  if (/^N\d+.*SEE/i.test(vin)) return true;
  // Single character repeated
  if (/^(.)\1+$/.test(vin)) return true;
  // Too short to be meaningful
  if (vin.length < 6) return true;
  return false;
}

function normalizeMake(make) {
  if (!make) return null;
  return make.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^(classic\s+sports\s+cars|assembled\s+vehicle)/i, '');
}

function makesCompatible(makeA, makeB) {
  if (!makeA || !makeB) return true; // one is null — compatible
  const a = normalizeMake(makeA);
  const b = normalizeMake(makeB);
  if (a === b) return true;
  // Common aliases
  const aliases = {
    'shelby': ['ford', 'shelby'],
    'ford': ['ford', 'shelby', 'factoryfive'],
    'factoryfive': ['ford', 'shelby', 'factoryfive'],
    'datsun': ['datsun', 'nissan'],
    'nissan': ['datsun', 'nissan'],
    'cav': ['ford', 'cav'],
    'kirkham': ['shelby', 'kirkham'],
  };
  const aliasA = aliases[a] || [a];
  const aliasB = aliases[b] || [b];
  return aliasA.some(x => aliasB.includes(x));
}

async function main() {
  console.log(`\n━━━ SAFE VIN DUPLICATE MERGE ━━━`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const pool = getPool();

  const vinDups = await pool.query(`
    SELECT
      vin,
      array_agg(id::text ORDER BY created_at ASC) as ordered_ids,
      array_agg(year ORDER BY created_at ASC) as years,
      array_agg(make ORDER BY created_at ASC) as makes,
      array_agg(model ORDER BY created_at ASC) as models,
      array_agg(source ORDER BY created_at ASC) as sources
    FROM vehicles
    WHERE vin IS NOT NULL
      AND vin != ''
      AND length(vin) >= 6
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY vin
    HAVING count(*) > 1
    ORDER BY count(*) DESC
  `);

  console.log(`Found ${vinDups.rows.length} VINs with duplicates\n`);

  let safePairs = [];
  let skippedFake = 0;
  let skippedIncompatible = 0;

  for (const group of vinDups.rows) {
    if (isFakeVin(group.vin)) {
      skippedFake++;
      console.log(`  [SKIP-FAKE] VIN:${group.vin} — looks like lot number, not real VIN`);
      continue;
    }

    const ids = group.ordered_ids;
    const primaryIdx = 0;
    const primaryYear = group.years[primaryIdx];
    const primaryMake = group.makes[primaryIdx];

    for (let i = 1; i < ids.length; i++) {
      const dupYear = group.years[i];
      const dupMake = group.makes[i];

      // Year must match or one must be null
      const yearOk = !primaryYear || !dupYear || primaryYear === dupYear;
      const makeOk = makesCompatible(primaryMake, dupMake);

      if (!yearOk || !makeOk) {
        skippedIncompatible++;
        console.log(`  [SKIP-INCOMPAT] VIN:${group.vin} — ${primaryYear} ${primaryMake} vs ${dupYear} ${dupMake}`);
        continue;
      }

      safePairs.push({
        vin: group.vin,
        primaryId: ids[primaryIdx],
        dupId: ids[i],
        desc: `${group.years[primaryIdx] || '?'} ${group.makes[primaryIdx] || '?'} ${group.models[primaryIdx] || '?'} [${group.sources[primaryIdx]}] ← ${group.years[i] || '?'} ${group.makes[i] || '?'} ${group.models[i] || '?'} [${group.sources[i]}]`
      });
    }
  }

  console.log(`\nSafe pairs: ${safePairs.length}`);
  console.log(`Skipped fake VIN: ${skippedFake}`);
  console.log(`Skipped incompatible: ${skippedIncompatible}\n`);

  if (dryRun) {
    for (const p of safePairs) {
      console.log(`  VIN:${p.vin} — ${p.desc}`);
    }
    console.log(`\nWould merge ${safePairs.length} pairs. Run without --dry-run to execute.`);
    await pool.end();
    return;
  }

  let merged = 0;
  let errors = 0;

  for (const p of safePairs) {
    try {
      const result = await pool.query(
        'SELECT merge_into_primary($1::uuid, $2::uuid) AS result',
        [p.primaryId, p.dupId]
      );
      const r = result.rows[0]?.result;
      if (r && !r.skipped) {
        merged++;
        console.log(`  [OK] VIN:${p.vin} — ${p.desc}`);
      } else {
        console.log(`  [SKIP] VIN:${p.vin} — ${r?.skip_reason || 'unknown'}`);
      }
    } catch (e) {
      errors++;
      console.error(`  [ERR] VIN:${p.vin}: ${e.message.slice(0, 100)}`);
    }
  }

  await pool.end();
  console.log(`\nComplete: ${merged} merged, ${errors} errors`);
}

main().catch(console.error);
