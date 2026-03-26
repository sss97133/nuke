#!/usr/bin/env node
/**
 * Mecum Algolia Discovery
 *
 * Discovers Mecum lots via their public Algolia search index and queues
 * new ones for extraction via import_queue.
 *
 * Usage:
 *   dotenvx run -- node scripts/mecum-algolia-discovery.mjs [--auction kissimmee-2026] [--limit 1000]
 */

import { createClient } from '@supabase/supabase-js';

const ALGOLIA_APP_ID = 'U6CFCQ7V52';
const ALGOLIA_API_KEY = '0291c46cde807bcb428a021a96138fcb';
const ALGOLIA_INDEX = 'wp_posts_lot';
const MECUM_BASE = 'https://www.mecum.com';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse args
const args = process.argv.slice(2);
let targetAuction = null;
let maxResults = 5000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--auction' && args[i + 1]) targetAuction = args[i + 1];
  if (args[i] === '--limit' && args[i + 1]) maxResults = parseInt(args[i + 1]);
}

async function algoliaSearch(params) {
  const resp = await fetch(`https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/*/queries`, {
    method: 'POST',
    headers: {
      'x-algolia-application-id': ALGOLIA_APP_ID,
      'x-algolia-api-key': ALGOLIA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params }] }),
  });
  const data = await resp.json();
  return data.results?.[0] || {};
}

async function getRecentAuctions() {
  // Get auction facets to find recent ones
  const result = await algoliaSearch(
    'hitsPerPage=0&facets=["taxonomies.auction_tax.name"]&maxValuesPerFacet=100'
  );
  const facets = result.facets?.['taxonomies.auction_tax.name'] || {};

  // Parse auction names and timestamps
  const auctions = Object.entries(facets).map(([name, count]) => {
    const parts = name.split('|');
    const auctionName = parts[0];
    const startTimestamp = parseInt(parts[1] || '0');
    return { name: auctionName, count, startTimestamp, raw: name };
  });

  // Sort by start date, most recent first
  auctions.sort((a, b) => b.startTimestamp - a.startTimestamp);

  // Return only 2025-2026 auctions
  const cutoff = new Date('2025-01-01').getTime() / 1000;
  return auctions.filter(a => a.startTimestamp >= cutoff);
}

async function discoverLotsForAuction(auctionSlug, auctionName) {
  console.log(`\n=== Discovering lots for ${auctionName} (slug: ${auctionSlug}) ===`);

  let allUrls = [];
  let page = 0;
  const hitsPerPage = 1000;

  while (allUrls.length < maxResults) {
    const result = await algoliaSearch(
      `hitsPerPage=${hitsPerPage}&page=${page}&attributesToRetrieve=permalink,post_title,taxonomies.auction_tax,taxonomies.lot_year,taxonomies.lot_type&filters=taxonomies.auction_tax.slug:"${auctionSlug}"`
    );

    const hits = result.hits || [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      const permalink = hit.permalink;
      if (permalink && permalink.includes('/lots/')) {
        allUrls.push({
          url: `${MECUM_BASE}${permalink}`,
          title: hit.post_title || null,
          year: hit.taxonomies?.lot_year?.[0]?.name || null,
        });
      }
    }

    page++;
    if (page >= result.nbPages) break;

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`  Found ${allUrls.length} lot URLs from Algolia`);
  return allUrls;
}

async function checkExisting(urls) {
  // Check which URLs already exist in vehicles table
  const urlList = urls.map(u => u.url);

  // Check in batches of 500
  const existing = new Set();
  for (let i = 0; i < urlList.length; i += 500) {
    const batch = urlList.slice(i, i + 500);

    // Check vehicles table
    const { data: vehicleData } = await supabase
      .from('vehicles')
      .select('listing_url')
      .in('listing_url', batch);

    if (vehicleData) {
      vehicleData.forEach(v => existing.add(v.listing_url));
    }

    // Also check with mecum.com vs www.mecum.com variants
    const altBatch = batch.map(u => u.replace('https://www.mecum.com', 'https://mecum.com'));
    const { data: altData } = await supabase
      .from('vehicles')
      .select('listing_url')
      .in('listing_url', altBatch);

    if (altData) {
      altData.forEach(v => {
        // Map back to www variant
        existing.add(v.listing_url.replace('https://mecum.com', 'https://www.mecum.com'));
        existing.add(v.listing_url);
      });
    }

    // Check import_queue too
    const { data: queueData } = await supabase
      .from('import_queue')
      .select('listing_url')
      .in('listing_url', batch);

    if (queueData) {
      queueData.forEach(q => existing.add(q.listing_url));
    }
  }

  return existing;
}

async function queueNewLots(lots) {
  if (lots.length === 0) {
    console.log('  No new lots to queue');
    return 0;
  }

  const MECUM_SOURCE_ID = 'fee71d50-c59c-4340-b819-cd9a7d074d7f';

  // Insert into import_queue in batches
  let queued = 0;
  for (let i = 0; i < lots.length; i += 100) {
    const batch = lots.slice(i, i + 100).map(lot => ({
      listing_url: lot.url,
      source_id: MECUM_SOURCE_ID,
      listing_title: lot.title,
      listing_year: lot.year ? parseInt(lot.year) : null,
      status: 'pending',
      priority: 5,
    }));

    const { error } = await supabase
      .from('import_queue')
      .upsert(batch, { onConflict: 'listing_url', ignoreDuplicates: true });

    if (error) {
      console.error(`  Error queuing batch: ${error.message}`);
    } else {
      queued += batch.length;
    }
  }

  return queued;
}

async function main() {
  console.log('Mecum Algolia Discovery');
  console.log(`Max results per auction: ${maxResults}`);

  let auctions;
  if (targetAuction) {
    auctions = [{ name: targetAuction, slug: targetAuction }];
  } else {
    const recentAuctions = await getRecentAuctions();
    console.log(`\nRecent auctions (2025-2026):`);
    for (const a of recentAuctions.slice(0, 15)) {
      const date = new Date(a.startTimestamp * 1000).toISOString().split('T')[0];
      console.log(`  ${a.name} (${date}): ${a.count} lots`);
    }

    // Process the top auctions by lot count
    auctions = recentAuctions.slice(0, 10).map(a => ({
      name: a.name,
      slug: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    }));
  }

  let totalNew = 0;
  let totalQueued = 0;

  for (const auction of auctions) {
    const slug = targetAuction || auction.slug;
    const lots = await discoverLotsForAuction(slug, auction.name);

    if (lots.length === 0) continue;

    const existing = await checkExisting(lots);
    const newLots = lots.filter(l => !existing.has(l.url));

    console.log(`  Existing: ${existing.size}, New: ${newLots.length}`);
    totalNew += newLots.length;

    if (newLots.length > 0) {
      const queued = await queueNewLots(newLots);
      totalQueued += queued;
      console.log(`  Queued: ${queued}`);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total new lots found: ${totalNew}`);
  console.log(`Total queued: ${totalQueued}`);
}

main().catch(console.error);
