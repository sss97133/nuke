#!/usr/bin/env node
/**
 * dedupe-vehicles.cjs
 *
 * Finds all vehicles sharing the same listing_url, keeps the best one
 * (highest field score, oldest as tiebreak), soft-deletes the rest.
 *
 * Processes in batches to avoid statement timeouts.
 * Expected to remove ~440K+ duplicate BaT rows from a runaway Feb 10-19 extraction loop.
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

async function run() {
  await client.connect();

  // Before stats
  const before = await client.query(`SELECT COUNT(*)::int as total FROM vehicles WHERE deleted_at IS NULL`);
  console.log(`Total active vehicles before: ${before.rows[0].total.toLocaleString()}`);

  // Step 1: Find all duplicated listing_urls (any platform)
  console.log('\n=== Step 1: Finding duplicated listing_urls ===');

  // Process in cursor-style batches by listing_url
  let totalDeleted = 0;
  let totalUrlsProcessed = 0;
  let lastUrl = '';

  while (true) {
    // Get next batch of duplicated URLs
    const urlBatch = await client.query(`
      SELECT listing_url, COUNT(*)::int as cnt
      FROM vehicles
      WHERE deleted_at IS NULL
        AND listing_url IS NOT NULL AND listing_url != ''
        AND listing_url > $1
      GROUP BY listing_url
      HAVING COUNT(*) > 1
      ORDER BY listing_url
      LIMIT 200
    `, [lastUrl]);

    if (urlBatch.rows.length === 0) break;

    for (const row of urlBatch.rows) {
      const url = row.listing_url;

      // Find the best record for this URL (most non-null fields, oldest as tiebreak)
      const best = await client.query(`
        SELECT id,
          (CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END +
           CASE WHEN make IS NOT NULL AND make != '' THEN 1 ELSE 0 END +
           CASE WHEN model IS NOT NULL AND model != '' THEN 1 ELSE 0 END +
           CASE WHEN vin IS NOT NULL AND vin != '' THEN 1 ELSE 0 END +
           CASE WHEN sale_price IS NOT NULL THEN 1 ELSE 0 END +
           CASE WHEN listing_location IS NOT NULL THEN 1 ELSE 0 END +
           CASE WHEN gps_latitude IS NOT NULL THEN 1 ELSE 0 END +
           CASE WHEN engine_type IS NOT NULL THEN 1 ELSE 0 END +
           CASE WHEN mileage IS NOT NULL THEN 1 ELSE 0 END +
           CASE WHEN transmission IS NOT NULL THEN 1 ELSE 0 END +
           CASE WHEN description IS NOT NULL THEN 1 ELSE 0 END) as score
        FROM vehicles
        WHERE listing_url = $1 AND deleted_at IS NULL
        ORDER BY score DESC, created_at ASC
        LIMIT 1
      `, [url]);

      if (best.rows.length === 0) continue;
      const keepId = best.rows[0].id;

      // Soft-delete all other records with this URL
      const del = await client.query(`
        UPDATE vehicles
        SET deleted_at = NOW(), status = 'duplicate'
        WHERE listing_url = $1 AND deleted_at IS NULL AND id != $2
      `, [url, keepId]);

      totalDeleted += del.rowCount;
      totalUrlsProcessed++;
    }

    lastUrl = urlBatch.rows[urlBatch.rows.length - 1].listing_url;

    if (totalUrlsProcessed % 500 === 0 || urlBatch.rows.length < 200) {
      console.log(`  URLs processed: ${totalUrlsProcessed.toLocaleString()}, duplicates removed: ${totalDeleted.toLocaleString()}`);
    }

    await client.query('SELECT pg_sleep(0.05)');
    if (urlBatch.rows.length < 200) break;
  }

  console.log(`\nDedup complete: ${totalUrlsProcessed.toLocaleString()} URLs deduped, ${totalDeleted.toLocaleString()} duplicates soft-deleted`);

  // After stats
  const after = await client.query(`SELECT COUNT(*)::int as total FROM vehicles WHERE deleted_at IS NULL`);
  console.log(`\nTotal active vehicles before: ${before.rows[0].total.toLocaleString()}`);
  console.log(`Total active vehicles after:  ${after.rows[0].total.toLocaleString()}`);
  console.log(`Removed: ${(before.rows[0].total - after.rows[0].total).toLocaleString()}`);

  // Platform breakdown after
  const breakdown = await client.query(`
    SELECT COALESCE(NULLIF(auction_source,''), '(blank)') as src, COUNT(*)::int as total
    FROM vehicles WHERE deleted_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15
  `);
  console.log('\n=== After dedup breakdown ===');
  for (const r of breakdown.rows) {
    console.log(`  ${r.src.padEnd(25)} ${r.total.toLocaleString()}`);
  }

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
