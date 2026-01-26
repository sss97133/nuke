#!/usr/bin/env node
/**
 * EXTRACTOR TEMPLATE
 *
 * Copy this file and modify for new auction sources.
 * All extractors should follow this pattern.
 *
 * Required changes:
 * 1. SOURCE_NAME - unique identifier for this source
 * 2. extractFromPage() - source-specific scraping logic
 * 3. Any source-specific data transformations
 *
 * The shared utilities handle:
 * - VIN deduplication
 * - Collection/organization creation
 * - Auction event creation
 * - Image insertion
 * - Owner/provenance parsing
 */

import { chromium } from 'playwright';
import {
  loadVinCache,
  upsertVehicle,
  parseOwnershipHistory,
  cache
} from '../lib/extraction-utils.js';

// ============================================
// CONFIGURATION
// ============================================

const SOURCE_NAME = 'template';  // Change this: 'mecum', 'bat', 'carsandbids', etc.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const PARALLEL = parseInt(process.argv[3]) || 3;

// ============================================
// SOURCE-SPECIFIC EXTRACTION
// ============================================

/**
 * Extract data from page - CUSTOMIZE THIS FOR EACH SOURCE
 *
 * @param {Page} page - Playwright page object
 * @param {string} url - URL being scraped
 * @returns {object} Extracted data in standard format
 */
async function extractFromPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // ========================================
    // CUSTOMIZE THIS SECTION FOR EACH SOURCE
    // ========================================

    // Example: Extract from __NEXT_DATA__ (common for Next.js sites)
    const nextData = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      return script ? JSON.parse(script.textContent) : null;
    });

    // Example: Extract from page text
    const bodyText = await page.evaluate(() => document.body.innerText);

    // Example: Extract from specific selectors
    const title = await page.$eval('h1', el => el.textContent.trim()).catch(() => null);

    // Parse year/make/model from title
    let year = null, make = null, model = null;
    if (title) {
      const match = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
      if (match) {
        year = parseInt(match[1]);
        make = match[2];
        model = match[3];
      }
    }

    // VIN extraction (common patterns)
    const vinMatch = bodyText.match(/VIN[:\s]+([A-Z0-9]{17})/i);

    // Price extraction
    const priceMatch = bodyText.match(/(?:sold|hammer|winning)[^$]*\$?([\d,]+)/i);

    // Image extraction
    const images = await page.evaluate(() =>
      [...document.querySelectorAll('img')]
        .map(i => i.src)
        .filter(s => s && !s.includes('logo') && !s.includes('icon'))
    );

    // ========================================
    // RETURN STANDARDIZED DATA OBJECT
    // ========================================

    return {
      // Vehicle identity
      vin: vinMatch?.[1] || null,
      title,
      year,
      make,
      model,

      // Specs
      transmission: null,  // Extract from source
      exterior_color: null,
      interior_color: null,
      mileage: null,
      engine: null,

      // Content
      description: null,
      highlights: [],
      images,

      // Sale result
      sale_result: priceMatch ? 'sold' : 'unknown',
      sale_price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
      high_bid: null,

      // Estimates
      low_estimate: null,
      high_estimate: null,

      // Auction event
      auction_date: null,
      lot_number: null,
      auction_location: null,
      source_listing_id: null,

      // Collection/Owner (if detected)
      collection_name: null,
      collection_slug: null,

      // Raw data for debugging/future parsing
      raw_data: {
        extractor: SOURCE_NAME,
        extracted_at: new Date().toISOString()
      }
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================
// STANDARD PROCESSING (DON'T MODIFY)
// ============================================

async function getVehiclesToProcess() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.${SOURCE_NAME}&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

async function worker(workerId, browser, queue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  while (queue.length > 0) {
    const vehicle = queue.shift();
    if (!vehicle) break;

    // 1. Extract data from page
    const data = await extractFromPage(page, vehicle.discovery_url);

    if (data.error) {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ${data.error.slice(0, 50)}`);
      continue;
    }

    // 2. Upsert vehicle (handles everything: dedup, collection, images, event)
    const result = await upsertVehicle({
      vehicleId: vehicle.id,
      sourceUrl: vehicle.discovery_url,
      source: SOURCE_NAME,
      data
    });

    // 3. Log result
    const fields = [];
    if (data.year) fields.push(data.year);
    if (data.make) fields.push(data.make);
    if (data.model) fields.push(data.model?.slice(0, 12));
    if (data.vin) fields.push('VIN');
    if (data.sale_price) {
      fields.push(`SOLD $${(data.sale_price / 1000).toFixed(0)}k`);
      stats.sold++;
      stats.totalSales += data.sale_price;
    }
    if (data.images?.length) fields.push(`${data.images.length}img`);
    if (data.collection_name) {
      fields.push(`[${data.collection_name.slice(0, 12)}]`);
      stats.collections++;
    }

    const dedup = !result.isNew ? `→${result.vehicleId.slice(0, 5)}` : '';
    const event = result.event?.created ? '+' : '';

    console.log(`[${workerId}] ${fields.join(' | ')} ${event}${dedup}`);
    stats.processed++;
    if (!result.isNew) stats.deduplicated++;
    if (result.event?.created) stats.events++;
  }

  await context.close();
}

async function main() {
  console.log(`\n🚗 ${SOURCE_NAME.toUpperCase()} Extractor`);
  console.log(`   Batch: ${BATCH_SIZE} | Workers: ${PARALLEL}\n`);

  // Load caches
  const vinCount = await loadVinCache();
  console.log(`Loaded ${vinCount} existing VINs`);

  // Get pending vehicles
  const vehicles = await getVehiclesToProcess();
  console.log(`Found ${vehicles.length} pending vehicles\n`);

  if (vehicles.length === 0) return;

  // Process
  const browser = await chromium.launch({ headless: true });
  const queue = [...vehicles];
  const stats = {
    processed: 0,
    deduplicated: 0,
    events: 0,
    errors: 0,
    sold: 0,
    totalSales: 0,
    collections: 0
  };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, queue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  // Summary
  console.log(`\n✅ Done!`);
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Sold: ${stats.sold} ($${(stats.totalSales / 1000000).toFixed(1)}M)`);
  console.log(`   Collections: ${stats.collections}`);
  console.log(`   Deduplicated: ${stats.deduplicated}`);
  console.log(`   Events: ${stats.events}`);
  console.log(`   Errors: ${stats.errors}`);
}

main().catch(console.error);
