#!/usr/bin/env node
/**
 * create-orphan-stubs.cjs
 *
 * Creates vehicle stubs for BaT snapshots that have no vehicle record.
 * Uses set-diff approach: load all snapshot URLs, load all vehicle URLs, diff in memory.
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

async function run() {
  await client.connect();

  // Load all BaT snapshot URLs (cursor approach)
  console.log('Loading snapshot URLs...');
  const snapshotUrls = new Set();
  let lastUrl = '';
  while (true) {
    const r = await client.query(`
      SELECT DISTINCT listing_url FROM listing_page_snapshots
      WHERE platform = 'bat' AND success = true AND listing_url > $1
      ORDER BY listing_url LIMIT 5000
    `, [lastUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) snapshotUrls.add(row.listing_url.replace(/\/$/, ''));
    lastUrl = r.rows[r.rows.length - 1].listing_url;
  }
  console.log(`  Snapshot URLs: ${snapshotUrls.size}`);

  // Load all BaT vehicle URLs
  console.log('Loading vehicle URLs...');
  const vehicleUrls = new Set();
  lastUrl = '';
  while (true) {
    const r = await client.query(`
      SELECT listing_url FROM vehicles
      WHERE auction_source = 'bat' AND deleted_at IS NULL
        AND listing_url IS NOT NULL AND listing_url != '' AND listing_url > $1
      ORDER BY listing_url LIMIT 5000
    `, [lastUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) vehicleUrls.add(row.listing_url.replace(/\/$/, ''));
    lastUrl = r.rows[r.rows.length - 1].listing_url;
  }
  console.log(`  Vehicle URLs: ${vehicleUrls.size}`);

  // Diff: snapshots without vehicles
  const orphans = [];
  for (const url of snapshotUrls) {
    if (!vehicleUrls.has(url)) orphans.push(url);
  }
  console.log(`  Orphan snapshots (need vehicle): ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('Nothing to do!');
    await client.end();
    return;
  }

  // Insert in batches
  let created = 0, skipped = 0;
  for (let i = 0; i < orphans.length; i++) {
    try {
      await client.query(
        `INSERT INTO vehicles (listing_url, auction_source, status) VALUES ($1, 'bat', 'pending_backfill')`,
        [orphans[i]]
      );
      created++;
    } catch (e) {
      skipped++;
    }

    if ((created + skipped) % 2000 === 0) {
      console.log(`  ${created + skipped}/${orphans.length} — ${created} created, ${skipped} skipped`);
      await new Promise(r => setTimeout(r, 50));
    }
  }

  console.log(`\nDone: ${created} stubs created, ${skipped} skipped (already exist)`);

  const stats = await client.query(`
    SELECT COUNT(*)::int as total FROM vehicles WHERE auction_source = 'bat' AND deleted_at IS NULL
  `);
  console.log(`BaT vehicles now: ${stats.rows[0].total}`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
