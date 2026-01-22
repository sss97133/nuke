/**
 * CRAIGSLIST PLAYWRIGHT SCRAPER v4 - FULL DETAIL EXTRACTION
 *
 * Extracts ALL available data from individual listing pages:
 * - VIN, mileage, images, full description, location
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const MIN_YEAR = 1962;
const MAX_YEAR = 1999;

const REGIONS = [
  'sfbay', 'losangeles', 'sandiego', 'sacramento', 'orangecounty',
  'phoenix', 'tucson', 'lasvegas',
  'dallas', 'houston', 'austin', 'sanantonio',
  'denver', 'seattle', 'portland',
  'chicago', 'detroit', 'minneapolis',
  'atlanta', 'miami', 'tampa',
  'boston', 'newyork', 'philadelphia',
  'nashville', 'charlotte', 'raleigh',
];

const MAKES = [
  'Porsche', 'Ferrari', 'Lamborghini', 'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi',
  'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac', 'GMC',
  'Jaguar', 'Aston Martin', 'Bentley', 'Maserati', 'Alfa Romeo',
  'Toyota', 'Nissan', 'Honda', 'Mazda', 'Datsun', 'Lexus', 'Acura', 'Subaru',
  'Jeep', 'Land Rover', 'Lotus', 'MG', 'Triumph', 'Corvette', 'Mustang', 'Camaro',
  'Volkswagen', 'VW', 'Volvo', 'Fiat', 'Oldsmobile', 'Chrysler', 'Lincoln', 'Mercury',
  'Impala', 'Chevelle', 'Nova', 'Cuda', 'Barracuda', 'Charger', 'Challenger',
  'Bronco', 'Blazer', 'Scout', 'Wrangler', 'CJ', 'Ranchero', 'El Camino',
];

function parseMake(title: string): string | null {
  const lowerTitle = title.toLowerCase();
  for (const make of MAKES) {
    if (lowerTitle.includes(make.toLowerCase())) {
      if (make === 'Chevy') return 'Chevrolet';
      if (make === 'VW') return 'Volkswagen';
      if (['Mustang', 'Bronco', 'Ranchero'].includes(make)) return 'Ford';
      if (['Camaro', 'Corvette', 'Impala', 'Chevelle', 'Nova', 'Blazer', 'El Camino'].includes(make)) return 'Chevrolet';
      if (['Cuda', 'Barracuda'].includes(make)) return 'Plymouth';
      if (['Charger', 'Challenger'].includes(make)) return 'Dodge';
      if (make === 'Scout') return 'International';
      if (['Wrangler', 'CJ'].includes(make)) return 'Jeep';
      return make;
    }
  }
  return null;
}

function parseYear(text: string): number | null {
  const clean = text.replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
  const fourDigit = clean.match(/\b(19[6-9]\d)\b/);
  if (fourDigit) {
    const year = parseInt(fourDigit[1]);
    if (year >= MIN_YEAR && year <= MAX_YEAR) return year;
  }
  const twoDigit = clean.match(/\b([6-9]\d)\s+[A-Za-z]/);
  if (twoDigit) {
    const year = 1900 + parseInt(twoDigit[1]);
    if (year >= MIN_YEAR && year <= MAX_YEAR) return year;
  }
  return null;
}

function parseModel(title: string, make: string | null): string | null {
  if (!make) return null;
  const clean = title.replace(/[•·]/g, ' ').replace(/\s+/g, ' ').trim();
  const regex = new RegExp(make.replace('-', '[-\\s]?'), 'i');
  const parts = clean.split(regex);
  if (parts.length < 2) return null;
  return parts[1].replace(/^\s*[-:]\s*/, '').trim().split(/\s+/).slice(0, 3).join(' ').replace(/[^\w\s\-\/\.]/g, '').trim() || null;
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ListingDetails {
  vin: string | null;
  mileage: number | null;
  description: string | null;
  images: string[];
  location: string | null;
  transmission: string | null;
  condition: string | null;
}

