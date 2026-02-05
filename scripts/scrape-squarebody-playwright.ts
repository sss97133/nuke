#!/usr/bin/env npx tsx
/**
 * Scrape ALL square body GM trucks from BAT using Playwright
 * Clicks through the price chart dots to load all listings
 *
 * Target: ~813 total (651 Chevy + 162 GMC)
 *
 * Run: npx tsx scripts/scrape-squarebody-playwright.ts
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORY_PAGES = [
  { name: 'Chevrolet C/K 1973-1991', url: 'https://bringatrailer.com/chevrolet/ck-1973-1991/', expected: 651 },
  { name: 'GMC C/K 1973-1991', url: 'https://bringatrailer.com/gmc/ck-1973-1991/', expected: 162 },
];

interface ListingData {
  url: string;
  title: string;
  price: number | null;
  status: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function extractAllListingUrls(page: Page): Promise<Set<string>> {
  const urls = await page.evaluate(() => {
    const found = new Set<string>();
    document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
      const href = (link as HTMLAnchorElement).href.replace(/\/$/, '');
      if (href.includes('bringatrailer.com/listing/') &&
        !href.includes('sign-') &&
        !href.includes('memorabilia-')) {
        found.add(href);
      }
    });
    return Array.from(found);
  });
  return new Set(urls);
}

async function scrapeCategory(page: Page, category: typeof CATEGORY_PAGES[0]): Promise<ListingData[]> {
  console.log(`\n📦 Scraping: ${category.name} (expecting ~${category.expected} results)`);

  await page.goto(category.url, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(3000);

  const allUrls = new Set<string>();

  // Get initial listings
  const initial = await extractAllListingUrls(page);
  initial.forEach(u => allUrls.add(u));
  console.log(`  Initial load: ${initial.size} listings`);

  // Try to find and click chart dots/points
  console.log('  Looking for chart interactions...');

  // Method 1: Click on SVG circles (chart dots)
  const svgCircles = await page.$$('svg circle, svg .dot, .auction-chart circle, .results-chart circle');
  console.log(`  Found ${svgCircles.length} SVG circles`);

  for (let i = 0; i < Math.min(svgCircles.length, 100); i++) {
    try {
      await svgCircles[i].click({ force: true });
      await sleep(300);
      const newUrls = await extractAllListingUrls(page);
      newUrls.forEach(u => allUrls.add(u));
    } catch {
      // Continue on click failures
    }
  }

  console.log(`  After clicking circles: ${allUrls.size} listings`);

  // Method 2: Click any "Show All" or "View All" buttons
  try {
    const showAllButtons = await page.$$('button:has-text("Show All"), a:has-text("View All"), button:has-text("Load All")');
    for (const btn of showAllButtons) {
      await btn.click();
      await sleep(2000);
    }
  } catch {
    // Ignore
  }

  // Method 3: Try clicking on data points in the graph area
  try {
    const graphArea = await page.$('.auctions-graph, .price-graph, .chart-container, svg');
    if (graphArea) {
      const box = await graphArea.boundingBox();
      if (box) {
        // Click across the graph at different x positions
        for (let i = 0; i < 20; i++) {
          const x = box.x + (box.width * i / 20);
          const y = box.y + box.height / 2;
          await page.mouse.click(x, y);
          await sleep(200);
        }
        const newUrls = await extractAllListingUrls(page);
        newUrls.forEach(u => allUrls.add(u));
        console.log(`  After graph clicks: ${allUrls.size} listings`);
      }
    }
  } catch (err: any) {
    console.log(`  Graph click error: ${err.message}`);
  }

  // Method 4: Scroll and check for lazy loading
  console.log('  Scrolling page...');
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await sleep(200);
    const newUrls = await extractAllListingUrls(page);
    const before = allUrls.size;
    newUrls.forEach(u => allUrls.add(u));
    if (allUrls.size > before && i % 5 === 0) {
      console.log(`  Scroll ${i}: ${allUrls.size} listings`);
    }
  }

  // Method 5: Look for pagination or "next" buttons
  try {
    const nextButtons = await page.$$('a:has-text("Next"), button:has-text("Next"), .pagination a, [class*="next"]');
    let pageNum = 1;
    while (nextButtons.length > 0 && pageNum < 50) {
      const nextBtn = nextButtons.find(async b => await b.isVisible());
      if (!nextBtn) break;

      await nextBtn.click();
      await sleep(1500);
      const newUrls = await extractAllListingUrls(page);
      const before = allUrls.size;
      newUrls.forEach(u => allUrls.add(u));
      if (allUrls.size === before) break;

      pageNum++;
      console.log(`  Page ${pageNum}: ${allUrls.size} total listings`);
    }
  } catch {
    // Ignore pagination errors
  }

  console.log(`  Total found: ${allUrls.size} listings`);

  // Convert to ListingData objects
  const listings: ListingData[] = Array.from(allUrls).map(url => ({
    url,
    title: url.split('/').pop()?.replace(/-/g, ' ') || '',
    price: null,
    status: 'unknown',
  }));

  return listings;
}

async function getExistingUrls(): Promise<Set<string>> {
  const existing = new Set<string>();

  const { data: batListings } = await supabase
    .from('bat_listings')
    .select('bat_listing_url');

  for (const row of batListings || []) {
    if (row.bat_listing_url) existing.add(row.bat_listing_url.replace(/\/$/, ''));
  }

  const { data: queued } = await supabase
    .from('import_queue')
    .select('listing_url')
    .ilike('listing_url', '%bringatrailer%');

  for (const row of queued || []) {
    if (row.listing_url) existing.add(row.listing_url.replace(/\/$/, ''));
  }

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('bat_auction_url')
    .not('bat_auction_url', 'is', null);

  for (const row of vehicles || []) {
    if (row.bat_auction_url) existing.add(row.bat_auction_url.replace(/\/$/, ''));
  }

  return existing;
}

async function queueListings(listings: ListingData[], existingUrls: Set<string>): Promise<number> {
  const newListings = listings.filter(l => !existingUrls.has(l.url));

  if (newListings.length === 0) {
    console.log('All listings already in database');
    return 0;
  }

  console.log(`\n📝 Queueing ${newListings.length} new listings...`);

  const records = newListings.map(l => ({
    listing_url: l.url,
    status: 'pending',
    priority: 25,
    raw_data: {
      source: 'squarebody_playwright',
      discovered_at: new Date().toISOString(),
    },
  }));

  const batchSize = 100;
  let queued = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase
      .from('import_queue')
      .upsert(batch, { onConflict: 'listing_url', ignoreDuplicates: true });

    if (!error) {
      queued += batch.length;
      console.log(`  Queued batch ${Math.floor(i / batchSize) + 1}: ${batch.length} listings`);
    } else {
      console.error(`  Batch error: ${error.message}`);
    }
  }

  return queued;
}

async function triggerExtraction(batchSize: number = 100): Promise<void> {
  console.log(`\n🔄 Triggering extraction of ${batchSize} listings...`);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-bat-extraction-queue`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch_size: batchSize }),
    });

    const data = await response.json();
    console.log(`  Result:`, JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error(`  Error: ${err.message}`);
  }
}

async function main() {
  console.log('🚛 SQUARE BODY BAT SCRAPER (Playwright)');
  console.log('========================================');
  console.log('Target: ~813 listings (651 Chevy + 162 GMC)\n');

  console.log('📊 Loading existing URLs...');
  const existingUrls = await getExistingUrls();
  console.log(`Found ${existingUrls.size} existing BAT URLs`);

  console.log('\n🌐 Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    const allListings: ListingData[] = [];

    for (const category of CATEGORY_PAGES) {
      const listings = await scrapeCategory(page, category);
      allListings.push(...listings);
    }

    // Dedupe
    const uniqueListings = Array.from(
      new Map(allListings.map(l => [l.url, l])).values()
    );

    console.log(`\n📊 DISCOVERY SUMMARY`);
    console.log(`  Total found: ${allListings.length}`);
    console.log(`  Unique: ${uniqueListings.length}`);
    console.log(`  Already known: ${uniqueListings.filter(l => existingUrls.has(l.url)).length}`);
    console.log(`  New: ${uniqueListings.filter(l => !existingUrls.has(l.url)).length}`);

    const queued = await queueListings(uniqueListings, existingUrls);
    console.log(`\n✅ Queued ${queued} new listings`);

    // Sample output
    console.log('\n📋 Sample (first 10):');
    for (const l of uniqueListings.slice(0, 10)) {
      console.log(`  ${l.url.split('/').pop()}`);
    }

    if (queued > 0) {
      await triggerExtraction(100);
    }

  } finally {
    await browser.close();
  }

  const { count: pendingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .ilike('listing_url', '%bringatrailer%')
    .eq('status', 'pending');

  console.log(`\n📊 QUEUE STATUS: ${pendingCount} pending`);
  console.log('\n🏁 Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
