/**
 * C&B HISTORICAL AUCTION DISCOVERY
 * =================================
 * Discovers all 33k+ past auctions from Cars & Bids via API interception
 * Uses Playwright to bypass Cloudflare, then captures API responses
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CONFIG = {
  SCROLL_DELAY: 1500,
  MAX_SCROLLS: 800,
  HEADLESS: false,  // Need visible browser to pass Cloudflare
};

interface DiscoveredAuction {
  id: string;
  url: string;
  title: string;
  subTitle: string;
  year?: number;
  make?: string;
  model?: string;
  location?: string;
  mileage?: string;
  noReserve?: boolean;
}

async function discoverAuctions(page: Page): Promise<DiscoveredAuction[]> {
  const allAuctions: DiscoveredAuction[] = [];
  const seenIds = new Set<string>();

  // Intercept API responses
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/v2/autos/auctions') && url.includes('status=closed')) {
      try {
        const json = await response.json();
        if (json.auctions && Array.isArray(json.auctions)) {
          for (const auction of json.auctions) {
            if (!seenIds.has(auction.id)) {
              seenIds.add(auction.id);

              // Parse year/make/model from title
              let year: number | undefined;
              let make: string | undefined;
              let model: string | undefined;
              const titleMatch = auction.title?.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
              if (titleMatch) {
                year = parseInt(titleMatch[1]);
                make = titleMatch[2];
                model = titleMatch[3];
              }

              allAuctions.push({
                id: auction.id,
                url: 'https://carsandbids.com/auctions/' + auction.id,
                title: auction.title || '',
                subTitle: auction.sub_title || '',
                year,
                make,
                model,
                location: auction.location,
                mileage: auction.mileage,
                noReserve: auction.no_reserve,
              });
            }
          }
          console.log('  API: +' + json.auctions.length + ' auctions (total: ' + allAuctions.length + '/' + json.total + ')');
        }
      } catch (e) {}
    }
  });

  console.log('Navigating to past-auctions page...');
  await page.goto('https://carsandbids.com/past-auctions/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  console.log('Scrolling to trigger API loads...');
  let lastCount = 0;
  let sameCountIterations = 0;

  for (let i = 0; i < CONFIG.MAX_SCROLLS; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(CONFIG.SCROLL_DELAY);

    if (allAuctions.length === lastCount) {
      sameCountIterations++;
      if (sameCountIterations >= 15) {
        console.log('No new auctions after 15 scrolls. Done.');
        break;
      }
    } else {
      sameCountIterations = 0;
      lastCount = allAuctions.length;
    }

    if ((i + 1) % 100 === 0) {
      console.log('  Scroll ' + (i + 1) + ': ' + allAuctions.length + ' auctions');
    }
  }

  return allAuctions;
}

async function saveDiscoveredAuctions(auctions: DiscoveredAuction[]): Promise<void> {
  console.log('\nPreparing to save ' + auctions.length + ' discovered auctions...');

  const existingUrls = new Set<string>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('vehicles')
      .select('listing_url')
      .ilike('listing_url', '%carsandbids%')
      .range(offset, offset + 1000);

    if (!data || data.length === 0) break;
    data.forEach(v => { if (v.listing_url) existingUrls.add(v.listing_url); });
    offset += 1000;
  }

  console.log('Found ' + existingUrls.size + ' existing C&B vehicles in database');

  const newAuctions = auctions.filter(a => !existingUrls.has(a.url));
  console.log('New auctions to add: ' + newAuctions.length);

  if (newAuctions.length === 0) {
    console.log('No new auctions to add.');
    return;
  }

  let created = 0;
  let errors = 0;

  for (let i = 0; i < newAuctions.length; i += 25) {
    const batch = newAuctions.slice(i, i + 25).map(a => ({
      year: a.year || null,
      make: a.make || 'Unknown',
      model: a.model || 'Unknown',
      listing_url: a.url,
      location: a.location || null,
      mileage: a.mileage ? parseInt(a.mileage.replace(/[^\d]/g, '')) : null,
      status: 'pending_backfill',
      discovery_url: a.url,
    }));

    const { error } = await supabase.from('vehicles').insert(batch);
    if (error) {
      for (const v of batch) {
        const { error: e } = await supabase.from('vehicles').insert(v);
        if (!e) created++;
        else if (!e?.message.includes('duplicate')) errors++;
      }
    } else {
      created += batch.length;
    }

    if ((i + 25) % 500 < 25) {
      console.log('  Progress: ' + created + ' created, ' + errors + ' errors');
    }
  }

  console.log('\nDone: ' + created + ' new vehicles created, ' + errors + ' errors');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  C&B HISTORICAL AUCTION DISCOVERY');
  console.log('  Target: ~33,877 auctions');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({
    headless: CONFIG.HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  const page = await context.newPage();

  try {
    const auctions = await discoverAuctions(page);
    console.log('\n✅ Discovered ' + auctions.length + ' total auctions\n');

    console.log('Sample:');
    auctions.slice(0, 5).forEach(a => {
      console.log('  ' + a.year + ' ' + a.make + ' ' + a.model + ' (' + a.location + ')');
    });

    await saveDiscoveredAuctions(auctions);
  } finally {
    await browser.close();
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  DISCOVERY COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