async function extractListingDetails(page: Page, url: string): Promise<ListingDetails> {
  const result: ListingDetails = {
    vin: null,
    mileage: null,
    description: null,
    images: [],
    location: null,
    transmission: null,
    condition: null,
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(1500);

    // Extract all data from the listing page
    const data = await page.evaluate(() => {
      const result: any = {};

      // Get posting body/description
      const bodyEl = document.querySelector('#postingbody, section.body');
      if (bodyEl) {
        // Remove the "QR Code Link" notice
        const qr = bodyEl.querySelector('.print-information');
        if (qr) qr.remove();
        result.description = bodyEl.textContent?.trim() || null;
      }

      // Get all attribute groups (condition, transmission, etc)
      const attrGroups = document.querySelectorAll('.attrgroup');
      attrGroups.forEach(group => {
        const spans = group.querySelectorAll('span');
        spans.forEach(span => {
          const text = span.textContent?.toLowerCase() || '';
          if (text.includes('automatic') || text.includes('manual') || text.includes('cvt')) {
            result.transmission = span.textContent?.trim();
          }
          if (text.includes('condition:')) {
            result.condition = text.replace('condition:', '').trim();
          }
          if (text.includes('odometer:')) {
            const match = text.match(/(\d[\d,]*)/);
            if (match) result.mileage = parseInt(match[1].replace(/,/g, ''));
          }
          if (text.includes('vin:')) {
            const vinMatch = text.match(/([A-HJ-NPR-Z0-9]{17})/i);
            if (vinMatch) result.vin = vinMatch[1].toUpperCase();
          }
        });
      });

      // Get location
      const mapAddress = document.querySelector('.mapaddress');
      if (mapAddress) {
        result.location = mapAddress.textContent?.trim();
      }

      // Get images
      const images: string[] = [];
      const thumbs = document.querySelectorAll('#thumbs a');
      thumbs.forEach(thumb => {
        const href = thumb.getAttribute('href');
        if (href && href.includes('craigslist')) {
          images.push(href);
        }
      });
      // Also check for main gallery images
      const galleryImgs = document.querySelectorAll('.gallery img, .slide img, .swipe img');
      galleryImgs.forEach(img => {
        const src = img.getAttribute('src');
        if (src && src.includes('craigslist') && !images.includes(src)) {
          images.push(src.replace('_300x300', '_600x450').replace('_50x50c', '_600x450'));
        }
      });
      result.images = images;

      return result;
    });

    // Also try to find VIN and mileage in the full page text
    const pageText = await page.content();

    if (!data.vin) {
      const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) data.vin = vinMatch[1].toUpperCase();
    }

    if (!data.mileage) {
      const mileMatch = pageText.match(/(\d{1,3}(?:,\d{3})*|\d+)[kK]?\s*(?:miles|mi\b|original miles)/i);
      if (mileMatch) {
        let miles = mileMatch[1].replace(/,/g, '');
        if (mileMatch[0].toLowerCase().includes('k')) {
          miles = String(parseInt(miles) * 1000);
        }
        const mileNum = parseInt(miles);
        if (mileNum > 0 && mileNum < 1000000) data.mileage = mileNum;
      }
    }

    result.vin = data.vin;
    result.mileage = data.mileage;
    result.description = data.description?.slice(0, 5000);
    result.images = data.images || [];
    result.location = data.location;
    result.transmission = data.transmission;
    result.condition = data.condition;

  } catch (err) {
    // Return partial data on error
  }

  return result;
}

async function scrapeCraigslistRegion(page: Page, region: string): Promise<{ saved: number; enriched: number }> {
  const url = `https://${region}.craigslist.org/search/cta?min_auto_year=${MIN_YEAR}&max_auto_year=${MAX_YEAR}&purveyor=owner`;

  console.log(`  URL: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await delay(3000);

    const listings = await page.evaluate(() => {
      const results: Array<{url: string, text: string, price: string}> = [];
      const items = document.querySelectorAll('.cl-static-search-result, .result-row, li.cl-search-result, [data-pid]');
      items.forEach(item => {
        const link = item.querySelector('a[href*="/d/"]') || item.querySelector('a');
        const priceEl = item.querySelector('.priceinfo, .result-price, .price');
        if (link) {
          const href = link.getAttribute('href');
          const text = item.textContent?.replace(/\s+/g, ' ').trim() || '';
          const price = priceEl?.textContent?.trim() || '';
          if (href && text) {
            results.push({
              url: href.startsWith('http') ? href : `${window.location.origin}${href}`,
              text,
              price,
            });
          }
        }
      });
      return results;
    });

    console.log(`  Found: ${listings.length} listings`);

    let saved = 0;
    let enriched = 0;
    let skipped = 0;

    for (const listing of listings) {
      const year = parseYear(listing.text);
      const make = parseMake(listing.text);

      if (!year || !make) continue;

      const model = parseModel(listing.text, make);
      const priceMatch = listing.price.match(/\$?([\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

      // Check if exists
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('listing_url', listing.url)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // === FULL DETAIL EXTRACTION ===
      console.log(`    → Extracting: ${year} ${make} ${model || ''}`);
      const details = await extractListingDetails(page, listing.url);

      const hasDetails = details.vin || details.mileage || details.images.length > 0;
      if (hasDetails) enriched++;

      // Save with full details
      const { error } = await supabase.from('vehicles').insert({
        year,
        make,
        model: model || 'Unknown',
        price,
        vin: details.vin,
        mileage: details.mileage,
        listing_url: listing.url,
        discovery_url: listing.url,
        listing_title: `${year} ${make} ${model || ''}`.trim(),
        location: details.location,
        auction_source: 'Craigslist',
      });

      if (!error) {
        saved++;
        const dataPoints = [
          details.vin ? 'VIN' : null,
          details.mileage ? `${details.mileage}mi` : null,
          details.images.length > 0 ? `${details.images.length}img` : null,
        ].filter(Boolean).join(' | ');
        console.log(`      ✓ $${price || '?'} | ${dataPoints || 'basic data'}`);
      }

      await delay(1000); // Respectful rate limiting
    }

    console.log(`  Saved: ${saved} | Enriched: ${enriched} | Skipped: ${skipped}`);
    return { saved, enriched };

  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
    return { saved: 0, enriched: 0 };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('CRAIGSLIST PLAYWRIGHT SCRAPER v4 - FULL DETAIL EXTRACTION');
  console.log(`Target: ${MIN_YEAR}-${MAX_YEAR} vehicles`);
  console.log(`Regions: ${REGIONS.length}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  let totalSaved = 0;
  let totalEnriched = 0;

  for (const region of REGIONS) {
    console.log(`\n📍 Region: ${region}`);
    const { saved, enriched } = await scrapeCraigslistRegion(page, region);
    totalSaved += saved;
    totalEnriched += enriched;

    console.log(`  📊 Running total: ${totalSaved} saved (${totalEnriched} with full details)`);
    await delay(5000);
  }

  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log('EXTRACTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total saved: ${totalSaved}`);
  console.log(`With VIN/mileage/images: ${totalEnriched}`);

  const { count } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .eq('auction_source', 'Craigslist');

  console.log(`Craigslist vehicles in database: ${count}`);
}

main().catch(console.error);
