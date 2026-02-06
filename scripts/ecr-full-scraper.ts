#!/usr/bin/env npx tsx
/**
 * ECR Full Scraper - Collections, Users, Cars
 * Priority: Collections (orgs) → Vehicles → Users (snowball)
 * Covert behavior - minimal requests, batch saves
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const BASE_URL = 'https://exclusivecarregistry.com';

interface ECRCollection {
  url: string;
  name: string;
  slug: string;
  owner?: string;
  instagram?: string;
  car_count?: number;
  description?: string;
}

interface ECRUser {
  url: string;
  username: string;
  display_name?: string;
  instagram?: string;
  car_count?: number;
}

interface ECRCar {
  url: string;
  title: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  chassis?: string;
  owner_collection?: string;
}

// ===== COLLECTIONS =====
async function scrapeCollectionList(page: Page): Promise<string[]> {
  console.log('\n=== Scraping Collection List ===\n');
  const urls: string[] = [];
  let pageNum = 1;

  while (pageNum <= 50) { // Safety limit
    const url = pageNum === 1 ? `${BASE_URL}/collection` : `${BASE_URL}/collection?page=${pageNum}`;
    console.log(`Collection list page ${pageNum}...`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const pageUrls = await page.$$eval('a[href*="/collection/"]', els =>
      els.map(a => a.getAttribute('href'))
         .filter(h => h && h !== '/collection' && !h.includes('?')) as string[]
    ).catch(() => []);

    const uniqueUrls = [...new Set(pageUrls)];
    if (uniqueUrls.length === 0) break;

    console.log(`  Found ${uniqueUrls.length} collections`);
    urls.push(...uniqueUrls);
    pageNum++;
    await page.waitForTimeout(1000);
  }

  const allUrls = [...new Set(urls)].map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`);
  console.log(`\nTotal unique collections: ${allUrls.length}\n`);
  return allUrls;
}

async function scrapeCollectionDetail(page: Page, url: string): Promise<{ collection: ECRCollection; cars: string[] } | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const slug = url.split('/collection/')[1]?.split('?')[0] || '';
    const name = await page.$eval('h1', el => el.textContent?.trim()).catch(() => slug);
    const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');

    // Find Instagram handle
    const igMatch = bodyText.match(/@([a-zA-Z0-9_.]+)/);
    const igLink = await page.$eval('a[href*="instagram.com"]', el => el.getAttribute('href')).catch(() => null);
    const instagram = igMatch ? igMatch[1] : (igLink ? igLink.split('instagram.com/')[1]?.split('/')[0] : undefined);

    // Find car count
    const carCountMatch = bodyText.match(/(\d+)\s*(?:cars?|vehicles?)/i);
    const carCount = carCountMatch ? parseInt(carCountMatch[1]) : undefined;

    // Get car URLs from this collection
    const carUrls = await page.$$eval('a[href*="/car/"]', els =>
      els.map(a => a.getAttribute('href')).filter(Boolean) as string[]
    ).catch(() => []);

    return {
      collection: {
        url,
        name: name || slug,
        slug,
        instagram,
        car_count: carCount || carUrls.length,
      },
      cars: [...new Set(carUrls)].map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`)
    };
  } catch (err: any) {
    console.log(`  Error: ${err.message.slice(0, 40)}`);
    return null;
  }
}

// ===== PROFILES/USERS =====
async function scrapeProfileList(page: Page): Promise<string[]> {
  console.log('\n=== Scraping Profile List ===\n');
  const urls: string[] = [];
  let pageNum = 1;

  while (pageNum <= 100) {
    const url = pageNum === 1 ? `${BASE_URL}/profile-list` : `${BASE_URL}/profile-list?page=${pageNum}`;
    console.log(`Profile list page ${pageNum}...`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const pageUrls = await page.$$eval('a[href*="/profile/"]', els =>
      els.map(a => a.getAttribute('href'))
         .filter(h => h && !h.includes('profile-list')) as string[]
    ).catch(() => []);

    const uniqueUrls = [...new Set(pageUrls)];
    if (uniqueUrls.length === 0) break;

    console.log(`  Found ${uniqueUrls.length} profiles`);
    urls.push(...uniqueUrls);
    pageNum++;
    await page.waitForTimeout(1000);
  }

  const allUrls = [...new Set(urls)].map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`);
  console.log(`\nTotal unique profiles: ${allUrls.length}\n`);
  return allUrls;
}

async function scrapeProfileDetail(page: Page, url: string): Promise<{ user: ECRUser; cars: string[] } | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const username = url.split('/profile/')[1]?.split('?')[0] || '';
    const displayName = await page.$eval('h1', el => el.textContent?.trim()).catch(() => username);
    const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');

    // Find Instagram
    const igMatch = bodyText.match(/@([a-zA-Z0-9_.]+)/);
    const igLink = await page.$eval('a[href*="instagram.com"]', el => el.getAttribute('href')).catch(() => null);
    const instagram = igMatch ? igMatch[1] : (igLink ? igLink.split('instagram.com/')[1]?.split('/')[0] : undefined);

    // Get car URLs
    const carUrls = await page.$$eval('a[href*="/car/"]', els =>
      els.map(a => a.getAttribute('href')).filter(Boolean) as string[]
    ).catch(() => []);

    return {
      user: {
        url,
        username,
        display_name: displayName,
        instagram,
        car_count: carUrls.length,
      },
      cars: [...new Set(carUrls)].map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`)
    };
  } catch (err: any) {
    console.log(`  Error: ${err.message.slice(0, 40)}`);
    return null;
  }
}

// ===== CARS =====
async function scrapeCarDetail(page: Page, url: string, ownerCollection?: string): Promise<ECRCar | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    const title = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
    const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');

    const match = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);
    const vinMatch = bodyText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const chassisMatch = bodyText.match(/(?:Chassis|S\/N|Serial)[:\s#]*([A-Z0-9-]+)/i);

    return {
      url,
      title,
      year: match ? parseInt(match[1]) : undefined,
      make: match ? match[2] : undefined,
      model: match ? match[3] : undefined,
      vin: vinMatch ? vinMatch[1] : undefined,
      chassis: chassisMatch ? chassisMatch[1] : undefined,
      owner_collection: ownerCollection,
    };
  } catch (err: any) {
    return null;
  }
}

// ===== SAVE FUNCTIONS =====
async function saveCollection(collection: ECRCollection): Promise<void> {
  await supabase.from('import_queue').upsert({
    listing_url: collection.url,
    listing_title: collection.name,
    status: 'complete', // Collections are metadata, not listings
    raw_data: {
      source: 'ecr',
      type: 'collection',
      ...collection
    }
  }, { onConflict: 'listing_url' });
}

async function saveUser(user: ECRUser): Promise<void> {
  await supabase.from('import_queue').upsert({
    listing_url: user.url,
    listing_title: user.display_name || user.username,
    status: 'complete',
    raw_data: {
      source: 'ecr',
      type: 'user',
      ...user
    }
  }, { onConflict: 'listing_url' });
}

async function saveCar(car: ECRCar): Promise<void> {
  await supabase.from('import_queue').upsert({
    listing_url: car.url,
    listing_title: car.title,
    listing_year: car.year,
    listing_make: car.make,
    listing_model: car.model,
    status: 'pending',
    raw_data: {
      source: 'ecr',
      type: 'car',
      ...car
    }
  }, { onConflict: 'listing_url' });
}

// ===== MAIN =====
async function main() {
  console.log('🏎️  ECR Full Scraper - Collections → Vehicles → Users\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  const allCarUrls = new Set<string>();
  let collectionsScraped = 0;
  let usersScraped = 0;

  try {
    // 1. COLLECTIONS (priority - have Instagram handles)
    const collectionUrls = await scrapeCollectionList(page);
    console.log(`Scraping ${collectionUrls.length} collections...\n`);

    for (let i = 0; i < collectionUrls.length; i++) {
      const url = collectionUrls[i];
      const slug = url.split('/collection/')[1] || '';
      console.log(`[${i + 1}/${collectionUrls.length}] ${slug}`);

      const result = await scrapeCollectionDetail(page, url);
      if (result) {
        await saveCollection(result.collection);
        result.cars.forEach(c => allCarUrls.add(c));
        collectionsScraped++;

        if (result.collection.instagram) {
          console.log(`  📸 Instagram: @${result.collection.instagram}`);
        }
        console.log(`  🚗 Cars: ${result.cars.length}`);
      }

      await page.waitForTimeout(800 + Math.random() * 400);
    }

    console.log(`\n✅ Collections: ${collectionsScraped} scraped, ${allCarUrls.size} car URLs found\n`);

    // 2. PROFILES/USERS (snowball - find more cars)
    const profileUrls = await scrapeProfileList(page);
    console.log(`Scraping ${profileUrls.length} profiles...\n`);

    for (let i = 0; i < profileUrls.length; i++) {
      const url = profileUrls[i];
      const username = url.split('/profile/')[1] || '';
      console.log(`[${i + 1}/${profileUrls.length}] ${username}`);

      const result = await scrapeProfileDetail(page, url);
      if (result) {
        await saveUser(result.user);
        result.cars.forEach(c => allCarUrls.add(c));
        usersScraped++;

        if (result.user.instagram) {
          console.log(`  📸 Instagram: @${result.user.instagram}`);
        }
        console.log(`  🚗 Cars: ${result.cars.length}`);
      }

      await page.waitForTimeout(800 + Math.random() * 400);
    }

    console.log(`\n✅ Users: ${usersScraped} scraped, ${allCarUrls.size} total car URLs\n`);

    // 3. CARS (batch save URLs for later detailed scraping)
    console.log(`\n=== Saving ${allCarUrls.size} Car URLs ===\n`);
    const carUrlArray = [...allCarUrls];

    for (let i = 0; i < carUrlArray.length; i += 50) {
      const batch = carUrlArray.slice(i, i + 50);
      for (const url of batch) {
        await supabase.from('import_queue').upsert({
          listing_url: url,
          status: 'pending',
          raw_data: { source: 'ecr', type: 'car' }
        }, { onConflict: 'listing_url' });
      }
      console.log(`  Saved ${Math.min(i + 50, carUrlArray.length)}/${carUrlArray.length} car URLs`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ ECR SCRAPE COMPLETE');
    console.log('='.repeat(50));
    console.log(`Collections: ${collectionsScraped}`);
    console.log(`Users: ${usersScraped}`);
    console.log(`Car URLs queued: ${allCarUrls.size}`);
    console.log('='.repeat(50) + '\n');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
