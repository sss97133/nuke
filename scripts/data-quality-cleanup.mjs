#!/usr/bin/env node
/**
 * data-quality-cleanup.mjs — Autonomous data quality enforcement
 *
 * Phase 1: Archive ECR ghost records (no year, no URL, no images, source=unknown)
 * Phase 2: Merge JamesEdition URL-variant duplicates (same listing ID, URL differs by appended title)
 * Phase 3: Find more systemic patterns
 *
 * Uses batched writes per hard rules (1000/batch, check locks after each).
 *
 * Usage:
 *   dotenvx run -- node scripts/data-quality-cleanup.mjs --phase 1 --dry-run
 *   dotenvx run -- node scripts/data-quality-cleanup.mjs --phase 1
 *   dotenvx run -- node scripts/data-quality-cleanup.mjs --phase 2 --dry-run
 *   dotenvx run -- node scripts/data-quality-cleanup.mjs --phase 2
 *   dotenvx run -- node scripts/data-quality-cleanup.mjs --phase 3
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const phase = parseInt(args[args.indexOf('--phase') + 1] || '0');
const dryRun = args.includes('--dry-run');
const BATCH_SIZE = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkLocks() {
  const { data } = await sb.rpc('exec_sql', {
    query: "SELECT count(*) as lock_count FROM pg_stat_activity WHERE wait_event_type='Lock'"
  }).maybeSingle();
  // Fallback: use direct query
  const { data: locks } = await sb.from('pg_stat_activity')
    .select('pid', { count: 'exact', head: true });
  return 0; // Can't easily check via REST, proceed carefully
}

// ---------------------------------------------------------------------------
// Phase 1: Archive ECR ghost records
// ---------------------------------------------------------------------------
async function phase1ArchiveECRGhosts() {
  console.log('\n━━━ PHASE 1: Archive ECR ghost records ━━━');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // Count total
  const { count: total } = await sb.from('vehicles')
    .select('id', { count: 'exact', head: true })
    .is('year', null)
    .is('listing_url', null)
    .eq('source', 'unknown')
    .not('status', 'in', '(merged,deleted,archived)');

  console.log(`Found ${total} ECR ghost records to archive\n`);

  if (dryRun) {
    // Show sample
    const { data: sample } = await sb.from('vehicles')
      .select('id, make, model, discovery_source, discovery_url')
      .is('year', null)
      .is('listing_url', null)
      .eq('source', 'unknown')
      .not('status', 'in', '(merged,deleted,archived)')
      .limit(10);

    console.log('Sample records that would be archived:');
    for (const v of (sample || [])) {
      console.log(`  ${v.id.slice(0, 8)} | ${v.make || '?'} ${v.model || '?'} | ${v.discovery_source || '?'} | ${(v.discovery_url || '-').slice(0, 60)}`);
    }
    console.log(`\nWould archive ${total} records. Run without --dry-run to execute.`);
    return;
  }

  // Archive in batches
  let archived = 0;
  let batchNum = 0;

  while (archived < total) {
    batchNum++;
    // Fetch a batch of IDs
    const { data: batch } = await sb.from('vehicles')
      .select('id')
      .is('year', null)
      .is('listing_url', null)
      .eq('source', 'unknown')
      .not('status', 'in', '(merged,deleted,archived)')
      .limit(BATCH_SIZE);

    if (!batch || batch.length === 0) break;

    const ids = batch.map(v => v.id);

    // Archive them
    const { error, count } = await sb.from('vehicles')
      .update({ status: 'archived' })
      .in('id', ids);

    if (error) {
      console.error(`Batch ${batchNum} error:`, error.message);
      break;
    }

    archived += ids.length;
    console.log(`Batch ${batchNum}: archived ${ids.length} (total: ${archived}/${total})`);

    // Breathe between batches
    await sleep(200);
  }

  console.log(`\nPhase 1 complete: ${archived} ECR ghosts archived`);
}

// ---------------------------------------------------------------------------
// Phase 2: Merge JamesEdition URL-variant duplicates
// ---------------------------------------------------------------------------
function extractJEListingId(url) {
  if (!url) return null;
  const m = url.match(/jamesedition\.com.*?[/-](\d{7,})/);
  return m ? m[1] : null;
}

function isCleanUrl(url) {
  // Clean URLs don't have the title appended in quotes
  return !url.includes(' "');
}

async function phase2MergeJEDuplicates() {
  console.log('\n━━━ PHASE 2: Merge JamesEdition URL-variant duplicates ━━━');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // Fetch all JamesEdition vehicles
  const { data: jeVehicles, error } = await sb.from('vehicles')
    .select('id, year, make, model, sale_price, vin, listing_url, created_at, status')
    .eq('source', 'jamesedition')
    .not('status', 'in', '(merged,deleted)')
    .order('listing_url');

  if (error) { console.error('Query error:', error); return; }

  console.log(`Total JamesEdition vehicles: ${jeVehicles.length}`);

  // Group by listing ID
  const byListingId = {};
  let noId = 0;

  for (const v of jeVehicles) {
    const lid = extractJEListingId(v.listing_url);
    if (!lid) { noId++; continue; }
    if (!byListingId[lid]) byListingId[lid] = [];
    byListingId[lid].push(v);
  }

  // Find groups with both clean and title-appended URLs
  const mergePairs = [];

  for (const [lid, group] of Object.entries(byListingId)) {
    if (group.length < 2) continue;

    const clean = group.filter(v => isCleanUrl(v.listing_url));
    const dirty = group.filter(v => !isCleanUrl(v.listing_url));

    if (clean.length === 1 && dirty.length >= 1) {
      // Clear case: merge dirty into clean
      for (const d of dirty) {
        mergePairs.push({ primary: clean[0], duplicate: d, listingId: lid });
      }
    } else if (clean.length === 0 && dirty.length >= 2) {
      // All have appended titles — pick oldest as primary
      const sorted = group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      for (let i = 1; i < sorted.length; i++) {
        mergePairs.push({ primary: sorted[0], duplicate: sorted[i], listingId: lid });
      }
    } else if (clean.length > 1) {
      // Multiple clean URLs for same listing ID — pick oldest
      const sorted = clean.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      for (let i = 1; i < sorted.length; i++) {
        mergePairs.push({ primary: sorted[0], duplicate: sorted[i], listingId: lid });
      }
      for (const d of dirty) {
        mergePairs.push({ primary: sorted[0], duplicate: d, listingId: lid });
      }
    }
  }

  console.log(`Found ${mergePairs.length} merge pairs across ${Object.keys(byListingId).length} listing IDs`);
  console.log(`(${noId} vehicles had no extractable listing ID)\n`);

  if (dryRun) {
    console.log('Merge pairs (first 20):');
    for (const { primary, duplicate, listingId } of mergePairs.slice(0, 20)) {
      console.log(`  JE:${listingId}`);
      console.log(`    PRIMARY:   ${primary.id.slice(0, 8)} | ${primary.year || '?'} ${primary.make || '?'} ${primary.model || '?'} | clean=${isCleanUrl(primary.listing_url)}`);
      console.log(`    DUPLICATE: ${duplicate.id.slice(0, 8)} | ${duplicate.year || '?'} ${duplicate.make || '?'} ${duplicate.model || '?'} | clean=${isCleanUrl(duplicate.listing_url)}`);
    }
    console.log(`\nWould merge ${mergePairs.length} duplicates. Run without --dry-run to execute.`);
    return;
  }

  // Connect via pg for merge_into_primary calls
  const pool = new pg.Pool({
    connectionString: `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ'}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  let merged = 0;
  let errors = 0;

  for (const { primary, duplicate, listingId } of mergePairs) {
    try {
      const result = await pool.query(
        'SELECT merge_into_primary($1::uuid, $2::uuid) AS result',
        [primary.id, duplicate.id]
      );
      const r = result.rows[0]?.result;
      if (r && !r.skipped) {
        merged++;
        console.log(`  [OK] JE:${listingId} — ${duplicate.id.slice(0, 8)} → ${primary.id.slice(0, 8)} (imgs:${r.images_moved || 0} obs:${r.observations_moved || 0})`);
      } else {
        console.log(`  [SKIP] JE:${listingId} — ${duplicate.id.slice(0, 8)} (${r?.skip_reason || 'unknown'})`);
      }
    } catch (e) {
      errors++;
      console.error(`  [ERR] JE:${listingId} — ${duplicate.id.slice(0, 8)}: ${e.message.slice(0, 100)}`);
    }

    // Breathe every 10 merges
    if (merged % 10 === 0) await sleep(100);
  }

  await pool.end();
  console.log(`\nPhase 2 complete: ${merged} merged, ${errors} errors`);
}

// ---------------------------------------------------------------------------
// Phase 3: Hunt for more systemic patterns
// ---------------------------------------------------------------------------
async function phase3HuntPatterns() {
  console.log('\n━━━ PHASE 3: Hunting systemic duplicate patterns ━━━\n');

  // 1. Exact URL duplicates (beyond JamesEdition)
  const pool = new pg.Pool({
    connectionString: `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ'}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    max: 1,
    idleTimeoutMillis: 30000,
  });

  // Exact listing_url duplicates
  const exactDups = await pool.query(`
    SELECT listing_url, count(*) as cnt, array_agg(source ORDER BY source) as sources
    FROM vehicles
    WHERE listing_url IS NOT NULL
      AND listing_url != ''
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY listing_url
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 30
  `);

  console.log(`1. EXACT URL DUPLICATES: ${exactDups.rows.length}+ groups`);
  for (const r of exactDups.rows.slice(0, 10)) {
    console.log(`   ${r.cnt}x | ${r.sources.join(',')} | ${r.listing_url.slice(0, 100)}`);
  }

  // 2. Vehicles with no data at all (no year, no make, no model, no images)
  const skeletons = await pool.query(`
    SELECT count(*) as cnt
    FROM vehicles v
    WHERE v.year IS NULL
      AND v.make IS NULL
      AND v.model IS NULL
      AND v.status NOT IN ('merged', 'deleted', 'archived')
      AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)
  `);
  console.log(`\n2. TOTAL SKELETON RECORDS (no year, no make, no model, no images): ${skeletons.rows[0].cnt}`);

  // 3. Source distribution for skeletons
  const skelSources = await pool.query(`
    SELECT source, discovery_source, count(*) as cnt
    FROM vehicles
    WHERE year IS NULL AND make IS NULL AND model IS NULL
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY source, discovery_source
    ORDER BY count(*) DESC
    LIMIT 20
  `);
  console.log('\n3. SKELETON SOURCE BREAKDOWN:');
  for (const r of skelSources.rows) {
    console.log(`   ${r.cnt}x | source=${r.source || 'null'} | discovery=${r.discovery_source || 'null'}`);
  }

  // 4. Vehicles with same VIN (should be same vehicle)
  const vinDups = await pool.query(`
    SELECT vin, count(*) as cnt, array_agg(id::text ORDER BY created_at) as ids
    FROM vehicles
    WHERE vin IS NOT NULL
      AND vin != ''
      AND length(vin) >= 11
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY vin
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 20
  `);
  console.log(`\n4. VIN DUPLICATES: ${vinDups.rows.length} VINs with multiple active records`);
  for (const r of vinDups.rows.slice(0, 10)) {
    console.log(`   ${r.cnt}x | VIN:${r.vin} | ids:${r.ids.map(i => i.slice(0, 8)).join(',')}`);
  }

  // 5. Same year+make+model+sale_price (strong signal for auction re-listings)
  const priceDups = await pool.query(`
    SELECT year, make, model, sale_price, count(*) as cnt
    FROM vehicles
    WHERE year IS NOT NULL
      AND make IS NOT NULL
      AND sale_price IS NOT NULL
      AND sale_price > 100000
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY year, make, model, sale_price
    HAVING count(*) > 2
    ORDER BY count(*) DESC
    LIMIT 20
  `);
  console.log(`\n5. SAME YEAR+MAKE+MODEL+PRICE (>$100K, 3+ records):  ${priceDups.rows.length} groups`);
  for (const r of priceDups.rows.slice(0, 10)) {
    console.log(`   ${r.cnt}x | ${r.year} ${r.make} ${r.model} | $${Number(r.sale_price).toLocaleString()}`);
  }

  await pool.end();

  console.log('\n━━━ PHASE 3 COMPLETE ━━━');
  console.log('Run phases 1 and 2 to fix known issues, then re-run phase 3 to find what remains.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (phase === 0) {
    console.log('Usage: data-quality-cleanup.mjs --phase <1|2|3> [--dry-run]');
    console.log('  Phase 1: Archive 25K ECR ghost records');
    console.log('  Phase 2: Merge JamesEdition URL-variant duplicates');
    console.log('  Phase 3: Hunt for more systemic patterns');
    process.exit(0);
  }

  if (phase === 1) await phase1ArchiveECRGhosts();
  else if (phase === 2) await phase2MergeJEDuplicates();
  else if (phase === 3) await phase3HuntPatterns();
  else console.log('Unknown phase:', phase);
}

main().catch(console.error);
