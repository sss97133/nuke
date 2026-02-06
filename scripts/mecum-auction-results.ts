#!/usr/bin/env npx tsx
/**
 * Mecum Auction Results Extractor
 *
 * Scrapes auction overview pages (e.g., /auctions/kissimmee-2024/) which
 * contain "SOLD for $X" results that aren't on individual lot pages.
 *
 * Also calculates buyer's premium (Mecum fees).
 *
 * Usage:
 *   npx tsx scripts/mecum-auction-results.ts kissimmee-2024
 *   npx tsx scripts/mecum-auction-results.ts --all
 */
import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Mecum buyer's premium schedule (as of 2024)
// https://www.mecum.com/about/terms-conditions/
function calculateBuyersPremium(hammerPrice: number): number {
  // Mecum's fee structure:
  // 10% on first $250,000
  // 10% on amount over $250,000 up to $5,000,000
  // Capped at certain amounts for high-value sales
  // For simplicity, using 10% which is typical
  return Math.round(hammerPrice * 0.10);
}

function calculateTotalPrice(hammerPrice: number): number {
  return hammerPrice + calculateBuyersPremium(hammerPrice);
}

interface AuctionResult {
  title: string;
  lotNumber: string;
  hammerPrice: number;
  totalPrice: number;
  auctionSlug: string;
  status: 'sold' | 'bid_goes_on' | 'no_sale';
}

async function scrapeAuctionResults(page: Page, auctionSlug: string): Promise<AuctionResult[]> {
  const url = `https://www.mecum.com/auctions/${auctionSlug}/`;
  console.log(`\nScraping: ${url}`);

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Scroll to load more content
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1000);
  }

  const results = await page.evaluate((slug) => {
    const text = document.body.innerText;
    const results: any[] = [];

    // Pattern: "TITLE\nAUCTION // Lot XXX // SOLD for $X,XXX"
    // Or: "TITLE\nAUCTION // Lot XXX // Bid Goes On"
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for "SOLD for $X" pattern
      const soldMatch = line.match(/Lot\s+([A-Z]?\d+(?:\.\d+)?)\s*\/\/\s*SOLD\s+for\s+\$?([\d,.]+)\s*(Million|Thousand)?/i);
      if (soldMatch) {
        const title = lines[i - 1]?.trim() || 'Unknown';
        let price = parseFloat(soldMatch[2].replace(/,/g, ''));

        // Handle "Million" or "Thousand" suffix
        if (soldMatch[3]?.toLowerCase() === 'million') {
          price = price * 1000000;
        } else if (soldMatch[3]?.toLowerCase() === 'thousand') {
          price = price * 1000;
        }

        results.push({
          title,
          lotNumber: soldMatch[1],
          hammerPrice: price,
          status: 'sold',
          auctionSlug: slug,
        });
      }

      // Look for "Bid Goes On" pattern
      const bidGoesOnMatch = line.match(/Lot\s+([A-Z]?\d+(?:\.\d+)?)\s*\/\/\s*(?:The\s+)?Bid\s+Goes\s+On/i);
      if (bidGoesOnMatch) {
        const title = lines[i - 1]?.trim() || 'Unknown';
        results.push({
          title,
          lotNumber: bidGoesOnMatch[1],
          hammerPrice: 0,
          status: 'bid_goes_on',
          auctionSlug: slug,
        });
      }
    }

    return results;
  }, auctionSlug);

  // Calculate total prices with buyer's premium
  return results.map(r => ({
    ...r,
    totalPrice: r.hammerPrice > 0 ? calculateTotalPrice(r.hammerPrice) : 0,
  }));
}

async function matchAndUpdate(results: AuctionResult[]): Promise<{ matched: number; updated: number }> {
  let matched = 0;
  let updated = 0;

  for (const result of results) {
    if (result.hammerPrice === 0) continue;

    // Parse year/make/model from title
    const ymmMatch = result.title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);
    if (!ymmMatch) continue;

    const year = parseInt(ymmMatch[1]);
    const make = ymmMatch[2];

    // Try to find matching vehicle
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, sale_price')
      .eq('discovery_source', 'mecum')
      .eq('year', year)
      .ilike('make', `%${make}%`)
      .is('sale_price', null)
      .limit(5);

    if (vehicles && vehicles.length > 0) {
      // Find best match by model similarity
      const vehicle = vehicles[0]; // TODO: better matching
      matched++;

      const { error } = await supabase
        .from('vehicles')
        .update({
          sale_price: result.totalPrice, // Total including buyer's premium
          sale_status: 'sold',
          origin_metadata: {
            hammer_price: result.hammerPrice,
            buyers_premium: result.totalPrice - result.hammerPrice,
            lot_number: result.lotNumber,
            auction: result.auctionSlug,
            extracted_from: 'auction_results_page',
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', vehicle.id);

      if (!error) {
        updated++;
        console.log(`  ✓ ${result.title.slice(0, 40)} → $${result.totalPrice.toLocaleString()}`);
      }
    }
  }

  return { matched, updated };
}

// Known Mecum auctions
const MECUM_AUCTIONS = [
  'kissimmee-2026', 'kissimmee-2025', 'kissimmee-2024', 'kissimmee-2023', 'kissimmee-2022',
  'indy-2025', 'indy-2024', 'indy-2023', 'indy-2022',
  'monterey-2025', 'monterey-2024', 'monterey-2023', 'monterey-2022',
  'glendale-2026', 'glendale-2025', 'glendale-2024', 'glendale-2023',
  'houston-2025', 'houston-2024', 'houston-2023',
  'dallas-2025', 'dallas-2024', 'dallas-2023',
  'las-vegas-2025', 'las-vegas-2024', 'las-vegas-2023',
  'harrisburg-2025', 'harrisburg-2024', 'harrisburg-2023',
  'chicago-2025', 'chicago-2024', 'chicago-2023',
];

async function main() {
  const args = process.argv.slice(2);
  let auctions: string[] = [];

  if (args.includes('--all')) {
    auctions = MECUM_AUCTIONS;
  } else if (args.length > 0) {
    auctions = args.filter(a => !a.startsWith('--'));
  } else {
    console.log('Usage:');
    console.log('  npx tsx scripts/mecum-auction-results.ts kissimmee-2024');
    console.log('  npx tsx scripts/mecum-auction-results.ts --all');
    return;
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  Mecum Auction Results Extractor');
  console.log(`  Auctions: ${auctions.length}`);
  console.log('═══════════════════════════════════════════════');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let totalResults = 0;
  let totalUpdated = 0;

  for (const auction of auctions) {
    try {
      const results = await scrapeAuctionResults(page, auction);
      console.log(`  Found ${results.length} results (${results.filter(r => r.status === 'sold').length} sold)`);

      totalResults += results.length;

      if (results.length > 0) {
        const { updated } = await matchAndUpdate(results);
        totalUpdated += updated;
      }
    } catch (e: any) {
      console.log(`  ✗ Error: ${e.message.slice(0, 50)}`);
    }
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  Total results scraped: ${totalResults}`);
  console.log(`  Vehicles updated: ${totalUpdated}`);
  console.log('═══════════════════════════════════════════════');
}

main().catch(console.error);
