#!/usr/bin/env node
/**
 * classify-blank-sources.cjs
 *
 * Handles the remaining blank/Unknown Source vehicles that fix-auction-source.cjs
 * couldn't classify (the ones without listing_urls).
 *
 * Strategy:
 * 1. Check for VIN duplicates against known-source vehicles
 * 2. Check for year+make+model+sale_price duplicates (likely same vehicle)
 * 3. Soft-delete confirmed dupes, classify orphans as 'unknown'
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

async function run() {
  await client.connect();

  const before = await client.query(`
    SELECT
      COUNT(CASE WHEN auction_source IS NULL OR auction_source = '' THEN 1 END)::int as blank,
      COUNT(CASE WHEN auction_source = 'Unknown Source' THEN 1 END)::int as unknown,
      COUNT(CASE WHEN auction_source = 'unknown' THEN 1 END)::int as unknown_lower
    FROM vehicles WHERE deleted_at IS NULL
  `);
  console.log('Before:', JSON.stringify(before.rows[0]));

  // === Step 1: VIN-based dedup ===
  // Blank/Unknown vehicles with VINs that match a known-source vehicle
  console.log('\n=== Step 1: VIN-based dedup ===');
  let vinDeduped = 0;
  while (true) {
    const r = await client.query(`
      UPDATE vehicles SET deleted_at = NOW(), status = 'duplicate'
      WHERE id IN (
        SELECT orphan.id
        FROM vehicles orphan
        WHERE orphan.deleted_at IS NULL
          AND (orphan.auction_source IS NULL OR orphan.auction_source IN ('', 'Unknown Source', 'unknown'))
          AND orphan.vin IS NOT NULL AND orphan.vin != '' AND LENGTH(orphan.vin) >= 11
          AND EXISTS (
            SELECT 1 FROM vehicles known
            WHERE known.deleted_at IS NULL
              AND known.vin = orphan.vin
              AND known.id != orphan.id
              AND known.auction_source IS NOT NULL
              AND known.auction_source NOT IN ('', 'Unknown Source', 'unknown')
          )
        LIMIT 2000
      )
    `);
    vinDeduped += r.rowCount;
    if (r.rowCount === 0) break;
    process.stdout.write(`  VIN deduped: ${vinDeduped}\r`);
    await client.query('SELECT pg_sleep(0.05)');
  }
  console.log(`  VIN deduped: ${vinDeduped}`);

  // === Step 2: Exact match dedup (year+make+model+sale_price) ===
  console.log('\n=== Step 2: Exact match dedup (year+make+model+price) ===');
  let exactDeduped = 0;
  while (true) {
    const r = await client.query(`
      UPDATE vehicles SET deleted_at = NOW(), status = 'duplicate'
      WHERE id IN (
        SELECT orphan.id
        FROM vehicles orphan
        WHERE orphan.deleted_at IS NULL
          AND (orphan.auction_source IS NULL OR orphan.auction_source IN ('', 'Unknown Source', 'unknown'))
          AND orphan.year IS NOT NULL
          AND orphan.make IS NOT NULL AND orphan.make != ''
          AND orphan.model IS NOT NULL AND orphan.model != ''
          AND orphan.sale_price IS NOT NULL AND orphan.sale_price > 0
          AND EXISTS (
            SELECT 1 FROM vehicles known
            WHERE known.deleted_at IS NULL
              AND known.year = orphan.year
              AND known.make = orphan.make
              AND known.model = orphan.model
              AND known.sale_price = orphan.sale_price
              AND known.id != orphan.id
              AND known.auction_source IS NOT NULL
              AND known.auction_source NOT IN ('', 'Unknown Source', 'unknown')
          )
        LIMIT 2000
      )
    `);
    exactDeduped += r.rowCount;
    if (r.rowCount === 0) break;
    process.stdout.write(`  Exact match deduped: ${exactDeduped}\r`);
    await client.query('SELECT pg_sleep(0.05)');
  }
  console.log(`  Exact match deduped: ${exactDeduped}`);

  // === Step 3: Label remaining as 'unknown' ===
  console.log('\n=== Step 3: Label remaining blank → unknown ===');
  let labeled = 0;
  while (true) {
    const r = await client.query(`
      UPDATE vehicles SET auction_source = 'unknown'
      WHERE id IN (
        SELECT id FROM vehicles
        WHERE deleted_at IS NULL
          AND (auction_source IS NULL OR auction_source = '' OR auction_source = 'Unknown Source')
        LIMIT 5000
      )
    `);
    labeled += r.rowCount;
    if (r.rowCount === 0) break;
    process.stdout.write(`  Labeled: ${labeled}\r`);
    await client.query('SELECT pg_sleep(0.05)');
  }
  console.log(`  Labeled: ${labeled}`);

  // Final stats
  const after = await client.query(`
    SELECT auction_source, COUNT(*)::int as c
    FROM vehicles WHERE deleted_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15
  `);
  console.log('\n=== AFTER ===');
  for (const r of after.rows) {
    console.log(`  ${(r.auction_source || '(blank)').padEnd(25)} ${r.c.toLocaleString()}`);
  }

  console.log(`\nTotal: VIN deduped ${vinDeduped}, exact deduped ${exactDeduped}, labeled ${labeled}`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
