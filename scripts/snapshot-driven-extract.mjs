#!/usr/bin/env node
/**
 * Snapshot-Driven Extraction
 *
 * Instead of scanning vehicles→snapshots (which times out on 1.3M vehicles),
 * this scans snapshots→vehicles (only 600K snapshots, much faster).
 *
 * For each snapshot with HTML, extracts fields and updates the matching vehicle.
 */
import pg from 'pg';
const { Client } = pg;

const BATCH = 200; // Smaller batches since regex on HTML is expensive
const args = process.argv.slice(2);
const source = args.find(a => a.startsWith('--source='))?.split('=')[1] || 'bat';

const SOURCE_URLS = {
  bat: '%bringatrailer.com%',
  carsandbids: '%carsandbids.com%',
  mecum: '%mecum.com%',
  bj: '%barrett-jackson.com%',
};

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

  const urlPattern = SOURCE_URLS[source] || SOURCE_URLS.bat;
  console.log(`Connected. Source: ${source} (${urlPattern}). Batch: ${BATCH}\n`);

  // Disable triggers
  await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER');
  console.log('Triggers disabled.\n');

  const results = {};

  // === PRICE from title tag (BaT specific: "sold for $XX,XXX") ===
  if (source === 'bat') {
    console.log('=== PRICE from BaT title tag ===');
    results.price = 0;
    let batch = 0;
    while (true) {
      try {
        const res = await client.query(`
          UPDATE vehicles v
          SET sale_price = sub.extracted_price
          FROM (
            SELECT lps.listing_url,
              regexp_replace(substring(lps.html from 'sold for \\$([0-9,]+)'), ',', '', 'g')::integer AS extracted_price
            FROM listing_page_snapshots lps
            WHERE lps.listing_url LIKE '${urlPattern}'
              AND lps.html IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM vehicles v2
                WHERE v2.listing_url = lps.listing_url
                  AND v2.deleted_at IS NULL
                  AND (v2.sale_price IS NULL OR v2.sale_price = 0)
              )
            LIMIT ${BATCH}
          ) sub
          WHERE v.listing_url = sub.listing_url
            AND v.deleted_at IS NULL
            AND (v.sale_price IS NULL OR v.sale_price = 0)
            AND sub.extracted_price IS NOT NULL
            AND sub.extracted_price > 100
        `);
        batch++;
        results.price += res.rowCount;
        if (res.rowCount === 0) { console.log(`  Price: done — ${results.price} total`); break; }
        if (batch % 5 === 0) console.log(`  Price batch ${batch}: ${res.rowCount} (total: ${results.price})`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        if (err.message?.includes('deadlock')) { await new Promise(r => setTimeout(r, 2000)); continue; }
        console.error(`  Price error: ${err.message}`); break;
      }
    }
  }

  // === IMAGE from og:image ===
  console.log('\n=== IMAGE from og:image ===');
  results.image = 0;
  let imgBatch = 0;
  while (true) {
    try {
      const res = await client.query(`
        UPDATE vehicles v
        SET primary_image_url = sub.img
        FROM (
          SELECT lps.listing_url,
            substring(lps.html from '<meta property="og:image" content="([^"]+)"') AS img
          FROM listing_page_snapshots lps
          WHERE lps.listing_url LIKE '${urlPattern}'
            AND lps.html IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM vehicles v2
              WHERE v2.listing_url = lps.listing_url
                AND v2.deleted_at IS NULL
                AND (v2.primary_image_url IS NULL OR v2.primary_image_url = '')
            )
          LIMIT ${BATCH}
        ) sub
        WHERE v.listing_url = sub.listing_url
          AND v.deleted_at IS NULL
          AND (v.primary_image_url IS NULL OR v.primary_image_url = '')
          AND sub.img IS NOT NULL AND sub.img != ''
      `);
      imgBatch++;
      results.image += res.rowCount;
      if (res.rowCount === 0) { console.log(`  Image: done — ${results.image} total`); break; }
      if (imgBatch % 5 === 0) console.log(`  Image batch ${imgBatch}: ${res.rowCount} (total: ${results.image})`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      if (err.message?.includes('deadlock')) { await new Promise(r => setTimeout(r, 2000)); continue; }
      console.error(`  Image error: ${err.message}`); break;
    }
  }

  // === DESCRIPTION ===
  console.log('\n=== DESCRIPTION ===');
  results.description = 0;
  let descBatch = 0;
  const descRegex = source === 'bat'
    ? `substring(lps.html from '"description"[^:]*:[^"]*"([^"]+)')`
    : `substring(lps.html from 'property="og:description"[^>]*content="([^"]+)')`;
  while (true) {
    try {
      const res = await client.query(`
        UPDATE vehicles v
        SET description = left(sub.desc_text, 2000)
        FROM (
          SELECT lps.listing_url,
            ${descRegex} AS desc_text
          FROM listing_page_snapshots lps
          WHERE lps.listing_url LIKE '${urlPattern}'
            AND lps.html IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM vehicles v2
              WHERE v2.listing_url = lps.listing_url
                AND v2.deleted_at IS NULL
                AND (v2.description IS NULL OR v2.description = '')
            )
          LIMIT ${BATCH}
        ) sub
        WHERE v.listing_url = sub.listing_url
          AND v.deleted_at IS NULL
          AND (v.description IS NULL OR v.description = '')
          AND sub.desc_text IS NOT NULL AND length(sub.desc_text) > 20
      `);
      descBatch++;
      results.description += res.rowCount;
      if (res.rowCount === 0) { console.log(`  Desc: done — ${results.description} total`); break; }
      if (descBatch % 5 === 0) console.log(`  Desc batch ${descBatch}: ${res.rowCount} (total: ${results.description})`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      if (err.message?.includes('deadlock')) { await new Promise(r => setTimeout(r, 2000)); continue; }
      console.error(`  Desc error: ${err.message}`); break;
    }
  }

  // === TRANSMISSION (BaT only) ===
  if (source === 'bat') {
    console.log('\n=== TRANSMISSION ===');
    results.transmission = 0;
    let transBatch = 0;
    while (true) {
      try {
        const res = await client.query(`
          UPDATE vehicles v
          SET transmission = sub.trans
          FROM (
            SELECT lps.listing_url,
              CASE
                WHEN lps.html ~* 'automatic|auto trans|tiptronic|powerglide|turbo.hydramatic|hydra.matic' THEN 'Automatic'
                WHEN lps.html ~* 'manual|stick.shift|[3-6]-speed.manual|[3-6]-speed.gearbox' THEN 'Manual'
                ELSE NULL
              END AS trans
            FROM listing_page_snapshots lps
            WHERE lps.listing_url LIKE '${urlPattern}'
              AND lps.html IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM vehicles v2
                WHERE v2.listing_url = lps.listing_url
                  AND v2.deleted_at IS NULL
                  AND (v2.transmission IS NULL OR v2.transmission = '')
              )
            LIMIT ${BATCH}
          ) sub
          WHERE v.listing_url = sub.listing_url
            AND v.deleted_at IS NULL
            AND (v.transmission IS NULL OR v.transmission = '')
            AND sub.trans IS NOT NULL
        `);
        transBatch++;
        results.transmission += res.rowCount;
        if (res.rowCount === 0) { console.log(`  Trans: done — ${results.transmission} total`); break; }
        if (transBatch % 5 === 0) console.log(`  Trans batch ${transBatch}: ${res.rowCount} (total: ${results.transmission})`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        if (err.message?.includes('deadlock')) { await new Promise(r => setTimeout(r, 2000)); continue; }
        console.error(`  Trans error: ${err.message}`); break;
      }
    }
  }

  // === MILEAGE (BaT only) ===
  if (source === 'bat') {
    console.log('\n=== MILEAGE ===');
    results.mileage = 0;
    let mileBatch = 0;
    while (true) {
      try {
        const res = await client.query(`
          UPDATE vehicles v
          SET mileage = sub.miles
          FROM (
            SELECT lps.listing_url,
              NULLIF(regexp_replace(COALESCE(substring(lps.html from '([0-9][0-9,]+)\\s+(?:miles|mi)'), ''), ',', '', 'g'), '')::integer AS miles
            FROM listing_page_snapshots lps
            WHERE lps.listing_url LIKE '${urlPattern}'
              AND lps.html IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM vehicles v2
                WHERE v2.listing_url = lps.listing_url
                  AND v2.deleted_at IS NULL
                  AND (v2.mileage IS NULL OR v2.mileage = 0)
              )
            LIMIT ${BATCH}
          ) sub
          WHERE v.listing_url = sub.listing_url
            AND v.deleted_at IS NULL
            AND (v.mileage IS NULL OR v.mileage = 0)
            AND sub.miles IS NOT NULL AND sub.miles > 0 AND sub.miles < 500000
        `);
        mileBatch++;
        results.mileage += res.rowCount;
        if (res.rowCount === 0) { console.log(`  Mileage: done — ${results.mileage} total`); break; }
        if (mileBatch % 5 === 0) console.log(`  Mileage batch ${mileBatch}: ${res.rowCount} (total: ${results.mileage})`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        if (err.message?.includes('deadlock')) { await new Promise(r => setTimeout(r, 2000)); continue; }
        if (err.message?.includes('integer out of range') || err.message?.includes('invalid input')) {
          console.log(`  Mileage: type error, skipping batch`);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        console.error(`  Mileage error: ${err.message}`); break;
      }
    }
  }

  // Re-enable triggers
  await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER');
  console.log('\nTriggers re-enabled.');

  // Lock check
  const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
  console.log(`Lock check: ${locks.rows[0].c}\n`);

  // Summary
  console.log('━━━ RESULTS ━━━');
  let total = 0;
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k}: ${v}`);
    total += v;
  }
  console.log(`  TOTAL: ${total} updates`);

  await client.end();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
