#!/usr/bin/env node
/**
 * Discover auctions from platforms with anti-bot protection using Playwright
 * Usage: node discover-auctions-playwright.js <platform> [limit]
 */

import { chromium } from 'playwright';

const platforms = {
  'cars-and-bids': {
    url: 'https://carsandbids.com/',
    selector: 'a[href*="/auctions/"]',
    baseUrl: 'https://carsandbids.com',
    pattern: /\/auctions\/[a-zA-Z0-9]+\//,
  },
  'pcarmarket': {
    url: 'https://pcarmarket.com/auctions/',
    selector: 'a[href*="/auction/"]',
    baseUrl: 'https://pcarmarket.com',
    pattern: /\/auction\/[a-zA-Z0-9-]+/,
  },
  'collecting-cars': {
    url: 'https://collectingcars.com/buy',
    selector: 'a[href*="/for-sale/"]',
    baseUrl: 'https://collectingcars.com',
    pattern: /\/for-sale\/[a-zA-Z0-9-]+/,
  },
};

async function discoverAuctions(platform, limit = 20) {
  const config = platforms[platform];
  if (!config) {
    console.error(`Unknown platform: ${platform}`);
    console.error(`Available: ${Object.keys(platforms).join(', ')}`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    console.error(`[discover] Navigating to ${config.url}...`);
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for dynamic content to load
    await page.waitForTimeout(3000);

    console.error(`[discover] Page loaded, extracting links...`);

    // Extract all matching links
    const links = await page.evaluate((selector) => {
      const anchors = document.querySelectorAll(selector);
      return Array.from(anchors).map(a => a.href);
    }, config.selector);

    // Filter and deduplicate
    const seen = new Set();
    const auctions = [];

    for (const link of links) {
      if (auctions.length >= limit) break;

      // Check pattern match
      if (!config.pattern.test(link)) continue;

      // Skip past/ended auctions
      if (link.includes('/past') || link.includes('/ended') || link.includes('/sold')) continue;

      // Normalize URL
      const normalized = link.split('?')[0].replace(/\/$/, '');

      if (!seen.has(normalized)) {
        seen.add(normalized);
        auctions.push(normalized);
      }
    }

    console.error(`[discover] Found ${auctions.length} active auctions`);

    // Output JSON array of URLs
    console.log(JSON.stringify(auctions, null, 2));

  } catch (error) {
    console.error(`[discover] Error: ${error.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Main
const platform = process.argv[2];
const limit = parseInt(process.argv[3]) || 20;

if (!platform) {
  console.error('Usage: node discover-auctions-playwright.js <platform> [limit]');
  console.error(`Available platforms: ${Object.keys(platforms).join(', ')}`);
  process.exit(1);
}

discoverAuctions(platform, limit);
