#!/usr/bin/env node
/**
 * dedupe-vehicles-fast.cjs
 *
 * Fast bulk dedup: for each duplicated listing_url, keep the oldest record,
 * soft-delete the rest. Uses batched SQL instead of per-URL scoring.
 *
 * ~100x faster than the per-URL approach.
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

async function run() {
  await client.connect();

  const before = await client.query(`SELECT COUNT(*)::int as active FROM vehicles WHERE deleted_at IS NULL`);
  const beforeDel = await client.query(`SELECT COUNT(*)::int as deleted FROM vehicles WHERE deleted_at IS NOT NULL`);
  console.log(`Before: ${before.rows[0].active.toLocaleString()} active, ${beforeDel.rows[0].deleted.toLocaleString()} soft-deleted`);

  // Count how many dupes exist
  const dupeCount = await client.query(`
    SELECT COUNT(*)::int as dupes FROM (
      SELECT listing_url FROM vehicles
      WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url != ''
      GROUP BY listing_url HAVING COUNT(*) > 1
    ) t
  `);
  console.log(`Duplicated URLs: ${dupeCount.rows[0].dupes.toLocaleString()}`);

  let totalDeleted = 0;
  let iteration = 0;

  while (true) {
    // Batch: soft-delete non-oldest records for duplicated URLs
    // This finds duped URLs, picks the min(id) as keeper, deletes the rest
    const r = await client.query(`
      UPDATE vehicles SET deleted_at = NOW(), status = 'duplicate'
      WHERE id IN (
        SELECT v.id
        FROM vehicles v
        JOIN (
          SELECT DISTINCT ON (listing_url) listing_url, id as keep_id
          FROM vehicles
          WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url != ''
            AND listing_url IN (
              SELECT listing_url FROM vehicles
              WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url != ''
              GROUP BY listing_url HAVING COUNT(*) > 1
              LIMIT 500
            )
          ORDER BY listing_url, created_at ASC
        ) dupes ON v.listing_url = dupes.listing_url
        WHERE v.deleted_at IS NULL AND v.id != dupes.keep_id
        LIMIT 5000
      )
    `);

    totalDeleted += r.rowCount;
    iteration++;

    if (r.rowCount === 0) break;

    if (iteration % 5 === 0 || r.rowCount < 5000) {
      console.log(`  Iteration ${iteration}: ${totalDeleted.toLocaleString()} total soft-deleted`);
    }

    await client.query('SELECT pg_sleep(0.05)');
  }

  const after = await client.query(`SELECT COUNT(*)::int as active FROM vehicles WHERE deleted_at IS NULL`);
  const afterDel = await client.query(`SELECT COUNT(*)::int as deleted FROM vehicles WHERE deleted_at IS NOT NULL`);

  console.log(`\n=== DONE ===`);
  console.log(`Soft-deleted this run: ${totalDeleted.toLocaleString()}`);
  console.log(`Active: ${before.rows[0].active.toLocaleString()} → ${after.rows[0].active.toLocaleString()}`);
  console.log(`Deleted: ${beforeDel.rows[0].deleted.toLocaleString()} → ${afterDel.rows[0].deleted.toLocaleString()}`);

  // Final breakdown
  const breakdown = await client.query(`
    SELECT COALESCE(NULLIF(auction_source,''), '(blank)') as src, COUNT(*)::int as total
    FROM vehicles WHERE deleted_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15
  `);
  console.log('\n=== Post-dedup breakdown ===');
  for (const r of breakdown.rows) {
    console.log(`  ${r.src.padEnd(25)} ${r.total.toLocaleString()}`);
  }

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
