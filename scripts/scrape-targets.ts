#!/usr/bin/env npx tsx
/**
 * Quick target scraper for URLs sent via Telegram
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT = process.env.TELEGRAM_CHAT_ID!;

async function send(msg: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}

async function main() {
  console.log('Starting target scraper...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // 1. Vanguard Motor Sales
    await send('🎯 Scraping Vanguard Motor Sales...');
    console.log('Scraping Vanguard...');
    const vanguardUrls: string[] = [];

    for (let p = 1; p <= 30; p++) {
      await page.goto(`https://www.vanguardmotorsales.com/vehicles?page=${p}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await page.waitForTimeout(1500);

      const urls = await page.$$eval('a[href*="/vehicles/"]', els =>
        els.map(a => a.getAttribute('href'))
           .filter(h => h && h.includes('/vehicles/') && h !== '/vehicles') as string[]
      ).catch(() => []);

      if (urls.length === 0) break;

      const fullUrls = urls.map(u => u.startsWith('http') ? u : `https://www.vanguardmotorsales.com${u}`);
      vanguardUrls.push(...fullUrls);
      console.log(`Vanguard page ${p}: ${urls.length} vehicles`);
    }

    const uniqueVanguard = [...new Set(vanguardUrls)];
    let vanguardQueued = 0;
    for (const url of uniqueVanguard) {
      const { error } = await supabase.from('import_queue').upsert({
        listing_url: url,
        status: 'pending',
        raw_data: { source: 'vanguard', queued_via: 'telegram' }
      }, { onConflict: 'listing_url' });
      if (!error) vanguardQueued++;
    }
    await send(`✅ <b>Vanguard Motor Sales</b>\n\nFound: ${uniqueVanguard.length} vehicles\nQueued: ${vanguardQueued}`);
    console.log(`Vanguard complete: ${uniqueVanguard.length} found, ${vanguardQueued} queued`);

    // 2. ECR List (cars)
    await send('🎯 Scraping ECR car list...');
    console.log('Scraping ECR cars...');
    const ecrCarUrls: string[] = [];

    for (let p = 1; p <= 100; p++) {
      await page.goto(`https://exclusivecarregistry.com/list?page=${p}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await page.waitForTimeout(1500);

      const urls = await page.$$eval('a[href*="/car/"]', els =>
        els.map(a => a.getAttribute('href')).filter(Boolean) as string[]
      ).catch(() => []);

      if (urls.length === 0) break;

      const fullUrls = urls.map(u => u.startsWith('http') ? u : `https://exclusivecarregistry.com${u}`);
      ecrCarUrls.push(...fullUrls);
      console.log(`ECR cars page ${p}: ${urls.length} cars`);
    }

    const uniqueEcrCars = [...new Set(ecrCarUrls)];
    let ecrQueued = 0;
    for (const url of uniqueEcrCars) {
      const { error } = await supabase.from('import_queue').upsert({
        listing_url: url,
        status: 'pending',
        raw_data: { source: 'ecr', type: 'car', queued_via: 'telegram' }
      }, { onConflict: 'listing_url' });
      if (!error) ecrQueued++;
    }
    await send(`✅ <b>ECR Car List</b>\n\nFound: ${uniqueEcrCars.length} cars\nQueued: ${ecrQueued}`);
    console.log(`ECR cars complete: ${uniqueEcrCars.length} found, ${ecrQueued} queued`);

    // 3. Summary
    await send(
      `🏁 <b>Target Scraping Complete!</b>\n\n` +
      `<b>Vanguard:</b> ${uniqueVanguard.length} vehicles\n` +
      `<b>ECR Cars:</b> ${uniqueEcrCars.length} cars\n\n` +
      `All queued for extraction. ECR collections still being scraped by full scraper.`
    );

  } finally {
    await browser.close();
  }

  console.log('Done!');
}

main().catch(e => {
  console.error(e);
  send(`❌ Target scraper error: ${e.message}`);
});
