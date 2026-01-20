/**
 * Live Auction Extractor
 *
 * Extracts LIVE auction data from major auction sites:
 * - Current bid
 * - Auction end time
 * - Bid count
 * - Reserve status
 *
 * Focuses on quality extraction - one complete profile per source.
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface LiveAuction {
  source: string;
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  image_url: string | null;
  current_bid_cents: number | null;
  bid_count: number | null;
  auction_end_time: string | null;
  reserve_status: 'no_reserve' | 'reserve' | 'reserve_met' | 'reserve_not_met' | null;
  time_remaining: string | null;
}

// Source-specific extractors
const extractors: Record<string, (page: Page) => Promise<LiveAuction[]>> = {

  // Bring a Trailer
  'bringatrailer.com': async (page: Page): Promise<LiveAuction[]> => {
    await page.goto('https://bringatrailer.com/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Scroll to load content
    for (let i = 0; i < 3; i++) {
      await page.evaluate((i) => window.scrollTo(0, 500 * (i + 1)), i);
      await page.waitForTimeout(500);
    }

    const auctions = await page.evaluate(() => {
      const items: any[] = [];
      // Try multiple selector patterns
      const cards = document.querySelectorAll('.listing-card, [class*="listing-card"], [class*="auction-item"], a[href*="/listing/"]');

      console.log('BaT: Found', cards.length, 'potential cards');

      for (const el of Array.from(cards).slice(0, 15)) {
        // Get the card container
        const card = el.closest('.listing-card') || el.closest('[class*="listing"]') || el;

        // Find link
        const linkEl = (card.tagName === 'A' ? card : card.querySelector('a[href*="/listing/"]')) as HTMLAnchorElement;
        if (!linkEl?.href) continue;

        // Find title - try multiple patterns
        const titleEl = card.querySelector('h3, h2, [class*="title"], [class*="name"]');
        const title = titleEl?.textContent?.trim() || linkEl.textContent?.trim() || '';
        if (!title || title.length < 5) continue;

        // Find image
        const imgEl = card.querySelector('img') as HTMLImageElement;
        const imgSrc = imgEl?.src || imgEl?.getAttribute('data-src') || null;

        // Find bid info - look in entire card text
        const cardText = card.textContent || '';

        // Parse bid amount ($XX,XXX format)
        const bidMatch = cardText.match(/\$\s*([\d,]+)/);
        const bidAmount = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) * 100 : null;

        // Parse bid count
        const bidCountMatch = cardText.match(/(\d+)\s*bids?/i);
        const bidCount = bidCountMatch ? parseInt(bidCountMatch[1]) : null;

        // Time remaining
        const timeMatch = cardText.match(/(\d+[dhms]\s*)+/i) || cardText.match(/(ending|ends)\s+(\w+)/i);
        const timeText = timeMatch ? timeMatch[0] : '';

        // Reserve status
        let reserveStatus = null;
        const lowerText = cardText.toLowerCase();
        if (lowerText.includes('no reserve')) reserveStatus = 'no_reserve';
        else if (lowerText.includes('reserve met')) reserveStatus = 'reserve_met';

        items.push({
          url: linkEl.href,
          title,
          image_url: imgSrc,
          current_bid_cents: bidAmount,
          bid_count: bidCount,
          time_remaining: timeText,
          reserve_status: reserveStatus,
        });
      }
      return items;
    });

    // Dedupe by URL
    const seen = new Set<string>();
    const unique = auctions.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    return unique.map(a => ({
      source: 'Bring a Trailer',
      ...a,
      year: parseYear(a.title),
      make: parseMake(a.title),
      model: parseModel(a.title, parseMake(a.title)),
      auction_end_time: null,
    }));
  },

  // Collecting Cars
  'collectingcars.com': async (page: Page): Promise<LiveAuction[]> => {
    await page.goto('https://collectingcars.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const auctions = await page.evaluate(() => {
      const items: any[] = [];
      const cards = document.querySelectorAll('[class*="listing-tile"], [class*="auction-card"]');

      for (const card of Array.from(cards).slice(0, 10)) {
        const titleEl = card.querySelector('h2, h3, [class*="title"]');
        const bidEl = card.querySelector('[class*="bid"], [class*="price"]');
        const timeEl = card.querySelector('[class*="time"], [class*="countdown"]');
        const imgEl = card.querySelector('img') as HTMLImageElement;
        const linkEl = card.querySelector('a') as HTMLAnchorElement;

        const title = titleEl?.textContent?.trim() || '';
        const bidText = bidEl?.textContent?.trim() || '';
        const timeText = timeEl?.textContent?.trim() || '';

        // Parse bid
        const bidMatch = bidText.match(/[£€$]?([\d,]+)/);
        const bidAmount = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) * 100 : null;

        // Parse bid count
        const bidCountMatch = bidText.match(/(\d+)\s*bids?/i);
        const bidCount = bidCountMatch ? parseInt(bidCountMatch[1]) : null;

        if (title && linkEl?.href) {
          items.push({
            url: linkEl.href,
            title,
            image_url: imgEl?.src || imgEl?.getAttribute('data-src') || null,
            current_bid_cents: bidAmount,
            bid_count: bidCount,
            time_remaining: timeText,
            reserve_status: null,
          });
        }
      }
      return items;
    });

    return auctions.map(a => ({
      source: 'Collecting Cars',
      ...a,
      year: parseYear(a.title),
      make: parseMake(a.title),
      model: parseModel(a.title, parseMake(a.title)),
      auction_end_time: null,
    }));
  },

  // Cars & Bids (Doug DeMuro)
  'carsandbids.com': async (page: Page): Promise<LiveAuction[]> => {
    await page.goto('https://carsandbids.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const auctions = await page.evaluate(() => {
      const items: any[] = [];
      const cards = document.querySelectorAll('.auction-item, .auction-card, li.auction-item');

      for (const card of Array.from(cards).slice(0, 10)) {
        const titleEl = card.querySelector('.auction-title, h2, h3');
        const bidEl = card.querySelector('.current-bid, .bid-amount, .price');
        const timeEl = card.querySelector('.time-left, .countdown, .ending');
        const imgEl = card.querySelector('img') as HTMLImageElement;
        const linkEl = card.querySelector('a[href*="/auctions/"]') as HTMLAnchorElement;

        const title = titleEl?.textContent?.trim() || '';
        const bidText = bidEl?.textContent?.trim() || '';
        const timeText = timeEl?.textContent?.trim() || '';

        const bidMatch = bidText.match(/\$?([\d,]+)/);
        const bidAmount = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) * 100 : null;

        const bidCountMatch = card.textContent?.match(/(\d+)\s*bids?/i);
        const bidCount = bidCountMatch ? parseInt(bidCountMatch[1]) : null;

        const cardText = card.textContent?.toLowerCase() || '';
        let reserveStatus = null;
        if (cardText.includes('no reserve')) reserveStatus = 'no_reserve';
        else if (cardText.includes('reserve met')) reserveStatus = 'reserve_met';

        if (title && linkEl?.href) {
          items.push({
            url: linkEl.href,
            title,
            image_url: imgEl?.src || null,
            current_bid_cents: bidAmount,
            bid_count: bidCount,
            time_remaining: timeText,
            reserve_status: reserveStatus,
          });
        }
      }
      return items;
    });

    return auctions.map(a => ({
      source: 'Cars & Bids',
      ...a,
      year: parseYear(a.title),
      make: parseMake(a.title),
      model: parseModel(a.title, parseMake(a.title)),
      auction_end_time: null,
    }));
  },

  // PCarMarket (Porsche-focused)
  'pcarmarket.com': async (page: Page): Promise<LiveAuction[]> => {
    await page.goto('https://www.pcarmarket.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const auctions = await page.evaluate(() => {
      const items: any[] = [];
      const cards = document.querySelectorAll('.pcar-vehicle-info, .auction-listing');

      for (const card of Array.from(cards).slice(0, 10)) {
        const titleEl = card.querySelector('h2, h3, .vehicle-title');
        const bidEl = card.querySelector('.current-bid, .bid-amount');
        const timeEl = card.querySelector('.time-remaining, .countdown');
        const imgEl = card.querySelector('img') as HTMLImageElement;
        const linkEl = card.querySelector('a') as HTMLAnchorElement;

        const title = titleEl?.textContent?.trim() || '';
        const bidText = bidEl?.textContent?.trim() || '';
        const timeText = timeEl?.textContent?.trim() || '';

        const bidMatch = bidText.match(/\$?([\d,]+)/);
        const bidAmount = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) * 100 : null;

        if (title && linkEl?.href) {
          items.push({
            url: linkEl.href,
            title,
            image_url: imgEl?.src || null,
            current_bid_cents: bidAmount,
            bid_count: null,
            time_remaining: timeText,
            reserve_status: null,
          });
        }
      }
      return items;
    });

    return auctions.map(a => ({
      source: 'PCarMarket',
      ...a,
      year: parseYear(a.title),
      make: parseMake(a.title) || 'Porsche',
      model: parseModel(a.title, 'Porsche'),
      auction_end_time: null,
    }));
  },
};

// Parsing helpers
function parseYear(title: string): number | null {
  const match = title.match(/\b(19[1-9]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1]) : null;
}

function parseMake(title: string): string | null {
  const makes = [
    'Porsche', 'Ferrari', 'Lamborghini', 'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi',
    'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac',
    'Jaguar', 'Aston Martin', 'Bentley', 'Rolls-Royce', 'Maserati', 'Alfa Romeo',
    'Toyota', 'Nissan', 'Honda', 'Mazda', 'Datsun', 'Lexus', 'Acura',
    'Jeep', 'Land Rover', 'Range Rover', 'McLaren', 'Lotus', 'MG', 'Triumph',
  ];

  for (const make of makes) {
    if (new RegExp(`\\b${make}\\b`, 'i').test(title)) {
      return make === 'Chevy' ? 'Chevrolet' : make;
    }
  }
  return null;
}

function parseModel(title: string, make: string | null): string | null {
  if (!make) return null;
  const afterMake = title.split(new RegExp(make, 'i'))[1];
  if (!afterMake) return null;

  const model = afterMake.trim().split(/\s+/).slice(0, 3).join(' ')
    .replace(/[^\w\s-]/g, '').trim();
  return model.length > 1 ? model : null;
}

async function saveLiveAuction(auction: LiveAuction): Promise<boolean> {
  // Check if vehicle exists
  const { data: existingVehicle } = await supabase
    .from('vehicles')
    .select('id')
    .eq('listing_url', auction.url)
    .limit(1);

  const vehicleData = {
    year: auction.year,
    make: auction.make || 'Unknown',
    model: auction.model || 'Unknown',
    listing_url: auction.url,
    listing_title: auction.title,
    listing_source: 'live_auction_extractor',
    primary_image_url: auction.image_url,
    // Live auction fields
    high_bid: auction.current_bid_cents ? auction.current_bid_cents / 100 : null,
    bid_count: auction.bid_count,
    auction_end_date: auction.auction_end_time,
    auction_source: auction.source,
    reserve_status: auction.reserve_status,
    sale_status: 'auction_live',
    updated_at: new Date().toISOString(),
  };

  if (existingVehicle && existingVehicle.length > 0) {
    // Update existing
    const { error } = await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', existingVehicle[0].id);

    if (error) {
      console.log(`    ✗ Failed to update: ${error.message}`);
      return false;
    }
  } else {
    // Create new
    const { error } = await supabase
      .from('vehicles')
      .insert(vehicleData);

    if (error) {
      console.log(`    ✗ Failed to create: ${error.message}`);
      return false;
    }
  }

  return true;
}

async function main() {
  console.log('='.repeat(60));
  console.log('LIVE AUCTION EXTRACTOR');
  console.log('Capturing live auction data from major sites');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  const results: { source: string; extracted: number; saved: number }[] = [];

  for (const [domain, extractor] of Object.entries(extractors)) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Source: ${domain}`);

    try {
      const page = await context.newPage();
      const auctions = await extractor(page);
      await page.close();

      console.log(`  📊 Extracted ${auctions.length} live auctions`);

      let saved = 0;
      for (const auction of auctions.slice(0, 5)) { // Save up to 5 per source
        console.log(`    → ${auction.title?.substring(0, 50)}...`);
        if (auction.current_bid_cents) {
          console.log(`      Bid: $${(auction.current_bid_cents / 100).toLocaleString()}`);
        }
        if (auction.bid_count) {
          console.log(`      Bids: ${auction.bid_count}`);
        }
        if (auction.time_remaining) {
          console.log(`      Time: ${auction.time_remaining}`);
        }
        if (auction.reserve_status) {
          console.log(`      Reserve: ${auction.reserve_status}`);
        }

        if (await saveLiveAuction(auction)) {
          saved++;
        }
      }

      console.log(`  ✅ Saved ${saved}/${auctions.length} auctions`);
      results.push({ source: domain, extracted: auctions.length, saved });

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
      results.push({ source: domain, extracted: 0, saved: 0 });
    }
  }

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  for (const r of results) {
    console.log(`  ${r.source}: ${r.saved} saved / ${r.extracted} extracted`);
  }

  const totalSaved = results.reduce((sum, r) => sum + r.saved, 0);
  console.log(`\nTotal live auctions captured: ${totalSaved}`);
}

main().catch(console.error);
