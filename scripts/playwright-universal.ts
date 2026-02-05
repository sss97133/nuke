#!/usr/bin/env npx tsx
/**
 * Universal Playwright Extractor
 * Works with ANY vehicle listing site - no site-specific code needed
 * Uses smart heuristics to extract year/make/model/price/vin from any page
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const WORKERS = parseInt(process.env.WORKERS || '4');

const KNOWN_MAKES = [
  'Porsche', 'BMW', 'Mercedes-Benz', 'Mercedes', 'Ferrari', 'Lamborghini', 'Audi', 'Ford', 'Chevrolet', 'Chevy',
  'Toyota', 'Honda', 'Nissan', 'Mazda', 'Volkswagen', 'VW', 'Alfa Romeo', 'Jaguar', 'Land Rover', 'Range Rover',
  'Jeep', 'Dodge', 'Plymouth', 'Maserati', 'Lancia', 'Bugatti', 'Rolls-Royce', 'Rolls Royce', 'Aston Martin',
  'De Tomaso', 'Bentley', 'Lotus', 'McLaren', 'Triumph', 'MG', 'Austin-Healey', 'Austin Healey', 'Shelby',
  'Pontiac', 'Cadillac', 'Lincoln', 'Buick', 'Oldsmobile', 'AMC', 'Datsun', 'Subaru', 'Mitsubishi', 'Volvo',
  'Saab', 'Fiat', 'Peugeot', 'Citroën', 'Citroen', 'Renault', 'TVR', 'Morgan', 'AC', 'DeLorean', 'Delorean',
  'GMC', 'Ram', 'Chrysler', 'Acura', 'Lexus', 'Infiniti', 'Genesis', 'Mini', 'Smart', 'Scion', 'Saturn',
  'Hummer', 'Isuzu', 'Suzuki', 'Kia', 'Hyundai', 'Daewoo', 'Geo', 'Eagle', 'Mercury', 'Packard', 'Studebaker',
  'Hudson', 'Nash', 'Kaiser', 'Willys', 'Tucker', 'DeSoto', 'Imperial', 'Edsel', 'Continental', 'Cord', 'Auburn',
  'Duesenberg', 'Pierce-Arrow', 'Stutz', 'Marmon', 'Franklin', 'REO', 'Graham', 'Hupmobile', 'LaSalle',
  'Opel', 'Vauxhall', 'Skoda', 'Seat', 'Dacia', 'Lada', 'GAZ', 'ZIL', 'Tatra', 'Trabant', 'Wartburg',
  'Holden', 'HSV', 'Falcon', 'Commodore', 'Monaro', 'Torana', 'Ute',
  'Alpine', 'Caterham', 'Ginetta', 'Noble', 'Ariel', 'BAC', 'Bristol', 'Jensen', 'Reliant', 'TVR',
  'Iso', 'Bizzarrini', 'OSCA', 'ATS', 'Innocenti', 'Autobianchi',
  'Koenigsegg', 'Pagani', 'Spyker', 'Wiesmann', 'Gumpert', 'Artega', 'Ruf',
  'Vector', 'Saleen', 'SSC', 'Hennessey', 'Panoz', 'Mosler', 'Rossion', 'Devon',
  'Fisker', 'Karma', 'Lucid', 'Rivian', 'Polestar', 'NIO', 'BYD', 'Xpeng', 'Li Auto'
];

interface ExtractedVehicle {
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  price?: number;
}

// Universal extraction - works on any page
async function universalExtract(page: Page, url: string): Promise<ExtractedVehicle> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Check for rate limiting
  const currentUrl = page.url();
  if (currentUrl.includes('/login') || currentUrl.includes('/account') || currentUrl.includes('/signin')) {
    throw new Error('RATE_LIMITED: Redirected to login');
  }

  // Wait for Cloudflare if needed
  for (let i = 0; i < 6; i++) {
    const title = await page.title();
    if (!title.includes('moment') && !title.includes('Cloudflare') && !title.includes('Just a')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);

  const data = await page.evaluate((knownMakes) => {
    const result: any = {};

    // 1. Try structured data first (JSON-LD, __NEXT_DATA__, etc.)
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
      try {
        const ld = JSON.parse(jsonLd.textContent || '');
        const item = Array.isArray(ld) ? ld[0] : ld;
        if (item.name) result.title = item.name;
        if (item.offers?.price) result.price = parseInt(String(item.offers.price).replace(/[^0-9]/g, ''));
        if (item.vehicleIdentificationNumber) result.vin = item.vehicleIdentificationNumber;
        if (item.mileageFromOdometer?.value) result.mileage = parseInt(item.mileageFromOdometer.value);
        if (item.modelDate || item.vehicleModelDate) result.year = parseInt(item.modelDate || item.vehicleModelDate);
        if (item.brand?.name) result.make = item.brand.name;
        if (item.model) result.model = item.model;
      } catch {}
    }

    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData && !result.year) {
      try {
        const json = JSON.parse(nextData.textContent || '');
        const props = json.props?.pageProps;
        const lot = props?.lot || props?.vehicle || props?.listing || props?.car || props;
        if (lot) {
          result.year = result.year || lot.year;
          result.make = result.make || lot.make;
          result.model = result.model || lot.model;
          result.title = result.title || lot.title || lot.name;
          result.price = result.price || lot.soldPrice || lot.salePrice || lot.price || lot.currentBid;
          result.mileage = result.mileage || lot.mileage || lot.odometer;
          result.vin = result.vin || lot.vin;
        }
      } catch {}
    }

    // 2. Get title from H1 or page title
    if (!result.title) {
      const h1 = document.querySelector('h1');
      result.title = h1?.textContent?.trim() || document.title?.split('|')[0]?.trim();
    }

    // 3. Parse year/make/model from title
    if (result.title && !result.year) {
      // Pattern: "1965 Porsche 911" or "2024 Toyota GR Yaris"
      const yearMatch = result.title.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
      if (yearMatch) {
        result.year = parseInt(yearMatch[1]);

        // Find make after year
        const afterYear = result.title.slice(result.title.indexOf(yearMatch[1]) + 4).trim();
        for (const make of knownMakes) {
          if (afterYear.toLowerCase().startsWith(make.toLowerCase())) {
            result.make = make;
            result.model = afterYear.slice(make.length).trim();
            break;
          }
        }
        // Fallback: first word is make
        if (!result.make && afterYear) {
          const parts = afterYear.split(/\s+/);
          result.make = parts[0];
          result.model = parts.slice(1).join(' ');
        }
      }
    }

    // 4. Extract from body text
    const body = document.body.innerText;

    // VIN - 17 character alphanumeric (no I, O, Q)
    if (!result.vin) {
      const vinMatch = body.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (vinMatch) result.vin = vinMatch[1].toUpperCase();
    }

    // Price - various formats
    if (!result.price) {
      const pricePatterns = [
        /(?:SOLD|Sold|Final|Winning|Sale|Price)[:\s]*[\$£€]\s*([\d,]+)/i,
        /[\$£€]\s*([\d,]+(?:,\d{3})*)/,
        /([\d,]+)\s*(?:USD|EUR|GBP)/i,
      ];
      for (const pattern of pricePatterns) {
        const match = body.match(pattern);
        if (match) {
          const price = parseInt(match[1].replace(/,/g, ''));
          if (price > 500 && price < 100000000) { // Sanity check
            result.price = price;
            break;
          }
        }
      }
    }

    // Mileage
    if (!result.mileage) {
      const mileMatch = body.match(/([\d,]+)\s*(?:miles|mi|km|kilometers)\b/i);
      if (mileMatch) {
        const miles = parseInt(mileMatch[1].replace(/,/g, ''));
        if (miles < 1000000) result.mileage = miles;
      }
    }

    // Chassis number for classics (often used instead of VIN)
    if (!result.vin) {
      const chassisMatch = body.match(/Chassis[:\s#]*([A-Z0-9]{5,})/i);
      if (chassisMatch) result.vin = chassisMatch[1].toUpperCase();
    }

    return result;
  }, KNOWN_MAKES);

  // 5. Final fallback: parse from URL
  if (!data.year && !data.make) {
    // URLs like: /2024-toyota-gr-yaris or /1965-porsche-911
    const urlMatch = url.match(/(\d{4})-([a-z]+)-([a-z0-9-]+)/i);
    if (urlMatch) {
      data.year = parseInt(urlMatch[1]);
      data.make = urlMatch[2].charAt(0).toUpperCase() + urlMatch[2].slice(1);
      data.model = urlMatch[3].replace(/-/g, ' ');
    }
  }

  return data;
}

async function worker(workerId: number) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  let processed = 0, success = 0, rateLimits = 0;

  while (true) {
    const { data: items } = await supabase
      .from('import_queue')
      .select('id, listing_url, attempts')
      .eq('status', 'pending')
      .lt('attempts', 5)
      .order('created_at', { ascending: true })
      .limit(10);

    if (!items?.length) {
      console.log(`[W${workerId}] No items, waiting 30s...`);
      await new Promise(r => setTimeout(r, 30000));
      continue;
    }

    for (const item of items) {
      const { error: claimErr } = await supabase
        .from('import_queue')
        .update({ status: 'processing', locked_at: new Date().toISOString(), locked_by: `w${workerId}` })
        .eq('id', item.id)
        .eq('status', 'pending');

      if (claimErr) continue;

      try {
        const data = await universalExtract(page, item.listing_url);

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
            mileage: data.mileage, sale_price: data.price, title: data.title,
          }).eq('id', vehicleId);
        } else {
          const { data: newV, error: insertErr } = await supabase.from('vehicles').insert({
            discovery_url: item.listing_url, year: data.year, make: data.make,
            model: data.model, vin: data.vin, mileage: data.mileage,
            sale_price: data.price, title: data.title,
          }).select('id').single();

          if (insertErr && !insertErr.message.includes('duplicate')) {
            throw new Error(`DB: ${insertErr.message}`);
          }
          vehicleId = newV?.id;
        }

        await supabase.from('import_queue').update({
          status: 'complete', vehicle_id: vehicleId,
          processed_at: new Date().toISOString(), locked_at: null, locked_by: null,
        }).eq('id', item.id);

        success++;
        rateLimits = 0;
        const domain = new URL(item.listing_url).hostname.replace('www.', '').slice(0, 15);
        console.log(`[W${workerId}] ✅ ${domain}: ${data.year || '?'} ${data.make || '?'} ${data.model?.slice(0, 25) || '?'}`);

      } catch (err: any) {
        const error = err.message?.slice(0, 100) || String(err);
        const isRateLimit = error.includes('RATE_LIMITED') || error.includes('login') || error.includes('403');
        const isGone = error.includes('404') || error.includes('Gone') || error.includes('not found');

        if (isRateLimit) {
          rateLimits++;
          await supabase.from('import_queue').update({ status: 'pending', locked_at: null, locked_by: null }).eq('id', item.id);
          if (rateLimits >= 3) {
            console.log(`[W${workerId}] ⚠️ Rate limited, pausing 2 min...`);
            await new Promise(r => setTimeout(r, 120000));
            rateLimits = 0;
          }
        } else if (isGone) {
          await supabase.from('import_queue').update({
            status: 'skipped', error_message: error,
            processed_at: new Date().toISOString(), locked_at: null, locked_by: null,
          }).eq('id', item.id);
        } else if (error.includes('duplicate')) {
          await supabase.from('import_queue').update({
            status: 'complete', processed_at: new Date().toISOString(), locked_at: null, locked_by: null,
          }).eq('id', item.id);
        } else {
          await supabase.from('import_queue').update({
            status: item.attempts >= 4 ? 'failed' : 'pending',
            error_message: error, attempts: item.attempts + 1, locked_at: null, locked_by: null,
          }).eq('id', item.id);
        }

        const domain = new URL(item.listing_url).hostname.replace('www.', '').slice(0, 15);
        console.log(`[W${workerId}] ❌ ${domain}: ${error.slice(0, 50)}`);
      }

      processed++;
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
    }

    if (processed % 20 === 0) {
      console.log(`[W${workerId}] 📊 ${success}/${processed} successful`);
    }
  }
}

async function main() {
  console.log(`🎭 Universal Extractor - ${WORKERS} workers\n`);

  const workers = Array.from({ length: WORKERS }, (_, i) =>
    worker(i + 1).catch(err => console.error(`Worker ${i + 1} crashed:`, err))
  );

  // Status reporter
  setInterval(async () => {
    const { data } = await supabase.rpc('get_queue_status_counts').single();
    if (data) {
      console.log(`\n📊 pending=${data.pending} complete=${data.complete} failed=${data.failed}\n`);
    }
  }, 120000);

  await Promise.all(workers);
}

main().catch(console.error);
