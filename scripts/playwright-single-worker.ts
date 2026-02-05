#!/usr/bin/env npx tsx
/**
 * Single-Worker Playwright Extractor
 * Reliable single-browser approach with site-specific extractors
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface ExtractedVehicle {
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  price?: number;
}

// BaT Extractor
async function extractBaT(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  if (page.url().includes('/login') || page.url().includes('/account')) {
    throw new Error('RATE_LIMITED: Redirected to login');
  }

  return await page.evaluate(() => {
    const data: any = {};
    const h1 = document.querySelector('h1.post-title, h1');
    data.title = h1?.textContent?.trim();

    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      const rest = titleMatch[2] + ' ' + titleMatch[3];
      const makes = ['Porsche', 'BMW', 'Mercedes-Benz', 'Ferrari', 'Lamborghini', 'Audi', 'Ford', 'Chevrolet', 'Toyota', 'Honda', 'Nissan', 'Mazda', 'Volkswagen', 'Alfa Romeo', 'Jaguar', 'Land Rover', 'Jeep', 'Dodge', 'Plymouth', 'Maserati', 'Lancia', 'Bugatti', 'Delage', 'Volvo'];
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

    const body = document.body.innerText;
    const vinMatch = body.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    const mileMatch = body.match(/([\d,]+)\s*(?:miles|mi)\b/i);
    if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

    const priceEl = document.querySelector('.listing-available-info-value, .bid-value, [class*="price"]');
    if (priceEl) {
      const priceMatch = priceEl.textContent?.match(/\$\s*([\d,]+)/);
      if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    return data;
  });
}

// Cars & Bids Extractor
async function extractCarsAndBids(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const data: any = {};
    const h1 = document.querySelector('h1');
    data.title = h1?.textContent?.trim();

    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      data.make = titleMatch[2];
      data.model = titleMatch[3];
    }

    const body = document.body.innerText;
    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    const mileMatch = body.match(/([\d,]+)\s*(?:Miles|mi)\b/i);
    if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

    const priceMatch = body.match(/(?:Sold|Bid|Price)[:\s]*\$\s*([\d,]+)/i);
    if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));

    return data;
  });
}

// Collecting Cars Extractor
async function extractCollectingCars(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Wait for Cloudflare challenge to complete (up to 10 seconds)
  for (let i = 0; i < 10; i++) {
    const title = await page.title();
    if (!title.includes('moment') && !title.includes('Cloudflare')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const data: any = {};

    // Try __NEXT_DATA__ first
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) {
      try {
        const json = JSON.parse(nextData.textContent || '');
        const lot = json.props?.pageProps?.lot || json.props?.pageProps?.vehicle;
        if (lot) {
          data.year = lot.year;
          data.make = lot.make;
          data.model = lot.model;
          data.title = lot.title || `${lot.year} ${lot.make} ${lot.model}`;
          data.price = lot.soldPrice || lot.currentBid || lot.price;
          data.mileage = lot.mileage || lot.odometer;
          data.vin = lot.vin;
        }
      } catch {}
    }

    // Fallback to DOM parsing
    if (!data.title) {
      const h1 = document.querySelector('h1');
      data.title = h1?.textContent?.trim();
    }

    // Parse from URL if title parsing fails (URL has format: 2024-toyota-gr-yaris-7)
    if (!data.year && !data.make) {
      const urlMatch = window.location.pathname.match(/(\d{4})-([a-z]+)-(.+?)(?:-\d+)?$/i);
      if (urlMatch) {
        data.year = parseInt(urlMatch[1]);
        data.make = urlMatch[2].charAt(0).toUpperCase() + urlMatch[2].slice(1);
        data.model = urlMatch[3].replace(/-/g, ' ');
      }
    }

    // Parse from title
    if (data.title && !data.year) {
      const titleMatch = data.title.match(/^(\d{4})\s+([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s+(.+)/);
      if (titleMatch) {
        data.year = parseInt(titleMatch[1]);
        const rest = data.title.slice(5).trim();
        const knownMakes = ['Mercedes-Benz', 'Aston Martin', 'Land Rover', 'Alfa Romeo', 'Rolls-Royce'];
        let found = false;
        for (const make of knownMakes) {
          if (rest.toLowerCase().startsWith(make.toLowerCase())) {
            data.make = make;
            data.model = rest.slice(make.length).trim();
            found = true;
            break;
          }
        }
        if (!found) {
          const parts = rest.split(/\s+/);
          data.make = parts[0];
          data.model = parts.slice(1).join(' ');
        }
      }
    }

    // Get price from body if not found
    if (!data.price) {
      const body = document.body.innerText;
      const priceMatch = body.match(/(?:Sold|Final|Winning)[:\s]*[£€$]\s*([\d,]+)/i);
      if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    return data;
  });
}

// PCarMarket Extractor
async function extractPCarMarket(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  return await page.evaluate(() => {
    const data: any = {};
    const h1 = document.querySelector('h1');
    data.title = h1?.textContent?.trim();

    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      data.make = titleMatch[2];
      data.model = titleMatch[3];
    }

    const body = document.body.innerText;
    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    const mileMatch = body.match(/([\d,]+)\s*(?:miles|mi|km)\b/i);
    if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

    const priceMatch = body.match(/\$\s*([\d,]+)/);
    if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));

    return data;
  });
}

// Gooding & Co Extractor
async function extractGooding(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const data: any = {};
    const h1 = document.querySelector('h1');
    data.title = h1?.textContent?.trim();

    // Parse year from title like "1965 Rolls-Royce Silver Cloud III Saloon"
    const titleMatch = data.title?.match(/^(\d{4})\s+([A-Za-z-]+(?:\s+[A-Za-z-]+)?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      // Handle multi-word makes like "Rolls-Royce", "Aston Martin", "Mercedes-Benz"
      const knownMakes = ['Rolls-Royce', 'Aston Martin', 'Mercedes-Benz', 'Alfa Romeo', 'Land Rover', 'De Tomaso'];
      const rest = data.title.slice(5).trim(); // Remove year
      let found = false;
      for (const make of knownMakes) {
        if (rest.toLowerCase().startsWith(make.toLowerCase())) {
          data.make = make;
          data.model = rest.slice(make.length).trim();
          found = true;
          break;
        }
      }
      if (!found) {
        // First word is make, rest is model
        const parts = rest.split(/\s+/);
        data.make = parts[0];
        data.model = parts.slice(1).join(' ');
      }
    }

    const body = document.body.innerText;

    // Chassis number (Gooding uses this instead of VIN for classics)
    const chassisMatch = body.match(/Chassis[:\s]*([A-Z0-9]+)/i);
    if (chassisMatch) data.vin = chassisMatch[1].toUpperCase();

    // VIN if present
    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    // Gooding shows "SOLD $34,100" format
    const soldMatch = body.match(/SOLD\s+\$\s*([\d,]+)/i);
    const estimateMatch = body.match(/Estimate[:\s]*\$\s*([\d,]+)/i);
    if (soldMatch) data.price = parseInt(soldMatch[1].replace(/,/g, ''));
    else if (estimateMatch) data.price = parseInt(estimateMatch[1].replace(/,/g, ''));

    return data;
  });
}

// Mecum Extractor
async function extractMecum(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const data: any = {};

    // Mecum has structured data in title like "1970 Plymouth Barracuda"
    const h1 = document.querySelector('h1, .lot-title');
    data.title = h1?.textContent?.trim();

    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      data.make = titleMatch[2];
      data.model = titleMatch[3];
    }

    const body = document.body.innerText;

    // VIN
    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    // Mileage
    const mileMatch = body.match(/([\d,]+)\s*(?:Miles|Actual Miles)/i);
    if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

    // Price - Mecum shows "SOLD $X" or "High Bid $X"
    const soldMatch = body.match(/SOLD[:\s]*\$\s*([\d,]+)/i);
    const bidMatch = body.match(/(?:High Bid|Bid)[:\s]*\$\s*([\d,]+)/i);
    if (soldMatch) data.price = parseInt(soldMatch[1].replace(/,/g, ''));
    else if (bidMatch) data.price = parseInt(bidMatch[1].replace(/,/g, ''));

    return data;
  });
}

// Generic Extractor
async function extractGeneric(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  return await page.evaluate(() => {
    const data: any = {};
    const body = document.body.innerText;
    const h1 = document.querySelector('h1');
    data.title = h1?.textContent?.trim();

    // Try to parse year/make/model from title first
    const titleMatch = data.title?.match(/^(\d{4})\s+(.+?)\s+(.+)/);
    if (titleMatch) {
      data.year = parseInt(titleMatch[1]);
      data.make = titleMatch[2];
      data.model = titleMatch[3];
    } else {
      const yearMatch = body.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
      if (yearMatch) data.year = parseInt(yearMatch[1]);
    }

    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    const priceMatch = body.match(/\$\s*([\d,]+)/);
    if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));

    const mileMatch = body.match(/([\d,]+)\s*(?:miles|mi|km)\b/i);
    if (mileMatch) data.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

    return data;
  });
}

async function main() {
  console.log('🎭 Single-Worker Playwright Extractor\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });

  const page = await context.newPage();
  let processed = 0, success = 0, rateLimits = 0;

  while (true) {
    // Prioritize non-BaT sources first (Gooding, CollectingCars, etc.)
    let { data: items } = await supabase
      .from('import_queue')
      .select('id, listing_url, attempts')
      .eq('status', 'pending')
      .lt('attempts', 5)
      .not('listing_url', 'like', '%bringatrailer%')
      .order('created_at', { ascending: true })
      .limit(20);

    // Fall back to BaT if no other items
    if (!items?.length) {
      const result = await supabase
        .from('import_queue')
        .select('id, listing_url, attempts')
        .eq('status', 'pending')
        .lt('attempts', 5)
        .order('created_at', { ascending: true })
        .limit(20);
      items = result.data;
    }

    if (!items?.length) {
      console.log('No items, waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }

    for (const item of items) {
      // Claim item
      const { error: claimErr } = await supabase
        .from('import_queue')
        .update({ status: 'processing', locked_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending');

      if (claimErr) continue;

      const url = item.listing_url;
      let data: ExtractedVehicle = {};
      let error: string | null = null;

      try {
        // Route to appropriate extractor
        if (url.includes('bringatrailer')) {
          data = await extractBaT(page, url);
        } else if (url.includes('carsandbids')) {
          data = await extractCarsAndBids(page, url);
        } else if (url.includes('collectingcars')) {
          data = await extractCollectingCars(page, url);
        } else if (url.includes('pcarmarket')) {
          data = await extractPCarMarket(page, url);
        } else if (url.includes('goodingco')) {
          data = await extractGooding(page, url);
        } else if (url.includes('mecum')) {
          data = await extractMecum(page, url);
        } else {
          data = await extractGeneric(page, url);
        }

        if (!data.year && !data.vin && !data.title) {
          throw new Error('No data extracted');
        }

        // Check for existing vehicle
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
          await supabase.from('vehicles').update({
            year: data.year || undefined,
            make: data.make || undefined,
            model: data.model || undefined,
            mileage: data.mileage || undefined,
            sale_price: data.price || undefined,
          }).eq('id', vehicleId);
        } else {
          const { data: newV, error: insertErr } = await supabase
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

          if (insertErr && !insertErr.message.includes('duplicate')) {
            throw new Error(`DB: ${insertErr.message}`);
          }
          vehicleId = newV?.id || null;
        }

        await supabase.from('import_queue').update({
          status: 'complete',
          vehicle_id: vehicleId,
          processed_at: new Date().toISOString(),
          locked_at: null,
          error_message: null,
        }).eq('id', item.id);

        success++;
        rateLimits = 0;
        console.log(`✅ ${data.year || '?'} ${data.make || '?'} ${data.model || '?'}`);

      } catch (err: any) {
        error = err.message?.slice(0, 200) || String(err);

        const isRateLimit = error.includes('RATE_LIMITED') || error.includes('login') || error.includes('403');
        const isGone = error.includes('404') || error.includes('Gone');

        if (isRateLimit) {
          rateLimits++;
          await supabase.from('import_queue').update({
            status: 'pending',
            error_message: error,
            locked_at: null,
          }).eq('id', item.id);

          if (rateLimits >= 3) {
            console.log('⚠️ Rate limited, pausing 2 min...');
            await new Promise(r => setTimeout(r, 120000));
            rateLimits = 0;
          }
        } else if (isGone) {
          await supabase.from('import_queue').update({
            status: 'skipped',
            error_message: error,
            processed_at: new Date().toISOString(),
            locked_at: null,
          }).eq('id', item.id);
        } else if (error.includes('duplicate')) {
          await supabase.from('import_queue').update({
            status: 'complete',
            processed_at: new Date().toISOString(),
            locked_at: null,
          }).eq('id', item.id);
        } else {
          await supabase.from('import_queue').update({
            status: item.attempts >= 4 ? 'failed' : 'pending',
            error_message: error,
            attempts: item.attempts + 1,
            processed_at: new Date().toISOString(),
            locked_at: null,
          }).eq('id', item.id);
        }

        console.log(`❌ ${url.slice(0, 50)}... - ${error.slice(0, 50)}`);
      }

      processed++;
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    }

    console.log(`📊 ${success}/${processed} successful`);
  }
}

main().catch(console.error);
