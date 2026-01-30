#!/usr/bin/env npx tsx
/**
 * BaT URL Discovery via Playwright
 *
 * Clicks "Show More" on BaT's results page to discover ALL listing URLs.
 * BaT has ~620+ pages of completed auctions.
 *
 * Usage: dotenvx run -f .env.local -- npx tsx scripts/bat-discover-all-urls.ts
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BaT URL DISCOVERY');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get existing URLs to track progress
  const { count: existingCount } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true })
    .not('bat_auction_url', 'is', null);

  const { count: queueCount } = await supabase
    .from('import_queue')
    .select('id', { count: 'exact', head: true })
    .ilike('listing_url', '%bringatrailer%');

  console.log(`Currently have: ${existingCount?.toLocaleString()} BaT vehicles in DB`);
  console.log(`Queue has: ${queueCount?.toLocaleString()} pending BaT URLs\n`);

  // Get all existing URLs into a Set for deduplication
  console.log('Loading existing URLs...');
  const existingUrls = new Set<string>();

  // Load in batches
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('vehicles')
      .select('bat_auction_url')
      .not('bat_auction_url', 'is', null)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(v => v.bat_auction_url && existingUrls.add(v.bat_auction_url));
    page++;
  }

  // Also load from queue
  page = 0;
  while (true) {
    const { data } = await supabase
      .from('import_queue')
      .select('listing_url')
      .ilike('listing_url', '%bringatrailer%')
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(q => q.listing_url && existingUrls.add(q.listing_url));
    page++;
  }

  console.log(`Loaded ${existingUrls.size} existing URLs\n`);

  // Launch browser
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const browserPage = await context.newPage();

  const discoveredUrls: string[] = [];
  const newUrls: string[] = [];
  let totalPages = 0;
  let consecutiveEmpty = 0;

  try {
    // Navigate to results page
    console.log('Navigating to BaT results...');
    await browserPage.goto('https://bringatrailer.com/auctions/results/', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    // Wait for listings to load
    await browserPage.waitForSelector('a[href*="/listing/"]', { timeout: 30000 });

    // Keep clicking "Show More" until we've covered all pages
    const maxPages = 700; // Safety limit
    const targetPages = parseInt(process.argv[2]) || maxPages;

    while (totalPages < targetPages && consecutiveEmpty < 5) {
      totalPages++;

      // Extract URLs from current page
      const urls = await browserPage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/listing/"]'));
        return [...new Set(links.map(a => a.getAttribute('href')).filter(Boolean))];
      });

      // Filter new URLs
      const pageNewUrls = (urls as string[]).filter(url => {
        const fullUrl = url.startsWith('http') ? url : `https://bringatrailer.com${url}`;
        return !existingUrls.has(fullUrl);
      });

      discoveredUrls.push(...urls as string[]);
      newUrls.push(...pageNewUrls);

      // Add to existing set
      (urls as string[]).forEach(url => {
        const fullUrl = url.startsWith('http') ? url : `https://bringatrailer.com${url}`;
        existingUrls.add(fullUrl);
      });

      if (pageNewUrls.length === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
      }

      console.log(`Page ${totalPages}: ${urls.length} found, ${pageNewUrls.length} new (total new: ${newUrls.length})`);

      // Queue new URLs in batches
      if (newUrls.length >= 100 || totalPages % 10 === 0) {
        await queueUrls(newUrls.splice(0));
      }

      // Look for "Show More" button (class: auctions-footer-button)
      const showMoreBtn = await browserPage.$('.auctions-footer-button');

      if (!showMoreBtn) {
        console.log('No more "Show More" button found');
        break;
      }

      // Check if button is visible and not loading
      const isVisible = await showMoreBtn.isVisible();
      if (!isVisible) {
        console.log('Button not visible, may have reached end');
        break;
      }

      // Click and wait for new content
      try {
        // Scroll button into view first
        await showMoreBtn.scrollIntoViewIfNeeded();
        await browserPage.waitForTimeout(500);

        // Click and wait for network to settle
        await showMoreBtn.click();
        await browserPage.waitForTimeout(2000);
        await browserPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      } catch (e: any) {
        console.log(`Click issue: ${e.message?.slice(0, 50)}`);
        // Try scrolling and retrying
        await browserPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await browserPage.waitForTimeout(2000);
      }
    }

  } catch (error: any) {
    console.error('Browser error:', error.message);
  } finally {
    await browser.close();
  }

  // Queue any remaining URLs
  if (newUrls.length > 0) {
    await queueUrls(newUrls);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DISCOVERY COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  Pages scraped: ${totalPages}`);
  console.log(`  Total URLs found: ${discoveredUrls.length}`);
  console.log(`  New URLs queued: ${newUrls.length}`);
  console.log('');

  async function queueUrls(urls: string[]) {
    if (urls.length === 0) return;

    const records = urls.map(url => ({
      listing_url: url.startsWith('http') ? url : `https://bringatrailer.com${url}`,
      status: 'pending',
      priority: 1,
      raw_data: {
        source: 'playwright_discovery',
        discovered_at: new Date().toISOString(),
      },
    }));

    const { error } = await supabase
      .from('import_queue')
      .upsert(records, { onConflict: 'listing_url', ignoreDuplicates: true });

    if (error) {
      console.error('Queue error:', error.message);
    } else {
      console.log(`  → Queued ${urls.length} URLs`);
    }
  }
}

main().catch(console.error);
