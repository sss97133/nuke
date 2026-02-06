#!/usr/bin/env npx tsx
/**
 * KSL Cars Scraper
 * Scrapes all For Sale By Owner listings and queues them for extraction
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const BASE_URL = 'https://cars.ksl.com';

// Year ranges in priority order (collector cars first)
const YEAR_RANGES = [
  { name: '1960-1999', min: 1960, max: 1999 },
  { name: '2000-2013', min: 2000, max: 2013 },
  { name: '2014+', min: 2014, max: 2026 },
  { name: 'Pre-1960', min: 1900, max: 1959 },
];

// Get range from env or default to first
const RANGE_INDEX = parseInt(process.env.YEAR_RANGE || '0');
const CURRENT_RANGE = YEAR_RANGES[RANGE_INDEX] || YEAR_RANGES[0];

const SEARCH_URL = `${BASE_URL}/search/sellerType/For+Sale+By+Owner/yearFrom/${CURRENT_RANGE.min}/yearTo/${CURRENT_RANGE.max}`;

interface KSLListing {
  id: string;
  url: string;
  title: string;
  year?: number;
  make?: string;
  model?: string;
  price?: number;
  mileage?: number;
  location?: string;
}

async function waitForBotProtection(page: Page): Promise<void> {
  // Wait for PerimeterX challenge to complete
  const maxWait = 30000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const html = await page.content();
    // Check for PerimeterX or Cloudflare challenges
    if (html.includes('px-captcha') || html.includes('challenge-running') ||
        html.includes('Please verify') || html.includes('Checking your browser')) {
      console.log('  Waiting for bot protection challenge...');
      await page.waitForTimeout(2000);
      continue;
    }
    // Check if we have actual listings content
    if (html.includes('listing-card') || html.includes('/listing/') || html.includes('results')) {
      return;
    }
    await page.waitForTimeout(1000);
  }
}

async function scrapeListingsPage(page: Page, pageNum: number): Promise<KSLListing[]> {
  const url = pageNum === 1 ? SEARCH_URL : `${SEARCH_URL}/page/${pageNum}`;
  console.log(`Scraping page ${pageNum}: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForBotProtection(page);
  await page.waitForTimeout(2000);

  // Wait for listing content to load
  await page.waitForSelector('a[href*="/listing/"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // Extract listings from the page
  const listings = await page.evaluate(() => {
    const items: any[] = [];
    const seenIds = new Set<string>();

    // KSL uses various card structures
    const allLinks = document.querySelectorAll('a[href*="/listing/"]');

    allLinks.forEach(link => {
      try {
        const href = link.getAttribute('href');
        if (!href || !href.includes('/listing/')) return;

        const id = href.match(/\/listing\/(\d+)/)?.[1] || '';
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);

        const fullUrl = href.startsWith('http') ? href : `https://cars.ksl.com${href}`;

        // Find the parent card container
        const card = link.closest('[class*="listing"], [class*="Card"], [class*="card"]') || link.parentElement?.parentElement || link;

        // Get all text from card
        const cardText = card?.textContent || '';

        // Try multiple title selectors
        let title = '';
        const titleSelectors = ['h2', 'h3', 'h4', '[class*="title"]', '[class*="Title"]', '[class*="name"]'];
        for (const sel of titleSelectors) {
          const el = card?.querySelector?.(sel);
          if (el?.textContent?.trim()) {
            title = el.textContent.trim();
            break;
          }
        }

        // If no title found, try to extract from link text
        if (!title) {
          title = link.textContent?.trim() || '';
        }

        // Clean title - remove extraneous text
        // Format: "2019 Toyota Camry" or "Price Reduced2019 Toyota Camry"
        const cleanTitle = title.replace(/^(Price Reduced|Featured|New Listing)/i, '').trim();

        // Parse year/make/model from cleaned title
        const match = cleanTitle.match(/^(\d{4})\s+([A-Za-z-]+)\s+([A-Za-z0-9\s/-]+?)(?=\d{2,}|Miles|\||\$|$)/i);

        // Get model - stop at mileage/price/location
        let model = match ? match[3]?.trim() : undefined;
        if (model) {
          model = model.replace(/[\d,]+\s*Miles?.*$/i, '').trim().slice(0, 50);
        }

        // Get price - look for $ followed by numbers, take first one
        const priceMatches = cardText.match(/\$([\d,]+)/g);
        let price: number | undefined;
        if (priceMatches) {
          // Take the largest price (avoid monthly payment)
          const prices = priceMatches.map(p => parseInt(p.replace(/[\$,]/g, '')));
          price = Math.max(...prices.filter(p => p > 100));
        }

        // Get mileage - look for numbers followed by "mi" or "miles"
        const mileageMatch = cardText.match(/([\d,]+)\s*(?:mi|miles)/i);
        const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : undefined;

        // Get location - look for city/state patterns
        const locationMatch = cardText.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),?\s*(?:UT|Utah|WY|Wyoming|ID|Idaho|NV|Nevada|AZ|Arizona|CO|Colorado)/i);
        const location = locationMatch ? locationMatch[0] : '';

        items.push({
          id,
          url: fullUrl,
          title: match ? `${match[1]} ${match[2]} ${model || match[3]}`.slice(0, 100) : cleanTitle.slice(0, 100),
          year: match ? parseInt(match[1]) : undefined,
          make: match ? match[2] : undefined,
          model,
          price,
          mileage,
          location,
        });
      } catch {}
    });

    return items;
  });

  return listings.filter(l => l.id && l.url);
}

async function getTotalPages(page: Page): Promise<{ total: number; perPage: number }> {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForBotProtection(page);
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const totalMatch = text.match(/([\d,]+)\s*results/i);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;

    // Count listings on page
    const cards = document.querySelectorAll('[data-testid="listing-card"], .listing-card, a[href*="/listing/"]');
    const perPage = cards.length || 24;

    return { total, perPage };
  });

  console.log(`Found ${info.total} total listings, ${info.perPage} per page`);
  return info;
}

async function queueListings(listings: KSLListing[]): Promise<number> {
  if (!listings.length) return 0;

  let processed = 0;

  for (const l of listings) {
    // Clean up the title - just get year make model
    const cleanTitle = l.title?.match(/^\d{4}\s+[A-Za-z-]+\s+[\w\s/-]+/)?.[0]?.trim() || l.title?.slice(0, 50);

    const data = {
      listing_title: cleanTitle,
      listing_year: l.year,
      listing_make: l.make,
      listing_model: l.model?.slice(0, 50),
      listing_price: l.price,
      raw_data: {
        source: 'ksl',
        ksl_id: l.id,
        mileage: l.mileage,
        location: l.location,
      }
    };

    // Check if exists
    const { data: existing } = await supabase
      .from('import_queue')
      .select('id')
      .eq('listing_url', l.url)
      .single();

    if (existing) {
      // Update existing record
      const { error } = await supabase
        .from('import_queue')
        .update(data)
        .eq('listing_url', l.url);

      if (!error) processed++;
    } else {
      // Insert new record
      const { error } = await supabase
        .from('import_queue')
        .insert({
          listing_url: l.url,
          status: 'pending',
          ...data
        });

      if (!error) processed++;
    }
  }

  return processed;
}

async function main() {
  console.log('🚗 KSL Cars Scraper\n');
  console.log(`📅 Year Range: ${CURRENT_RANGE.name} (${CURRENT_RANGE.min}-${CURRENT_RANGE.max})\n`);

  const browser = await chromium.launch({
    headless: false, // Visible browser to avoid detection
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Denver', // Utah timezone
    geolocation: { latitude: 40.7608, longitude: -111.8910 }, // Salt Lake City
    permissions: ['geolocation'],
  });

  // Anti-detection: Override navigator properties
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    (window as any).chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // Get total pages
    const { total, perPage } = await getTotalPages(page);
    const totalPages = Math.ceil(total / perPage);

    console.log(`Will scrape ${totalPages} pages\n`);

    let totalQueued = 0;
    let totalFound = 0;

    // Resume from page specified in env or start at 1
    const startPage = parseInt(process.env.START_PAGE || '1');
    console.log(`Starting from page ${startPage}\n`);

    for (let pageNum = startPage; pageNum <= totalPages; pageNum++) {
      try {
        const listings = await scrapeListingsPage(page, pageNum);
        totalFound += listings.length;

        const queued = await queueListings(listings);
        totalQueued += queued;

        console.log(`  Page ${pageNum}: Found ${listings.length}, queued ${queued} new`);

        // Longer delays to avoid detection (5-10 seconds)
        const delay = 5000 + Math.random() * 5000;
        await page.waitForTimeout(delay);

        // Progress update every 10 pages
        if (pageNum % 10 === 0) {
          console.log(`\n📊 Progress: ${pageNum}/${totalPages} pages, ${totalFound} found, ${totalQueued} queued\n`);
          // Extra long break every 10 pages (15-25 seconds)
          await page.waitForTimeout(15000 + Math.random() * 10000);
        }

        // Every 50 pages, take a longer break (1-2 minutes)
        if (pageNum % 50 === 0) {
          console.log(`\n☕ Taking a break to avoid detection...\n`);
          await page.waitForTimeout(60000 + Math.random() * 60000);
        }
      } catch (err: any) {
        console.error(`  Page ${pageNum} error: ${err.message}`);
        // Longer error recovery delay
        await page.waitForTimeout(30000);
      }
    }

    console.log(`\n✅ Complete: ${totalFound} listings found, ${totalQueued} queued`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
