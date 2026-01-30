#!/usr/bin/env node
/**
 * Sync auction data from platforms with anti-bot protection using Playwright
 * Usage: node sync-auctions-playwright.js [platform]
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const platformConfigs = {
  'cars-and-bids': {
    bidSelector: '[class*="bid"], [class*="price"]',
    bidPattern: /\$([\d,]+)/,
    bidCountPattern: /(\d+)\s+bids?/i,
    endTimeSelector: '[data-countdown], [class*="countdown"]',
    timeout: 20000,
    waitUntil: 'domcontentloaded',
  },
  'pcarmarket': {
    bidSelector: '.current-bid, .high-bid, [class*="bid"]',
    bidPattern: /\$([\d,]+)/,
    bidCountPattern: /(\d+)\s+bids?/i,
    endTimeSelector: '[data-countdown]',
    timeout: 25000,
    waitUntil: 'domcontentloaded',
  },
  'collecting-cars': {
    bidSelector: '[class*="bid"], [class*="price"]',
    bidPattern: /[£$€]([\d,]+)/,
    bidCountPattern: /(\d+)\s+bids?/i,
    endTimeSelector: '[class*="countdown"], [class*="timer"]',
    timeout: 45000,  // Longer timeout for slow UK site
    waitUntil: 'load',  // Wait for full load
    extraWait: 5000,  // Extra wait for JS
  },
};

async function getAuctionsToSync(platform) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/monitored_auctions?select=*,live_auction_sources!inner(slug)&is_live=eq.true&live_auction_sources.slug=eq.${platform}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch auctions: ${response.status}`);
  }

  return response.json();
}

async function updateAuction(id, data) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/monitored_auctions?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      ...data,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update auction: ${response.status}`);
  }
}

async function extractAuctionData(page, platform) {
  const config = platformConfigs[platform];
  if (!config) return null;

  const data = await page.evaluate((cfg) => {
    const result = {
      current_bid_cents: null,
      bid_count: null,
      is_ended: false,
    };

    // Check if ended
    const bodyText = document.body.innerText.toLowerCase();
    result.is_ended = bodyText.includes('auction ended') ||
                      bodyText.includes('sold for') ||
                      bodyText.includes('bidding closed');

    // Get all text content
    const pageText = document.body.innerText;

    // Find bid amount
    const bidMatch = pageText.match(/Current\s*Bid[:\s]*[£$€]?([\d,]+)/i) ||
                     pageText.match(/High\s*Bid[:\s]*[£$€]?([\d,]+)/i) ||
                     pageText.match(/Highest\s*Bid[:\s]*[£$€]?([\d,]+)/i);

    if (bidMatch?.[1]) {
      result.current_bid_cents = parseInt(bidMatch[1].replace(/,/g, ''), 10) * 100;
    }

    // Find bid count
    const bidCountMatch = pageText.match(/(\d+)\s+bids?/i);
    if (bidCountMatch?.[1]) {
      result.bid_count = parseInt(bidCountMatch[1], 10);
    }

    return result;
  }, config);

  return data;
}

async function syncPlatform(platform) {
  console.error(`[sync] Starting sync for ${platform}`);

  const auctions = await getAuctionsToSync(platform);
  console.error(`[sync] Found ${auctions.length} auctions to sync`);

  if (auctions.length === 0) return;

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: platform === 'collecting-cars' ? 'en-GB' : 'en-US',
    timezoneId: platform === 'collecting-cars' ? 'Europe/London' : 'America/New_York',
  });

  const results = { synced: 0, failed: 0, unchanged: 0 };

  try {
    for (const auction of auctions) {
      const page = await context.newPage();

      try {
        console.error(`[sync] Fetching ${auction.external_auction_url}`);
        const config = platformConfigs[platform];
        await page.goto(auction.external_auction_url, {
          waitUntil: config.waitUntil || 'domcontentloaded',
          timeout: config.timeout || 20000
        });

        // Wait for dynamic content
        await page.waitForTimeout(config.extraWait || 3000);

        const data = await extractAuctionData(page, platform);

        if (data && data.current_bid_cents !== null) {
          await updateAuction(auction.id, {
            current_bid_cents: data.current_bid_cents,
            bid_count: data.bid_count,
            is_live: !data.is_ended,
          });
          console.error(`  ✓ ${auction.external_auction_id}: $${data.current_bid_cents / 100}, ${data.bid_count || 0} bids`);
          results.synced++;
        } else {
          console.error(`  - ${auction.external_auction_id}: No bid data found`);
          results.unchanged++;
        }
      } catch (err) {
        console.error(`  ✗ ${auction.external_auction_id}: ${err.message}`);
        results.failed++;
      } finally {
        await page.close();
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }
  } finally {
    await browser.close();
  }

  console.error(`[sync] Done: ${results.synced} synced, ${results.unchanged} unchanged, ${results.failed} failed`);

  // Output results as JSON
  console.log(JSON.stringify({
    platform,
    auctions: auctions.length,
    ...results,
  }));
}

// Platforms that work with Playwright (Collecting Cars has aggressive Cloudflare)
const workingPlatforms = ['cars-and-bids', 'pcarmarket'];

// Main
const platform = process.argv[2] || 'all';

if (platform === 'all') {
  for (const p of workingPlatforms) {
    await syncPlatform(p);
  }
} else if (platform === 'collecting-cars') {
  console.error('[sync] Collecting Cars has aggressive anti-bot protection - skipping');
  console.error('[sync] Use a residential proxy or browser-as-a-service for this platform');
  console.log(JSON.stringify({ platform: 'collecting-cars', skipped: true, reason: 'cloudflare' }));
} else if (platformConfigs[platform]) {
  await syncPlatform(platform);
} else {
  console.error(`Unknown platform: ${platform}`);
  console.error(`Available: ${Object.keys(platformConfigs).join(', ')}, all`);
  process.exit(1);
}
