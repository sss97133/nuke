#!/usr/bin/env npx tsx
/**
 * ECR (Exclusive Car Registry) Scraper
 * Scrapes all cars, dealers, collections from exclusivecarregistry.com
 * No bot protection - should be easy!
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const BASE_URL = 'https://exclusivecarregistry.com';

interface ECRCar {
  url: string;
  title: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  chassis?: string;
  color?: string;
  owner?: string;
  history?: string;
  images?: string[];
}

interface ECRDealer {
  url: string;
  name: string;
  location?: string;
  website?: string;
  inventory_count?: number;
}

async function scrapeCarList(page: Page): Promise<string[]> {
  const carUrls: string[] = [];
  let pageNum = 1;

  while (true) {
    const url = `${BASE_URL}/list?page=${pageNum}`;
    console.log(`Scraping car list page ${pageNum}...`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Get car URLs from this page
    const urls = await page.$$eval('a[href*="/car/"]', els =>
      els.map(a => a.getAttribute('href')).filter(Boolean)
    ).catch(() => [] as string[]);

    if (urls.length === 0) {
      console.log(`  No more cars found, stopping at page ${pageNum}`);
      break;
    }

    console.log(`  Found ${urls.length} cars on page ${pageNum}`);
    carUrls.push(...urls.map(u => u!.startsWith('http') ? u! : `${BASE_URL}${u}`));

    pageNum++;
    await page.waitForTimeout(1000 + Math.random() * 1000);

    // Safety limit
    if (pageNum > 500) break;
  }

  return [...new Set(carUrls)]; // Dedupe
}

async function scrapeDealerList(page: Page): Promise<string[]> {
  await page.goto(`${BASE_URL}/dealer`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const urls = await page.$$eval('a[href*="/dealer/"]', els =>
    els.map(a => a.getAttribute('href'))
       .filter(h => h && h !== '/dealer') as string[]
  ).catch(() => [] as string[]);

  console.log(`Found ${urls.length} dealers`);
  return urls.map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`);
}

async function scrapeCarDetail(page: Page, url: string): Promise<ECRCar | null> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    const title = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '') ||
                  await page.title();
    const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');

    // Parse year/make/model from title like "1967 Ferrari 275 GTB/4"
    const match = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);

    // Get VIN/Chassis
    const vinMatch = bodyText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const chassisMatch = bodyText.match(/(?:Chassis|S\/N|Serial)[:\s#]*([A-Z0-9-]+)/i);

    // Get images
    const images = await page.$$eval('img[src*="/images/car/"], img[src*="/upload/"]', els =>
      els.map(img => img.getAttribute('src')).filter(Boolean).slice(0, 20) as string[]
    ).catch(() => [] as string[]);

    // Get color
    const colorMatch = bodyText.match(/(?:Color|Exterior)[:\s]*([A-Za-z\s]+?)(?:\n|,|\.|Interior)/i);

    return {
      url,
      title,
      year: match ? parseInt(match[1]) : undefined,
      make: match ? match[2] : undefined,
      model: match ? match[3] : undefined,
      vin: vinMatch ? vinMatch[1] : undefined,
      chassis: chassisMatch ? chassisMatch[1] : undefined,
      color: colorMatch ? colorMatch[1]?.trim() : undefined,
      images,
    };
  } catch (err: any) {
    console.log(`  Error scraping ${url}: ${err.message.slice(0, 50)}`);
    return null;
  }
}

async function scrapeDealerDetail(page: Page, url: string): Promise<ECRDealer | null> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    const name = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
    const title = await page.title();
    const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');

    const locationMatch = bodyText.match(/(?:Location|Based in|Located)[:\s]*([^\n]+)/i);
    const websiteHref = await page.$eval(
      'a[href*="http"]:not([href*="exclusivecarregistry"])',
      el => el.getAttribute('href')
    ).catch(() => null);

    const inventoryCount = await page.$$eval('.car_item', els => els.length).catch(() => 0);

    return {
      url,
      name: name || title.split('-')[0]?.trim() || '',
      location: locationMatch ? locationMatch[1]?.trim() : undefined,
      website: websiteHref || undefined,
      inventory_count: inventoryCount,
    };
  } catch (err: any) {
    console.log(`  Error scraping ${url}: ${err.message.slice(0, 50)}`);
    return null;
  }
}

async function saveToQueue(items: (ECRCar | ECRDealer)[], type: 'car' | 'dealer'): Promise<number> {
  let saved = 0;

  for (const item of items) {
    if (!item) continue;

    const { error } = await supabase.from('import_queue').upsert({
      listing_url: item.url,
      listing_title: 'title' in item ? item.title : ('name' in item ? item.name : ''),
      listing_year: 'year' in item ? item.year : null,
      listing_make: 'make' in item ? item.make : null,
      listing_model: 'model' in item ? item.model : null,
      status: 'pending',
      raw_data: {
        source: 'ecr',
        type,
        ...item
      }
    }, { onConflict: 'listing_url' });

    if (!error) saved++;
  }

  return saved;
}

async function main() {
  console.log('🏎️  ECR (Exclusive Car Registry) Scraper\n');

  const mode = process.env.MODE || 'all'; // 'cars', 'dealers', 'all'

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  try {
    if (mode === 'dealers' || mode === 'all') {
      console.log('=== Scraping Dealers ===\n');
      const dealerUrls = await scrapeDealerList(page);

      const dealers: ECRDealer[] = [];
      for (let i = 0; i < dealerUrls.length; i++) {
        console.log(`Dealer ${i + 1}/${dealerUrls.length}: ${dealerUrls[i]}`);
        const dealer = await scrapeDealerDetail(page, dealerUrls[i]);
        if (dealer) dealers.push(dealer);
        await page.waitForTimeout(500 + Math.random() * 500);
      }

      const savedDealers = await saveToQueue(dealers, 'dealer');
      console.log(`\n✅ Saved ${savedDealers} dealers\n`);
    }

    if (mode === 'cars' || mode === 'all') {
      console.log('=== Scraping Cars ===\n');
      const carUrls = await scrapeCarList(page);
      console.log(`\nTotal unique car URLs: ${carUrls.length}\n`);

      // Scrape car details in batches
      const cars: ECRCar[] = [];
      for (let i = 0; i < carUrls.length; i++) {
        console.log(`Car ${i + 1}/${carUrls.length}: ${carUrls[i]}`);
        const car = await scrapeCarDetail(page, carUrls[i]);
        if (car) cars.push(car);

        // Save every 50 cars
        if (cars.length >= 50) {
          const saved = await saveToQueue(cars, 'car');
          console.log(`  Batch saved: ${saved} cars`);
          cars.length = 0;
        }

        await page.waitForTimeout(500 + Math.random() * 500);
      }

      // Save remaining
      if (cars.length > 0) {
        const saved = await saveToQueue(cars, 'car');
        console.log(`  Final batch saved: ${saved} cars`);
      }
    }

    console.log('\n✅ ECR scraping complete!');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
