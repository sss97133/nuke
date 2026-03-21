#!/usr/bin/env node
/**
 * data-quality-cleanup-phase4.mjs — Fix remaining systemic issues from Phase 3
 *
 * Phase 4a: Merge exact URL duplicates (Barrett-Jackson + all platforms)
 * Phase 4b: Merge VIN duplicates (highest confidence possible)
 * Phase 4c: Archive Bonhams skeletons (no year/make/model, no images)
 * Phase 4d: Archive remaining skeletons from all sources
 *
 * Usage:
 *   dotenvx run -- node scripts/data-quality-cleanup-phase4.mjs --sub a --dry-run
 *   dotenvx run -- node scripts/data-quality-cleanup-phase4.mjs --sub a
 *   dotenvx run -- node scripts/data-quality-cleanup-phase4.mjs --sub b --dry-run
 *   dotenvx run -- node scripts/data-quality-cleanup-phase4.mjs --sub c
 *   dotenvx run -- node scripts/data-quality-cleanup-phase4.mjs --sub d
 */

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const sub = args[args.indexOf('--sub') + 1] || '';
const dryRun = args.includes('--dry-run');
const BATCH_SIZE = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getPool() {
  return new pg.Pool({
    connectionString: `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ'}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

// ---------------------------------------------------------------------------
// 4a: Merge exact URL duplicates across all platforms
// ---------------------------------------------------------------------------
async function phase4a() {
  console.log('\n━━━ PHASE 4a: Merge exact URL duplicates ━━━');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const pool = getPool();

  const dupGroups = await pool.query(`
    SELECT
      listing_url,
      count(*) as cnt,
      array_agg(id::text ORDER BY created_at ASC, id ASC) as ordered_ids,
      array_agg(source ORDER BY created_at ASC, id ASC) as sources
    FROM vehicles
    WHERE listing_url IS NOT NULL
      AND listing_url != ''
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY listing_url
    HAVING count(*) > 1
    ORDER BY count(*) DESC
  `);

  console.log(`Found ${dupGroups.rows.length} exact URL duplicate groups\n`);

  if (dryRun) {
    for (const r of dupGroups.rows.slice(0, 20)) {
      console.log(`  ${r.cnt}x | ${r.sources.join(',')} | ${r.listing_url.slice(0, 100)}`);
      console.log(`    PRIMARY: ${r.ordered_ids[0].slice(0, 8)} | DUPS: ${r.ordered_ids.slice(1).map(i => i.slice(0, 8)).join(', ')}`);
    }
    const totalDups = dupGroups.rows.reduce((s, r) => s + r.cnt - 1, 0);
    console.log(`\nWould merge ${totalDups} duplicates across ${dupGroups.rows.length} groups.`);
    await pool.end();
    return;
  }

  let merged = 0;
  let errors = 0;

  for (const group of dupGroups.rows) {
    const primaryId = group.ordered_ids[0];
    const dupIds = group.ordered_ids.slice(1);

    for (const dupId of dupIds) {
      try {
        const result = await pool.query(
          'SELECT merge_into_primary($1::uuid, $2::uuid) AS result',
          [primaryId, dupId]
        );
        const r = result.rows[0]?.result;
        if (r && !r.skipped) {
          merged++;
          if (merged <= 30 || merged % 50 === 0) {
            console.log(`  [OK] ${dupId.slice(0, 8)} → ${primaryId.slice(0, 8)} (imgs:${r.images_moved || 0})`);
          }
        } else {
          console.log(`  [SKIP] ${dupId.slice(0, 8)} (${r?.skip_reason || 'unknown'})`);
        }
      } catch (e) {
        errors++;
        console.error(`  [ERR] ${dupId.slice(0, 8)}: ${e.message.slice(0, 100)}`);
      }

      if (merged % 20 === 0) await sleep(100);
    }
  }

  await pool.end();
  console.log(`\nPhase 4a complete: ${merged} merged, ${errors} errors`);
}

// ---------------------------------------------------------------------------
// 4b: Merge VIN duplicates
// ---------------------------------------------------------------------------
async function phase4b() {
  console.log('\n━━━ PHASE 4b: Merge VIN duplicates ━━━');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const pool = getPool();

  const vinDups = await pool.query(`
    SELECT
      vin,
      count(*) as cnt,
      array_agg(id::text ORDER BY created_at ASC) as ordered_ids,
      array_agg(source ORDER BY created_at ASC) as sources,
      array_agg(year ORDER BY created_at ASC) as years,
      array_agg(make ORDER BY created_at ASC) as makes,
      array_agg(model ORDER BY created_at ASC) as models
    FROM vehicles
    WHERE vin IS NOT NULL
      AND vin != ''
      AND length(vin) >= 11
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY vin
    HAVING count(*) > 1
    ORDER BY count(*) DESC
  `);

  console.log(`Found ${vinDups.rows.length} VINs with multiple active records\n`);

  for (const r of vinDups.rows) {
    const detail = r.ordered_ids.map((id, i) =>
      `${id.slice(0, 8)} ${r.years[i] || '?'} ${r.makes[i] || '?'} ${r.models[i] || '?'} [${r.sources[i]}]`
    ).join(' | ');
    console.log(`  VIN:${r.vin} (${r.cnt}x) — ${detail}`);
  }

  if (dryRun) {
    const totalDups = vinDups.rows.reduce((s, r) => s + r.cnt - 1, 0);
    console.log(`\nWould merge ${totalDups} VIN duplicates. Run without --dry-run to execute.`);
    await pool.end();
    return;
  }

  let merged = 0;
  let errors = 0;

  for (const group of vinDups.rows) {
    const primaryId = group.ordered_ids[0];
    const dupIds = group.ordered_ids.slice(1);

    for (const dupId of dupIds) {
      try {
        const result = await pool.query(
          'SELECT merge_into_primary($1::uuid, $2::uuid) AS result',
          [primaryId, dupId]
        );
        const r = result.rows[0]?.result;
        if (r && !r.skipped) {
          merged++;
          console.log(`  [OK] VIN:${group.vin} — ${dupId.slice(0, 8)} → ${primaryId.slice(0, 8)} (imgs:${r.images_moved || 0})`);
        } else {
          console.log(`  [SKIP] VIN:${group.vin} — ${dupId.slice(0, 8)} (${r?.skip_reason || 'unknown'})`);
        }
      } catch (e) {
        errors++;
        console.error(`  [ERR] VIN:${group.vin}: ${e.message.slice(0, 100)}`);
      }
    }
  }

  await pool.end();
  console.log(`\nPhase 4b complete: ${merged} merged, ${errors} errors`);
}

// ---------------------------------------------------------------------------
// 4c: Archive Bonhams skeletons
// ---------------------------------------------------------------------------
async function phase4c() {
  console.log('\n━━━ PHASE 4c: Archive Bonhams skeletons ━━━');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const { count: total } = await sb.from('vehicles')
    .select('id', { count: 'exact', head: true })
    .is('year', null)
    .is('make', null)
    .is('model', null)
    .eq('source', 'bonhams')
    .not('status', 'in', '(merged,deleted,archived)');

  console.log(`Found ${total} Bonhams skeleton records\n`);

  if (dryRun) {
    const { data: sample } = await sb.from('vehicles')
      .select('id, listing_url, discovery_url, created_at')
      .is('year', null)
      .is('make', null)
      .is('model', null)
      .eq('source', 'bonhams')
      .not('status', 'in', '(merged,deleted,archived)')
      .limit(5);

    for (const v of (sample || [])) {
      console.log(`  ${v.id.slice(0, 8)} | url:${(v.listing_url || v.discovery_url || '-').slice(0, 80)} | ${v.created_at}`);
    }
    console.log(`\nWould archive ${total} records.`);
    return;
  }

  let archived = 0;
  while (archived < total) {
    const { data: batch } = await sb.from('vehicles')
      .select('id')
      .is('year', null)
      .is('make', null)
      .is('model', null)
      .eq('source', 'bonhams')
      .not('status', 'in', '(merged,deleted,archived)')
      .limit(BATCH_SIZE);

    if (!batch || batch.length === 0) break;

    const { error } = await sb.from('vehicles')
      .update({ status: 'archived' })
      .in('id', batch.map(v => v.id));

    if (error) { console.error('Error:', error.message); break; }

    archived += batch.length;
    console.log(`  Archived ${archived}/${total}`);
    await sleep(200);
  }

  console.log(`\nPhase 4c complete: ${archived} Bonhams skeletons archived`);
}

// ---------------------------------------------------------------------------
// 4d: Archive ALL remaining skeletons (no year, no make, no model, no images)
// ---------------------------------------------------------------------------
async function phase4d() {
  console.log('\n━━━ PHASE 4d: Archive remaining skeletons ━━━');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const pool = getPool();

  // Find skeletons: no year, no make, no model, and no images
  const skeletons = await pool.query(`
    SELECT v.source, count(*) as cnt
    FROM vehicles v
    WHERE v.year IS NULL
      AND v.make IS NULL
      AND v.model IS NULL
      AND v.status NOT IN ('merged', 'deleted', 'archived')
      AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)
    GROUP BY v.source
    ORDER BY count(*) DESC
  `);

  console.log('Skeleton breakdown by source:');
  let totalSkeletons = 0;
  for (const r of skeletons.rows) {
    console.log(`  ${r.cnt}x | ${r.source || 'null'}`);
    totalSkeletons += parseInt(r.cnt);
  }
  console.log(`Total: ${totalSkeletons}\n`);

  if (dryRun) {
    console.log(`Would archive ${totalSkeletons} records.`);
    await pool.end();
    return;
  }

  // Archive in batches using the pool
  let archived = 0;
  while (archived < totalSkeletons) {
    const result = await pool.query(`
      UPDATE vehicles SET status = 'archived'
      WHERE id IN (
        SELECT v.id FROM vehicles v
        WHERE v.year IS NULL
          AND v.make IS NULL
          AND v.model IS NULL
          AND v.status NOT IN ('merged', 'deleted', 'archived')
          AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)
        LIMIT $1
      )
    `, [BATCH_SIZE]);

    if (result.rowCount === 0) break;
    archived += result.rowCount;
    console.log(`  Archived ${archived}/${totalSkeletons}`);
    await sleep(200);
  }

  await pool.end();
  console.log(`\nPhase 4d complete: ${archived} skeletons archived`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!sub) {
    console.log('Usage: data-quality-cleanup-phase4.mjs --sub <a|b|c|d> [--dry-run]');
    console.log('  a: Merge exact URL duplicates');
    console.log('  b: Merge VIN duplicates');
    console.log('  c: Archive Bonhams skeletons');
    console.log('  d: Archive ALL remaining skeletons');
    process.exit(0);
  }

  if (sub === 'a') await phase4a();
  else if (sub === 'b') await phase4b();
  else if (sub === 'c') await phase4c();
  else if (sub === 'd') await phase4d();
  else console.log('Unknown sub:', sub);
}

main().catch(console.error);
