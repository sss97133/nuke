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

// Organization to link discovered vehicles to (for display on org profile)
const TARGET_ORG_ID = process.env.TARGET_ORG_ID || '20e1d1e0-06b5-43b9-a994-7b5b9accb405';

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

  // Major Classic Car Dealers
  { name: 'Gateway Classic Cars', url: 'https://www.gatewayclassiccars.com/vehicles?make=Chevrolet', type: 'gateway' },
  { name: 'Gateway GMC', url: 'https://www.gatewayclassiccars.com/vehicles?make=GMC', type: 'gateway' },
  { name: 'Streetside Classics', url: 'https://www.streetsideclassics.com/vehicles?make=Chevrolet', type: 'streetside' },
  { name: 'Streetside GMC', url: 'https://www.streetsideclassics.com/vehicles?make=GMC', type: 'streetside' },
  { name: 'Classic Auto Mall', url: 'https://www.classicautomall.com/vehicles?make=Chevrolet', type: 'classicautomall' },
  { name: 'Volo Museum', url: 'https://www.volocars.com/inventory?make=Chevrolet', type: 'volo' },
  { name: 'Restore A Muscle Car', url: 'https://www.restoreamusclecar.com/inventory/', type: 'ramc' },
  { name: 'RK Motors', url: 'https://www.rkmotorscharlotte.com/inventory?make=Chevrolet', type: 'rk' },
  { name: 'Worldwide Vintage Autos', url: 'https://www.worldwidevintageautos.com/inventory/', type: 'wva' },
  { name: 'Classic Car Deals', url: 'https://www.classiccardeals.com/used-inventory/index.htm?make=Chevrolet', type: 'ccd' },
  { name: 'Hemmings', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/c10', type: 'hemmings' },
  { name: 'Hemmings K10', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/k10', type: 'hemmings' },
  { name: 'Hemmings Blazer', url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/blazer', type: 'hemmings' },

  // Auction Houses
  { name: 'Collecting Cars', url: 'https://collectingcars.com/search/?q=chevrolet', type: 'collecting' },
  { name: 'eBay Motors C10', url: 'https://www.ebay.com/sch/i.html?_nkw=chevrolet+c10+squarebody&_sacat=6001', type: 'ebay' },
  { name: 'eBay Motors K5 Blazer', url: 'https://www.ebay.com/sch/i.html?_nkw=chevrolet+k5+blazer&_sacat=6001', type: 'ebay' },

  // Facebook Marketplace (limited without auth)
  // Craigslist aggregators
  { name: 'Autotempest C10', url: 'https://www.autotempest.com/results?make=chevrolet&model=c10&zip=90210&radius=any', type: 'autotempest' },
  { name: 'Autotempest K10', url: 'https://www.autotempest.com/results?make=chevrolet&model=k10&zip=90210&radius=any', type: 'autotempest' },
  { name: 'Autotempest Blazer', url: 'https://www.autotempest.com/results?make=chevrolet&model=blazer&zip=90210&radius=any', type: 'autotempest' },
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

      // Wait for initial load
      await page.waitForTimeout(2000);

      // Scroll to trigger lazy loading
      await page.evaluate(() => window.scrollTo(0, 1000));
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(1500);

      // Wait for listings to load - different selectors per source type
      const waitSelectors: Record<string, string> = {
        bat: 'a[href*="/listing/"]',
        cab: 'a[href*="/auctions/"]',
        gateway: 'a[href*="/vehicles/"]',
        streetside: 'a.inventory-item',
        classicautomall: 'a[href*="/inventory/"]',
        volo: 'a[href*="/inventory/"]',
        ramc: 'a[href*="/inventory/"]',
        rk: 'a[href*="/inventory/"]',
        wva: 'a[href*="/inventory/"]',
        ccd: 'a[href*="/used/"]',
        hemmings: 'a[href*="/listing/"]',
        collecting: 'a[href*="/lot/"]',
        ebay: '.s-item__link, a[href*="/itm/"]',
        autotempest: '.result-item a, a[target="_blank"]',
      };
      const waitSelector = waitSelectors[source.type] || 'a';
      await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => null);

      // Get all listing links based on source type
      const listings = await page.evaluate((sourceType: string) => {
        const links: { url: string; title: string; price: string }[] = [];

        // Determine selectors and pattern based on source type
        let selectors: string[] = [];
        let patternStr = '';

        switch (sourceType) {
          case 'bat':
            selectors = ['a[href*="/listing/"]'];
            patternStr = '\\/listing\\/';
            break;
          case 'cab':
            selectors = ['a[href*="/auctions/"]'];
            patternStr = '\\/auctions\\/';
            break;
          case 'gateway':
            selectors = ['a[href*="/vehicles/"][href*="-"]'];
            patternStr = '\\/vehicles\\/[A-Z]{3,4}-?\\d+';
            break;
          case 'streetside':
            selectors = ['a.inventory-item', 'a[href*="/vehicles/"][href*="-"]'];
            patternStr = '\\/vehicles\\/\\d+';
            break;
          case 'hemmings':
            selectors = ['a[href*="/listing/"]'];
            patternStr = '\\/listing\\/\\d{4}-';
            break;
          case 'ebay':
            selectors = ['.s-item__link', 'a[href*="/itm/"]'];
            patternStr = '\\/itm\\/';
            break;
          case 'collecting':
            selectors = ['a[href*="/lot/"]', '.auction-card a'];
            patternStr = '\\/lot\\/';
            break;
          default:
            selectors = ['a[href*="/vehicle"]', 'a[href*="/inventory"]', 'a[href*="/listing"]'];
            patternStr = '';
        }

        const urlPattern = patternStr ? new RegExp(patternStr, 'i') : null;

        // Find vehicle links
        for (const selector of selectors) {
          document.querySelectorAll(selector).forEach(el => {
            const link = el.tagName === 'A' ? el as HTMLAnchorElement : el.querySelector('a') as HTMLAnchorElement;
            if (!link?.href) return;
            if (urlPattern && !urlPattern.test(link.href)) return;

            const card = link.closest('[class*="vehicle"], [class*="card"], [class*="item"], [class*="listing"], article, li');
            const title = card?.querySelector('h2, h3, h4, [class*="title"], [class*="name"]')?.textContent?.trim()
              || link.textContent?.trim()
              || '';
            const price = card?.querySelector('[class*="price"], [class*="bid"], [class*="cost"]')?.textContent?.trim() || '';

            if (title && !links.some(l => l.url === link.href)) {
              links.push({ url: link.href, title, price });
            }
          });
        }

        return links.slice(0, 50); // Limit to 50
      }, source.type);

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
              listing_source: source.type,
            })
            .select()
            .single();

          if (data) {
            totalSaved++;
            console.log(`  ✅ ${vehicle.year} ${vehicle.make} ${vehicle.model} - $${vehicle.price || 'N/A'}`);

            // Link to organization for discoverability
            if (TARGET_ORG_ID) {
              await supabase.from('organization_vehicles').insert({
                organization_id: TARGET_ORG_ID,
                vehicle_id: data.id,
                relationship_type: 'work_location',
                auto_tagged: true,
                status: 'active',
              }).catch(() => {}); // Ignore if link already exists
            }
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
