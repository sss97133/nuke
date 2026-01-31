#!/usr/bin/env npx tsx
/**
 * Mecum Results Importer
 *
 * Scrapes Mecum results pages after auction days
 * Updates vehicles with sale prices
 * Triggers market settlements
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AUCTION_SLUG = process.argv[2] || 'kissimmee-2026';

interface Result {
  lotNumber: string;
  url: string;
  title: string;
  soldPrice: number | null;
  highBid: number | null;
  outcome: 'sold' | 'not_sold' | 'bid_to';
}

async function scrapeResultsPage(page: any, pageNum: number): Promise<Result[]> {
  const url = `https://www.mecum.com/auctions/${AUCTION_SLUG}/results/?page=${pageNum}`;

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const results: any[] = [];

    // Find result cards
    document.querySelectorAll('[class*="lot"], [class*="result"], article').forEach(card => {
      const text = card.textContent || '';
      const link = card.querySelector('a[href*="/lots/"]') as HTMLAnchorElement;
      if (!link) return;

      const lotMatch = text.match(/LOT\s*([A-Z]?\d+)/i);
      const soldMatch = text.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
      const bidMatch = text.match(/(?:High\s*Bid|Bid\s*To)\s*\$?([\d,]+)/i);
      const noSaleMatch = text.match(/No\s*Sale|Did\s*Not\s*Sell/i);

      let outcome: string = 'sold';
      let soldPrice: number | null = null;
      let highBid: number | null = null;

      if (soldMatch) {
        soldPrice = parseInt(soldMatch[1].replace(/,/g, ''));
        outcome = 'sold';
      } else if (noSaleMatch) {
        outcome = 'not_sold';
        if (bidMatch) {
          highBid = parseInt(bidMatch[1].replace(/,/g, ''));
          outcome = 'bid_to';
        }
      } else if (bidMatch) {
        highBid = parseInt(bidMatch[1].replace(/,/g, ''));
        outcome = 'bid_to';
      }

      if (lotMatch) {
        results.push({
          lotNumber: lotMatch[1],
          url: link.href.split('?')[0],
          title: card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim() || '',
          soldPrice,
          highBid,
          outcome,
        });
      }
    });

    return results;
  });
}

async function updateVehicleAndSettle(result: Result) {
  // Find vehicle by lot URL
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id')
    .ilike('discovery_url', `%${result.url.split('/lots/')[1]?.split('/')[0]}%`)
    .limit(1);

  if (!vehicles?.length) {
    console.log(`  Vehicle not found for ${result.lotNumber}`);
    return false;
  }

  const vehicleId = vehicles[0].id;

  // Update vehicle with sale price
  const updateData: any = {};
  if (result.soldPrice) updateData.sale_price = result.soldPrice;
  else if (result.highBid) updateData.sale_price = result.highBid;

  if (Object.keys(updateData).length > 0) {
    await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicleId);
  }

  // Update auction event
  await supabase
    .from('auction_events')
    .update({
      outcome: result.outcome === 'sold' ? 'sold' :
               result.outcome === 'bid_to' ? 'bid_to' : 'no_sale',
      winning_bid: result.soldPrice,
      high_bid: result.highBid,
    })
    .eq('vehicle_id', vehicleId)
    .eq('source', 'mecum');

  // Find and settle betting markets for this vehicle
  const { data: markets } = await supabase
    .from('betting_markets')
    .select('id, line_value, market_type')
    .eq('vehicle_id', vehicleId)
    .eq('status', 'locked');

  for (const market of markets || []) {
    let outcome: string;
    let resolutionValue = result.soldPrice || result.highBid || 0;

    if (market.market_type === 'auction_over_under') {
      if (result.outcome === 'not_sold') {
        outcome = 'no'; // Didn't sell = under
        resolutionValue = 0;
      } else {
        outcome = resolutionValue > market.line_value ? 'yes' : 'no';
      }
    } else if (market.market_type === 'auction_will_sell') {
      outcome = result.outcome === 'sold' ? 'yes' : 'no';
    } else {
      continue;
    }

    // Call settlement
    const { data, error } = await supabase.rpc('settle_market', {
      p_market_id: market.id,
      p_outcome: outcome,
      p_resolution_value: resolutionValue,
    });

    if (error) {
      console.log(`  Settlement error for market ${market.id}: ${error.message}`);
    } else {
      console.log(`  ✓ Settled market: ${outcome.toUpperCase()} at $${resolutionValue.toLocaleString()}`);
    }
  }

  return true;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log(`  Mecum Results Importer - ${AUCTION_SLUG}`);
  console.log('═══════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let totalResults = 0;
  let totalSettled = 0;

  for (let pageNum = 1; pageNum <= 50; pageNum++) {
    console.log(`Page ${pageNum}...`);

    const results = await scrapeResultsPage(page, pageNum);

    if (results.length === 0) {
      console.log('  No more results');
      break;
    }

    for (const result of results) {
      console.log(`  Lot ${result.lotNumber}: ${result.outcome} ${
        result.soldPrice ? `$${result.soldPrice.toLocaleString()}` :
        result.highBid ? `bid $${result.highBid.toLocaleString()}` : ''
      }`);

      const settled = await updateVehicleAndSettle(result);
      if (settled) totalSettled++;
      totalResults++;
    }
  }

  await browser.close();

  console.log(`\n✅ Done! ${totalResults} results processed, ${totalSettled} vehicles updated`);
}

main().catch(console.error);
