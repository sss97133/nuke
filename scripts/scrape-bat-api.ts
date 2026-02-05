#!/usr/bin/env npx tsx
/**
 * Scrape ALL square body trucks from BAT using their AJAX API
 *
 * Chevy C/K 1973-1991: keyword_pages=49693897 (651 results)
 * GMC C/K 1973-1991: keyword_pages=49693898 (162 results)
 *
 * Run: npx tsx scripts/scrape-bat-api.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface Category {
  name: string;
  url: string;
  keywordPage: number;
}

const CATEGORIES: Category[] = [
  { name: 'Chevrolet C/K 1973-1991', url: 'https://bringatrailer.com/chevrolet/ck-1973-1991/', keywordPage: 49693897 },
  { name: 'GMC C/K 1973-1991', url: 'https://bringatrailer.com/gmc/ck-1973-1991/', keywordPage: 49693898 },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getNonce(url: string): Promise<{ nonce: string; total: number; pages: number }> {
  console.log(`  Fetching page to get nonce...`);
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  const html = await response.text();

  // Extract nonce
  const nonceMatch = html.match(/"nonce":"([^"]+)"/);
  const nonce = nonceMatch ? nonceMatch[1] : '';

  // Extract initial data for totals
  const dataMatch = html.match(/auctionsCompletedInitialData\s*=\s*(\{.*?\});/s);
  let total = 0;
  let pages = 0;

  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      total = data.items_total || 0;
      pages = data.pages_total || 0;
    } catch {}
  }

  return { nonce, total, pages };
}

async function fetchPage(keywordPage: number, page: number, nonce: string): Promise<{ urls: string[]; prices: Map<string, number> }> {
  const formData = new URLSearchParams();
  formData.append('action', 'bat_auctions_results');
  formData.append('nonce', nonce);
  formData.append('page', page.toString());
  formData.append('keyword_pages[]', keywordPage.toString());
  formData.append('items_type', 'model');

  const response = await fetch('https://bringatrailer.com/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const urls: string[] = [];
  const prices = new Map<string, number>();

  if (data.items && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item.url) {
        const url = item.url.replace(/\/$/, '');
        urls.push(url);
        if (item.current_bid) {
          prices.set(url, item.current_bid);
        }
      }
    }
  }

  return { urls, prices };
}

async function scrapeCategory(cat: Category): Promise<{ urls: string[]; prices: Map<string, number> }> {
  console.log(`\n📦 Scraping: ${cat.name}`);

  const { nonce, total, pages } = await getNonce(cat.url);
  console.log(`  Total: ${total} items, ${pages} pages`);

  if (!nonce) {
    console.error('  Failed to get nonce!');
    return { urls: [], prices: new Map() };
  }

  const allUrls: string[] = [];
  const allPrices = new Map<string, number>();

  for (let page = 1; page <= pages; page++) {
    try {
      const { urls, prices } = await fetchPage(cat.keywordPage, page, nonce);
      allUrls.push(...urls);
      prices.forEach((v, k) => allPrices.set(k, v));

      console.log(`  Page ${page}/${pages}: ${urls.length} URLs (total: ${allUrls.length})`);

      // Rate limit
      await sleep(500);
    } catch (err: any) {
      console.error(`  Page ${page} error: ${err.message}`);
    }
  }

  return { urls: allUrls, prices: allPrices };
}

async function main() {
  console.log('🚛 BAT API SCRAPER - SQUARE BODY TRUCKS');
  console.log('=======================================');
  console.log('Target: 651 Chevy + 162 GMC = 813 total\n');

  const allUrls: string[] = [];
  const allPrices = new Map<string, number>();

  for (const cat of CATEGORIES) {
    const { urls, prices } = await scrapeCategory(cat);
    allUrls.push(...urls);
    prices.forEach((v, k) => allPrices.set(k, v));
  }

  // Dedupe
  const uniqueUrls = [...new Set(allUrls)];
  console.log(`\n📊 TOTAL: ${uniqueUrls.length} unique URLs`);

  // Get existing URLs
  console.log('\nChecking existing URLs...');
  const { data: existing } = await supabase
    .from('import_queue')
    .select('listing_url')
    .ilike('listing_url', '%bringatrailer%');

  const existingSet = new Set((existing || []).map(e => e.listing_url?.replace(/\/$/, '')));

  const { data: batListings } = await supabase
    .from('bat_listings')
    .select('bat_listing_url');

  (batListings || []).forEach(b => {
    if (b.bat_listing_url) existingSet.add(b.bat_listing_url.replace(/\/$/, ''));
  });

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('bat_auction_url')
    .not('bat_auction_url', 'is', null);

  (vehicles || []).forEach(v => {
    if (v.bat_auction_url) existingSet.add(v.bat_auction_url.replace(/\/$/, ''));
  });

  console.log(`Existing URLs in DB: ${existingSet.size}`);

  const newUrls = uniqueUrls.filter(u => !existingSet.has(u));
  console.log(`New URLs to queue: ${newUrls.length}`);

  if (newUrls.length > 0) {
    console.log('\n📝 Queueing new URLs...');

    const records = newUrls.map(url => ({
      listing_url: url,
      status: 'pending',
      priority: 30, // High priority for square body
      raw_data: {
        source: 'bat_api_scraper',
        discovered_at: new Date().toISOString(),
        scraped_price: allPrices.get(url) || null,
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

      if (!error) {
        queued += batch.length;
        console.log(`  Queued batch ${Math.floor(i / batchSize) + 1}: ${batch.length} URLs`);
      } else {
        console.error(`  Batch error: ${error.message}`);
      }
    }

    console.log(`\n✅ Queued ${queued} new URLs`);
  }

  // Show sample
  console.log('\n📋 Sample URLs:');
  for (const url of uniqueUrls.slice(0, 15)) {
    const price = allPrices.get(url);
    const priceStr = price ? `$${price.toLocaleString()}` : 'N/A';
    console.log(`  ${url.split('/').pop()} | ${priceStr}`);
  }

  console.log('\n🏁 Done!');
}

main().catch(console.error);
