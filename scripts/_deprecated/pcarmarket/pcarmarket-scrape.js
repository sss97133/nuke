#!/usr/bin/env node
/**
 * PCarMarket Scraper
 *
 * Uses Playwright to render JS and extract embedded JSON data,
 * then calls the import-pcarmarket-listing edge function.
 *
 * Usage:
 *   node scripts/pcarmarket-scrape.js https://pcarmarket.com/auction/1990-porsche-911
 *   node scripts/pcarmarket-scrape.js --batch urls.txt
 *   node scripts/pcarmarket-scrape.js --discover sold 1 10  # pages 1-10 of sold
 */

import { chromium } from 'playwright';
import fs from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function extractListingData(page, url) {
  console.log(`[scrape] Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for the page content to load - look for specific auction elements
  try {
    await page.waitForSelector('h1, [class*="title"], [class*="auction"]', { timeout: 10000 });
  } catch {
    console.log('[scrape] Warning: Could not find title element, continuing anyway');
  }

  // Additional wait for dynamic content
  await page.waitForTimeout(3000);

  // Extract data from meta tags, DOM, and any embedded JSON
  const data = await page.evaluate(() => {
    const result = {
      source: 'dom',
      meta: {},
      dom: {},
      images: []
    };

    // Extract from meta tags (always available on initial load)
    const metaTags = {
      'og:title': 'title',
      'og:description': 'description',
      'og:image': 'image',
      'og:url': 'url'
    };

    for (const [property, key] of Object.entries(metaTags)) {
      const meta = document.querySelector(`meta[property="${property}"]`);
      if (meta) {
        result.meta[key] = meta.getAttribute('content');
      }
    }

    // Also check name attributes
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) result.meta.description = descMeta.getAttribute('content');

    // Extract title
    const title = document.querySelector('title');
    if (title) result.meta.pageTitle = title.textContent;

    // Try to find __NEXT_DATA__ (Next.js)
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) {
      try {
        const parsed = JSON.parse(nextData.textContent);
        if (parsed.props?.pageProps?.auction) {
          return { source: 'nextjs', data: parsed.props.pageProps.auction };
        }
        if (parsed.props?.pageProps) {
          result.nextData = parsed.props.pageProps;
        }
      } catch {}
    }

    // Try to find window.__AUCTION_DATA__
    if (window.__AUCTION_DATA__) {
      return { source: 'window', data: window.__AUCTION_DATA__ };
    }

    // Extract from visible DOM elements
    // Title/Year/Make/Model from h1 or title
    const h1 = document.querySelector('h1');
    if (h1) result.dom.h1 = h1.textContent?.trim();

    // Look for specific data elements
    const selectors = {
      status: '[class*="status"], [class*="badge"]',
      bid: '[class*="bid"], [class*="price"]',
      vin: '[class*="vin"]',
      mileage: '[class*="mile"], [class*="odometer"]',
      location: '[class*="location"]',
      seller: '[class*="seller"]',
      time: '[class*="time"], [class*="countdown"]'
    };

    for (const [key, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector);
      if (el) result.dom[key] = el.textContent?.trim();
    }

    // Extract all images from the page
    const imgSet = new Set();
    document.querySelectorAll('img[src*="cloudfront"], img[src*="pcarmarket"]').forEach(img => {
      const src = img.src || img.getAttribute('data-src');
      if (src && src.includes('media/uploads')) {
        imgSet.add(src);
      }
    });
    result.images = [...imgSet];

    // Get full HTML for backend parsing
    result.html = document.documentElement.outerHTML;

    return result;
  });

  return data;
}

async function discoverListings(page, auctionType, startPage, endPage) {
  const urls = new Set();

  for (let p = startPage; p <= endPage; p++) {
    const url = `https://www.pcarmarket.com/auctions?auctionType=${auctionType}&page=${p}`;
    console.log(`[discover] Page ${p}: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Extract auction links
    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll('a[href*="/auction/"]');
      return [...anchors].map(a => a.href).filter(href =>
        href.match(/\/auction\/\d{4}-[a-z0-9-]+-\d+/)
      );
    });

    links.forEach(link => urls.add(link));
    console.log(`[discover] Found ${links.length} listings (total: ${urls.size})`);

    // Rate limit
    await page.waitForTimeout(1000);
  }

  return [...urls];
}

async function importListing(url, html) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[import] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return null;
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/import-pcarmarket-listing`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ listing_url: url, html }),
  });

  return response.json();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage:
  node scripts/pcarmarket-scrape.js <url>
  node scripts/pcarmarket-scrape.js --batch <urls-file>
  node scripts/pcarmarket-scrape.js --discover <sold|unsold|no_reserve> <start> <end>
  node scripts/pcarmarket-scrape.js --extract-only <url>  # Just show data, don't import
`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  try {
    if (args[0] === '--discover') {
      const [, auctionType, startPage, endPage] = args;
      const urls = await discoverListings(
        page,
        auctionType || 'sold',
        parseInt(startPage) || 1,
        parseInt(endPage) || 5
      );

      console.log('\n=== Discovered URLs ===');
      urls.forEach(url => console.log(url));
      console.log(`\nTotal: ${urls.length} URLs`);

    } else if (args[0] === '--extract-only') {
      const url = args[1];
      const data = await extractListingData(page, url);
      console.log('\n=== Extracted Data ===');
      console.log(JSON.stringify(data, null, 2));

    } else if (args[0] === '--batch') {
      const urls = fs.readFileSync(args[1], 'utf8').split('\n').filter(Boolean);

      for (const url of urls) {
        console.log(`\n[batch] Processing: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const html = await page.content();
        const result = await importListing(url, html);
        console.log(`[batch] Result:`, JSON.stringify(result));
        await page.waitForTimeout(2000); // Rate limit
      }

    } else {
      // Single URL
      const url = args[0];
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      const html = await page.content();

      console.log(`[scrape] Got ${html.length} chars of HTML`);

      const result = await importListing(url, html);
      console.log('\n=== Import Result ===');
      console.log(JSON.stringify(result, null, 2));
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
