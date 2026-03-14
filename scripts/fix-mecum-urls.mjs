#!/usr/bin/env node
/**
 * Fix Mecum URL mismatch: vehicles have www.mecum.com, snapshots have mecum.com
 * Also handles Barrett-Jackson and other www/non-www mismatches.
 */
import pg from 'pg';
const { Client } = pg;

const BATCH = 500;

async function fixUrls(client, name, oldPattern, replacement) {
  let total = 0;
  let batch = 0;
  while (true) {
    try {
      const res = await client.query(`
        UPDATE vehicles SET listing_url = replace(listing_url, '${oldPattern}', '${replacement}')
        WHERE id IN (
          SELECT id FROM vehicles
          WHERE listing_url LIKE '%${oldPattern}%'
            AND deleted_at IS NULL
          LIMIT ${BATCH}
        )
      `);
      batch++;
      total += res.rowCount;
      if (res.rowCount === 0) break;
      if (batch % 10 === 0) console.log(`  ${name}: batch ${batch}, total ${total}`);
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      if (err.message?.includes('deadlock')) { await new Promise(r => setTimeout(r, 2000)); continue; }
      console.error(`  ${name} error: ${err.message}`); break;
    }
  }
  console.log(`  ${name}: done — ${total}`);
  return total;
}

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
  console.log('Connected.\n');

  // Check what snapshot URLs look like
  const snapshotCheck = await client.query(`
    SELECT listing_url FROM listing_page_snapshots
    WHERE listing_url LIKE '%mecum.com%' LIMIT 1
  `);
  console.log('Mecum snapshot URL format:', snapshotCheck.rows[0]?.listing_url);

  const snapshotCheckBJ = await client.query(`
    SELECT listing_url FROM listing_page_snapshots
    WHERE listing_url LIKE '%barrett-jackson.com%' LIMIT 1
  `);
  console.log('BJ snapshot URL format:', snapshotCheckBJ.rows[0]?.listing_url);

  // Check vehicle URLs
  const vehCheck = await client.query(`
    SELECT listing_url FROM vehicles
    WHERE listing_url LIKE '%mecum.com%' AND deleted_at IS NULL LIMIT 1
  `);
  console.log('Mecum vehicle URL format:', vehCheck.rows[0]?.listing_url);

  const vehCheckBJ = await client.query(`
    SELECT listing_url FROM vehicles
    WHERE listing_url LIKE '%barrett-jackson.com%' AND deleted_at IS NULL LIMIT 1
  `);
  console.log('BJ vehicle URL format:', vehCheckBJ.rows[0]?.listing_url);

  // Disable triggers
  await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER');
  console.log('\nTriggers disabled.\n');

  // Now normalize: make vehicle URLs match snapshot URLs
  // Mecum: www.mecum.com → mecum.com (to match snapshots)
  const mecumResult = await fixUrls(client, 'mecum_www', 'www.mecum.com', 'mecum.com');

  // BJ: Check if similar issue
  const bjCheck = await client.query(`
    SELECT
      COUNT(CASE WHEN listing_url LIKE '%www.barrett-jackson.com%' THEN 1 END) AS www,
      COUNT(CASE WHEN listing_url LIKE '%barrett-jackson.com%' AND listing_url NOT LIKE '%www.barrett-jackson.com%' THEN 1 END) AS no_www
    FROM vehicles TABLESAMPLE SYSTEM(1) WHERE listing_url LIKE '%barrett-jackson.com%' AND deleted_at IS NULL
  `);
  console.log('\nBJ vehicles: www=' + bjCheck.rows[0]?.www + ' no_www=' + bjCheck.rows[0]?.no_www);

  const bjSnapCheck = await client.query(`
    SELECT
      COUNT(CASE WHEN listing_url LIKE '%www.barrett-jackson.com%' THEN 1 END) AS www,
      COUNT(CASE WHEN listing_url LIKE '%barrett-jackson.com%' AND listing_url NOT LIKE '%www.barrett-jackson.com%' THEN 1 END) AS no_www
    FROM listing_page_snapshots WHERE listing_url LIKE '%barrett-jackson.com%'
  `);
  console.log('BJ snapshots: www=' + bjSnapCheck.rows[0]?.www + ' no_www=' + bjSnapCheck.rows[0]?.no_www);

  // Normalize BJ if needed
  if (bjCheck.rows[0]?.no_www > 0 && bjSnapCheck.rows[0]?.www > 0) {
    // Snapshots have www, vehicles don't → add www to vehicles
    const bjResult = await fixUrls(client, 'bj_add_www', '://barrett-jackson.com', '://www.barrett-jackson.com');
  } else if (bjCheck.rows[0]?.www > 0 && bjSnapCheck.rows[0]?.no_www > 0) {
    // Vehicles have www, snapshots don't → remove www from vehicles
    const bjResult = await fixUrls(client, 'bj_remove_www', '://www.barrett-jackson.com', '://barrett-jackson.com');
  }

  // Re-enable triggers
  await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER');
  console.log('\nTriggers re-enabled.');

  // Lock check
  const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
  console.log(`Locks: ${locks.rows[0].c}`);

  await client.end();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
