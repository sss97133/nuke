#!/usr/bin/env npx tsx
/**
 * Bonhams Sale Discovery + Extraction via Playwright
 *
 * Cloudflare blocks Supabase edge function IPs, so we extract locally.
 * 1. Playwright discovers sale IDs from cars.bonhams.com/auctions/
 * 2. For each sale, navigates to the page and extracts JSON-LD
 * 3. Parses lots from JSON-LD and saves directly to Supabase
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/bonhams-discover-sales.ts
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [BONHAMS-DISCOVER] ${msg}`);
}

// Known makes for parsing offer names
const KNOWN_MAKES = [
  'Alfa Romeo', 'Aston Martin', 'Mercedes-Benz', 'Rolls-Royce', 'Land Rover',
  'Porsche', 'Ferrari', 'Lamborghini', 'Bugatti', 'McLaren', 'Maserati',
  'Bentley', 'Jaguar', 'BMW', 'Audi', 'Ford', 'Chevrolet', 'Dodge',
  'Plymouth', 'Pontiac', 'Cadillac', 'Lincoln', 'Chrysler', 'Shelby',
  'AC', 'Austin-Healey', 'De Tomaso', 'Lancia', 'Iso', 'Bizzarrini',
  'Facel Vega', 'Delahaye', 'Delage', 'Hispano-Suiza', 'Duesenberg',
  'Packard', 'Pierce-Arrow', 'Stutz', 'Cord', 'Auburn', 'Tucker',
  'Harley-Davidson', 'Indian', 'Vincent', 'Brough Superior', 'Norton',
  'Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'Ducati', 'Triumph', 'MV Agusta',
  'Toyota', 'Nissan', 'Mazda', 'Subaru', 'Mitsubishi', 'Datsun',
  'Volkswagen', 'Fiat', 'Lotus', 'Morgan', 'MG', 'Austin', 'Rover',
  'Citroen', 'Peugeot', 'Renault', 'Saab', 'Volvo',
];

function parseOfferName(name: string): { year: number | null; make: string | null; model: string | null; vin: string | null } {
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;
  let vin: string | null = null;

  const vinMatch = name.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) vin = vinMatch[1].toUpperCase();

  const cleanName = name.replace(/VIN:\s*[A-HJ-NPR-Z0-9]+/i, '').trim();
  const yearMatch = cleanName.match(/^(\d{4})\s+/);
  if (yearMatch) {
    year = parseInt(yearMatch[1]);
    const afterYear = cleanName.slice(yearMatch[0].length);
    for (const knownMake of KNOWN_MAKES) {
      if (afterYear.toLowerCase().startsWith(knownMake.toLowerCase())) {
        make = knownMake;
        model = afterYear.slice(knownMake.length).trim();
        break;
      }
    }
    if (!make) {
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 1) make = parts[0];
      if (parts.length >= 2) model = parts.slice(1).join(' ');
    }
  }
  return { year, make, model, vin };
}

interface CatalogLot {
  name: string;
  url: string;
  price: number | null;
  priceCurrency: string | null;
  lotNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  availability: string | null;
}

async function discoverSalesViaPlaywright(browser: Browser): Promise<Set<string>> {
  const saleIds = new Set<string>();
  log('Discovering sales via Playwright...');

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const discoveryUrls = [
    'https://cars.bonhams.com/auctions/',
    'https://cars.bonhams.com/auctions/?status=past',
    'https://www.bonhams.com/department/MOT/',
    'https://www.bonhams.com/auctions/?department=MOT',
  ];

  for (const url of discoveryUrls) {
    try {
      log(`Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(500);
      }

      const ids = await page.evaluate(() => {
        const found: string[] = [];
        document.querySelectorAll('a[href]').forEach((a: any) => {
          const href = a.href || '';
          const match = href.match(/\/auction\/(\d+)\/?/);
          if (match) found.push(match[1]);
        });
        const html = document.body.innerHTML;
        const matches = html.matchAll(/\/auction\/(\d+)\/?/g);
        for (const m of matches) found.push(m[1]);
        return [...new Set(found)];
      });

      for (const id of ids) saleIds.add(id);
      log(`  Found ${ids.length} sale IDs from ${url}`);
    } catch (err: any) {
      log(`  Error fetching ${url}: ${err.message}`);
    }
  }

  await context.close();
  return saleIds;
}

async function extractSaleViaPlaywright(
  browser: Browser,
  saleId: string
): Promise<{ lots: CatalogLot[]; auctionName: string; auctionDate: string | null; auctionLocation: string | null } | null> {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    const url = `https://cars.bonhams.com/auction/${saleId}/`;
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    // Wait for Next.js to hydrate and render JSON-LD
    await page.waitForTimeout(5000);

    const finalUrl = page.url();
    log(`  Sale ${saleId}: landed on ${finalUrl}`);

    // Extract JSON-LD from rendered page
    const jsonLdContent = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      const results: string[] = [];
      for (const script of scripts) {
        const text = script.textContent?.trim();
        if (text) results.push(text);
      }
      if (results.length === 0) return null;
      // Find the SaleEvent one
      for (const text of results) {
        try {
          const data = JSON.parse(text);
          if (data['@type'] === 'SaleEvent' || data.offers) return text;
        } catch {}
      }
      // Return the first one as fallback
      return results[0];
    });

    if (!jsonLdContent) {
      const pageTitle = await page.title();
      log(`  Sale ${saleId}: No JSON-LD found (title: "${pageTitle}")`);
      return null;
    }

    const jsonLd = JSON.parse(jsonLdContent);
    const auctionName = jsonLd.name || 'Unknown Auction';
    let auctionDate: string | null = null;
    if (jsonLd.startDate) {
      try { auctionDate = new Date(jsonLd.startDate).toISOString().split('T')[0]; } catch {}
    }
    const auctionLocation = jsonLd.location?.name || jsonLd.location?.address?.addressLocality || null;

    const offers = jsonLd.offers?.offers || jsonLd.offers || [];
    const lots: CatalogLot[] = [];

    for (const offer of (Array.isArray(offers) ? offers : [])) {
      if (offer['@type'] !== 'Offer') continue;
      const name = offer.name || '';
      const offerUrl = offer.url || '';
      const price = typeof offer.price === 'number' ? Math.round(offer.price) : null;
      const priceCurrency = offer.priceCurrency || null;
      const availability = offer.availability || null;

      const lotMatch = offerUrl.match(/\/lot\/(\d+)\//);
      const lotNumber = lotMatch?.[1] || null;
      const parsed = parseOfferName(name);

      if (!parsed.year && !name.match(/\d{4}/)) continue;

      lots.push({ name, url: offerUrl, price, priceCurrency, lotNumber, ...parsed, availability });
    }

    return { lots, auctionName, auctionDate, auctionLocation };
  } catch (err: any) {
    log(`  Sale ${saleId}: Error - ${err.message}`);
    return null;
  } finally {
    await context.close();
  }
}

async function retryableSupabaseOp<T>(op: () => Promise<{ data: T; error: any }>, maxRetries = 3): Promise<{ data: T; error: any }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await op();
    if (!result.error) return result;
    const msg = result.error.message || '';
    if (msg.includes('schema cache') || msg.includes('connection pool') || msg.includes('Retrying')) {
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    return result; // Non-retryable error
  }
  return await op(); // Final attempt
}

async function saveLots(
  saleId: string,
  auctionName: string,
  auctionDate: string | null,
  auctionLocation: string | null,
  lots: CatalogLot[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const lot of lots) {
    try {
      const { data: existing } = await retryableSupabaseOp(() =>
        supabase.from('vehicles').select('id').eq('discovery_url', lot.url).maybeSingle()
      );

      const vehicleData = {
        year: lot.year,
        make: lot.make?.toLowerCase() || null,
        model: lot.model?.toLowerCase() || null,
        vin: lot.vin?.toUpperCase() || null,
        sale_price: lot.price,
        listing_url: lot.url,
        discovery_url: lot.url,
        discovery_source: 'bonhams',
        profile_origin: 'bonhams_catalog_import',
        is_public: true,
        status: 'active',
        sale_status: lot.availability?.includes('OutOfStock') ? 'sold' : 'available',
        auction_outcome: lot.availability?.includes('OutOfStock') ? 'sold' : null,
        auction_end_date: auctionDate,
        origin_metadata: {
          source: 'bonhams_catalog_import',
          lot_number: lot.lotNumber,
          sale_id: saleId,
          sale_name: auctionName,
          sale_location: auctionLocation,
          price_currency: lot.priceCurrency,
          imported_at: new Date().toISOString(),
        },
      };

      if (existing) {
        await retryableSupabaseOp(() =>
          supabase.from('vehicles').update(vehicleData).eq('id', existing.id)
        );
        updated++;
      } else {
        const { data: newVehicle, error: insertError } = await retryableSupabaseOp(() =>
          supabase.from('vehicles').insert(vehicleData).select('id').single()
        );

        if (insertError) {
          log(`    Lot ${lot.lotNumber}: insert error - ${insertError.message}`);
        } else {
          created++;
          const listingUrlKey = lot.url.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
          await retryableSupabaseOp(() =>
            supabase.from('external_listings').upsert({
              vehicle_id: newVehicle.id,
              platform: 'bonhams',
              listing_url: lot.url,
              listing_url_key: listingUrlKey,
              listing_id: lot.lotNumber || saleId,
              listing_status: lot.availability?.includes('OutOfStock') ? 'sold' : 'active',
              end_date: auctionDate,
              final_price: lot.price,
              sold_at: lot.availability?.includes('OutOfStock') ? auctionDate : null,
              metadata: {
                lot_number: lot.lotNumber,
                sale_id: saleId,
                sale_name: auctionName,
                price_currency: lot.priceCurrency,
              },
            }, { onConflict: 'platform,listing_url_key' })
          );
        }
      }
    } catch (err: any) {
      log(`    Lot ${lot.lotNumber}: save error - ${err.message}`);
    }
  }

  return { created, updated };
}

async function probeSaleExists(page: Page, saleId: string): Promise<boolean> {
  try {
    const resp = await page.goto(`https://cars.bonhams.com/auction/${saleId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    // 308 redirects to slug page = exists. 404 or error page = doesn't exist
    const finalUrl = page.url();
    return resp !== null && resp.status() < 400 && finalUrl.includes(`/auction/${saleId}/`);
  } catch {
    return false;
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('  BONHAMS SALE DISCOVERY + EXTRACTION');
  console.log('='.repeat(50));

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  let totalLots = 0;
  let totalCreated = 0;
  let successfulSales = 0;

  // Phase 1: Discover sale IDs via Playwright
  const discoveredIds = await discoverSalesViaPlaywright(browser);
  log(`Playwright discovered ${discoveredIds.size} unique sale IDs`);

  // Non-vehicle sale keywords — skip entire sales with these in the name
  const NON_VEHICLE_KEYWORDS = [
    'ceramic', 'glass', 'wine', 'watch', 'jewel', 'book', 'print', 'photograph',
    'silver', 'rug', 'carpet', 'map', 'furniture', 'painting', 'art online',
    'art sale', 'western art', 'modern art', 'contemporary art', 'impressionist',
    'antiquities', 'asian art', 'chinese art', 'japanese art', 'tribal',
    'musical instrument', 'coin', 'medal', 'stamp', 'manuscript',
    'cellar', 'spirits', 'whisky', 'whiskey', 'cognac', 'gastronom',
    'ungraceful', 'connoisseur', 'library sale', 'natural history',
    'design', 'sculpture', 'works on paper', 'porcelain', 'textile',
  ];

  function isVehicleSale(name: string): boolean {
    const lower = name.toLowerCase();
    // Explicit vehicle keywords — always accept
    if (/\b(motor|car|automobile|vehicle|classic|vintage|racing|concours|speed|ferrari|porsche|mercedes|bugatti|rolls|bentley)\b/i.test(lower)) return true;
    // Check for non-vehicle keywords
    for (const kw of NON_VEHICLE_KEYWORDS) {
      if (lower.includes(kw)) return false;
    }
    return true; // Default accept if no non-vehicle keyword found
  }

  // Phase 2: Extract each discovered sale via Playwright
  for (const saleId of discoveredIds) {
    log(`Extracting sale: ${saleId}`);
    const result = await extractSaleViaPlaywright(browser, saleId);
    if (result && result.lots.length > 0) {
      if (!isVehicleSale(result.auctionName)) {
        log(`  Sale ${saleId} "${result.auctionName}": SKIPPED (non-vehicle sale)`);
        continue;
      }
      const { created, updated } = await saveLots(saleId, result.auctionName, result.auctionDate, result.auctionLocation, result.lots);
      totalLots += result.lots.length;
      totalCreated += created;
      successfulSales++;
      log(`  Sale ${saleId} "${result.auctionName}": ${result.lots.length} lots (${created} new, ${updated} updated)`);
    } else {
      log(`  Sale ${saleId}: no vehicle lots found`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Phase 3: Probe sequential range via Playwright (find sales not on auctions page)
  log('Probing sequential range 27000-33000 for undiscovered sales...');
  let probeContext = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  let probePage = await probeContext.newPage();
  let probeHits = 0;

  for (let id = 27000; id <= 33000; id++) {
    const saleId = String(id);
    if (discoveredIds.has(saleId)) continue;

    const exists = await probeSaleExists(probePage, saleId);
    if (exists) {
      log(`  PROBE HIT: Sale ${saleId} exists, extracting...`);
      await probeContext.close().catch(() => {});

      const result = await extractSaleViaPlaywright(browser, saleId);
      if (result && result.lots.length > 0) {
        if (!isVehicleSale(result.auctionName)) {
          log(`  Sale ${saleId} "${result.auctionName}": SKIPPED (non-vehicle)`);
        } else {
          const { created, updated } = await saveLots(saleId, result.auctionName, result.auctionDate, result.auctionLocation, result.lots);
          totalLots += result.lots.length;
          totalCreated += created;
          successfulSales++;
          probeHits++;
          log(`  Sale ${saleId}: ${result.lots.length} lots (${created} new, ${updated} updated)`);
        }
      }

      // Reopen probe context for next iteration
      probeContext = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      probePage = await probeContext.newPage();
    }
    await new Promise(r => setTimeout(r, 500));
  }

  try { await probeContext.close(); } catch {}
  await browser.close();

  log(`Sequential probe found ${probeHits} additional sales`);

  console.log('\n' + '='.repeat(50));
  console.log('  BONHAMS DISCOVERY COMPLETE');
  console.log('='.repeat(50));
  console.log(`Successful sales: ${successfulSales}`);
  console.log(`Total lots found: ${totalLots}`);
  console.log(`New vehicles created: ${totalCreated}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
