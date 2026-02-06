#!/usr/bin/env npx tsx
/**
 * Parallel ECR Agents
 * Spawns multiple workers to scrape ECR collections, profiles, and cars concurrently
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT = process.env.TELEGRAM_CHAT_ID!;

const NUM_WORKERS = 5;
const BASE_URL = 'https://exclusivecarregistry.com';

interface WorkItem {
  url: string;
  type: 'collection' | 'profile' | 'car';
}

// Work queue
const workQueue: WorkItem[] = [];
let processed = 0;
let totalFound = { collections: 0, profiles: 0, cars: 0, instagram: 0 };

async function send(msg: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

async function saveData(data: any) {
  await supabase.from('import_queue').upsert({
    listing_url: data.url,
    listing_title: data.name || data.title,
    listing_year: data.year,
    listing_make: data.make,
    listing_model: data.model,
    status: data.type === 'car' ? 'pending' : 'complete',
    raw_data: { source: 'ecr', ...data }
  }, { onConflict: 'listing_url' });
}

async function scrapeCollectionPage(page: Page, url: string): Promise<{ carUrls: string[]; instagram?: string }> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2000);

  // Get Instagram handle
  const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
  const igMatch = bodyText.match(/@([a-zA-Z0-9_\.]+)/);
  const igLink = await page.$eval('a[href*="instagram.com"]', el => el.getAttribute('href')).catch(() => null);
  const instagram = igMatch ? igMatch[1] : (igLink ? igLink.split('instagram.com/')[1]?.split(/[/?]/)[0] : undefined);

  // Get car URLs
  const carUrls = await page.$$eval('a[href*="/car/"]', els =>
    [...new Set(els.map(a => a.getAttribute('href')).filter(Boolean))] as string[]
  ).catch(() => []);

  return {
    carUrls: carUrls.map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`),
    instagram
  };
}

async function scrapeProfilePage(page: Page, url: string): Promise<{ carUrls: string[]; instagram?: string; displayName?: string }> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2000);

  const displayName = await page.$eval('h1', el => el.textContent?.trim()).catch(() => undefined);
  const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
  const igMatch = bodyText.match(/@([a-zA-Z0-9_\.]+)/);
  const instagram = igMatch ? igMatch[1] : undefined;

  const carUrls = await page.$$eval('a[href*="/car/"]', els =>
    [...new Set(els.map(a => a.getAttribute('href')).filter(Boolean))] as string[]
  ).catch(() => []);

  return {
    carUrls: carUrls.map(u => u.startsWith('http') ? u : `${BASE_URL}${u}`),
    instagram,
    displayName
  };
}

async function scrapeCarPage(page: Page, url: string): Promise<any> {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);

  const title = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
  const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');

  const match = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)/);
  const vinMatch = bodyText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
  const chassisMatch = bodyText.match(/(?:Chassis|S\/N|Serial)[:\s#]*([A-Z0-9-]+)/i);

  return {
    url,
    type: 'car',
    title,
    year: match ? parseInt(match[1]) : undefined,
    make: match ? match[2] : undefined,
    model: match ? match[3] : undefined,
    vin: vinMatch ? vinMatch[1] : undefined,
    chassis: chassisMatch ? chassisMatch[1] : undefined,
  };
}

async function worker(id: number, browser: Browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  console.log(`[W${id}] Started`);

  while (true) {
    const item = workQueue.shift();
    if (!item) {
      await new Promise(r => setTimeout(r, 1000));
      if (workQueue.length === 0) {
        // Check if we should exit
        await new Promise(r => setTimeout(r, 5000));
        if (workQueue.length === 0) break;
      }
      continue;
    }

    try {
      const slug = item.url.split('/').pop() || '';
      console.log(`[W${id}] ${item.type}: ${slug}`);

      if (item.type === 'collection') {
        const result = await scrapeCollectionPage(page, item.url);
        await saveData({ url: item.url, type: 'collection', name: slug, instagram: result.instagram });
        totalFound.collections++;
        if (result.instagram && result.instagram !== 'exclusivecarregistry') totalFound.instagram++;

        // Add cars to queue
        for (const carUrl of result.carUrls) {
          workQueue.push({ url: carUrl, type: 'car' });
        }
        console.log(`[W${id}]   📸 @${result.instagram || 'none'} | 🚗 ${result.carUrls.length} cars`);

      } else if (item.type === 'profile') {
        const result = await scrapeProfilePage(page, item.url);
        await saveData({ url: item.url, type: 'profile', name: result.displayName || slug, instagram: result.instagram });
        totalFound.profiles++;
        if (result.instagram) totalFound.instagram++;

        for (const carUrl of result.carUrls) {
          workQueue.push({ url: carUrl, type: 'car' });
        }

      } else if (item.type === 'car') {
        const result = await scrapeCarPage(page, item.url);
        await saveData(result);
        totalFound.cars++;
      }

      processed++;
    } catch (err: any) {
      console.log(`[W${id}] Error: ${err.message.slice(0, 40)}`);
    }

    await page.waitForTimeout(500 + Math.random() * 500);
  }

  await context.close();
  console.log(`[W${id}] Done`);
}

async function loadInitialWork(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Loading collection URLs...');

  // Load all collection URLs
  let pageNum = 1;
  while (pageNum <= 100) {
    const url = pageNum === 1 ? `${BASE_URL}/collection` : `${BASE_URL}/collection?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const urls = await page.$$eval('a[href*="/collection/"]', els =>
      els.map(a => a.getAttribute('href'))
         .filter(h => h && h !== '/collection' && !h.includes('?')) as string[]
    ).catch(() => []);

    if (urls.length === 0) break;

    for (const u of [...new Set(urls)]) {
      const fullUrl = u.startsWith('http') ? u : `${BASE_URL}${u}`;
      workQueue.push({ url: fullUrl, type: 'collection' });
    }
    console.log(`  Page ${pageNum}: ${urls.length} collections (queue: ${workQueue.length})`);
    pageNum++;
  }

  console.log('Loading profile URLs...');

  // Load all profile URLs
  pageNum = 1;
  while (pageNum <= 200) {
    const url = pageNum === 1 ? `${BASE_URL}/profile-list` : `${BASE_URL}/profile-list?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const urls = await page.$$eval('a[href*="/profile/"]', els =>
      els.map(a => a.getAttribute('href'))
         .filter(h => h && !h.includes('profile-list')) as string[]
    ).catch(() => []);

    if (urls.length === 0) break;

    for (const u of [...new Set(urls)]) {
      const fullUrl = u.startsWith('http') ? u : `${BASE_URL}${u}`;
      workQueue.push({ url: fullUrl, type: 'profile' });
    }
    console.log(`  Page ${pageNum}: ${urls.length} profiles (queue: ${workQueue.length})`);
    pageNum++;
  }

  await context.close();
  console.log(`\nTotal work items: ${workQueue.length}\n`);
}

async function main() {
  console.log(`🏎️  Parallel ECR Agents (${NUM_WORKERS} workers)\n`);

  await send(`🚀 <b>Parallel ECR Agents Starting</b>\n\n${NUM_WORKERS} workers\nLoading work queue...`);

  const browser = await chromium.launch({ headless: true });

  // Load initial work
  await loadInitialWork(browser);

  await send(`📋 <b>Work Queue Loaded</b>\n\n${workQueue.length} items to process\n\nStarting ${NUM_WORKERS} parallel workers...`);

  // Start workers
  const workers = [];
  for (let i = 1; i <= NUM_WORKERS; i++) {
    workers.push(worker(i, browser));
  }

  // Progress reporter
  const reporter = setInterval(async () => {
    const queueSize = workQueue.length;
    console.log(`\n📊 Progress: ${processed} processed, ${queueSize} queued`);
    console.log(`   Collections: ${totalFound.collections}, Profiles: ${totalFound.profiles}, Cars: ${totalFound.cars}`);
    console.log(`   Instagram handles: ${totalFound.instagram}\n`);

    if (processed > 0 && processed % 100 === 0) {
      await send(
        `📊 <b>ECR Progress</b>\n\n` +
        `Processed: ${processed}\n` +
        `Queue: ${queueSize}\n\n` +
        `Collections: ${totalFound.collections}\n` +
        `Profiles: ${totalFound.profiles}\n` +
        `Cars: ${totalFound.cars}\n` +
        `Instagram: ${totalFound.instagram}`
      );
    }
  }, 30000);

  // Wait for all workers
  await Promise.all(workers);
  clearInterval(reporter);

  await browser.close();

  await send(
    `✅ <b>ECR Scrape Complete!</b>\n\n` +
    `Total processed: ${processed}\n\n` +
    `Collections: ${totalFound.collections}\n` +
    `Profiles: ${totalFound.profiles}\n` +
    `Cars: ${totalFound.cars}\n` +
    `Instagram handles: ${totalFound.instagram}`
  );

  console.log('\n✅ Complete!');
}

main().catch(console.error);
