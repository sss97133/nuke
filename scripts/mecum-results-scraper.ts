#!/usr/bin/env npx tsx
/**
 * Mecum Results Page Scraper
 *
 * Scrapes the auction results listing pages to get sale prices in bulk.
 * Much more efficient than scraping individual lot pages.
 *
 * Usage:
 *   npx tsx scripts/mecum-results-scraper.ts --auction kissimmee-2025
 *   npx tsx scripts/mecum-results-scraper.ts --auction kissimmee-2024 --pages 10
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LotResult {
  lotNumber: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  salePrice: number | null;
  status: 'sold' | 'no_sale' | 'unknown';
  lotUrl: string;
}

async function scrapeResultsPage(page: Page): Promise<LotResult[]> {
  // Wait for results to load
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const results: any[] = [];

    // Look for lot cards/rows in the results
    const lotElements = document.querySelectorAll('[class*="lot"], [class*="Lot"], [class*="card"], [class*="Card"], article, .result-item');

    lotElements.forEach(el => {
      const text = el.textContent || '';
      const html = el.innerHTML || '';

      // Skip if not a lot (check for lot number pattern)
      if (!/lot\s*#?\s*[A-Z0-9]/i.test(text) && !/[A-Z]\d+-\d+/.test(text)) {
        return;
      }

      const result: any = {
        lotNumber: '',
        title: '',
        year: null,
        make: null,
        model: null,
        salePrice: null,
        status: 'unknown',
        lotUrl: '',
      };

      // Extract lot number
      const lotMatch = text.match(/Lot\s*#?\s*([A-Z0-9.-]+)/i) || text.match(/([A-Z]\d+-\d+)/);
      if (lotMatch) {
        result.lotNumber = lotMatch[1];
      }

      // Extract title (year make model)
      const titleMatch = text.match(/(\d{4})\s+([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s+([A-Za-z0-9\s-]+?)(?:\s*(?:Lot|Sold|\$|No Sale))/i);
      if (titleMatch) {
        result.year = parseInt(titleMatch[1]);
        result.make = titleMatch[2].trim();
        result.model = titleMatch[3].trim();
        result.title = `${result.year} ${result.make} ${result.model}`;
      }

      // Extract price
      const priceMatch = text.match(/\$([0-9,]+)/);
      if (priceMatch) {
        result.salePrice = parseInt(priceMatch[1].replace(/,/g, ''));
        result.status = 'sold';
      }

      // Check for no sale
      if (/no\s*sale|did\s*not\s*sell/i.test(text)) {
        result.status = 'no_sale';
      }

      // Extract URL
      const link = el.querySelector('a[href*="/lots/"]') as HTMLAnchorElement;
      if (link) {
        result.lotUrl = link.href;
      }

      // Only add if we got meaningful data
      if (result.lotNumber || result.title || result.salePrice) {
        results.push(result);
      }
    });

    return results;
  });
}

async function scrapeAuctionResults(browser: Browser, auctionSlug: string, maxPages: number): Promise<LotResult[]> {
  const page = await browser.newPage();
  const allResults: LotResult[] = [];

  try {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Try the results page
    const resultsUrl = `https://www.mecum.com/auctions/${auctionSlug}/results/`;
    console.log(`Navigating to: ${resultsUrl}`);

    await page.goto(resultsUrl, { waitUntil: 'load', timeout: 60000 });

    // Check if we need to scroll/paginate
    let currentPage = 1;

    while (currentPage <= maxPages) {
      console.log(`\nScraping page ${currentPage}...`);

      const results = await scrapeResultsPage(page);
      console.log(`  Found ${results.length} lots on this page`);

      if (results.length === 0) {
        // Try alternative selectors or check if page is empty
        const bodyText = await page.evaluate(() => document.body.innerText);
        console.log(`  Page text preview: ${bodyText.slice(0, 200)}...`);
        break;
      }

      allResults.push(...results);

      // Look for "next page" button or infinite scroll
      const nextButton = await page.$('button:has-text("Next"), a:has-text("Next"), [aria-label="Next page"]');
      if (nextButton) {
        await nextButton.click();
        await page.waitForTimeout(2000);
        currentPage++;
      } else {
        // Try scrolling for infinite scroll
        const previousHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        const newHeight = await page.evaluate(() => document.body.scrollHeight);

        if (newHeight === previousHeight) {
          break; // No more content
        }
        currentPage++;
      }
    }

    return allResults;
  } finally {
    await page.close();
  }
}

async function matchAndUpdateVehicles(results: LotResult[]): Promise<{ matched: number; updated: number }> {
  let matched = 0;
  let updated = 0;

  for (const result of results) {
    if (!result.salePrice) continue;

    // Try to match by lot URL
    let vehicleId: string | null = null;

    if (result.lotUrl) {
      const { data } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_source', 'mecum')
        .ilike('discovery_url', `%${result.lotNumber}%`)
        .limit(1)
        .single();

      if (data) {
        vehicleId = data.id;
      }
    }

    // Try to match by year/make/model if no URL match
    if (!vehicleId && result.year && result.make) {
      const { data } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_source', 'mecum')
        .eq('year', result.year)
        .ilike('make', result.make)
        .is('sale_price', null)
        .limit(1)
        .single();

      if (data) {
        vehicleId = data.id;
      }
    }

    if (vehicleId) {
      matched++;

      const { error } = await supabase
        .from('vehicles')
        .update({
          sale_price: result.salePrice,
          sale_status: result.status === 'sold' ? 'sold' : 'unsold',
          updated_at: new Date().toISOString(),
        })
        .eq('id', vehicleId);

      if (!error) {
        updated++;
        console.log(`  ✓ Updated ${result.title}: $${result.salePrice.toLocaleString()}`);
      }
    }
  }

  return { matched, updated };
}

async function main() {
  const args = process.argv.slice(2);
  let auctionSlug = 'kissimmee-2025';
  let maxPages = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--auction' && args[i + 1]) {
      auctionSlug = args[i + 1];
    } else if (args[i] === '--pages' && args[i + 1]) {
      maxPages = parseInt(args[i + 1]);
    }
  }

  console.log('='.repeat(60));
  console.log('Mecum Results Scraper');
  console.log(`Auction: ${auctionSlug}`);
  console.log(`Max pages: ${maxPages}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });

  try {
    const results = await scrapeAuctionResults(browser, auctionSlug, maxPages);

    console.log('\n' + '='.repeat(60));
    console.log(`Total lots scraped: ${results.length}`);
    console.log(`With prices: ${results.filter(r => r.salePrice).length}`);

    if (results.length > 0) {
      console.log('\nSample results:');
      results.slice(0, 5).forEach(r => {
        console.log(`  ${r.title || r.lotNumber}: ${r.salePrice ? '$' + r.salePrice.toLocaleString() : r.status}`);
      });

      console.log('\nMatching to database...');
      const { matched, updated } = await matchAndUpdateVehicles(results);
      console.log(`Matched: ${matched}, Updated: ${updated}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
