/**
 * C&B HISTORICAL AUCTION DISCOVERY
 * =================================
 * Scrapes the past-auctions archive to discover all historical auctions.
 * Cars & Bids launched mid-2020, estimated 25,000-35,000 total auctions.
 *
 * Strategy:
 * 1. Paginate through past-auctions pages
 * 2. Extract auction URLs from each page
 * 3. Store in database for later full extraction
 * 4. Track which pages have been scraped
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CONFIG = {
  BASE_URL: 'https://carsandbids.com/past-auctions/',
  MAX_PAGES: 500,        // Safety limit
  DELAY_BETWEEN_PAGES: 3000,
  HEADLESS: false,
};

// Extraction script for past-auctions page
const EXTRACT_AUCTIONS = `
(function() {
  var auctions = [];

  // Find all auction cards/links
  var links = document.querySelectorAll('a[href*="/auctions/"]');
  var seen = {};

  for (var i = 0; i < links.length; i++) {
    var href = links[i].href;

    // Skip if not a valid auction URL
    if (!href.match(/\\/auctions\\/[A-Za-z0-9]+\\//)) continue;

    // Skip duplicates
    if (seen[href]) continue;
    seen[href] = true;

    // Extract auction ID from URL
    var idMatch = href.match(/\\/auctions\\/([A-Za-z0-9]+)\\//);
    var auctionId = idMatch ? idMatch[1] : null;

    // Try to extract title from the link or nearby element
    var title = links[i].textContent?.trim() || '';

    // Look for year/make/model in URL
    var ymmMatch = href.match(/\\/(\\d{4})-([^/]+)$/);
    var urlTitle = ymmMatch ? ymmMatch[1] + ' ' + ymmMatch[2].replace(/-/g, ' ') : '';

    if (auctionId) {
      auctions.push({
        url: href,
        auctionId: auctionId,
        title: title || urlTitle
      });
    }
  }

  // Check for pagination - look for "next" or page numbers
  var hasNextPage = false;
  var nextPageUrl = null;

  var nextLinks = document.querySelectorAll('a[href*="page="], a.next, a[rel="next"]');
  for (var j = 0; j < nextLinks.length; j++) {
    var text = nextLinks[j].textContent?.toLowerCase() || '';
    if (text.includes('next') || text.includes('>') || text.includes('»')) {
      hasNextPage = true;
      nextPageUrl = nextLinks[j].href;
      break;
    }
  }

  // Also check for numbered pagination
  var pageLinks = document.querySelectorAll('a[href*="page="]');
  var currentPage = 1;
  var maxPage = 1;

  for (var k = 0; k < pageLinks.length; k++) {
    var pageMatch = pageLinks[k].href.match(/page=(\\d+)/);
    if (pageMatch) {
      var pageNum = parseInt(pageMatch[1], 10);
      if (pageNum > maxPage) maxPage = pageNum;
    }
    if (pageLinks[k].classList.contains('active') || pageLinks[k].getAttribute('aria-current')) {
      var curMatch = pageLinks[k].href.match(/page=(\\d+)/);
      if (curMatch) currentPage = parseInt(curMatch[1], 10);
    }
  }

  return {
    auctions: auctions,
    hasNextPage: hasNextPage || currentPage < maxPage,
    nextPageUrl: nextPageUrl,
    currentPage: currentPage,
    maxPage: maxPage,
    totalOnPage: auctions.length
  };
})()
`;

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  C&B HISTORICAL AUCTION DISCOVERY');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: CONFIG.HEADLESS });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('Warming up on C&B...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  let totalDiscovered = 0;
  let pageNum = 1;
  let allAuctions: any[] = [];

  console.log('Starting discovery...\n');

  while (pageNum <= CONFIG.MAX_PAGES) {
    const url = pageNum === 1
      ? CONFIG.BASE_URL
      : `${CONFIG.BASE_URL}?page=${pageNum}`;

    console.log(`Page ${pageNum}: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });

      // Wait for Cloudflare
      for (let i = 0; i < 15; i++) {
        const title = await page.title();
        if (!title.includes('Just a moment')) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(2000);

      const result = await page.evaluate(EXTRACT_AUCTIONS);

      console.log(`  Found ${result.totalOnPage} auctions (max page: ${result.maxPage})`);

      if (result.auctions.length === 0) {
        console.log('  No auctions found - reached end or blocked');
        break;
      }

      allAuctions.push(...result.auctions);
      totalDiscovered += result.auctions.length;

      // Save batch to database every 100 auctions
      if (allAuctions.length >= 100) {
        await saveDiscoveredAuctions(allAuctions);
        allAuctions = [];
      }

      if (!result.hasNextPage) {
        console.log('  No more pages');
        break;
      }

      pageNum++;
      await page.waitForTimeout(CONFIG.DELAY_BETWEEN_PAGES);

    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
      break;
    }
  }

  // Save remaining
  if (allAuctions.length > 0) {
    await saveDiscoveredAuctions(allAuctions);
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  DISCOVERY COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Pages scraped: ${pageNum}`);
  console.log(`  Auctions discovered: ${totalDiscovered}`);
}

async function saveDiscoveredAuctions(auctions: any[]) {
  console.log(`    Saving ${auctions.length} auctions to queue...`);

  // Check which ones we already have
  const urls = auctions.map(a => a.url);
  const { data: existing } = await supabase
    .from('external_listings')
    .select('listing_url')
    .in('listing_url', urls);

  const existingUrls = new Set(existing?.map(e => e.listing_url) || []);
  const newAuctions = auctions.filter(a => !existingUrls.has(a.url));

  if (newAuctions.length === 0) {
    console.log(`    All ${auctions.length} already exist`);
    return;
  }

  console.log(`    ${newAuctions.length} new, ${auctions.length - newAuctions.length} existing`);

  // For now, just log - full insertion would require vehicle creation
  // This is a discovery script to understand the scale
  for (const a of newAuctions.slice(0, 5)) {
    console.log(`      NEW: ${a.title}`);
  }
  if (newAuctions.length > 5) {
    console.log(`      ... and ${newAuctions.length - 5} more`);
  }
}

main().catch(console.error);
