#!/usr/bin/env npx tsx
/**
 * Scrape ALL square body trucks by clicking "Show More" button repeatedly
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = [
  { name: 'Chevrolet C/K 1973-1991', url: 'https://bringatrailer.com/chevrolet/ck-1973-1991/', expected: 651 },
  { name: 'GMC C/K 1973-1991', url: 'https://bringatrailer.com/gmc/ck-1973-1991/', expected: 162 },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function extractUrls(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const urls: string[] = [];
    document.querySelectorAll('a[href*="/listing/"]').forEach(a => {
      const href = (a as HTMLAnchorElement).href.replace(/\/$/, '');
      if (href.includes('bringatrailer.com/listing/') && !urls.includes(href)) {
        urls.push(href);
      }
    });
    return urls;
  });
}

async function scrapeCategory(page: Page, cat: typeof CATEGORIES[0]): Promise<string[]> {
  console.log(`\n📦 ${cat.name} (expecting ${cat.expected})`);

  await page.goto(cat.url, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(3000);

  let urls = await extractUrls(page);
  console.log(`  Initial: ${urls.length} URLs`);

  // Keep clicking "Show More" until we have all items or button disappears
  let clickCount = 0;
  const maxClicks = Math.ceil(cat.expected / 24) + 5; // 24 items per load

  while (clickCount < maxClicks) {
    // Find and click the Show More button
    const showMore = await page.$('button.button-show-more:visible, .button-show-more:visible');

    if (!showMore) {
      console.log(`  No more "Show More" button after ${clickCount} clicks`);
      break;
    }

    // Check if button is visible and enabled
    const isVisible = await showMore.isVisible();
    const isDisabled = await showMore.evaluate(el => el.classList.contains('disabled') || (el as any).disabled);

    if (!isVisible || isDisabled) {
      console.log(`  Button not clickable after ${clickCount} clicks`);
      break;
    }

    try {
      await showMore.click();
      clickCount++;

      // Wait for new content to load
      await sleep(1500);

      const newUrls = await extractUrls(page);

      if (clickCount % 5 === 0 || newUrls.length >= cat.expected) {
        console.log(`  Click ${clickCount}: ${newUrls.length} URLs`);
      }

      if (newUrls.length >= cat.expected) {
        console.log(`  Reached target! ${newUrls.length} URLs`);
        break;
      }

      // If no new URLs loaded after a click, try scrolling
      if (newUrls.length === urls.length) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(500);
      }

      urls = newUrls;

    } catch (err: any) {
      console.log(`  Click ${clickCount} error: ${err.message}`);
      // Try scrolling to make button visible
      await page.evaluate(() => window.scrollBy(0, 500));
      await sleep(500);
    }
  }

  const finalUrls = await extractUrls(page);
  console.log(`  Final: ${finalUrls.length} URLs (target: ${cat.expected})`);

  return finalUrls;
}

async function main() {
  console.log('🚛 BAT SHOW MORE SCRAPER');
  console.log('========================');
  console.log('Target: 651 Chevy + 162 GMC = 813\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const allUrls: string[] = [];

  try {
    for (const cat of CATEGORIES) {
      const urls = await scrapeCategory(page, cat);
      allUrls.push(...urls);
    }
  } finally {
    await browser.close();
  }

  const unique = [...new Set(allUrls)];
  console.log(`\n📊 TOTAL: ${unique.length} unique URLs (target: 813)`);

  // Queue to database
  console.log('\nQueuing to database...');

  const { data: existing } = await supabase
    .from('import_queue')
    .select('listing_url')
    .ilike('listing_url', '%bringatrailer%');

  const existingSet = new Set((existing || []).map(e => e.listing_url?.replace(/\/$/, '')));

  const { data: batListings } = await supabase
    .from('bat_listings')
    .select('bat_listing_url');
  (batListings || []).forEach(b => { if (b.bat_listing_url) existingSet.add(b.bat_listing_url.replace(/\/$/, '')); });

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('bat_auction_url')
    .not('bat_auction_url', 'is', null);
  (vehicles || []).forEach(v => { if (v.bat_auction_url) existingSet.add(v.bat_auction_url.replace(/\/$/, '')); });

  console.log(`Existing in DB: ${existingSet.size}`);

  const newUrls = unique.filter(u => !existingSet.has(u));
  console.log(`New URLs to queue: ${newUrls.length}`);

  if (newUrls.length > 0) {
    const records = newUrls.map(url => ({
      listing_url: url,
      status: 'pending',
      priority: 35, // High priority
      raw_data: { source: 'bat_showmore_scraper', discovered_at: new Date().toISOString() },
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
        console.log(`  Queued batch ${Math.floor(i/batchSize)+1}: ${batch.length}`);
      } else {
        console.error(`  Error: ${error.message}`);
      }
    }
    console.log(`\n✅ Queued ${queued} new URLs`);
  }

  // Sample output
  console.log('\n📋 Sample URLs:');
  for (const u of unique.slice(0, 10)) {
    console.log(`  ${u.split('/').pop()}`);
  }

  console.log('\n🏁 Done!');
}

main().catch(console.error);
