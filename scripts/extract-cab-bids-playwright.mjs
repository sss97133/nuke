/**
 * extract-cab-bids-playwright.mjs
 * 
 * Extracts bid history from C&B auction pages using Playwright (no Firecrawl needed).
 * Playwright bypasses Cloudflare with a real browser.
 *
 * Usage:
 *   node scripts/extract-cab-bids-playwright.mjs --file urls.txt
 *   node scripts/extract-cab-bids-playwright.mjs <single-url>
 *   node scripts/extract-cab-bids-playwright.mjs --scan --limit 50
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load env via dotenvx (run with: dotenvx run -- node scripts/...)
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Parse bids from page DOM ──────────────────────────────────────

async function extractBidsFromPage(page) {
  // Click "Bid History" tab
  try {
    const bidBtn = await page.$('button[data-ga="bids"], button[data-filter="4"]');
    if (bidBtn) {
      await bidBtn.click();
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    console.log('  Could not click bid history tab');
  }

  // Scroll to load all bids
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  // Extract bids directly from DOM
  const bids = await page.$$eval('li.bid', (bidEls) => {
    return bidEls.map(el => {
      const userLink = el.querySelector('a.user');
      const bidValueEl = el.querySelector('dd.bid-value');
      if (!userLink || !bidValueEl) return null;

      const username = userLink.textContent?.trim() || '';
      const bidText = bidValueEl.textContent?.trim() || '';
      const amountMatch = bidText.match(/\$?([\d,]+)/);
      if (!username || !amountMatch) return null;

      const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
      if (!amount || amount <= 0) return null;

      const href = userLink.getAttribute('href') || '';
      const profileUrl = href.startsWith('http') ? href : href ? `https://carsandbids.com${href}` : null;

      return { username, amount, profileUrl };
    }).filter(Boolean);
  });

  // C&B shows highest first — reverse to chronological
  bids.reverse();
  return bids.map((b, i) => ({
    bidder_username: b.username,
    bid_amount: b.amount,
    bid_number: i + 1,
    profile_url: b.profileUrl,
  }));
}

// ─── Extract auction metadata ──────────────────────────────────────

async function extractAuctionMeta(page) {
  return page.evaluate(() => {
    const meta = {};
    // End date
    const timeEnded = document.querySelector('.time-ended');
    if (timeEnded) meta.endDate = timeEnded.textContent?.trim();
    // Bid count from bar
    const numBids = document.querySelector('.num-bids .value');
    if (numBids) meta.totalBids = parseInt(numBids.textContent?.trim() || '0');
    // Final bid
    const bidValue = document.querySelector('.bid-bar .bid-value');
    if (bidValue) meta.finalBid = bidValue.textContent?.trim();
    return meta;
  });
}

// ─── Process one URL ───────────────────────────────────────────────

async function extractBidsForUrl(page, url) {
  console.log(`\n--- ${url}`);

  // Resolve vehicle_id
  let vehicleId = null;
  let auctionEventId = null;

  const { data: ae } = await supabase
    .from('auction_events')
    .select('id, vehicle_id')
    .eq('source', 'cars_and_bids')
    .eq('source_url', url)
    .limit(1)
    .maybeSingle();

  if (ae) {
    auctionEventId = ae.id;
    vehicleId = ae.vehicle_id;
  }

  if (!vehicleId) {
    const { data: el } = await supabase
      .from('external_listings')
      .select('vehicle_id')
      .eq('platform', 'carsandbids')
      .eq('listing_url', url)
      .limit(1)
      .maybeSingle();
    if (el?.vehicle_id) vehicleId = el.vehicle_id;
  }

  if (!vehicleId) {
    const urlPath = url.replace(/^https?:\/\/[^/]+/, '');
    const { data: v } = await supabase
      .from('vehicles')
      .select('id')
      .ilike('discovery_url', `%${urlPath}%`)
      .limit(1)
      .maybeSingle();
    if (v?.id) vehicleId = v.id;
  }

  if (!vehicleId) {
    console.log('  No vehicle found, skipping');
    return { success: false, bids: 0, error: 'no_vehicle' };
  }

  // Check existing bids
  const { count: existingBids } = await supabase
    .from('external_auction_bids')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
    .eq('platform', 'cars_and_bids');

  if (existingBids && existingBids > 2) {
    console.log(`  Already have ${existingBids} bids, skipping`);
    return { success: true, bids: existingBids, vehicle_id: vehicleId };
  }

  // Navigate and extract
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log(`  Navigation error: ${e.message?.slice(0, 60)}`);
    return { success: false, bids: 0, error: 'nav_error', vehicle_id: vehicleId };
  }

  // Check for Cloudflare
  const title = await page.title();
  if (title.includes('moment') || title.includes('Cloudflare')) {
    await page.waitForTimeout(8000);
    const newTitle = await page.title();
    if (newTitle.includes('moment')) {
      console.log('  Cloudflare block, skipping');
      return { success: false, bids: 0, error: 'cloudflare', vehicle_id: vehicleId };
    }
  }

  const bids = await extractBidsFromPage(page);
  console.log(`  Found ${bids.length} bids`);

  if (bids.length === 0) {
    return { success: true, bids: 0, vehicle_id: vehicleId };
  }

  // Get auction end date for synthetic timestamps
  let auctionEndDate = new Date();
  const meta = await extractAuctionMeta(page);
  if (meta.endDate) {
    const parsed = new Date(meta.endDate);
    if (!isNaN(parsed.getTime())) auctionEndDate = parsed;
  } else if (auctionEventId) {
    const { data: aeData } = await supabase
      .from('auction_events')
      .select('auction_end_date')
      .eq('id', auctionEventId)
      .maybeSingle();
    if (aeData?.auction_end_date) {
      auctionEndDate = new Date(aeData.auction_end_date);
    }
  }

  // Synthetic timestamps spread across 48 hours before auction end
  const auctionEndMs = auctionEndDate.getTime();
  const bidWindowMs = 48 * 60 * 60 * 1000;
  const interval = bidWindowMs / (bids.length + 1);

  // Delete existing and insert new
  await supabase
    .from('external_auction_bids')
    .delete()
    .eq('vehicle_id', vehicleId)
    .eq('platform', 'cars_and_bids');

  const rows = bids.map(b => ({
    vehicle_id: vehicleId,
    platform: 'cars_and_bids',
    bid_amount: b.bid_amount,
    bid_timestamp: new Date(auctionEndMs - bidWindowMs + b.bid_number * interval).toISOString(),
    bidder_username: b.bidder_username,
    bid_number: b.bid_number,
    is_winning_bid: b.bid_number === bids.length,
    source: 'extract-cab-bids-pw',
    raw_data: { profile_url: b.profile_url, auction_url: url },
  }));

  const { error: insertErr } = await supabase
    .from('external_auction_bids')
    .insert(rows);

  if (insertErr) {
    console.error(`  Insert error: ${insertErr.message}`);
    return { success: false, bids: 0, error: insertErr.message, vehicle_id: vehicleId };
  }

  // Update auction_event bid_history
  if (auctionEventId) {
    await supabase
      .from('auction_events')
      .update({
        bid_history: bids.map(b => ({
          amount: b.bid_amount,
          bidder: b.bidder_username,
          bid_number: b.bid_number,
        })),
      })
      .eq('id', auctionEventId);
  }

  console.log(`  Inserted ${bids.length} bids: $${bids[0].bid_amount} → $${bids[bids.length - 1].bid_amount}`);
  return { success: true, bids: bids.length, vehicle_id: vehicleId };
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let urls = [];

  if (args.includes('--file')) {
    const filePath = args[args.indexOf('--file') + 1];
    urls = readFileSync(filePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l.includes('carsandbids.com'));
  } else if (args.includes('--scan')) {
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 50;
    
    const { data: candidates } = await supabase
      .from('auction_events')
      .select('source_url')
      .eq('source', 'cars_and_bids')
      .not('source_url', 'is', null)
      .not('vehicle_id', 'is', null)
      .or('bid_history.is.null')
      .limit(limit);
    
    urls = (candidates || []).map(c => c.source_url).filter(Boolean);
  } else if (args[0]?.includes('carsandbids.com')) {
    urls = [args[0]];
  } else {
    console.log('Usage:\n  dotenvx run -- node scripts/extract-cab-bids-playwright.mjs --file urls.txt\n  dotenvx run -- node scripts/extract-cab-bids-playwright.mjs --scan --limit 50\n  dotenvx run -- node scripts/extract-cab-bids-playwright.mjs <URL>');
    process.exit(0);
  }

  console.log(`Processing ${urls.length} URLs with Playwright...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let extracted = 0;
  let totalBids = 0;
  let failed = 0;

  for (let i = 0; i < urls.length; i++) {
    console.log(`[${i + 1}/${urls.length}]`);
    try {
      const result = await extractBidsForUrl(page, urls[i]);
      if (result.success && result.bids > 0) {
        extracted++;
        totalBids += result.bids;
      } else if (!result.success) {
        failed++;
      }
    } catch (e) {
      console.error(`  Fatal: ${e.message?.slice(0, 80)}`);
      failed++;
    }
    // Small delay between requests
    await page.waitForTimeout(500);
  }

  await browser.close();
  console.log(`\nDone: ${extracted} extracted, ${totalBids} bids, ${failed} failed out of ${urls.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
