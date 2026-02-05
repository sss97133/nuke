#!/usr/bin/env npx tsx
/**
 * Autonomous Playwright Extractor
 * Main extraction technique - runs continuously, processes all sources
 * No external APIs needed (no OpenAI, no Firecrawl)
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');
const WORKERS = parseInt(process.env.WORKERS || '3');
const DELAY_MS = 1500;
const TIMEOUT_MS = 45000;

interface ExtractedVehicle {
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  price?: number;
  images?: string[];
  description?: string;
  seller?: string;
  location?: string;
}

// Stealth settings
async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
}

// BaT Extractor
async function extractBaT(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

  // Check for redirect to login
  if (page.url().includes('/login') || page.url().includes('/account')) {
    throw new Error('RATE_LIMITED: Redirected to login');
  }

  return await page.evaluate(() => {
    const data: any = {};

    // Title
    const h1 = document.querySelector('h1.post-title, h1');
    data.title = h1?.textContent?.trim();

    // Parse year/make/model from title
    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      // Split make/model intelligently
      const rest = titleMatch[2] + ' ' + titleMatch[3];
      const makes = ['Porsche', 'BMW', 'Mercedes-Benz', 'Ferrari', 'Lamborghini', 'Audi', 'Ford', 'Chevrolet', 'Toyota', 'Honda', 'Nissan', 'Mazda', 'Volkswagen', 'Alfa Romeo', 'Jaguar', 'Land Rover', 'Jeep', 'Dodge', 'Plymouth'];
      for (const make of makes) {
        if (rest.toLowerCase().startsWith(make.toLowerCase())) {
          data.make = make;
          data.model = rest.slice(make.length).trim();
          break;
        }
      }
      if (!data.make) {
        const parts = rest.split(' ');
        data.make = parts[0];
        data.model = parts.slice(1).join(' ');
      }
    }

    // Essentials section
    const essentials = document.querySelector('.listing-essentials, .essentials');
    if (essentials) {
      const text = essentials.textContent || '';

      // VIN
      const vinMatch = text.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) data.vin = vinMatch[1].toUpperCase();

      // Mileage
      const mileMatch = text.match(/([\d,]+)\s*(?:miles|mi)\b/i);
      if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

      // Location
      const locMatch = text.match(/(?:Location|Seller)[:\s]*([^,\n]+(?:,\s*[A-Z]{2})?)/i);
      if (locMatch) data.location = locMatch[1].trim();
    }

    // Price - sold price or current bid
    const priceEl = document.querySelector('.listing-available-info-value, .bid-value, [class*="price"]');
    if (priceEl) {
      const priceMatch = priceEl.textContent?.match(/\$\s*([\d,]+)/);
      if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    // Description
    const desc = document.querySelector('.listing-post-content, .post-content');
    if (desc) data.description = desc.textContent?.trim().slice(0, 5000);

    // Images
    const imgs = Array.from(document.querySelectorAll('img[src*="bringatrailer"]'))
      .map(img => (img as HTMLImageElement).src)
      .filter(src => src.includes('/photos/') || src.includes('/wp-content/'))
      .filter(src => !src.includes('-150x') && !src.includes('-80x'))
      .slice(0, 100);
    if (imgs.length) data.images = imgs;

    return data;
  });
}

// Cars & Bids Extractor
async function extractCarsAndBids(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForTimeout(2000); // Let JS render

  return await page.evaluate(() => {
    const data: any = {};

    // Title
    const h1 = document.querySelector('h1');
    data.title = h1?.textContent?.trim();

    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      data.make = titleMatch[2];
      data.model = titleMatch[3];
    }

    // Quick facts / details
    const body = document.body.innerText;

    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    const mileMatch = body.match(/([\d,]+)\s*(?:Miles|mi)\b/i);
    if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

    // Price
    const priceMatch = body.match(/(?:Sold|Bid|Price)[:\s]*\$\s*([\d,]+)/i);
    if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));

    // Images
    const imgs = Array.from(document.querySelectorAll('img'))
      .map(img => (img as HTMLImageElement).src)
      .filter(src => src.includes('carsandbids') && (src.includes('/photos/') || src.includes('/images/')))
      .slice(0, 50);
    if (imgs.length) data.images = imgs;

    return data;
  });
}

// Collecting Cars Extractor
async function extractCollectingCars(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const data: any = {};

    // Try __NEXT_DATA__ first
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) {
      try {
        const json = JSON.parse(nextData.textContent || '');
        const lot = json.props?.pageProps?.lot;
        if (lot) {
          data.year = lot.year;
          data.make = lot.make;
          data.model = lot.model;
          data.title = `${lot.year} ${lot.make} ${lot.model}`;
          data.price = lot.soldPrice || lot.currentBid;
          data.mileage = lot.mileage;
          data.vin = lot.vin;
          data.location = lot.location;
        }
      } catch {}
    }

    // Fallback to DOM
    if (!data.title) {
      const h1 = document.querySelector('h1');
      data.title = h1?.textContent?.trim();
    }

    return data;
  });
}

// Generic Extractor (fallback)
async function extractGeneric(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

  return await page.evaluate(() => {
    const data: any = {};
    const body = document.body.innerText;

    // Title
    const h1 = document.querySelector('h1');
    const ogTitle = document.querySelector('meta[property="og:title"]');
    data.title = h1?.textContent?.trim() || ogTitle?.getAttribute('content');

    // Year
    const yearMatch = body.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
    if (yearMatch) data.year = parseInt(yearMatch[1]);

    // VIN
    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    // Price
    const priceMatch = body.match(/\$\s*([\d,]+)/);
    if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));

    // Mileage
    const mileMatch = body.match(/([\d,]+)\s*(?:miles|mi|km)\b/i);
    if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

    return data;
  });
}

// Worker function - each worker gets its own browser instance
async function processWorker(workerId: number) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await createStealthContext(browser);
  const page = await context.newPage();

  let processed = 0;
  let success = 0;
  let rateLimited = 0;

  while (true) {
    // Claim batch
    const { data: items } = await supabase
      .from('import_queue')
      .select('id, listing_url, attempts')
      .eq('status', 'pending')
      .lt('attempts', 5)
      .order('created_at', { ascending: true })
      .limit(10);

    if (!items?.length) {
      console.log(`[W${workerId}] No items, waiting...`);
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }

    for (const item of items) {
      // Claim item
      const { error: claimErr } = await supabase
        .from('import_queue')
        .update({
          status: 'processing',
          locked_by: `playwright-w${workerId}`,
          locked_at: new Date().toISOString()
        })
        .eq('id', item.id)
        .eq('status', 'pending');

      if (claimErr) continue; // Someone else got it

      const url = item.listing_url;
      let data: ExtractedVehicle = {};
      let error: string | null = null;

      try {
        if (url.includes('bringatrailer')) {
          data = await extractBaT(page, url);
        } else if (url.includes('carsandbids')) {
          data = await extractCarsAndBids(page, url);
        } else if (url.includes('collectingcars')) {
          data = await extractCollectingCars(page, url);
        } else {
          data = await extractGeneric(page, url);
        }

        if (!data.year && !data.vin && !data.price && !data.title) {
          throw new Error('No data extracted');
        }

        // Check if vehicle exists by VIN or discovery_url
        let vehicleId: string | null = null;

        if (data.vin) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('vin', data.vin)
            .maybeSingle();
          if (existing) vehicleId = existing.id;
        }

        if (!vehicleId) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('discovery_url', url)
            .maybeSingle();
          if (existing) vehicleId = existing.id;
        }

        if (vehicleId) {
          // Update existing
          await supabase.from('vehicles').update({
            year: data.year || undefined,
            make: data.make || undefined,
            model: data.model || undefined,
            mileage: data.mileage || undefined,
            sale_price: data.price || undefined,
          }).eq('id', vehicleId);
        } else {
          // Insert new
          const { data: newVehicle, error: insertErr } = await supabase
            .from('vehicles')
            .insert({
              discovery_url: url,
              year: data.year,
              make: data.make,
              model: data.model,
              vin: data.vin,
              mileage: data.mileage,
              sale_price: data.price,
              title: data.title,
            })
            .select('id')
            .single();

          if (insertErr) {
            if (insertErr.message.includes('duplicate')) {
              // Already exists, mark complete anyway
            } else {
              throw new Error(`DB: ${insertErr.message}`);
            }
          }
          vehicleId = newVehicle?.id || null;
        }

        const vehicle = { id: vehicleId };

        // Mark complete
        await supabase.from('import_queue').update({
          status: 'complete',
          vehicle_id: vehicle?.id,
          processed_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
          error_message: null,
        }).eq('id', item.id);

        success++;
        console.log(`[W${workerId}] ✅ ${data.year || '?'} ${data.make || '?'} ${data.model || '?'}`);

      } catch (err: any) {
        error = err.message?.slice(0, 200) || String(err);

        const isRateLimit = error.includes('RATE_LIMITED') || error.includes('login') || error.includes('403');
        const isGone = error.includes('404') || error.includes('Gone');

        if (isRateLimit) {
          rateLimited++;
          // Back off - don't count against attempts
          await supabase.from('import_queue').update({
            status: 'pending',
            error_message: error,
            locked_at: null,
            locked_by: null,
          }).eq('id', item.id);

          if (rateLimited >= 3) {
            console.log(`[W${workerId}] ⚠️ Rate limited, pausing 2 min...`);
            await new Promise(r => setTimeout(r, 120000));
            rateLimited = 0;
          }
        } else if (isGone) {
          await supabase.from('import_queue').update({
            status: 'skipped',
            error_message: error,
            processed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          }).eq('id', item.id);
        } else {
          await supabase.from('import_queue').update({
            status: item.attempts >= 4 ? 'failed' : 'pending',
            error_message: error,
            attempts: item.attempts + 1,
            processed_at: new Date().toISOString(),
            locked_at: null,
            locked_by: null,
          }).eq('id', item.id);
        }

        console.log(`[W${workerId}] ❌ ${url.slice(0, 50)}... - ${error.slice(0, 60)}`);
      }

      processed++;
      await new Promise(r => setTimeout(r, DELAY_MS + Math.random() * 1000));
    }
  }
}

async function main() {
  console.log('🎭 Autonomous Playwright Extractor');
  console.log(`Workers: ${WORKERS}, Batch: ${BATCH_SIZE}\n`);

  // Start workers - each gets its own browser
  const workers = Array.from({ length: WORKERS }, (_, i) =>
    processWorker(i + 1).catch(err => console.error(`Worker ${i + 1} crashed:`, err))
  );

  // Status reporter
  setInterval(async () => {
    const { data } = await supabase
      .from('import_queue')
      .select('status')
      .limit(300000);

    const counts: Record<string, number> = {};
    data?.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });

    console.log(`\n📊 Status: pending=${counts.pending || 0} processing=${counts.processing || 0} complete=${counts.complete || 0} failed=${counts.failed || 0}\n`);
  }, 60000);

  await Promise.all(workers);
}

main().catch(console.error);
