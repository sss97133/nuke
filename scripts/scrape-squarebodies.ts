/**
 * Scrape squarebody trucks from Hemmings using Playwright
 * Run with: npx ts-node scripts/scrape-squarebodies.ts
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SOURCES = [
  // BaT squarebody searches
  { name: 'BaT C10', url: 'https://bringatrailer.com/chevrolet/c10/', type: 'bat' },
  { name: 'BaT K10', url: 'https://bringatrailer.com/chevrolet/k10/', type: 'bat' },
  { name: 'BaT Suburban', url: 'https://bringatrailer.com/chevrolet/suburban/', type: 'bat' },
  { name: 'BaT Blazer', url: 'https://bringatrailer.com/chevrolet/blazer/', type: 'bat' },
  { name: 'BaT GMC Jimmy', url: 'https://bringatrailer.com/gmc/jimmy/', type: 'bat' },
  { name: 'BaT Results', url: 'https://bringatrailer.com/auctions/results/', type: 'bat' },
  // Cars & Bids
  { name: 'C&B Trucks', url: 'https://carsandbids.com/search?category=trucks', type: 'cab' },
  { name: 'C&B All', url: 'https://carsandbids.com/auctions/', type: 'cab' },
  // Dealers
  { name: 'Worldwide Vintage Autos', url: 'https://www.worldwidevintageautos.com/', type: 'dealer' },
  { name: 'Classic Car Deals', url: 'https://www.classiccardeals.com/', type: 'dealer' },
  { name: 'Arizona Classic Cars', url: 'https://www.arizonaclassiccarsales.com/', type: 'dealer' },
  { name: 'Fast Lane Classic Cars', url: 'https://www.fastlanecars.com/inventory', type: 'dealer' },
  { name: 'California Classic Cars', url: 'https://www.californiaclassiccars.com/', type: 'dealer' },
  { name: 'Gateway Classic Cars', url: 'https://www.gatewayclassiccars.com/vehicles', type: 'dealer' },
  { name: 'Streetside Classics', url: 'https://www.streetsideclassics.com/vehicles', type: 'dealer' },
  // Collecting Cars (online auction)
  { name: 'Collecting Cars', url: 'https://collectingcars.com/search/', type: 'auction' },
];

interface Vehicle {
  year: number;
  make: string;
  model: string;
  price: number | null;
  mileage: number | null;
  vin: string | null;
  listing_url: string;
  location: string | null;
}

async function scrapeHemmings(): Promise<void> {
  console.log('='.repeat(60));
  console.log('SQUAREBODY SCRAPER - Hemmings');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  let totalFound = 0;
  let totalSaved = 0;

  for (const source of SOURCES) {
    console.log(`\n--- ${source.name} ---`);
    console.log(`URL: ${source.url}`);

    try {
      const page = await context.newPage();
      await page.goto(source.url, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for listings to load
      await page.waitForSelector('a[href*="/listing/"], a[href*="/auctions/"]', { timeout: 15000 }).catch(() => null);

      // Get all listing links
      const listings = await page.evaluate(() => {
        const links: { url: string; title: string; price: string }[] = [];

        // BaT listings
        document.querySelectorAll('a[href*="/listing/"]').forEach(a => {
          const link = a as HTMLAnchorElement;
          const title = link.textContent?.trim() || '';
          if (link.href && title && !links.some(l => l.url === link.href)) {
            links.push({ url: link.href, title, price: '' });
          }
        });

        // Cars & Bids auctions
        document.querySelectorAll('a[href*="/auctions/"]').forEach(a => {
          const link = a as HTMLAnchorElement;
          const card = link.closest('.auction-card, article, [class*="auction"]');
          const title = card?.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || link.textContent?.trim() || '';
          const price = card?.querySelector('[class*="bid"], [class*="price"]')?.textContent?.trim() || '';
          if (link.href && title && !links.some(l => l.url === link.href)) {
            links.push({ url: link.href, title, price });
          }
        });

        return links.slice(0, 50); // Limit to 50
      });

      console.log(`  Found ${listings.length} listings`);
      totalFound += listings.length;

      // Check which we already have
      const urls = listings.map(l => l.url);
      const { data: existing } = await supabase
        .from('vehicles')
        .select('listing_url')
        .in('listing_url', urls);

      const existingUrls = new Set((existing || []).map(e => e.listing_url));
      const newListings = listings.filter(l => !existingUrls.has(l.url));
      console.log(`  New: ${newListings.length}`);

      // Extract details from each new listing (limit 15 per source)
      for (const listing of newListings.slice(0, 15)) {
        const vehicle = await extractListing(page, listing.url);
        if (vehicle && vehicle.year) {
          // Check if we already have this listing
          const { data: exists } = await supabase
            .from('vehicles')
            .select('id')
            .or(`listing_url.eq.${vehicle.listing_url},bat_auction_url.eq.${vehicle.listing_url}`)
            .limit(1);

          if (exists?.length) {
            console.log(`  ⏭️  Already have: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
            continue;
          }

          const { data, error } = await supabase
            .from('vehicles')
            .insert({
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              price: vehicle.price,
              mileage: vehicle.mileage,
              vin: vehicle.vin,
              listing_url: vehicle.listing_url,
              bat_auction_url: vehicle.listing_url.includes('bringatrailer') ? vehicle.listing_url : null,
              location: vehicle.location,
            })
            .select()
            .single();

          if (data) {
            totalSaved++;
            console.log(`  ✅ ${vehicle.year} ${vehicle.make} ${vehicle.model} - $${vehicle.price || 'N/A'}`);
          } else if (error) {
            console.log(`  ❌ DB error: ${error.message}`);
          }
        }
      }

      await page.close();

    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETE: Found ${totalFound}, Saved ${totalSaved}`);
  console.log('='.repeat(60));
}

async function extractListing(page: any, url: string): Promise<Vehicle | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const data = await page.evaluate(() => {
      const title = document.querySelector('h1')?.textContent?.trim() ||
                    document.title.split('|')[0].trim();

      // Extract price
      const priceText = document.body.innerText.match(/\$[\d,]+/)?.[0] || '';
      const price = priceText ? parseInt(priceText.replace(/[$,]/g, '')) : null;

      // Extract mileage
      const mileageMatch = document.body.innerText.match(/([\d,]+)\s*(?:miles|mi\b)/i);
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

      // Extract VIN
      const vinMatch = document.body.innerText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      const vin = vinMatch?.[1] || null;

      // Extract location
      const locationMatch = document.body.innerText.match(/Location[:\s]*([^\n]+)/i);
      const location = locationMatch?.[1]?.trim() || null;

      return { title, price, mileage, vin, location };
    });

    // Parse year/make/model from title
    const yearMatch = data.title.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    const makes = ['Chevrolet', 'Chevy', 'GMC', 'Ford', 'Dodge'];
    let make = null;
    for (const m of makes) {
      if (data.title.toLowerCase().includes(m.toLowerCase())) {
        make = m === 'Chevy' ? 'Chevrolet' : m;
        break;
      }
    }

    // Extract model
    let model = null;
    if (make) {
      const afterMake = data.title.split(new RegExp(make, 'i'))[1];
      if (afterMake) {
        model = afterMake.replace(/^\s*[-:]\s*/, '').trim().split(/\s+/).slice(0, 3).join(' ');
      }
    }

    if (!year || !make) return null;

    return {
      year,
      make,
      model: model || 'Unknown',
      price: data.price,
      mileage: data.mileage,
      vin: data.vin,
      listing_url: url,
      location: data.location,
    };

  } catch (err) {
    return null;
  }
}

// Run
scrapeHemmings().catch(console.error);
