#!/usr/bin/env npx tsx
/**
 * KSL Cars Monitor
 * Watches for new For Sale By Owner listings and queues them
 * Run via cron or continuously
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const BASE_URL = 'https://cars.ksl.com';
const SEARCH_URL = `${BASE_URL}/search/sellerType/For+Sale+By+Owner`;
const CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

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

async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
    });
  } catch {}
}

async function waitForBotProtection(page: Page): Promise<void> {
  const maxWait = 30000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const html = await page.content();
    if (html.includes('px-captcha') || html.includes('challenge-running') ||
        html.includes('Please verify') || html.includes('Checking your browser')) {
      await page.waitForTimeout(2000);
      continue;
    }
    if (html.includes('listing-card') || html.includes('/listing/') || html.includes('results')) {
      return;
    }
    await page.waitForTimeout(1000);
  }
}

async function scrapeFirstPage(page: Page): Promise<KSLListing[]> {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForBotProtection(page);
  await page.waitForTimeout(3000);

  const listings = await page.evaluate(() => {
    const items: any[] = [];
    const cards = document.querySelectorAll('[data-testid="listing-card"], .listing-card, a[href*="/listing/"]');

    cards.forEach(card => {
      try {
        const link = card.querySelector('a[href*="/listing/"]') || card.closest('a[href*="/listing/"]') || card;
        const href = link?.getAttribute('href');
        if (!href || !href.includes('/listing/')) return;

        const fullUrl = href.startsWith('http') ? href : `https://cars.ksl.com${href}`;
        const id = href.match(/\/listing\/(\d+)/)?.[1] || '';

        const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="Title"]');
        const title = titleEl?.textContent?.trim() || '';
        const match = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);

        const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
        const priceText = priceEl?.textContent?.replace(/[^0-9]/g, '') || '';

        const mileageEl = card.querySelector('[class*="mileage"], [class*="Mileage"], [class*="miles"]');
        const mileageText = mileageEl?.textContent?.replace(/[^0-9]/g, '') || '';

        const locationEl = card.querySelector('[class*="location"], [class*="Location"]');
        const location = locationEl?.textContent?.trim() || '';

        items.push({
          id,
          url: fullUrl,
          title,
          year: match ? parseInt(match[1]) : undefined,
          make: match ? match[2] : undefined,
          model: match ? match[3] : undefined,
          price: priceText ? parseInt(priceText) : undefined,
          mileage: mileageText ? parseInt(mileageText) : undefined,
          location,
        });
      } catch {}
    });

    return items;
  });

  return listings.filter(l => l.id && l.url);
}

async function queueNewListings(listings: KSLListing[]): Promise<number> {
  if (!listings.length) return 0;

  const urls = listings.map(l => l.url);
  const { data: existing } = await supabase
    .from('import_queue')
    .select('listing_url')
    .in('listing_url', urls);

  const existingUrls = new Set(existing?.map(e => e.listing_url) || []);
  const newListings = listings.filter(l => !existingUrls.has(l.url));

  if (!newListings.length) return 0;

  const { error } = await supabase.from('import_queue').insert(
    newListings.map(l => ({
      listing_url: l.url,
      listing_title: l.title,
      listing_year: l.year,
      listing_make: l.make,
      listing_model: l.model,
      listing_price: l.price,
      status: 'pending',
      raw_data: {
        source: 'ksl',
        ksl_id: l.id,
        mileage: l.mileage,
        location: l.location,
      }
    }))
  );

  if (error) {
    console.error('Insert error:', error.message);
    return 0;
  }

  return newListings.length;
}

async function runCheck(page: Page) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  try {
    const listings = await scrapeFirstPage(page);
    const newCount = await queueNewListings(listings);

    console.log(`[${now}] Checked first page: ${listings.length} listings, ${newCount} new`);

    if (newCount > 0) {
      await sendTelegram(`🚗 <b>KSL Monitor</b>\n\nFound ${newCount} new listings!\nTotal on first page: ${listings.length}`);
    }
  } catch (err: any) {
    console.error(`[${now}] Error: ${err.message}`);
    await sendTelegram(`⚠️ <b>KSL Monitor Error</b>\n\n${err.message}`);
  }
}

async function main() {
  console.log('🚗 KSL Cars Monitor started\n');
  console.log(`Checking every ${CHECK_INTERVAL / 60000} minutes\n`);

  const browser = await chromium.launch({
    headless: false,
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
    timezoneId: 'America/Denver',
    geolocation: { latitude: 40.7608, longitude: -111.8910 },
    permissions: ['geolocation'],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    (window as any).chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Initial check
  await runCheck(page);

  // Run every CHECK_INTERVAL
  setInterval(() => runCheck(page), CHECK_INTERVAL);

  // Keep alive
  await sendTelegram('🚗 <b>KSL Monitor Started</b>\n\nWatching for new listings every 15 minutes.');
}

main().catch(console.error);
