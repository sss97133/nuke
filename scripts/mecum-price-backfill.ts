#!/usr/bin/env npx tsx
/**
 * Mecum Price Backfill
 *
 * Uses Playwright to scrape sale prices from Mecum lot pages.
 * Updates vehicles in database that are missing prices.
 *
 * Usage:
 *   npx tsx scripts/mecum-price-backfill.ts --limit 100
 *   npx tsx scripts/mecum-price-backfill.ts --auction kissimmee-2025
 *   npx tsx scripts/mecum-price-backfill.ts --url https://mecum.com/lots/...
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface MecumLotData {
  lotNumber: string | null;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  salePrice: number | null;
  hammerPrice: number | null;
  status: 'sold' | 'no_sale' | 'upcoming' | 'unknown';
  auctionName: string | null;
  imageUrl: string | null;
}

async function extractLotData(page: Page): Promise<MecumLotData> {
  // Wait for the page to load
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Give React time to hydrate
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const result: any = {
      lotNumber: null,
      title: null,
      year: null,
      make: null,
      model: null,
      salePrice: null,
      hammerPrice: null,
      status: 'unknown',
      auctionName: null,
      imageUrl: null,
    };

    // Try to get title from h1 or og:title
    const h1 = document.querySelector('h1');
    if (h1) {
      result.title = h1.textContent?.trim() || null;
    }

    // Parse year/make/model from title
    if (result.title) {
      const match = result.title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);
      if (match) {
        result.year = parseInt(match[1]);
        result.make = match[2];
        result.model = match[3];
      }
    }

    // Look for price in various places
    const pricePatterns = [
      /\$([0-9,]+)/,
      /Sold\s*(?:for\s*)?\$([0-9,]+)/i,
      /Hammer\s*(?:Price)?\s*:?\s*\$([0-9,]+)/i,
      /Final\s*(?:Price)?\s*:?\s*\$([0-9,]+)/i,
    ];

    // Check all text content for prices
    const bodyText = document.body.innerText || '';

    // Check for "Sold" status
    if (/\bsold\b/i.test(bodyText)) {
      result.status = 'sold';

      // Find the price near "Sold"
      const soldMatch = bodyText.match(/sold[^$]*\$([0-9,]+)/i);
      if (soldMatch) {
        result.salePrice = parseInt(soldMatch[1].replace(/,/g, ''));
      }
    }

    // Check for "No Sale" / "Did Not Sell"
    if (/no\s*sale|did\s*not\s*sell|not\s*sold/i.test(bodyText)) {
      result.status = 'no_sale';
    }

    // Try to find price in specific elements
    const priceElements = document.querySelectorAll('[class*="price"], [class*="Price"], [class*="sold"], [class*="Sold"], [class*="hammer"], [class*="Hammer"]');
    priceElements.forEach(el => {
      const text = el.textContent || '';
      const priceMatch = text.match(/\$([0-9,]+)/);
      if (priceMatch && !result.salePrice) {
        result.salePrice = parseInt(priceMatch[1].replace(/,/g, ''));
      }
    });

    // Look for lot number
    const lotMatch = bodyText.match(/Lot\s*#?\s*([A-Z0-9.-]+)/i);
    if (lotMatch) {
      result.lotNumber = lotMatch[1];
    }

    // Get auction name
    const auctionMatch = bodyText.match(/(Kissimmee|Indy|Monterey|Glendale|Houston|Dallas|Las Vegas|Harrisburg|Chicago|Portland|Tulsa)\s*\d{4}/i);
    if (auctionMatch) {
      result.auctionName = auctionMatch[0];
    }

    // Get main image
    const mainImg = document.querySelector('img[src*="cloudinary"][src*="mecum"]') as HTMLImageElement;
    if (mainImg) {
      result.imageUrl = mainImg.src;
    }

    return result;
  });
}

async function scrapeMecumLot(browser: Browser, url: string): Promise<MecumLotData | null> {
  const page = await browser.newPage();

  try {
    // Set a realistic viewport and user agent
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    // Navigate to the lot page with longer timeout
    console.log(`  Fetching: ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    const data = await extractLotData(page);
    return data;
  } catch (err: any) {
    console.error(`  Error scraping ${url}: ${err.message}`);
    return null;
  } finally {
    await page.close();
  }
}

async function getVehiclesWithoutPrices(limit: number, auctionSlug?: string): Promise<Array<{ id: string; discovery_url: string }>> {
  let query = supabase
    .from('vehicles')
    .select('id, discovery_url')
    .eq('discovery_source', 'mecum')
    .is('sale_price', null)
    .not('discovery_url', 'is', null)
    .limit(limit);

  if (auctionSlug) {
    query = query.ilike('discovery_url', `%${auctionSlug}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching vehicles:', error);
    return [];
  }

  return data || [];
}

async function updateVehiclePrice(vehicleId: string, data: MecumLotData): Promise<boolean> {
  if (!data.salePrice) {
    return false;
  }

  const { error } = await supabase
    .from('vehicles')
    .update({
      sale_price: data.salePrice,
      sale_status: data.status === 'sold' ? 'sold' : data.status === 'no_sale' ? 'unsold' : 'available',
      updated_at: new Date().toISOString(),
    })
    .eq('id', vehicleId);

  if (error) {
    console.error(`Error updating vehicle ${vehicleId}:`, error);
    return false;
  }

  return true;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 100;
  let auctionSlug: string | undefined;
  let singleUrl: string | undefined;

  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    } else if (args[i] === '--auction' && args[i + 1]) {
      auctionSlug = args[i + 1];
    } else if (args[i] === '--url' && args[i + 1]) {
      singleUrl = args[i + 1];
    }
  }

  console.log('='.repeat(60));
  console.log('Mecum Price Backfill');
  console.log('='.repeat(60));

  // Launch browser
  console.log('\nLaunching browser...');
  const browser = await chromium.launch({
    headless: true,
  });

  try {
    if (singleUrl) {
      // Single URL mode
      console.log(`\nScraping single URL: ${singleUrl}`);
      const data = await scrapeMecumLot(browser, singleUrl);
      console.log('\nExtracted data:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      // Batch mode
      console.log(`\nFetching vehicles without prices (limit: ${limit})...`);
      if (auctionSlug) {
        console.log(`Filtering by auction: ${auctionSlug}`);
      }

      const vehicles = await getVehiclesWithoutPrices(limit, auctionSlug);
      console.log(`Found ${vehicles.length} vehicles to process`);

      if (vehicles.length === 0) {
        console.log('No vehicles to process.');
        return;
      }

      let processed = 0;
      let updated = 0;
      let failed = 0;
      let noPrice = 0;

      for (const vehicle of vehicles) {
        processed++;
        console.log(`\n[${processed}/${vehicles.length}] Processing: ${vehicle.id}`);

        const data = await scrapeMecumLot(browser, vehicle.discovery_url);

        if (!data) {
          failed++;
          continue;
        }

        if (data.salePrice) {
          const success = await updateVehiclePrice(vehicle.id, data);
          if (success) {
            updated++;
            console.log(`  ✓ Updated: $${data.salePrice.toLocaleString()} (${data.status})`);
          } else {
            failed++;
          }
        } else {
          noPrice++;
          console.log(`  - No price found (status: ${data.status})`);
        }

        // Small delay to be respectful
        await new Promise(r => setTimeout(r, 1000));
      }

      console.log('\n' + '='.repeat(60));
      console.log('Summary:');
      console.log(`  Processed: ${processed}`);
      console.log(`  Updated with price: ${updated}`);
      console.log(`  No price found: ${noPrice}`);
      console.log(`  Failed: ${failed}`);
      console.log('='.repeat(60));
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
