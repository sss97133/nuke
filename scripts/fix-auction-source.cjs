#!/usr/bin/env node
/**
 * fix-auction-source.cjs
 *
 * Normalizes auction_source across all vehicles:
 * 1. Classifies blank/null/Unknown Source by URL domain
 * 2. Normalizes capitalization variants to canonical values
 * 3. Merges duplicate platform representations
 *
 * Canonical values (matches existing trigger + edge functions):
 *   bat, mecum, barrett-jackson, cars_and_bids, bonhams, pcarmarket,
 *   collecting_cars, gooding, broad_arrow, craigslist, facebook-marketplace,
 *   rm-sothebys, gaa-classic-cars, hemmings, ebay, hagerty, copart, iaai
 *
 * Uses batched updates to avoid statement timeouts.
 */

const pg = require('pg');
const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

// URL domain → canonical auction_source
const URL_RULES = [
  { pattern: '%bringatrailer.com%', source: 'bat' },
  { pattern: '%mecum.com%', source: 'mecum' },
  { pattern: '%barrett-jackson.com%', source: 'barrett-jackson' },
  { pattern: '%carsandbids.com%', source: 'cars_and_bids' },
  { pattern: '%bonhams.com%', source: 'bonhams' },
  { pattern: '%goodingco.com%', source: 'gooding' },
  { pattern: '%pcarmarket.com%', source: 'pcarmarket' },
  { pattern: '%collectingcars.com%', source: 'collecting_cars' },
  { pattern: '%rmsothebys.com%', source: 'rm-sothebys' },
  { pattern: '%gaaclassiccars.com%', source: 'gaa-classic-cars' },
  { pattern: '%broadarrowauctions.com%', source: 'broad_arrow' },
  { pattern: '%hemmings.com%', source: 'hemmings' },
  { pattern: '%ebay.com%', source: 'ebay' },
  { pattern: '%craigslist.%', source: 'craigslist' },
  { pattern: '%facebook.com%', source: 'facebook-marketplace' },
  { pattern: '%hagerty.com%', source: 'hagerty' },
  { pattern: '%copart.com%', source: 'copart' },
  { pattern: '%iaai.com%', source: 'iaai' },
  { pattern: '%classic.com%', source: 'classic-com' },
  { pattern: '%historics.co.uk%', source: 'historics' },
  { pattern: '%conceptcarz%', source: 'conceptcarz' },
];

// Direct renames: old value → canonical value
const RENAMES = [
  { from: 'Bring a Trailer', to: 'bat' },
  { from: 'Cars & Bids', to: 'cars_and_bids' },
  { from: 'Barrett-Jackson', to: 'barrett-jackson' },
  { from: 'Mecum', to: 'mecum' },  // already canonical, but ensure case
  { from: 'Bonhams', to: 'bonhams' },
  { from: 'PCarMarket', to: 'pcarmarket' },
  { from: 'Collecting Cars', to: 'collecting_cars' },
  { from: 'Gooding', to: 'gooding' },
  { from: 'Craigslist', to: 'craigslist' },
  { from: 'Facebook Marketplace', to: 'facebook-marketplace' },
  { from: 'User Submission', to: 'user-submission' },
];

async function batchUpdate(label, condition, setValue, batchSize = 2000) {
  let total = 0;
  while (true) {
    const r = await client.query(`
      UPDATE vehicles SET auction_source = $1
      WHERE id IN (
        SELECT id FROM vehicles
        WHERE deleted_at IS NULL AND ${condition}
        LIMIT ${batchSize}
      )
    `, [setValue]);

    total += r.rowCount;
    if (r.rowCount === 0) break;
    process.stdout.write(`  ${label}: ${total} updated\r`);
    await client.query('SELECT pg_sleep(0.05)');
  }
  if (total > 0) console.log(`  ${label}: ${total} updated`);
  return total;
}

async function run() {
  await client.connect();

  // Before stats
  const before = await client.query(`
    SELECT auction_source, COUNT(*)::int as c
    FROM vehicles WHERE deleted_at IS NULL
    GROUP BY auction_source ORDER BY c DESC LIMIT 20
  `);
  console.log('=== BEFORE ===');
  for (const r of before.rows) {
    console.log(`  ${(r.auction_source || '(blank)').padEnd(25)} ${r.c.toLocaleString()}`);
  }

  let grandTotal = 0;

  // === Step 1: Rename known variants to canonical ===
  console.log('\n=== Step 1: Rename known variants ===');
  for (const rename of RENAMES) {
    // Only rename if from !== to (case-insensitive match but values differ)
    if (rename.from === rename.to) continue;
    const count = await batchUpdate(
      `"${rename.from}" → "${rename.to}"`,
      `auction_source = '${rename.from}'`,
      rename.to
    );
    grandTotal += count;
  }

  // === Step 2: Classify blank/null by URL domain ===
  console.log('\n=== Step 2: Classify blank/null by URL ===');
  for (const rule of URL_RULES) {
    const count = await batchUpdate(
      `${rule.pattern} → "${rule.source}"`,
      `(auction_source IS NULL OR auction_source = '') AND listing_url ILIKE '${rule.pattern}'`,
      rule.source
    );
    grandTotal += count;
  }

  // === Step 3: Classify "Unknown Source" by URL domain ===
  console.log('\n=== Step 3: Classify "Unknown Source" by URL ===');
  for (const rule of URL_RULES) {
    const count = await batchUpdate(
      `Unknown + ${rule.pattern} → "${rule.source}"`,
      `auction_source = 'Unknown Source' AND listing_url ILIKE '${rule.pattern}'`,
      rule.source
    );
    grandTotal += count;
  }

  // === Step 4: Remaining blank with no URL → "unknown" ===
  console.log('\n=== Step 4: Remaining blank → "unknown" ===');
  const unknownCount = await batchUpdate(
    'blank no-URL → "unknown"',
    `(auction_source IS NULL OR auction_source = '') AND (listing_url IS NULL OR listing_url = '')`,
    'unknown'
  );
  grandTotal += unknownCount;

  // After stats
  const after = await client.query(`
    SELECT auction_source, COUNT(*)::int as c
    FROM vehicles WHERE deleted_at IS NULL
    GROUP BY auction_source ORDER BY c DESC LIMIT 25
  `);
  console.log('\n=== AFTER ===');
  for (const r of after.rows) {
    console.log(`  ${(r.auction_source || '(blank)').padEnd(25)} ${r.c.toLocaleString()}`);
  }

  console.log(`\nTotal updates: ${grandTotal.toLocaleString()}`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
