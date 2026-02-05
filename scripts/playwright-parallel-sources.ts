#!/usr/bin/env npx tsx
/**
 * Parallel Source Extractor
 * Runs separate workers for each source simultaneously
 */

import { chromium, Browser, Page } from 'playwright';
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

const KNOWN_MAKES = ['Porsche', 'BMW', 'Mercedes-Benz', 'Ferrari', 'Lamborghini', 'Audi', 'Ford', 'Chevrolet', 'Toyota', 'Honda', 'Nissan', 'Mazda', 'Volkswagen', 'Alfa Romeo', 'Jaguar', 'Land Rover', 'Jeep', 'Dodge', 'Plymouth', 'Maserati', 'Lancia', 'Bugatti', 'Rolls-Royce', 'Aston Martin', 'De Tomaso', 'Bentley', 'Lotus', 'McLaren', 'Triumph', 'MG', 'Austin-Healey', 'Shelby', 'Pontiac', 'Cadillac', 'Lincoln', 'Buick', 'Oldsmobile', 'AMC', 'Datsun', 'Subaru', 'Mitsubishi', 'Volvo', 'Saab', 'Fiat', 'Peugeot', 'Citroën', 'Renault', 'TVR', 'Morgan', 'AC', 'DeLorean'];

function parseMakeModel(titleWithoutYear: string): { make?: string; model?: string } {
  const rest = titleWithoutYear.trim();
  for (const make of KNOWN_MAKES) {
    if (rest.toLowerCase().startsWith(make.toLowerCase())) {
      return { make, model: rest.slice(make.length).trim() };
    }
  }
  const parts = rest.split(/\s+/);
  return { make: parts[0], model: parts.slice(1).join(' ') };
}

// Gooding Extractor
async function extractGooding(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  return await page.evaluate((knownMakes) => {
    const data: any = {};
    const h1 = document.querySelector('h1');
    data.title = h1?.textContent?.trim();

    if (data.title) {
      const yearMatch = data.title.match(/^(\d{4})\s+/);
      if (yearMatch) {
        data.year = parseInt(yearMatch[1]);
        const rest = data.title.slice(5).trim();
        for (const make of knownMakes) {
          if (rest.toLowerCase().startsWith(make.toLowerCase())) {
            data.make = make;
            data.model = rest.slice(make.length).trim();
            break;
          }
        }
        if (!data.make) {
          const parts = rest.split(/\s+/);
          data.make = parts[0];
          data.model = parts.slice(1).join(' ');
        }
      }
    }

    const body = document.body.innerText;
    const soldMatch = body.match(/SOLD\s+\$\s*([\d,]+)/i);
    if (soldMatch) data.price = parseInt(soldMatch[1].replace(/,/g, ''));

    const chassisMatch = body.match(/Chassis[:\s]*([A-Z0-9]+)/i);
    if (chassisMatch) data.vin = chassisMatch[1];

    return data;
  }, KNOWN_MAKES);
}

