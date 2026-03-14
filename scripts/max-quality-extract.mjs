#!/usr/bin/env node
/**
 * Maximum Quality Extraction Script
 *
 * Runs ALL possible backfill operations in sequence:
 * 1. Backfill listing_url from vehicle_events (42K vehicles)
 * 2. Backfill listing_url from bat_auction_url (~18K vehicles)
 * 3. Backfill sale_price from multiple price columns
 * 4. Backfill sale_price from vehicle_events.final_price
 * 5. Extract price from BaT snapshot title tags
 * 6. Extract og:image from snapshots
 * 7. Extract description from snapshots (BaT, C&B, Mecum)
 * 8. Extract transmission from BaT snapshots
 * 9. Extract mileage from BaT snapshots
 *
 * All operations: batches of 500, pg_sleep(0.2), lock checks, triggers disabled.
 */
import pg from 'pg';
const { Client } = pg;

const BATCH = 500;

async function runBatchedUpdate(client, name, sql, opts = {}) {
  const { maxBatches = 10000 } = opts;
  let total = 0;
  let batch = 0;

  while (batch < maxBatches) {
    try {
      const res = await client.query(sql);
      const affected = res.rowCount || 0;
      total += affected;
      batch++;

      if (affected === 0) {
        console.log(`  ${name}: done — ${total} total`);
        return total;
      }

      if (batch % 10 === 0 || affected < BATCH) {
        console.log(`  ${name}: batch ${batch}, ${affected} rows (total: ${total})`);
      }

      // Lock check every 5 batches
      if (batch % 5 === 0) {
        const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
        if (locks.rows[0].c > 2) {
          console.log(`  ⚠️  ${locks.rows[0].c} locks — pausing 5s`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      if (err.message?.includes('deadlock')) {
        console.log(`  ⚠️  Deadlock, retrying after 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      console.error(`  ❌ ${name} error: ${err.message}`);
      return total;
    }
  }
  console.log(`  ${name}: hit max batches — ${total} total`);
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
    statement_timeout: 90000,
  });
  await client.connect();
  console.log('Connected. Starting maximum quality extraction...\n');

  // Disable triggers
  await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER');
  console.log('Triggers disabled.\n');

  const results = {};

  // === 1. BACKFILL listing_url FROM vehicle_events ===
  console.log('=== 1. BACKFILL listing_url FROM vehicle_events ===');
  results['url_from_events'] = await runBatchedUpdate(client, 'url_from_events', `
    UPDATE vehicles v SET listing_url = ve.source_url
    FROM (
      SELECT DISTINCT ON (vehicle_id) vehicle_id, source_url
      FROM vehicle_events
      WHERE source_url IS NOT NULL AND source_url != ''
      ORDER BY vehicle_id, created_at DESC
    ) ve
    WHERE v.id = ve.vehicle_id
      AND (v.listing_url IS NULL OR v.listing_url = '')
      AND v.deleted_at IS NULL
      AND v.id IN (
        SELECT id FROM vehicles
        WHERE (listing_url IS NULL OR listing_url = '') AND deleted_at IS NULL
        LIMIT ${BATCH}
      )
  `);

  // === 2. BACKFILL listing_url FROM bat_auction_url ===
  console.log('\n=== 2. BACKFILL listing_url FROM bat_auction_url ===');
  results['url_from_bat'] = await runBatchedUpdate(client, 'url_from_bat', `
    UPDATE vehicles SET listing_url = bat_auction_url
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE bat_auction_url IS NOT NULL AND bat_auction_url != ''
        AND (listing_url IS NULL OR listing_url = '')
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // === 3. BACKFILL sale_price FROM other price columns ===
  console.log('\n=== 3. BACKFILL sale_price FROM other price columns ===');
  // From sold_price
  results['price_from_sold'] = await runBatchedUpdate(client, 'price_from_sold_price', `
    UPDATE vehicles SET sale_price = sold_price
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE sold_price IS NOT NULL AND sold_price > 100
        AND (sale_price IS NULL OR sale_price = 0)
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // From winning_bid
  results['price_from_winning'] = await runBatchedUpdate(client, 'price_from_winning_bid', `
    UPDATE vehicles SET sale_price = winning_bid
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE winning_bid IS NOT NULL AND winning_bid > 100
        AND (sale_price IS NULL OR sale_price = 0)
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // From high_bid (if no reserve met, high_bid is still the best price signal)
  results['price_from_highbid'] = await runBatchedUpdate(client, 'price_from_high_bid', `
    UPDATE vehicles SET sale_price = high_bid
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE high_bid IS NOT NULL AND high_bid > 100
        AND (sale_price IS NULL OR sale_price = 0)
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // From asking_price (last resort)
  results['price_from_asking'] = await runBatchedUpdate(client, 'price_from_asking', `
    UPDATE vehicles SET sale_price = asking_price
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE asking_price IS NOT NULL AND asking_price > 100
        AND (sale_price IS NULL OR sale_price = 0)
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // From price column
  results['price_from_price'] = await runBatchedUpdate(client, 'price_from_price_col', `
    UPDATE vehicles SET sale_price = price
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE price IS NOT NULL AND price > 100
        AND (sale_price IS NULL OR sale_price = 0)
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // From bat_sold_price
  results['price_from_bat'] = await runBatchedUpdate(client, 'price_from_bat_sold', `
    UPDATE vehicles SET sale_price = bat_sold_price
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE bat_sold_price IS NOT NULL AND bat_sold_price > 100
        AND (sale_price IS NULL OR sale_price = 0)
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // === 4. BACKFILL sale_price FROM vehicle_events ===
  console.log('\n=== 4. BACKFILL sale_price FROM vehicle_events ===');
  results['price_from_events'] = await runBatchedUpdate(client, 'price_from_events', `
    UPDATE vehicles v SET sale_price = ve.final_price
    FROM (
      SELECT DISTINCT ON (vehicle_id) vehicle_id, final_price
      FROM vehicle_events
      WHERE final_price IS NOT NULL AND final_price > 100
      ORDER BY vehicle_id, created_at DESC
    ) ve
    WHERE v.id = ve.vehicle_id
      AND (v.sale_price IS NULL OR v.sale_price = 0)
      AND v.deleted_at IS NULL
      AND v.id IN (
        SELECT id FROM vehicles
        WHERE (sale_price IS NULL OR sale_price = 0) AND deleted_at IS NULL
        LIMIT ${BATCH}
      )
  `);

  // === 5. EXTRACT price FROM BaT snapshot title tags ===
  console.log('\n=== 5. EXTRACT price FROM BaT snapshot title tags ===');
  results['price_from_snapshots'] = await runBatchedUpdate(client, 'price_from_snapshot_title', `
    WITH batch AS (
      SELECT v.id AS vid,
        regexp_replace(substring(lps.html from 'sold for \\$([0-9,]+)'), ',', '', 'g')::integer AS extracted_price
      FROM vehicles v
      JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
      WHERE v.deleted_at IS NULL
        AND v.listing_url LIKE '%bringatrailer.com%'
        AND (v.sale_price IS NULL OR v.sale_price = 0)
        AND lps.html IS NOT NULL
      LIMIT ${BATCH}
    )
    UPDATE vehicles v SET sale_price = b.extracted_price
    FROM batch b
    WHERE v.id = b.vid AND b.extracted_price IS NOT NULL AND b.extracted_price > 100
  `);

  // === 6. EXTRACT og:image FROM snapshots ===
  console.log('\n=== 6. EXTRACT og:image FROM ALL snapshots ===');
  results['image_from_snapshots'] = await runBatchedUpdate(client, 'image_from_snapshots', `
    WITH batch AS (
      SELECT v.id AS vid,
        substring(lps.html from '<meta property="og:image" content="([^"]+)"') AS img
      FROM vehicles v
      JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
      WHERE v.deleted_at IS NULL
        AND (v.primary_image_url IS NULL OR v.primary_image_url = '')
        AND lps.html IS NOT NULL
      LIMIT ${BATCH}
    )
    UPDATE vehicles v SET primary_image_url = b.img
    FROM batch b
    WHERE v.id = b.vid AND b.img IS NOT NULL AND b.img != ''
  `);

  // === 7. EXTRACT description FROM snapshots ===
  console.log('\n=== 7. EXTRACT description FROM snapshots ===');
  // BaT descriptions from JSON-LD
  results['desc_from_bat_snapshots'] = await runBatchedUpdate(client, 'desc_bat', `
    WITH batch AS (
      SELECT v.id AS vid,
        left(substring(lps.html from '"description"[^:]*:[^"]*"([^"]+)'), 2000) AS desc_text
      FROM vehicles v
      JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
      WHERE v.deleted_at IS NULL
        AND v.listing_url LIKE '%bringatrailer.com%'
        AND (v.description IS NULL OR v.description = '')
        AND lps.html IS NOT NULL
      LIMIT ${BATCH}
    )
    UPDATE vehicles v SET description = b.desc_text
    FROM batch b
    WHERE v.id = b.vid AND b.desc_text IS NOT NULL AND length(b.desc_text) > 20
  `);

  // og:description for non-BaT
  results['desc_from_og'] = await runBatchedUpdate(client, 'desc_og', `
    WITH batch AS (
      SELECT v.id AS vid,
        left(substring(lps.html from 'property="og:description"[^>]*content="([^"]+)'), 2000) AS desc_text
      FROM vehicles v
      JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
      WHERE v.deleted_at IS NULL
        AND v.listing_url NOT LIKE '%bringatrailer.com%'
        AND (v.description IS NULL OR v.description = '')
        AND lps.html IS NOT NULL
      LIMIT ${BATCH}
    )
    UPDATE vehicles v SET description = b.desc_text
    FROM batch b
    WHERE v.id = b.vid AND b.desc_text IS NOT NULL AND length(b.desc_text) > 20
  `);

  // === 8. EXTRACT transmission FROM BaT snapshots ===
  console.log('\n=== 8. EXTRACT transmission FROM BaT snapshots ===');
  results['trans_from_snapshots'] = await runBatchedUpdate(client, 'transmission', `
    WITH batch AS (
      SELECT v.id AS vid,
        CASE
          WHEN lps.html ~* 'automatic|auto trans|tiptronic|powerglide|turbo-hydramatic|hydra-matic' THEN 'Automatic'
          WHEN lps.html ~* '(?:^|[^a-z])manual|stick shift|(?:3|4|5|6)-speed(?:\\s+manual)?' THEN 'Manual'
          ELSE NULL
        END AS trans
      FROM vehicles v
      JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
      WHERE v.deleted_at IS NULL
        AND v.listing_url LIKE '%bringatrailer.com%'
        AND (v.transmission IS NULL OR v.transmission = '')
        AND lps.html IS NOT NULL
      LIMIT ${BATCH}
    )
    UPDATE vehicles v SET transmission = b.trans
    FROM batch b
    WHERE v.id = b.vid AND b.trans IS NOT NULL
  `);

  // === 9. EXTRACT mileage FROM BaT snapshots ===
  console.log('\n=== 9. EXTRACT mileage FROM BaT snapshots ===');
  results['mileage_from_snapshots'] = await runBatchedUpdate(client, 'mileage', `
    WITH batch AS (
      SELECT v.id AS vid,
        NULLIF(regexp_replace(COALESCE(substring(lps.html from '([0-9][0-9,]+)\\s+(?:miles|mi)'), ''), ',', '', 'g'), '')::integer AS miles
      FROM vehicles v
      JOIN listing_page_snapshots lps ON lps.listing_url = v.listing_url
      WHERE v.deleted_at IS NULL
        AND v.listing_url LIKE '%bringatrailer.com%'
        AND (v.mileage IS NULL OR v.mileage = 0)
        AND lps.html IS NOT NULL
      LIMIT ${BATCH}
    )
    UPDATE vehicles v SET mileage = b.miles
    FROM batch b
    WHERE v.id = b.vid AND b.miles IS NOT NULL AND b.miles > 0 AND b.miles < 1000000
  `);

  // === 10. FIX trailing slashes on new URLs (from step 1 & 2) ===
  console.log('\n=== 10. FIX trailing slashes on newly-backfilled BaT URLs ===');
  results['trailing_slash_fix'] = await runBatchedUpdate(client, 'trailing_slash', `
    UPDATE vehicles SET listing_url = listing_url || '/'
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE listing_url LIKE '%bringatrailer.com%'
        AND listing_url NOT LIKE '%/'
        AND deleted_at IS NULL
      LIMIT ${BATCH}
    )
  `);

  // Re-enable triggers
  await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER');
  console.log('\nTriggers re-enabled.');

  // Lock check
  const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
  console.log(`Final lock check: ${locks.rows[0].c} locks`);

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  EXTRACTION SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  let grandTotal = 0;
  for (const [key, count] of Object.entries(results)) {
    console.log(`  ${key}: ${count} rows`);
    grandTotal += count;
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  GRAND TOTAL: ${grandTotal} field updates`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await client.end();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
