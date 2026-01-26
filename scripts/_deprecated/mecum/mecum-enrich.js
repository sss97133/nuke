#!/usr/bin/env node
/**
 * Mecum DETAIL ENRICHMENT - Scrape full vehicle details
 * Visits each discovery_url and extracts all available fields
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const PARALLEL = parseInt(process.argv[3]) || 2;

async function getVehiclesToEnrich() {
  console.log('Finding Mecum vehicles needing enrichment...');
  
  // Get vehicles with discovery_url but missing key fields (vin, mileage, etc)
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&vin=is.null&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const vehicles = await res.json();
  console.log(`Found ${vehicles.length} vehicles to enrich\n`);
  return vehicles;
}

async function scrapeDetailPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      // Helper to find value after label
      const findAfter = (label) => {
        const regex = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
        const match = bodyText.match(regex);
        return match?.[1]?.trim() || null;
      };
      
      // VIN/Serial
      const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);
      
      // Mileage
      const mileageMatch = bodyText.match(/ODOMETER[^\\d]*([\d,]+)/i);
      
      // Specs section
      const engine = findAfter('ENGINE');
      const transmission = findAfter('TRANSMISSION');
      const exteriorColor = findAfter('EXTERIOR COLOR');
      const interiorColor = findAfter('INTERIOR COLOR');
      
      // Price - look for "Sold" price
      const soldMatch = bodyText.match(/Sold[^$]*\$([\d,]+)/i);
      const bidMatch = bodyText.match(/High Bid[^$]*\$([\d,]+)/i);
      
      // Highlights
      const highlightsSection = bodyText.match(/HIGHLIGHTS([\s\S]*?)(?:PHOTOS|EQUIPMENT|Information found)/i);
      const highlights = highlightsSection?.[1]
        ?.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 5 && s.length < 200)
        .slice(0, 10) || [];
      
      // Equipment
      const equipmentSection = bodyText.match(/EQUIPMENT([\s\S]*?)(?:Information found|PHOTOS|All rights)/i);
      const equipment = equipmentSection?.[1]
        ?.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 5 && s.length < 200)
        .slice(0, 10) || [];
      
      // Images - look for high-res gallery images
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src)
        .filter(s => s && s.includes('mecum') && (s.includes('upload') || s.includes('auctions')))
        .filter(s => !s.includes('logo') && !s.includes('icon') && !s.includes('50x50'))
        .map(s => s.split('?')[0])
        .filter((v, i, a) => a.indexOf(v) === i); // dedupe
      
      // Auction info
      const auctionMatch = bodyText.match(/AUCTION[:\s]+([^\n]+)/i);
      
      return {
        vin: vinMatch?.[1] || null,
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        engine: engine,
        transmission: transmission,
        exterior_color: exteriorColor,
        interior_color: interiorColor,
        sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
        high_bid: bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null,
        highlights: highlights,
        equipment: equipment,
        images: [...new Set(images)],
        auction_name: auctionMatch?.[1]?.trim() || null
      };
    });

    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message, data: null };
  }
}

async function updateVehicle(vehicleId, data) {
  const updateData = {};

  if (data.vin) updateData.vin = data.vin;
  if (data.mileage) updateData.mileage = data.mileage;
  if (data.engine) updateData.engine_size = data.engine;
  if (data.transmission) updateData.transmission = data.transmission;
  if (data.exterior_color) updateData.color = data.exterior_color;
  if (data.interior_color) updateData.interior_color = data.interior_color;
  if (data.sold_price) updateData.sale_price = data.sold_price;
  if (data.high_bid && !data.sold_price) updateData.sale_price = data.high_bid;
  if (data.highlights?.length) updateData.highlights = data.highlights;
  if (data.equipment?.length) updateData.equipment = data.equipment;
  if (data.images?.length) {
    updateData.primary_image_url = data.images[0];
    updateData.image_url = data.images[0];
  }

  // Set to active if we have VIN (quality data)
  if (data.vin) {
    updateData.status = 'active';
  }

  // Only update if we have new data
  if (Object.keys(updateData).length === 0) return false;
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(updateData)
  });
  
  return res.ok;
}

async function saveImages(vehicleId, images) {
  if (!images?.length) return 0;
  
  let saved = 0;
  for (let i = 0; i < Math.min(images.length, 20); i++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          image_url: images[i],
          source: 'mecum_scraper',
          is_external: true,
          is_primary: i === 0,
          position: i
        })
      });
      if (res.ok) saved++;
    } catch (e) {}
  }
  return saved;
}

async function worker(workerId, browser, queue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  while (queue.length > 0) {
    const vehicle = queue.shift();
    if (!vehicle) break;

    const result = await scrapeDetailPage(page, vehicle.discovery_url);
    
    if (result.success && result.data) {
      const updated = await updateVehicle(vehicle.id, result.data);

      if (updated) {
        stats.enriched++;
        const fields = [];
        if (result.data.vin) fields.push('VIN');
        if (result.data.mileage) fields.push('mi');
        if (result.data.engine) fields.push('eng');
        if (result.data.exterior_color) fields.push('clr');
        if (result.data.sold_price || result.data.high_bid) fields.push('$');
        if (result.data.images?.length) fields.push(result.data.images.length + 'img');
        console.log(`[W${workerId}] ✓ ${vehicle.id.slice(0,8)} - ${fields.join(',')}`);
      } else {
        stats.skipped++;
        console.log(`[W${workerId}] - ${vehicle.id.slice(0,8)} (no new data)`);
      }
    } else {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ${vehicle.id.slice(0,8)} - ${result.error}`);
    }
  }

  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Mecum DETAIL ENRICHMENT                                   ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Workers: ${PARALLEL}                                   ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const vehicles = await getVehiclesToEnrich();
  if (vehicles.length === 0) {
    console.log('No vehicles to enrich!');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const queue = [...vehicles];
  const stats = { enriched: 0, skipped: 0, errors: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, queue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Done! Enriched ${stats.enriched}, Skipped ${stats.skipped}, Errors ${stats.errors}`);
}

main().catch(console.error);