// CollectingCars Extractor
async function extractCollectingCars(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for Cloudflare
  for (let i = 0; i < 8; i++) {
    const title = await page.title();
    if (!title.includes('moment') && !title.includes('Cloudflare')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);

  const data = await page.evaluate((knownMakes) => {
    const data: any = {};

    // Try __NEXT_DATA__
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

    // Fallback: parse from h1
    if (!data.year) {
      const h1 = document.querySelector('h1');
      data.title = h1?.textContent?.trim();
      if (data.title) {
        const yearMatch = data.title.match(/^(\d{4})\s+/);
        if (yearMatch) {
          data.year = parseInt(yearMatch[1]);
          const rest = data.title.slice(5).trim();
          for (const make of knownMakes) {
            if (rest.toLowerCase().startsWith(make.toLowerCase())) {
              data.make = make;
              data.model = rest.slice(make.length).trim();
              break;
            }
          }
          if (!data.make) {
            const parts = rest.split(/\s+/);
            data.make = parts[0];
            data.model = parts.slice(1).join(' ');
          }
        }
      }
    }

    return data;
  }, KNOWN_MAKES);

  // Final fallback: parse from URL
  if (!data.year && !data.make) {
    const urlMatch = url.match(/(\d{4})-([a-z]+)-(.+?)(?:-\d+)?$/i);
    if (urlMatch) {
      data.year = parseInt(urlMatch[1]);
      data.make = urlMatch[2].charAt(0).toUpperCase() + urlMatch[2].slice(1);
      data.model = urlMatch[3].replace(/-/g, ' ');
    }
  }

  return data;
}

// Mecum Extractor
async function extractMecum(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  return await page.evaluate((knownMakes) => {
    const data: any = {};
    const h1 = document.querySelector('h1, .lot-title');
    data.title = h1?.textContent?.trim();

    if (data.title) {
      const yearMatch = data.title.match(/^(\d{4})\s+/);
      if (yearMatch) {
        data.year = parseInt(yearMatch[1]);
        const rest = data.title.slice(5).trim();
        for (const make of knownMakes) {
          if (rest.toLowerCase().startsWith(make.toLowerCase())) {
            data.make = make;
            data.model = rest.slice(make.length).trim();
            break;
          }
        }
        if (!data.make) {
          const parts = rest.split(/\s+/);
          data.make = parts[0];
          data.model = parts.slice(1).join(' ');
        }
      }
    }

    const body = document.body.innerText;
    const vinMatch = body.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    const soldMatch = body.match(/SOLD[:\s]*\$\s*([\d,]+)/i);
    if (soldMatch) data.price = parseInt(soldMatch[1].replace(/,/g, ''));

    return data;
  }, KNOWN_MAKES);
}

// BaT Extractor
async function extractBaT(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  if (page.url().includes('/login') || page.url().includes('/account')) {
    throw new Error('RATE_LIMITED');
  }

  return await page.evaluate((knownMakes) => {
    const data: any = {};
    const h1 = document.querySelector('h1.post-title, h1');
    data.title = h1?.textContent?.trim();

    if (data.title) {
      const yearMatch = data.title.match(/^(\d{4})\s+/);
      if (yearMatch) {
        data.year = parseInt(yearMatch[1]);
        const rest = data.title.slice(5).trim();
        for (const make of knownMakes) {
          if (rest.toLowerCase().startsWith(make.toLowerCase())) {
            data.make = make;
            data.model = rest.slice(make.length).trim();
            break;
          }
        }
        if (!data.make) {
          const parts = rest.split(/\s+/);
          data.make = parts[0];
          data.model = parts.slice(1).join(' ');
        }
      }
    }

    const body = document.body.innerText;
    const vinMatch = body.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    if (vinMatch) data.vin = vinMatch[1].toUpperCase();

    const priceEl = document.querySelector('.listing-available-info-value, .bid-value');
    if (priceEl) {
      const priceMatch = priceEl.textContent?.match(/\$\s*([\d,]+)/);
      if (priceMatch) data.price = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    return data;
  }, KNOWN_MAKES);
}

// Generic worker for a source
async function sourceWorker(sourceName: string, urlPattern: string, extractor: (page: Page, url: string) => Promise<ExtractedVehicle>, delayMs: number = 2000) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let processed = 0, success = 0, rateLimits = 0;

  while (true) {
    const { data: items } = await supabase
      .from('import_queue')
      .select('id, listing_url, attempts')
      .eq('status', 'pending')
      .lt('attempts', 5)
      .like('listing_url', urlPattern)
      .order('created_at', { ascending: true })
      .limit(10);

    if (!items?.length) {
      console.log(`[${sourceName}] No items, waiting 60s...`);
      await new Promise(r => setTimeout(r, 60000));
      continue;
    }

    for (const item of items) {
      const { error: claimErr } = await supabase
        .from('import_queue')
        .update({ status: 'processing', locked_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending');

      if (claimErr) continue;

      try {
        const data = await extractor(page, item.listing_url);

        if (!data.year && !data.vin && !data.title) {
          throw new Error('No data extracted');
        }

        // Upsert vehicle
        let vehicleId: string | null = null;
        if (data.vin) {
          const { data: existing } = await supabase.from('vehicles').select('id').eq('vin', data.vin).maybeSingle();
          if (existing) vehicleId = existing.id;
        }
        if (!vehicleId) {
          const { data: existing } = await supabase.from('vehicles').select('id').eq('discovery_url', item.listing_url).maybeSingle();
          if (existing) vehicleId = existing.id;
        }

        if (vehicleId) {
          await supabase.from('vehicles').update({
            year: data.year, make: data.make, model: data.model,
            mileage: data.mileage, sale_price: data.price,
          }).eq('id', vehicleId);
        } else {
          const { data: newV } = await supabase.from('vehicles').insert({
            discovery_url: item.listing_url, year: data.year, make: data.make,
            model: data.model, vin: data.vin, mileage: data.mileage,
            sale_price: data.price, title: data.title,
          }).select('id').single();
          vehicleId = newV?.id;
        }

        await supabase.from('import_queue').update({
          status: 'complete', vehicle_id: vehicleId,
          processed_at: new Date().toISOString(), locked_at: null,
        }).eq('id', item.id);

        success++;
        rateLimits = 0;
        console.log(`[${sourceName}] ✅ ${data.year || '?'} ${data.make || '?'} ${data.model?.slice(0, 20) || '?'}`);

      } catch (err: any) {
        const error = err.message?.slice(0, 100) || String(err);
        const isRateLimit = error.includes('RATE_LIMITED') || error.includes('login') || error.includes('403');

        if (isRateLimit) {
          rateLimits++;
          await supabase.from('import_queue').update({ status: 'pending', locked_at: null }).eq('id', item.id);
          if (rateLimits >= 3) {
            console.log(`[${sourceName}] ⚠️ Rate limited, pausing 3 min...`);
            await new Promise(r => setTimeout(r, 180000));
            rateLimits = 0;
          }
        } else {
          await supabase.from('import_queue').update({
            status: item.attempts >= 4 ? 'failed' : 'pending',
            error_message: error, attempts: item.attempts + 1, locked_at: null,
          }).eq('id', item.id);
        }
        console.log(`[${sourceName}] ❌ ${error.slice(0, 40)}`);
      }

      processed++;
      await new Promise(r => setTimeout(r, delayMs + Math.random() * 1000));
    }

    if (processed % 50 === 0) {
      console.log(`[${sourceName}] 📊 ${success}/${processed} successful`);
    }
  }
}

async function main() {
  console.log('🎭 Parallel Source Extractor\n');

  // Start workers for each source in parallel
  const workers = [
    sourceWorker('Gooding', '%goodingco%', extractGooding, 2000),
    sourceWorker('CollectingCars', '%collectingcars%', extractCollectingCars, 3000),
    sourceWorker('Mecum', '%mecum%', extractMecum, 2000),
    sourceWorker('BaT', '%bringatrailer%', extractBaT, 2500),
  ];

  // Status reporter
  setInterval(async () => {
    const { data } = await supabase
      .from('import_queue')
      .select('status')
      .limit(100000);

    const counts: Record<string, number> = {};
    data?.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });

    console.log(`\n📊 Queue: pending=${counts.pending || 0} complete=${counts.complete || 0} failed=${counts.failed || 0}\n`);
  }, 120000);

  await Promise.all(workers);
}

main().catch(console.error);
