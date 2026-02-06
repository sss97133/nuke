#!/usr/bin/env npx tsx
/**
 * KSL Extract - Extracts data from individual KSL listing pages
 * Runs slowly and carefully to avoid bot detection
 */

import { chromium, Page, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Slow and careful - 1 listing per 15-30 seconds
const MIN_DELAY = 15000;
const MAX_DELAY = 30000;
const BATCH_SIZE = 5; // Process 5, then take a break
const BATCH_BREAK = 60000; // 1 minute break between batches

interface ExtractedData {
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  vin: string | null;
}

async function createFreshContext(browser: any): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Denver',
    geolocation: { latitude: 40.7608, longitude: -111.8910 },
    permissions: ['geolocation'],
  });
}

async function extractFromPage(page: Page, url: string): Promise<ExtractedData | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for potential bot protection
    await page.waitForTimeout(3000);

    const html = await page.content();

    // Check if blocked
    if (html.includes('px-captcha') || html.includes('Access to this page has been denied')) {
      console.log('  ⚠️ Bot protection detected');
      return null;
    }

    // Extract data from page
    const data = await page.evaluate(() => {
      const getText = (selectors: string[]): string => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return '';
      };

      // Get title from H1 or meta
      const title = getText(['h1', '[class*="title"]', 'meta[property="og:title"]']) ||
                    document.title.split('|')[0]?.trim() || '';

      // Parse year/make/model from title
      const match = title.match(/(\d{4})\s+([A-Za-z-]+)\s+(.+)/);

      // Get price
      const priceText = getText(['[class*="price"]', '[class*="Price"]']);
      const priceMatch = priceText.match(/\$([\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

      // Get mileage
      const bodyText = document.body.innerText;
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:mi|miles)/i);
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

      // Get VIN
      const vinMatch = bodyText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      const vin = vinMatch ? vinMatch[1] : null;

      // Get location
      const locationMatch = bodyText.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),?\s*(UT|Utah|WY|ID|NV|AZ|CO)/i);
      const location = locationMatch ? locationMatch[0] : null;

      return {
        title,
        year: match ? parseInt(match[1]) : null,
        make: match ? match[2] : null,
        model: match ? match[3]?.slice(0, 50) : null,
        price,
        mileage,
        location,
        vin
      };
    });

    return data;
  } catch (err: any) {
    console.log(`  ❌ Error: ${err.message.slice(0, 50)}`);
    return null;
  }
}

async function processListing(page: Page, record: any): Promise<boolean> {
  const data = await extractFromPage(page, record.listing_url);

  if (!data || !data.year) {
    // Mark as failed if no data
    await supabase
      .from('import_queue')
      .update({
        status: 'failed',
        error_message: data ? 'No year extracted' : 'Bot protection blocked',
        processed_at: new Date().toISOString()
      })
      .eq('id', record.id);
    return false;
  }

  // Update queue record with extracted data
  await supabase
    .from('import_queue')
    .update({
      listing_title: data.title,
      listing_year: data.year,
      listing_make: data.make,
      listing_model: data.model,
      listing_price: data.price,
      raw_data: {
        source: 'ksl',
        mileage: data.mileage,
        location: data.location,
        vin: data.vin
      },
      status: 'complete',
      processed_at: new Date().toISOString()
    })
    .eq('id', record.id);

  console.log(`  ✅ ${data.year} ${data.make} ${data.model}`);
  return true;
}

async function main() {
  console.log('🚗 KSL Extract - Individual listing extractor\n');
  console.log('Running slowly to avoid detection...\n');

  // Get year range preference from env
  const yearFilter = process.env.YEAR_FILTER; // e.g., "1960-1999"

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });

  let context = await createFreshContext(browser);
  let page = await context.newPage();

  // Anti-detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  let processed = 0;
  let successful = 0;
  let batchCount = 0;

  try {
    while (true) {
      // Get next batch of KSL listings without year data
      let query = supabase
        .from('import_queue')
        .select('*')
        .eq('status', 'pending')
        .like('listing_url', '%cars.ksl.com%')
        .is('listing_year', null)
        .limit(BATCH_SIZE);

      const { data: records, error } = await query;

      if (error || !records?.length) {
        console.log('\n✅ No more listings to process');
        break;
      }

      console.log(`\nBatch ${++batchCount}: Processing ${records.length} listings`);

      for (const record of records) {
        const id = record.listing_url.match(/listing\/(\d+)/)?.[1] || '?';
        console.log(`Processing listing ${id}...`);

        const success = await processListing(page, record);
        processed++;
        if (success) successful++;

        // Random delay between listings
        const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
        await page.waitForTimeout(delay);
      }

      console.log(`\n📊 Progress: ${processed} processed, ${successful} successful`);

      // Rotate context every batch to avoid fingerprinting
      await page.close();
      await context.close();
      context = await createFreshContext(browser);
      page = await context.newPage();
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Take a break between batches
      console.log(`\n☕ Taking a ${BATCH_BREAK/1000}s break...`);
      await new Promise(r => setTimeout(r, BATCH_BREAK));
    }
  } finally {
    await browser.close();
  }

  console.log(`\n✅ Complete: ${processed} processed, ${successful} successful`);
}

main().catch(console.error);
