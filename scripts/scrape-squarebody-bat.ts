#!/usr/bin/env npx tsx
/**
 * Scrape ALL square body GM trucks from BAT
 *
 * Sources:
 * - https://bringatrailer.com/gmc/ck-1973-1991/
 * - https://bringatrailer.com/chevrolet/ck-1973-1991/
 *
 * Run: npx tsx scripts/scrape-squarebody-bat.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CATEGORY_PAGES = [
  { name: 'GMC C/K 1973-1991', baseUrl: 'https://bringatrailer.com/gmc/ck-1973-1991/' },
  { name: 'Chevrolet C/K 1973-1991', baseUrl: 'https://bringatrailer.com/chevrolet/ck-1973-1991/' },
];

interface ScrapedListing {
  url: string;
  title?: string;
  price?: number;
  status?: string;
  endDate?: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapePage(url: string): Promise<ScrapedListing[]> {
  console.log(`  Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!response.ok) {
    console.error(`  HTTP ${response.status} for ${url}`);
    return [];
  }

  const html = await response.text();
  const listings: ScrapedListing[] = [];

  // Extract listing URLs
  const urlMatches = html.matchAll(/href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"/g);
  const seenUrls = new Set<string>();

  for (const match of urlMatches) {
    const listingUrl = match[1].replace(/\/$/, '');
    if (seenUrls.has(listingUrl)) continue;
    seenUrls.add(listingUrl);

    // Try to extract price from nearby text
    const priceMatch = html.match(new RegExp(`${listingUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]*?"price"[^}]*?([0-9,]+)`));
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : undefined;

    listings.push({
      url: listingUrl,
      price,
    });
  }

  return listings;
}

async function scrapeCategory(category: { name: string; baseUrl: string }): Promise<ScrapedListing[]> {
  console.log(`\n📦 Scraping: ${category.name}`);

  const allListings: ScrapedListing[] = [];
  let page = 1;
  let consecutiveEmpty = 0;

  while (consecutiveEmpty < 3) {
    const pageUrl = page === 1 ? category.baseUrl : `${category.baseUrl}?page=${page}`;

    try {
      const listings = await scrapePage(pageUrl);

      if (listings.length === 0) {
        consecutiveEmpty++;
        console.log(`  Page ${page}: empty (${consecutiveEmpty}/3 consecutive)`);
      } else {
        consecutiveEmpty = 0;
        allListings.push(...listings);
        console.log(`  Page ${page}: ${listings.length} listings (total: ${allListings.length})`);
      }

      page++;
      await sleep(500); // Rate limit

    } catch (err: any) {
      console.error(`  Page ${page} error: ${err.message}`);
      consecutiveEmpty++;
    }
  }

  return allListings;
}

async function getExistingUrls(): Promise<Set<string>> {
  const existing = new Set<string>();

  // Get from bat_listings
  const { data: batListings } = await supabase
    .from('bat_listings')
    .select('bat_listing_url');

  for (const row of batListings || []) {
    if (row.bat_listing_url) {
      existing.add(row.bat_listing_url.replace(/\/$/, ''));
    }
  }

  // Get from vehicles with BAT source
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('bat_auction_url, listing_url')
    .or('auction_source.ilike.%bat%,auction_source.ilike.%trailer%');

  for (const row of vehicles || []) {
    if (row.bat_auction_url) existing.add(row.bat_auction_url.replace(/\/$/, ''));
    if (row.listing_url) existing.add(row.listing_url.replace(/\/$/, ''));
  }

  // Get from import_queue
  const { data: queued } = await supabase
    .from('import_queue')
    .select('listing_url')
    .ilike('listing_url', '%bringatrailer%');

  for (const row of queued || []) {
    if (row.listing_url) existing.add(row.listing_url.replace(/\/$/, ''));
  }

  return existing;
}

async function queueForExtraction(listings: ScrapedListing[], existingUrls: Set<string>): Promise<number> {
  const newListings = listings.filter(l => !existingUrls.has(l.url));

  if (newListings.length === 0) {
    console.log('No new listings to queue');
    return 0;
  }

  console.log(`\n📝 Queueing ${newListings.length} new listings for extraction...`);

  const records = newListings.map(l => ({
    listing_url: l.url,
    status: 'pending',
    priority: 20, // High priority for square body trucks
    raw_data: {
      source: 'squarebody_crawler',
      discovered_at: new Date().toISOString(),
      scraped_price: l.price,
    },
  }));

  // Insert in batches
  const batchSize = 100;
  let queued = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase
      .from('import_queue')
      .upsert(batch, { onConflict: 'listing_url', ignoreDuplicates: true });

    if (error) {
      console.error(`  Batch ${i / batchSize + 1} error: ${error.message}`);
    } else {
      queued += batch.length;
      console.log(`  Queued batch ${i / batchSize + 1}: ${batch.length} listings`);
    }
  }

  return queued;
}

async function extractBatch(batchSize: number = 50): Promise<number> {
  console.log(`\n🔄 Extracting ${batchSize} queued listings...`);

  const { data: pending } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .ilike('listing_url', '%bringatrailer%')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .limit(batchSize);

  if (!pending || pending.length === 0) {
    console.log('No pending listings to extract');
    return 0;
  }

  let extracted = 0;
  const concurrency = 5;

  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = pending.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (item) => {
        // Mark as processing
        await supabase
          .from('import_queue')
          .update({ status: 'processing' })
          .eq('id', item.id);

        // Call bat-simple-extract
        const response = await fetch(`${SUPABASE_URL}/functions/v1/bat-simple-extract`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: item.listing_url, save_to_db: true }),
        });

        const data = await response.json();

        if (data.success) {
          await supabase
            .from('import_queue')
            .update({ status: 'complete', processed_at: new Date().toISOString() })
            .eq('id', item.id);
          return { success: true, url: item.listing_url };
        } else {
          await supabase
            .from('import_queue')
            .update({ status: 'failed', error_message: data.error })
            .eq('id', item.id);
          throw new Error(data.error);
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        extracted++;
        console.log(`  ✅ ${result.value.url.split('/').pop()}`);
      } else {
        console.log(`  ❌ ${result.reason?.message}`);
      }
    }

    // Rate limit between batches
    if (i + concurrency < pending.length) {
      await sleep(2000);
    }
  }

  return extracted;
}

async function main() {
  console.log('🚛 SQUARE BODY BAT SCRAPER');
  console.log('==========================\n');

  // Step 1: Get existing URLs
  console.log('📊 Loading existing URLs from database...');
  const existingUrls = await getExistingUrls();
  console.log(`Found ${existingUrls.size} existing BAT URLs\n`);

  // Step 2: Scrape both category pages
  const allListings: ScrapedListing[] = [];

  for (const category of CATEGORY_PAGES) {
    const listings = await scrapeCategory(category);
    allListings.push(...listings);
  }

  // Deduplicate
  const uniqueListings = Array.from(
    new Map(allListings.map(l => [l.url, l])).values()
  );

  console.log(`\n📊 DISCOVERY SUMMARY`);
  console.log(`  Total listings found: ${allListings.length}`);
  console.log(`  Unique listings: ${uniqueListings.length}`);
  console.log(`  Already in DB: ${uniqueListings.filter(l => existingUrls.has(l.url)).length}`);
  console.log(`  New listings: ${uniqueListings.filter(l => !existingUrls.has(l.url)).length}`);

  // Step 3: Queue new listings
  const queued = await queueForExtraction(uniqueListings, existingUrls);
  console.log(`\n✅ Queued ${queued} new listings for extraction`);

  // Step 4: Extract a batch
  const extracted = await extractBatch(100);
  console.log(`\n✅ Extracted ${extracted} listings`);

  // Final stats
  const { count: pendingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .ilike('listing_url', '%bringatrailer%')
    .eq('status', 'pending');

  console.log(`\n📊 FINAL STATUS`);
  console.log(`  Remaining in queue: ${pendingCount}`);
  console.log('\n🏁 Done! Run again to extract more.');
}

main().catch(console.error);
