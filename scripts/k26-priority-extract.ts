#!/usr/bin/env npx tsx
/**
 * Priority extraction for Kissimmee 2026 lots
 * Processes high lot numbers (115xxxx, 116xxxx) first
 */
import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH = 200;

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Kissimmee 2026 Priority Extraction');
  console.log('═══════════════════════════════════════════════\n');

  // Get Kissimmee 2026 pending (high lot numbers)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.pending&or=(discovery_url.ilike.*lots/115*,discovery_url.ilike.*lots/116*)&select=id,discovery_url,year,make,model&limit=${BATCH}`,
    { headers: { 'apikey': SUPABASE_KEY! } }
  );
  const vehicles = await res.json();
  console.log(`Found ${vehicles.length} Kissimmee 2026 pending vehicles\n`);

  if (vehicles.length === 0) {
    console.log('No K26 vehicles to process');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  let processed = 0;
  let events = 0;

  for (const v of vehicles) {
    const page = await browser.newPage();
    try {
      await page.goto(v.discovery_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);

      const data = await page.evaluate(() => {
        const text = document.body.innerText;
        const title = document.querySelector('h1')?.innerText || '';
        const vinMatch = text.match(/VIN[^\w]*([A-Z0-9]{11,17})/i);
        const auctionMatch = text.match(/\/\/\s*([A-Z]+\s+\d{4})/i);
        const lotMatch = text.match(/LOT\s+([A-Z]?\d+)/i);
        const soldMatch = text.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
        const highBidMatch = text.match(/High\s*Bid\s*\$?([\d,]+)/i);
        const engineMatch = text.match(/ENGINE[:\s]+([^\n]+)/i);
        const colorMatch = text.match(/EXTERIOR[:\s]+([^\n]+)/i);
        const mileMatch = text.match(/ODOMETER[^\d]*([\d,]+)/i);

        const images = [...document.querySelectorAll('img[src*="mecum"]')]
          .map(i => (i as HTMLImageElement).src)
          .filter(s => s.includes('upload'))
          .slice(0, 15);

        return {
          title: title.split('|')[0].trim(),
          vin: vinMatch?.[1],
          auction: auctionMatch?.[1] || 'Kissimmee 2026',
          lot: lotMatch?.[1],
          sold: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
          highBid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null,
          engine: engineMatch?.[1]?.trim(),
          color: colorMatch?.[1]?.trim(),
          mileage: mileMatch ? parseInt(mileMatch[1].replace(/,/g, '')) : null,
          images,
        };
      });

      // Update vehicle
      const updateData: any = {
        status: 'active',
      };
      if (data.vin) updateData.vin = data.vin;
      if (data.sold) updateData.sale_price = data.sold;
      else if (data.highBid) updateData.sale_price = data.highBid;
      if (data.engine) updateData.engine_size = data.engine;
      if (data.color) updateData.color = data.color;
      if (data.mileage) updateData.mileage = data.mileage;
      if (data.images[0]) updateData.primary_image_url = data.images[0];

      await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${v.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY!,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      // Create auction event
      // Determine outcome: sold, bid_to, or pending
      let outcome = 'pending';
      if (data.sold) outcome = 'sold';
      else if (data.highBid) outcome = 'bid_to';

      const eventRes = await fetch(`${SUPABASE_URL}/rest/v1/auction_events`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY!,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          vehicle_id: v.id,
          source: 'mecum',
          source_url: v.discovery_url,
          lot_number: data.lot,
          outcome,
          high_bid: data.highBid,
          winning_bid: data.sold,
          raw_data: { auction_name: data.auction, extractor: 'k26-priority' },
        }),
      });

      if (eventRes.ok) events++;
      processed++;

      const status = [
        data.vin ? 'VIN' : '',
        data.mileage ? 'mi' : '',
        data.engine ? 'eng' : '',
        data.sold ? `$${(data.sold/1000).toFixed(0)}k` : '',
        `${data.images.length}img`,
      ].filter(Boolean).join(',');

      console.log(`✓ ${v.year} ${v.make} ${v.model?.slice(0,15)} | ${data.auction} | ${status}`);

    } catch (e: any) {
      console.log(`✗ ${v.discovery_url.slice(-40)}: ${e.message.slice(0, 40)}`);
    }
    await page.close();
  }

  await browser.close();

  console.log(`\n✅ Processed: ${processed} | Events: ${events}`);
}

main().catch(console.error);
