#!/usr/bin/env npx tsx
/**
 * Scrape BAT category pages by interacting with the price chart
 * Each dot on the chart represents a sold auction
 *
 * Run: npx tsx scripts/scrape-bat-chart.ts
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const URLS = [
  'https://bringatrailer.com/chevrolet/ck-1973-1991/',
  'https://bringatrailer.com/gmc/ck-1973-1991/',
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeWithChart(page: Page, url: string): Promise<string[]> {
  console.log(`\n📊 Scraping: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(3000);

  const allUrls = new Set<string>();

  // Method 1: Extract URLs from the initial page
  const getUrls = async () => {
    return await page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll('a[href*="/listing/"]').forEach(a => {
        const href = (a as HTMLAnchorElement).href.replace(/\/$/, '');
        if (href.includes('bringatrailer.com/listing/')) {
          urls.push(href);
        }
      });
      return [...new Set(urls)];
    });
  };

  let initial = await getUrls();
  initial.forEach(u => allUrls.add(u));
  console.log(`  Initial: ${initial.length} URLs`);

  // Method 2: Try to find the auction results list and scroll it
  try {
    // Look for a scrollable results container
    const containers = await page.$$('.auctions-list, .listing-results, [class*="results"], [class*="auction"]');
    console.log(`  Found ${containers.length} potential result containers`);

    for (const container of containers.slice(0, 3)) {
      // Scroll within the container
      for (let i = 0; i < 20; i++) {
        await container.evaluate(el => el.scrollBy(0, 500));
        await sleep(300);
      }
    }

    const afterContainerScroll = await getUrls();
    afterContainerScroll.forEach(u => allUrls.add(u));
    console.log(`  After container scroll: ${allUrls.size} URLs`);
  } catch (e: any) {
    console.log(`  Container scroll failed: ${e.message}`);
  }

  // Method 3: Click on chart elements (the scatter plot)
  try {
    // BAT uses a chart with clickable data points
    // Try finding elements that could be chart points
    const chartSelectors = [
      'circle',
      '.chart-point',
      '.data-point',
      '[class*="dot"]',
      '[class*="point"]',
      'path[d*="M"]', // SVG paths that might be clickable
    ];

    for (const selector of chartSelectors) {
      const elements = await page.$$(selector);
      if (elements.length > 0 && elements.length < 1000) {
        console.log(`  Clicking ${elements.length} "${selector}" elements...`);
        for (let i = 0; i < Math.min(elements.length, 200); i++) {
          try {
            await elements[i].click({ force: true, timeout: 1000 });
            await sleep(100);
          } catch {
            // Continue on failures
          }
        }
        const afterClicks = await getUrls();
        afterClicks.forEach(u => allUrls.add(u));
      }
    }
    console.log(`  After chart clicks: ${allUrls.size} URLs`);
  } catch (e: any) {
    console.log(`  Chart click failed: ${e.message}`);
  }

  // Method 4: Look for "Load More" / pagination and click repeatedly
  try {
    let clickCount = 0;
    while (clickCount < 50) {
      const loadMore = await page.$('button:has-text("Load"), button:has-text("More"), button:has-text("Show"), a:has-text("Load More")');
      if (!loadMore) break;

      const isVisible = await loadMore.isVisible();
      if (!isVisible) break;

      await loadMore.click();
      await sleep(1500);
      clickCount++;

      const newUrls = await getUrls();
      const before = allUrls.size;
      newUrls.forEach(u => allUrls.add(u));

      if (allUrls.size === before && clickCount > 3) break;
      console.log(`  Load more click ${clickCount}: ${allUrls.size} URLs`);
    }
  } catch (e: any) {
    console.log(`  Load more failed: ${e.message}`);
  }

  // Method 5: Full page scroll
  console.log('  Scrolling full page...');
  for (let i = 0; i < 50; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(200);

    if (i % 10 === 9) {
      const newUrls = await getUrls();
      newUrls.forEach(u => allUrls.add(u));
      console.log(`  Scroll ${i + 1}: ${allUrls.size} URLs`);
    }
  }

  // Method 6: Check for infinite scroll trigger elements
  try {
    const observer = await page.evaluate(() => {
      return document.querySelector('[data-infinite-scroll], [class*="infinite"]') !== null;
    });

    if (observer) {
      console.log('  Found infinite scroll, scrolling to bottom...');
      for (let i = 0; i < 100; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(500);

        const newUrls = await getUrls();
        const before = allUrls.size;
        newUrls.forEach(u => allUrls.add(u));

        if (i > 10 && allUrls.size === before) break;
      }
    }
  } catch {
    // Ignore
  }

  // Final collection
  const finalUrls = await getUrls();
  finalUrls.forEach(u => allUrls.add(u));

  console.log(`  Total found: ${allUrls.size} URLs`);
  return Array.from(allUrls);
}

async function main() {
  console.log('🚛 BAT CHART SCRAPER');
  console.log('====================\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  const allUrls: string[] = [];

  try {
    for (const url of URLS) {
      const urls = await scrapeWithChart(page, url);
      allUrls.push(...urls);
    }

    // Dedupe
    const unique = [...new Set(allUrls)];
    console.log(`\n📊 TOTAL: ${unique.length} unique URLs`);

    // Get existing
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

    const newUrls = unique.filter(u => !existingSet.has(u));
    console.log(`New URLs to queue: ${newUrls.length}`);

    if (newUrls.length > 0) {
      const records = newUrls.map(u => ({
        listing_url: u,
        status: 'pending',
        priority: 30,
        raw_data: { source: 'bat_chart_scraper', discovered_at: new Date().toISOString() },
      }));

      const { error } = await supabase
        .from('import_queue')
        .upsert(records, { onConflict: 'listing_url', ignoreDuplicates: true });

      if (error) {
        console.error('Queue error:', error.message);
      } else {
        console.log(`✅ Queued ${newUrls.length} URLs`);
      }
    }

    // Show sample
    console.log('\nSample URLs:');
    for (const u of unique.slice(0, 15)) {
      console.log(`  ${u.split('/').pop()}`);
    }

  } finally {
    await browser.close();
  }

  console.log('\n🏁 Done!');
}

main().catch(console.error);
