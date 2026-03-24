#!/usr/bin/env node
/**
 * Backfill vehicles.price from other price columns.
 * Priority: canonical_sold_price > bat_sold_price > asking_price > high_bid > sold_price
 *
 * Uses Supabase Management API to run direct SQL UPDATE in batches — no upsert, no deadlocks.
 *
 * Usage: dotenvx run -- node scripts/backfill-vehicle-prices.mjs
 */

const PROJECT_ID = 'qkgaybvrernstplzjaam';
const MGMT_API_URL = `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const BATCH_SIZE = 5000;

if (!ACCESS_TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(MGMT_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function getStats() {
  const result = await sql(`
    SELECT
      COUNT(*) FILTER (WHERE price IS NOT NULL) AS with_price,
      COUNT(*) FILTER (WHERE price IS NULL AND COALESCE(canonical_sold_price, bat_sold_price, asking_price, high_bid, sold_price) IS NOT NULL) AS remaining,
      COUNT(*) AS total
    FROM vehicles
  `);
  return result[0];
}

async function runBatch() {
  // Single SQL UPDATE: set price = first non-null price source, batch of BATCH_SIZE rows
  const result = await sql(`
    UPDATE vehicles
    SET price = COALESCE(canonical_sold_price, bat_sold_price, asking_price, high_bid, sold_price)
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE price IS NULL
        AND COALESCE(canonical_sold_price, bat_sold_price, asking_price, high_bid, sold_price) IS NOT NULL
      LIMIT ${BATCH_SIZE}
    )
  `);

  // Management API returns affected row count in the response
  // It may return an array with one object showing rowCount
  if (Array.isArray(result)) {
    // Some versions return [{rowCount: N}] or just the rows
    const row = result[0];
    if (row && typeof row.rowCount === 'number') return row.rowCount;
    // If result has no rows, the UPDATE may return count via another field
    return result.length;
  }

  return 0;
}

async function runBatchWithCount() {
  // Use a CTE to count how many we actually update
  const result = await sql(`
    WITH updated AS (
      UPDATE vehicles
      SET price = COALESCE(canonical_sold_price, bat_sold_price, asking_price, high_bid, sold_price)
      WHERE id IN (
        SELECT id FROM vehicles
        WHERE price IS NULL
          AND COALESCE(canonical_sold_price, bat_sold_price, asking_price, high_bid, sold_price) IS NOT NULL
        ORDER BY id
        LIMIT ${BATCH_SIZE}
      )
      RETURNING id
    )
    SELECT COUNT(*) AS count FROM updated
  `);

  return parseInt(result[0]?.count ?? '0', 10);
}

async function main() {
  console.log('=== Vehicle Price Backfill ===');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  const initial = await getStats();
  console.log('Initial state:');
  console.log(`  Total vehicles:    ${Number(initial.total).toLocaleString()}`);
  console.log(`  With price:        ${Number(initial.with_price).toLocaleString()}`);
  console.log(`  Remaining to fill: ${Number(initial.remaining).toLocaleString()}\n`);

  if (Number(initial.remaining) === 0) {
    console.log('Nothing to do — all vehicles with price data already have price set.');
    return;
  }

  let totalUpdated = 0;
  let batchNum = 0;
  const startTime = Date.now();

  while (true) {
    batchNum++;
    const count = await runBatchWithCount();

    if (count === 0) break;

    totalUpdated += count;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (totalUpdated / ((Date.now() - startTime) / 1000)).toFixed(0);
    console.log(
      `Batch ${batchNum}: +${count.toLocaleString()} | total: ${totalUpdated.toLocaleString()} | ${elapsed}s | ~${rate} rows/s`
    );

    // Brief pause between batches to avoid overwhelming the DB
    if (count === BATCH_SIZE) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const final = await getStats();

  console.log(`\n=== Done in ${elapsed}s ===`);
  console.log(`  Updated this run:  ${totalUpdated.toLocaleString()}`);
  console.log(`  With price now:    ${Number(final.with_price).toLocaleString()}`);
  console.log(`  Still remaining:   ${Number(final.remaining).toLocaleString()}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
