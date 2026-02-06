#!/usr/bin/env npx tsx
/**
 * Vanguard Motor Sales Scraper - Fetch-based (no browser needed)
 * Site works fine with proper User-Agent, no need for Playwright
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT = process.env.TELEGRAM_CHAT_ID!;

const BASE_URL = 'https://www.vanguardmotorsales.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

async function send(msg: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractVehicleUrls(html: string): string[] {
  // Match /inventory/{id}/{slug} patterns
  const matches = html.matchAll(/href="(\/inventory\/\d+\/[^"]+)"/g);
  const urls = [...new Set([...matches].map(m => `${BASE_URL}${m[1]}`))];
  return urls;
}

function parseVehicleDetails(html: string, url: string): any {
  // Extract title from <title> tag: "1968 Plymouth Road Runner | Classic Cars..."
  const titleTagMatch = html.match(/<title>([^|]+)\|/i);
  const title = titleTagMatch ? titleTagMatch[1].trim().replace(/&amp;/g, '&') : '';

  // Parse year/make/model from title like "1967 Ford Mustang"
  const ymMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);

  // Get price - look for price patterns
  const priceMatch = html.match(/\$[\s]*([0-9,]+)/);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : undefined;

  // Get VIN
  const vinMatch = html.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);

  // Get mileage
  const mileageMatch = html.match(/([0-9,]+)\s*(?:mi|miles)/i);

  // Get stock number
  const stockMatch = html.match(/Stock[:\s#]*([A-Z0-9-]+)/i);

  // Get images
  const imgMatches = html.matchAll(/src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
  const images = [...new Set([...imgMatches].map(m => m[1]))].filter(u =>
    u.includes('vehicle') || u.includes('inventory') || u.includes('uploads')
  );

  return {
    url,
    title,
    year: ymMatch ? parseInt(ymMatch[1]) : undefined,
    make: ymMatch ? ymMatch[2] : undefined,
    model: ymMatch ? ymMatch[3] : undefined,
    price,
    vin: vinMatch ? vinMatch[1] : undefined,
    mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : undefined,
    stock: stockMatch ? stockMatch[1] : undefined,
    images: images.slice(0, 20), // Limit to 20 images
  };
}

async function main() {
  console.log('🚗 Vanguard Motor Sales Scraper (Fetch-based)\n');
  await send('🎯 <b>Vanguard Motor Sales</b>\n\nStarting fetch-based scrape...');

  const allUrls: string[] = [];
  let pageNum = 1;

  // Collect all vehicle URLs
  console.log('Phase 1: Collecting vehicle URLs...\n');

  while (pageNum <= 100) {
    const url = `${BASE_URL}/vehicles?page=${pageNum}`;
    console.log(`Page ${pageNum}...`);

    try {
      const html = await fetchPage(url);
      const urls = extractVehicleUrls(html);

      if (urls.length === 0) {
        console.log('  No more vehicles found');
        break;
      }

      console.log(`  Found ${urls.length} vehicles`);
      allUrls.push(...urls);
      pageNum++;

      // Small delay to be polite
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
      break;
    }
  }

  const uniqueUrls = [...new Set(allUrls)];
  console.log(`\nTotal unique vehicles: ${uniqueUrls.length}\n`);
  await send(`📋 Found ${uniqueUrls.length} vehicles\n\nExtracting details...`);

  // Extract details from each vehicle
  console.log('Phase 2: Extracting vehicle details...\n');

  let extracted = 0;
  let errors = 0;

  for (const url of uniqueUrls) {
    try {
      const html = await fetchPage(url);
      const data = parseVehicleDetails(html, url);

      await supabase.from('import_queue').upsert({
        listing_url: url,
        listing_title: data.title,
        listing_year: data.year,
        listing_make: data.make,
        listing_model: data.model,
        listing_price: data.price,
        status: 'pending',
        raw_data: {
          source: 'vanguard',
          vin: data.vin,
          mileage: data.mileage,
          stock: data.stock,
          images: data.images,
        }
      }, { onConflict: 'listing_url' });

      extracted++;
      if (extracted % 50 === 0) {
        console.log(`Extracted ${extracted}/${uniqueUrls.length}`);
      }

      // Small delay
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      errors++;
      if (errors < 5) console.log(`Error on ${url}: ${err.message}`);
    }
  }

  await send(
    `✅ <b>Vanguard Complete!</b>\n\n` +
    `Vehicles found: ${uniqueUrls.length}\n` +
    `Extracted: ${extracted}\n` +
    `Errors: ${errors}\n\n` +
    `All queued for processing.`
  );

  console.log(`\n✅ Complete: ${extracted} vehicles extracted, ${errors} errors`);
}

main().catch(console.error);
