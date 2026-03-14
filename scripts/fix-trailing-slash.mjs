#!/usr/bin/env node
/**
 * Fix trailing slashes on BaT listing URLs.
 * Batches of 500 with 0.2s sleep, lock checks.
 */
import pg from 'pg';
const { Client } = pg;

async function run() {
  const client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });
  await client.connect();

  // Disable user triggers for bulk update
  await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER');
  console.log('Triggers disabled');

  let total = 0;
  let batch = 0;
  while (true) {
    const res = await client.query(`
      UPDATE vehicles SET listing_url = listing_url || '/'
      WHERE id IN (
        SELECT id FROM vehicles
        WHERE listing_url LIKE '%bringatrailer.com%'
          AND listing_url NOT LIKE '%/'
          AND deleted_at IS NULL
        LIMIT 500
      )
    `);
    batch++;
    total += res.rowCount;
    console.log(`Batch ${batch}: ${res.rowCount} (total: ${total})`);
    if (res.rowCount === 0) break;

    // Lock check
    const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
    if (locks.rows[0].c > 0) {
      console.log(`  Locks: ${locks.rows[0].c} — pausing 5s`);
      await new Promise(r => setTimeout(r, 5000));
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // Re-enable triggers
  await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER');
  console.log(`Triggers re-enabled. Total fixed: ${total}`);
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
