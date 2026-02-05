#!/usr/bin/env npx tsx
/**
 * Mecum Price Backfill
 *
 * Extracts sale prices from Mecum lot pages using Playwright.
 * Based on the working k26-priority-extract.ts approach.
 *
 * Usage:
 *   npx tsx scripts/mecum-backfill-prices.ts --limit 100
 *   npx tsx scripts/mecum-backfill-prices.ts --auction kissimmee-2024 --limit 500
 */
import { chromium, Browser } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getVehiclesWithoutPrices(limit: number, auctionSlug?: string) {
  let url = `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&sale_price=is.null&select=id,discovery_url,year,make,model&limit=${limit}`;

  if (auctionSlug) {
    url += `&discovery_url=ilike.*${auctionSlug}*`;
  }

  const res = await fetch(url, { headers: { 'apikey': SUPABASE_KEY! } });
  return res.json();
}

async function extractPriceFromPage(context: any, url: string): Promise<{
  sold: number | null;
  highBid: number | null;
  status: 'sold' | 'no_sale' | 'pending';
  lot: string | null;
  auction: string | null;
}> {
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {
      const text = document.body.innerText;

      // Look for sale price patterns
      const soldMatch = text.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
      const highBidMatch = text.match(/High\s*Bid\s*\$?([\d,]+)/i);
      const noSaleMatch = /No\s*Sale|Did\s*Not\s*Sell|Not\s*Sold/i.test(text);
      const lotMatch = text.match(/LOT\s+([A-Z]?\d+[-.]?\d*)/i);
      const auctionMatch = text.match(/(Kissimmee|Indy|Monterey|Glendale|Houston|Dallas|Las Vegas|Harrisburg|Chicago|Portland|Tulsa)\s*\d{4}/i);

      return {
        sold: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
        highBid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null,
        noSale: noSaleMatch,
        lot: lotMatch?.[1] || null,
        auction: auctionMatch?.[0] || null,
      };
    });

    let status: 'sold' | 'no_sale' | 'pending' = 'pending';
    if (data.sold) status = 'sold';
    else if (data.noSale) status = 'no_sale';

    return {
      sold: data.sold,
      highBid: data.highBid,
      status,
      lot: data.lot,
      auction: data.auction,
    };
  } finally {
    await page.close();
  }
}

async function updateVehicle(id: string, data: { sold?: number; highBid?: number; status: string }) {
  const updateData: any = {};

  if (data.sold) {
    updateData.sale_price = data.sold;
    updateData.sale_status = 'sold';
  } else if (data.highBid) {
    updateData.sale_price = data.highBid;
    updateData.sale_status = 'unsold'; // Had a high bid but didn't meet reserve
  } else if (data.status === 'no_sale') {
    updateData.sale_status = 'unsold';
  }

  if (Object.keys(updateData).length === 0) return false;

  updateData.updated_at = new Date().toISOString();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY!,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updateData),
  });

  return res.ok;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 100;
  let auctionSlug: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    } else if (args[i] === '--auction' && args[i + 1]) {
      auctionSlug = args[i + 1];
    }
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  Mecum Price Backfill');
  console.log(`  Limit: ${limit} | Auction: ${auctionSlug || 'all'}`);
  console.log('═══════════════════════════════════════════════\n');

  const vehicles = await getVehiclesWithoutPrices(limit, auctionSlug);
  console.log(`Found ${vehicles.length} vehicles without prices\n`);

  if (vehicles.length === 0) {
    console.log('No vehicles to process');
    return;
  }

  const browser = await chromium.launch({
    headless: true,
  });

  // Create a context with realistic settings
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let noPrice = 0;

  for (const v of vehicles) {
    processed++;
    process.stdout.write(`[${processed}/${vehicles.length}] ${v.year} ${v.make} ${v.model?.slice(0, 15).padEnd(15)} `);

    try {
      const data = await extractPriceFromPage(context, v.discovery_url);

      if (data.sold || data.highBid) {
        const success = await updateVehicle(v.id, data);
        if (success) {
          updated++;
          const price = data.sold || data.highBid;
          console.log(`✓ $${price!.toLocaleString()} (${data.status})`);
        } else {
          failed++;
          console.log('✗ update failed');
        }
      } else if (data.status === 'no_sale') {
        await updateVehicle(v.id, data);
        noPrice++;
        console.log('- no sale');
      } else {
        noPrice++;
        console.log('- no price found');
      }
    } catch (e: any) {
      failed++;
      console.log(`✗ ${e.message.slice(0, 50)}`);
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  await context.close();
  await browser.close();

  console.log('\n═══════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  Processed: ${processed}`);
  console.log(`  Updated with price: ${updated}`);
  console.log(`  No price/no sale: ${noPrice}`);
  console.log(`  Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════');
}

main().catch(console.error);
