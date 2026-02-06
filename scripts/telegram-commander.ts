#!/usr/bin/env npx tsx
/**
 * Telegram Commander
 * Listens for URLs/commands via Telegram and triggers scrapers
 * Text me targets and I'll scrape them!
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

const POLL_INTERVAL = 5000; // Check every 5 seconds
let lastUpdateId = 0;

async function sendTelegram(message: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
    });
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}

async function getUpdates(): Promise<any[]> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
    );
    const data = await res.json();
    return data.ok ? data.result : [];
  } catch {
    return [];
  }
}

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  return text.match(urlRegex) || [];
}

// ===== SCRAPERS =====

async function scrapeGenericSite(page: Page, url: string): Promise<{ title: string; urls: string[] }> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const title = await page.title();

  // Find all internal links that look like listings/inventory
  const domain = new URL(url).hostname;
  const urls = await page.$$eval('a[href]', (els, domain) => {
    return els
      .map(a => a.getAttribute('href'))
      .filter(h => h && (
        h.includes('/listing') ||
        h.includes('/inventory') ||
        h.includes('/vehicle') ||
        h.includes('/car/') ||
        h.includes('/collection/') ||
        h.includes('/profile/')
      ))
      .map(h => h!.startsWith('http') ? h! : `https://${domain}${h!.startsWith('/') ? '' : '/'}${h}`)
      .filter((v, i, a) => a.indexOf(v) === i) as string[];
  }, domain).catch(() => []);

  return { title, urls };
}

async function scrapeVanguard(page: Page): Promise<string[]> {
  console.log('Scraping Vanguard Motor Sales...');
  const carUrls: string[] = [];
  let pageNum = 1;

  while (pageNum <= 50) {
    const url = `https://www.vanguardmotorsales.com/vehicles?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const urls = await page.$$eval('a[href*="/vehicles/"]', els =>
      els.map(a => a.getAttribute('href')).filter(Boolean) as string[]
    ).catch(() => []);

    const unique = [...new Set(urls)].filter(u => u !== '/vehicles' && u.includes('/vehicles/'));
    if (unique.length === 0) break;

    carUrls.push(...unique.map(u => u.startsWith('http') ? u : `https://www.vanguardmotorsales.com${u}`));
    console.log(`  Page ${pageNum}: ${unique.length} vehicles`);
    pageNum++;
    await page.waitForTimeout(1000);
  }

  return [...new Set(carUrls)];
}

async function scrapeECRList(page: Page): Promise<string[]> {
  console.log('Scraping ECR car list...');
  const carUrls: string[] = [];
  let pageNum = 1;

  while (pageNum <= 100) {
    const url = `https://exclusivecarregistry.com/list?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const urls = await page.$$eval('a[href*="/car/"]', els =>
      els.map(a => a.getAttribute('href')).filter(Boolean) as string[]
    ).catch(() => []);

    if (urls.length === 0) break;
    carUrls.push(...urls.map(u => u.startsWith('http') ? u : `https://exclusivecarregistry.com${u}`));
    console.log(`  Page ${pageNum}: ${urls.length} cars`);
    pageNum++;
    await page.waitForTimeout(1000);
  }

  return [...new Set(carUrls)];
}

async function scrapeECRCollections(page: Page): Promise<string[]> {
  console.log('Scraping ECR collections...');
  const urls: string[] = [];
  let pageNum = 1;

  while (pageNum <= 100) {
    const url = pageNum === 1
      ? 'https://exclusivecarregistry.com/collection'
      : `https://exclusivecarregistry.com/collection?page=${pageNum}`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const pageUrls = await page.$$eval('a[href*="/collection/"]', els =>
      els.map(a => a.getAttribute('href'))
         .filter(h => h && h !== '/collection' && !h.includes('?')) as string[]
    ).catch(() => []);

    if (pageUrls.length === 0) break;
    urls.push(...pageUrls.map(u => u.startsWith('http') ? u : `https://exclusivecarregistry.com${u}`));
    console.log(`  Page ${pageNum}: ${pageUrls.length} collections`);
    pageNum++;
    await page.waitForTimeout(1000);
  }

  return [...new Set(urls)];
}

async function queueUrls(urls: string[], source: string): Promise<number> {
  let queued = 0;
  for (const url of urls) {
    const { error } = await supabase.from('import_queue').upsert({
      listing_url: url,
      status: 'pending',
      raw_data: { source, queued_via: 'telegram' }
    }, { onConflict: 'listing_url' });
    if (!error) queued++;
  }
  return queued;
}

async function handleUrl(page: Page, url: string): Promise<void> {
  const domain = new URL(url).hostname.replace('www.', '');

  await sendTelegram(`🎯 <b>Target received</b>\n\n${url}\n\nProcessing...`);

  try {
    let urls: string[] = [];
    let source = domain;

    // Route to appropriate scraper
    if (url.includes('exclusivecarregistry.com/collection')) {
      urls = await scrapeECRCollections(page);
      source = 'ecr-collections';
    } else if (url.includes('exclusivecarregistry.com/list')) {
      urls = await scrapeECRList(page);
      source = 'ecr-cars';
    } else if (url.includes('vanguardmotorsales.com')) {
      urls = await scrapeVanguard(page);
      source = 'vanguard';
    } else {
      // Generic scraper
      const result = await scrapeGenericSite(page, url);
      urls = result.urls;
      await sendTelegram(`📄 <b>${result.title}</b>\n\nFound ${urls.length} links`);
    }

    if (urls.length > 0) {
      const queued = await queueUrls(urls, source);
      await sendTelegram(
        `✅ <b>Scrape complete</b>\n\n` +
        `Source: ${source}\n` +
        `Found: ${urls.length} URLs\n` +
        `Queued: ${queued} new items\n\n` +
        `Sample:\n${urls.slice(0, 3).map(u => `• ${u.slice(0, 50)}...`).join('\n')}`
      );
    } else {
      await sendTelegram(`⚠️ No URLs found on ${domain}`);
    }
  } catch (err: any) {
    await sendTelegram(`❌ <b>Error scraping</b>\n\n${url}\n\n${err.message.slice(0, 100)}`);
  }
}

async function handleCommand(text: string): Promise<string> {
  const cmd = text.toLowerCase().trim();

  if (cmd === '/status' || cmd === 'status') {
    const { data } = await supabase
      .from('import_queue')
      .select('status')
      .limit(100000);

    const counts: Record<string, number> = {};
    data?.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });

    return `📊 <b>Queue Status</b>\n\n` +
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `• ${k}: ${v.toLocaleString()}`)
        .join('\n');
  }

  if (cmd === '/help' || cmd === 'help') {
    return `🤖 <b>Commands</b>\n\n` +
      `• Send any URL to scrape it\n` +
      `• <code>/status</code> - Queue stats\n` +
      `• <code>/help</code> - This message\n\n` +
      `<b>Supported sites:</b>\n` +
      `• exclusivecarregistry.com\n` +
      `• vanguardmotorsales.com\n` +
      `• Any site (generic scraper)`;
  }

  return '';
}

async function processMessage(page: Page, message: any) {
  const text = message.text || '';
  const chatId = message.chat?.id?.toString();

  // Only respond to our chat
  if (chatId !== TELEGRAM_CHAT_ID) return;

  console.log(`\nReceived: ${text.slice(0, 50)}...`);

  // Check for commands
  const cmdResponse = await handleCommand(text);
  if (cmdResponse) {
    await sendTelegram(cmdResponse);
    return;
  }

  // Extract and process URLs
  const urls = extractUrls(text);
  if (urls.length > 0) {
    for (const url of urls) {
      await handleUrl(page, url);
    }
  }
}

async function main() {
  console.log('🤖 Telegram Commander started\n');
  console.log('Listening for messages...\n');

  await sendTelegram(
    `🤖 <b>Commander Online</b>\n\n` +
    `Send me URLs to scrape!\n\n` +
    `Commands:\n` +
    `• <code>/status</code> - Queue stats\n` +
    `• <code>/help</code> - Help`
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  // Main polling loop
  while (true) {
    try {
      const updates = await getUpdates();

      for (const update of updates) {
        lastUpdateId = update.update_id;
        if (update.message) {
          await processMessage(page, update.message);
        }
      }
    } catch (err) {
      console.error('Poll error:', err);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(console.error);
