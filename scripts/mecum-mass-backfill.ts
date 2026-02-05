#!/usr/bin/env npx tsx
/**
 * Mecum Mass Price Backfill
 *
 * Extracts sale prices from ALL Mecum vehicles missing prices.
 * Uses the same approach as k26-priority-extract.ts which worked.
 *
 * Run: nohup npx tsx scripts/mecum-mass-backfill.ts > /tmp/mecum-backfill.log 2>&1 &
 */
import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 100;

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Mecum Mass Price Backfill');
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════\n');

  // Get Mecum vehicles without prices
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&sale_price=is.null&select=id,discovery_url,year,make,model&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY! } }
  );
  const vehicles = await res.json();
  console.log(`Found ${vehicles.length} vehicles without prices\n`);

  if (vehicles.length === 0) {
    console.log('No vehicles to process');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  let processed = 0;
  let pricesFound = 0;
  let errors = 0;

  for (const v of vehicles) {
    processed++;
    const shortUrl = v.discovery_url?.split('/lots/')[1]?.slice(0, 30) || v.id.slice(0, 8);
    process.stdout.write(`[${processed}/${vehicles.length}] ${v.year || '????'} ${v.make || '???'} ${(v.model || '').slice(0, 12).padEnd(12)} `);

    const page = await browser.newPage();
    try {
      await page.goto(v.discovery_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);

      const data = await page.evaluate(() => {
        const text = document.body.innerText;
        const soldMatch = text.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
        const highBidMatch = text.match(/High\s*Bid\s*\$?([\d,]+)/i);
        const noSale = /No\s*Sale|Did\s*Not\s*Sell|Not\s*Sold/i.test(text);
        const auctionMatch = text.match(/(Kissimmee|Indy|Monterey|Glendale|Houston|Dallas|Las Vegas|Harrisburg|Chicago|Portland|Tulsa)\s*\d{4}/i);

        return {
          sold: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
          highBid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null,
          noSale,
          auction: auctionMatch?.[0] || null,
        };
      });

      // Determine price and status
      let salePrice = data.sold || data.highBid || null;
      let saleStatus = 'available';
      if (data.sold) saleStatus = 'sold';
      else if (data.noSale) saleStatus = 'unsold';
      else if (data.highBid) saleStatus = 'unsold'; // bid but didn't meet reserve

      if (salePrice) {
        // Update vehicle with price
        await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${v.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY!,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sale_price: salePrice,
            sale_status: saleStatus,
            updated_at: new Date().toISOString(),
          }),
        });
        pricesFound++;
        console.log(`✓ $${salePrice.toLocaleString()} (${saleStatus}) | ${data.auction || ''}`);
      } else if (data.noSale) {
        // Mark as unsold
        await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${v.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY!,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sale_status: 'unsold',
            updated_at: new Date().toISOString(),
          }),
        });
        console.log(`- no sale | ${data.auction || ''}`);
      } else {
        console.log(`- no price found`);
      }

    } catch (e: any) {
      errors++;
      console.log(`✗ ${e.message.slice(0, 40)}`);
    }
    await page.close();

    // Brief pause between requests
    await new Promise(r => setTimeout(r, 500));
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  Processed: ${processed}`);
  console.log(`  Prices found: ${pricesFound}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Finished: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════');
}

main().catch(console.error);
