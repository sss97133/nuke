#!/usr/bin/env npx tsx
/**
 * Smart Scraper - Auto-handles bot detection
 * Tries headless first, falls back to visible browser if blocked
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const BOT = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT = process.env.TELEGRAM_CHAT_ID!;

// Sites known to need visible browser
const NEEDS_VISIBLE: string[] = [
  'vanguardmotorsales.com',
  'cars.ksl.com',
  'classic.com',
];

async function send(msg: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {});
}

function isBlocked(html: string): boolean {
  const blockers = [
    'captcha', 'challenge', 'blocked', 'denied', 'cloudflare',
    'just a moment', 'checking your browser', 'access denied',
    'please verify', 'are you a robot', 'px-captcha'
  ];
  const lower = html.toLowerCase();
  return html.length < 1000 || blockers.some(b => lower.includes(b));
}

async function createBrowser(headless: boolean): Promise<Browser> {
  return chromium.launch({
    headless,
    args: headless ? [] : [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ]
  });
}

async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });
}

interface ScrapeResult {
  success: boolean;
  urls: string[];
  title: string;
  usedVisible: boolean;
}

async function scrapeWithFallback(url: string): Promise<ScrapeResult> {
  const domain = new URL(url).hostname.replace('www.', '');
  const needsVisible = NEEDS_VISIBLE.some(d => domain.includes(d));

  // Try headless first (unless known to need visible)
  if (!needsVisible) {
    console.log(`[HEADLESS] Trying ${domain}...`);
    const browser = await createBrowser(true);
    const context = await createContext(browser);
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const html = await page.content();

      if (!isBlocked(html)) {
        const title = await page.title();
        const urls = await extractUrls(page, domain);
        await browser.close();
        return { success: true, urls, title, usedVisible: false };
      }

      console.log(`[HEADLESS] Blocked! Falling back to visible...`);
    } catch (e) {
      console.log(`[HEADLESS] Error, falling back...`);
    }
    await browser.close();
  }

  // Visible browser mode
  console.log(`[VISIBLE] Opening browser for ${domain}...`);
  await send(`🖥️ Opening visible browser for bot-protected site:\n${url}`);

  const browser = await createBrowser(false);
  const context = await createContext(browser);

  // Add anti-detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    (window as any).chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for any challenges to complete
    let attempts = 0;
    while (attempts < 30) {
      await page.waitForTimeout(2000);
      const html = await page.content();

      if (!isBlocked(html) && html.length > 5000) {
        break;
      }

      console.log(`[VISIBLE] Waiting for page to load... (${attempts + 1}/30)`);
      attempts++;
    }

    const title = await page.title();
    const urls = await extractUrls(page, domain);

    // Add domain to NEEDS_VISIBLE for future
    if (!NEEDS_VISIBLE.includes(domain)) {
      console.log(`[VISIBLE] Adding ${domain} to bot-detection list`);
    }

    await browser.close();
    return { success: true, urls, title, usedVisible: true };

  } catch (e: any) {
    await browser.close();
    return { success: false, urls: [], title: '', usedVisible: true };
  }
}

async function extractUrls(page: Page, domain: string): Promise<string[]> {
  // Generic URL extraction - looks for listing/vehicle/inventory patterns
  const urls = await page.$$eval('a[href]', (els, domain) => {
    const patterns = [
      /\/vehicles?\/\d+/,
      /\/inventory\/\d+/,
      /\/listing\/\d+/,
      /\/car\/\d+/,
      /\/cars\/\d+/,
      /\/detail\/\d+/,
      /\/stock\/[a-z0-9-]+/i,
    ];

    return els
      .map(a => a.getAttribute('href'))
      .filter(h => h && patterns.some(p => p.test(h)))
      .map(h => h!.startsWith('http') ? h! : `https://${domain}${h!.startsWith('/') ? '' : '/'}${h}`)
      .filter((v, i, a) => a.indexOf(v) === i);
  }, domain).catch(() => []);

  return urls;
}

async function scrapeVanguard(page: Page): Promise<string[]> {
  console.log('Scraping Vanguard inventory...');
  const allUrls: string[] = [];

  for (let p = 1; p <= 50; p++) {
    const url = `https://www.vanguardmotorsales.com/vehicles?page=${p}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const urls = await page.$$eval('a[href]', els =>
      els.map(a => a.getAttribute('href'))
         .filter(h => h && /\/vehicles\/\d+/.test(h)) as string[]
    ).catch(() => []);

    if (urls.length === 0) break;

    const fullUrls = [...new Set(urls)].map(u =>
      u.startsWith('http') ? u : `https://www.vanguardmotorsales.com${u}`
    );

    allUrls.push(...fullUrls);
    console.log(`  Page ${p}: ${fullUrls.length} vehicles`);
    await page.waitForTimeout(1000);
  }

  return [...new Set(allUrls)];
}

async function main() {
  const targetUrl = process.argv[2] || process.env.TARGET_URL;

  if (!targetUrl) {
    console.log('Usage: npx tsx smart-scraper.ts <url>');
    console.log('Or set TARGET_URL env var');
    process.exit(1);
  }

  console.log(`🎯 Smart Scraper: ${targetUrl}\n`);

  const domain = new URL(targetUrl).hostname.replace('www.', '');

  // Special handling for known sites
  if (domain.includes('vanguardmotorsales')) {
    console.log('Using Vanguard-specific scraper...\n');
    await send(`🎯 Scraping Vanguard Motor Sales...`);

    const browser = await createBrowser(false); // Always visible for Vanguard
    const context = await createContext(browser);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    const page = await context.newPage();

    const urls = await scrapeVanguard(page);
    await browser.close();

    console.log(`\nFound ${urls.length} vehicles`);

    // Queue them
    let queued = 0;
    for (const url of urls) {
      const { error } = await supabase.from('import_queue').upsert({
        listing_url: url,
        status: 'pending',
        raw_data: { source: 'vanguard' }
      }, { onConflict: 'listing_url' });
      if (!error) queued++;
    }

    await send(`✅ <b>Vanguard Complete</b>\n\nFound: ${urls.length} vehicles\nQueued: ${queued}`);
    console.log(`Queued: ${queued}`);
    return;
  }

  // Generic scraping with fallback
  const result = await scrapeWithFallback(targetUrl);

  if (result.success) {
    console.log(`\n✅ Success! Found ${result.urls.length} URLs`);
    console.log(`Mode: ${result.usedVisible ? 'VISIBLE' : 'HEADLESS'}`);

    if (result.urls.length > 0) {
      // Queue URLs
      let queued = 0;
      for (const url of result.urls) {
        const { error } = await supabase.from('import_queue').upsert({
          listing_url: url,
          status: 'pending',
          raw_data: { source: domain }
        }, { onConflict: 'listing_url' });
        if (!error) queued++;
      }

      await send(
        `✅ <b>Scrape Complete</b>\n\n` +
        `Site: ${domain}\n` +
        `Mode: ${result.usedVisible ? '🖥️ Visible' : '👻 Headless'}\n` +
        `Found: ${result.urls.length} URLs\n` +
        `Queued: ${queued}`
      );
    }
  } else {
    await send(`❌ Failed to scrape ${domain}`);
  }
}

main().catch(console.error);
