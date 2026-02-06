#!/usr/bin/env npx tsx
/**
 * Vanguard Motor Sales Scraper
 * Classic cars dealer - easy to scrape
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT = process.env.TELEGRAM_CHAT_ID!;

const BASE_URL = 'https://www.vanguardmotorsales.com';

async function send(msg: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

async function main() {
  console.log('🚗 Vanguard Motor Sales Scraper\n');

  await send('🎯 <b>Vanguard Motor Sales</b>\n\nStarting scrape...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const allUrls: string[] = [];
  let pageNum = 1;

  // Collect all vehicle URLs
  while (pageNum <= 50) {
    const url = `${BASE_URL}/vehicles?page=${pageNum}`;
    console.log(`Page ${pageNum}...`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000); // Wait longer for JS

    // Debug: log page content
    const html = await page.content();
    console.log(`  Page has ${html.length} chars`);

    // Get all links and filter for vehicle detail pages
    const urls = await page.$$eval('a', els =>
      els.map(a => a.getAttribute('href'))
         .filter(h => h && /\/vehicles\/\d+/.test(h))
    ).catch(() => []) as string[];

    console.log(`  Raw vehicle links: ${urls.length}`);

    const fullUrls = [...new Set(urls)].map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`);

    if (fullUrls.length === 0) {
      console.log('  No more vehicles found');
      break;
    }

    console.log(`  Found ${fullUrls.length} vehicles`);
    allUrls.push(...fullUrls);
    pageNum++;
    await page.waitForTimeout(1000);
  }

  const uniqueUrls = [...new Set(allUrls)];
  console.log(`\nTotal unique vehicles: ${uniqueUrls.length}\n`);

  await send(`📋 Found ${uniqueUrls.length} vehicles\n\nExtracting details...`);

  // Extract details from each vehicle
  let extracted = 0;
  for (const url of uniqueUrls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      const title = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
      const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');

      // Parse year/make/model from title like "1967 Ford Mustang"
      const match = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);

      // Get price
      const priceMatch = bodyText.match(/\$[\s]*([\d,]+)/);
      const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : undefined;

      // Get VIN
      const vinMatch = bodyText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);

      // Get mileage
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:mi|miles)/i);

      // Get stock number
      const stockMatch = bodyText.match(/Stock[:\s#]*([A-Z0-9-]+)/i);

      await supabase.from('import_queue').upsert({
        listing_url: url,
        listing_title: title,
        listing_year: match ? parseInt(match[1]) : undefined,
        listing_make: match ? match[2] : undefined,
        listing_model: match ? match[3] : undefined,
        listing_price: price,
        status: 'pending',
        raw_data: {
          source: 'vanguard',
          vin: vinMatch ? vinMatch[1] : undefined,
          mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : undefined,
          stock: stockMatch ? stockMatch[1] : undefined,
        }
      }, { onConflict: 'listing_url' });

      extracted++;
      if (extracted % 50 === 0) {
        console.log(`Extracted ${extracted}/${uniqueUrls.length}`);
      }
    } catch (err) {
      console.log(`Error on ${url}`);
    }
  }

  await browser.close();

  await send(
    `✅ <b>Vanguard Complete!</b>\n\n` +
    `Vehicles found: ${uniqueUrls.length}\n` +
    `Extracted: ${extracted}\n\n` +
    `All queued for extraction.`
  );

  console.log(`\n✅ Complete: ${extracted} vehicles extracted`);
}

main().catch(console.error);
