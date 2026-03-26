#!/usr/bin/env node
/**
 * Barrett-Jackson API Discovery
 *
 * Discovers BJ lots via their public Strapi API and queues new ones for extraction.
 * BJ API: https://www.barrett-jackson.com/api/docket
 *
 * Usage:
 *   dotenvx run -- node scripts/bj-api-discovery.mjs [--limit 5000] [--event 2026-palm-beach]
 */

import { createClient } from '@supabase/supabase-js';

const BJ_API_BASE = 'https://www.barrett-jackson.com/api/docket';
const BJ_SOURCE_ID = '23b5bd94-bbe3-441e-8688-3ab1aec30680'; // Barrett-Jackson in scrape_sources
const BJ_URL_BASE = 'https://barrett-jackson.com';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse args
const args = process.argv.slice(2);
let maxResults = 10000;
let targetEvent = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) maxResults = parseInt(args[i + 1]);
  if (args[i] === '--event' && args[i + 1]) targetEvent = args[i + 1];
}

async function fetchDocketPage(page, pageSize = 100) {
  const url = `${BJ_API_BASE}?page=${page}&pageSize=${pageSize}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!resp.ok) throw new Error(`BJ API returned ${resp.status}`);
  return resp.json();
}

async function discoverAllLots() {
  console.log('Fetching BJ lot inventory...');

  // Get first page to know total
  const firstPage = await fetchDocketPage(1, 100);
  const total = firstPage.meta.pagination.total;
  const pageCount = firstPage.meta.pagination.pageCount;
  console.log(`Total BJ lots in API: ${total} across ${pageCount} pages`);

  const allLots = [];
  const eventCounts = {};

  // Process first page
  for (const item of firstPage.data) {
    const lot = parseLot(item);
    if (lot) {
      allLots.push(lot);
      eventCounts[lot.event_slug] = (eventCounts[lot.event_slug] || 0) + 1;
    }
  }

  // Fetch remaining pages
  const maxPages = Math.min(pageCount, Math.ceil(maxResults / 100));
  for (let page = 2; page <= maxPages; page++) {
    if (allLots.length >= maxResults) break;

    try {
      const data = await fetchDocketPage(page, 100);
      for (const item of data.data) {
        const lot = parseLot(item);
        if (lot) {
          allLots.push(lot);
          eventCounts[lot.event_slug] = (eventCounts[lot.event_slug] || 0) + 1;
        }
      }
    } catch (e) {
      console.error(`  Error on page ${page}: ${e.message}`);
    }

    // Progress every 10 pages
    if (page % 10 === 0) {
      console.log(`  Page ${page}/${maxPages}: ${allLots.length} lots discovered`);
    }

    // Small delay
    await new Promise(r => setTimeout(r, 50));
  }

  // Print event summary
  console.log('\nEvent distribution:');
  const sorted = Object.entries(eventCounts).sort((a, b) => b[1] - a[1]);
  for (const [event, count] of sorted.slice(0, 15)) {
    console.log(`  ${event}: ${count} lots`);
  }

  // Filter by target event if specified
  if (targetEvent) {
    const filtered = allLots.filter(l => l.event_slug === targetEvent);
    console.log(`\nFiltered to ${targetEvent}: ${filtered.length} lots`);
    return filtered;
  }

  return allLots;
}

function parseLot(item) {
  const attrs = item.attributes || item;
  if (!attrs.item_id) return null;

  const slug = attrs.slug || `${attrs.title}-${attrs.item_id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const eventSlug = attrs.event_slug || 'unknown';

  // Build the docket URL (BJ's URL pattern)
  const url = `${BJ_URL_BASE}/${eventSlug}/docket/vehicle/${slug}`;

  return {
    url,
    item_id: attrs.item_id,
    title: attrs.title || null,
    year: attrs.year || null,
    make: attrs.make || null,
    model: attrs.model || null,
    vin: attrs.vin || null,
    lot_number: attrs.lot_number || null,
    is_sold: attrs.is_sold || false,
    price: attrs.price_decimal || null,
    event_slug: eventSlug,
    reserve_type: attrs.reserve_type_name || null,
  };
}

async function checkExisting(lots) {
  const existing = new Set();
  const urls = lots.map(l => l.url);

  for (let i = 0; i < urls.length; i += 500) {
    const batch = urls.slice(i, i + 500);

    // Check vehicles table
    const { data } = await supabase
      .from('vehicles')
      .select('listing_url')
      .in('listing_url', batch);

    if (data) data.forEach(v => existing.add(v.listing_url));

    // Also check import_queue
    const { data: qData } = await supabase
      .from('import_queue')
      .select('listing_url')
      .in('listing_url', batch);

    if (qData) qData.forEach(q => existing.add(q.listing_url));

    // Check with http:// variant
    const httpBatch = batch.map(u => u.replace('https://', 'http://'));
    const { data: httpData } = await supabase
      .from('vehicles')
      .select('listing_url')
      .in('listing_url', httpBatch);

    if (httpData) {
      httpData.forEach(v => {
        existing.add(v.listing_url);
        existing.add(v.listing_url.replace('http://', 'https://'));
      });
    }
  }

  return existing;
}

async function queueLots(lots) {
  let queued = 0;
  for (let i = 0; i < lots.length; i += 100) {
    const batch = lots.slice(i, i + 100).map(lot => ({
      listing_url: lot.url,
      source_id: BJ_SOURCE_ID,
      listing_title: lot.title,
      listing_year: lot.year ? parseInt(lot.year) : null,
      listing_make: lot.make,
      listing_model: lot.model,
      status: 'pending',
      priority: 5,
      raw_data: {
        item_id: lot.item_id,
        vin: lot.vin,
        lot_number: lot.lot_number,
        is_sold: lot.is_sold,
        price: lot.price,
        event_slug: lot.event_slug,
        reserve_type: lot.reserve_type,
      },
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
  console.log('Barrett-Jackson API Discovery');
  console.log(`Max results: ${maxResults}`);
  if (targetEvent) console.log(`Target event: ${targetEvent}`);

  const lots = await discoverAllLots();
  console.log(`\nTotal lots discovered: ${lots.length}`);

  if (lots.length === 0) {
    console.log('No lots found.');
    return;
  }

  const existing = await checkExisting(lots);
  const newLots = lots.filter(l => !existing.has(l.url));
  console.log(`Existing: ${existing.size}, New: ${newLots.length}`);

  if (newLots.length > 0) {
    const queued = await queueLots(newLots);
    console.log(`Queued: ${queued}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total discovered: ${lots.length}`);
  console.log(`Already known: ${existing.size}`);
  console.log(`New lots queued: ${newLots.length}`);
}

main().catch(console.error);
