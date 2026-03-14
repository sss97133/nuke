#!/usr/bin/env node
/**
 * Soft-delete dead-weight vehicles that:
 * 1. Have no price, no image, no description, no VIN
 * 2. Have no valid listing URL (NULL or fake protocol like conceptcarz://)
 * 3. Cannot be enriched from any existing data source
 *
 * These drag down quality metrics and add no value.
 */
import pg from 'pg';
const { Client } = pg;

const BATCH = 500;
const dryRun = process.argv.includes('--dry-run');

async function run() {
  const client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });
  await client.connect();
  console.log(`Connected. Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // Count candidates
  const countRes = await client.query(`
    SELECT COUNT(*) AS cnt FROM vehicles
    WHERE deleted_at IS NULL
      AND (sale_price IS NULL OR sale_price = 0)
      AND (primary_image_url IS NULL OR primary_image_url = '')
      AND (description IS NULL OR description = '')
      AND (vin IS NULL OR vin = '')
      AND (
        listing_url IS NULL OR listing_url = ''
        OR listing_url LIKE 'conceptcarz://%'
        OR listing_url LIKE 'internal://%'
      )
  `);
  console.log(`Dead-weight candidates: ${countRes.rows[0].cnt}\n`);

  if (dryRun) {
    // Show sample
    const sample = await client.query(`
      SELECT year, make, model, auction_source, left(listing_url, 50) AS url
      FROM vehicles
      WHERE deleted_at IS NULL
        AND (sale_price IS NULL OR sale_price = 0)
        AND (primary_image_url IS NULL OR primary_image_url = '')
        AND (description IS NULL OR description = '')
        AND (vin IS NULL OR vin = '')
        AND (listing_url IS NULL OR listing_url = '' OR listing_url LIKE 'conceptcarz://%' OR listing_url LIKE 'internal://%')
      LIMIT 10
    `);
    console.log('Sample:');
    sample.rows.forEach(r => console.log(`  ${r.year || '-'} ${r.make} ${r.model} [${r.auction_source}] ${r.url || 'NULL'}`));
    await client.end();
    return;
  }

  // Disable triggers
  await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER');
  console.log('Triggers disabled.\n');

  let total = 0;
  let batch = 0;
  while (true) {
    // First find IDs, then update — avoids nested scan timeout
    const ids = await client.query(`
      SELECT id FROM vehicles
      WHERE deleted_at IS NULL
        AND (sale_price IS NULL OR sale_price = 0)
        AND (primary_image_url IS NULL OR primary_image_url = '')
        AND (description IS NULL OR description = '')
        AND (vin IS NULL OR vin = '')
        AND (
          listing_url IS NULL OR listing_url = ''
          OR listing_url LIKE 'conceptcarz://%'
          OR listing_url LIKE 'internal://%'
        )
      LIMIT ${BATCH}
    `);
    if (ids.rows.length === 0) { batch++; break; }
    const idList = ids.rows.map(r => r.id);
    const res = await client.query(`
      UPDATE vehicles SET deleted_at = now()
      WHERE id = ANY($1::uuid[])
    `, [idList]);
    batch++;
    total += res.rowCount;
    if (res.rowCount === 0) break;
    if (batch % 10 === 0) console.log(`  Batch ${batch}: total ${total} soft-deleted`);

    // Lock check
    if (batch % 5 === 0) {
      const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
      if (locks.rows[0].c > 2) {
        console.log(`  ⚠️  ${locks.rows[0].c} locks — pausing 5s`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER');
  console.log(`\nTriggers re-enabled.`);
  console.log(`\n━━━ DEAD WEIGHT PURGE RESULTS ━━━`);
  console.log(`Soft-deleted: ${total} vehicles`);

  await client.end();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
