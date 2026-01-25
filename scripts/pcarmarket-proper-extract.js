#!/usr/bin/env node
/**
 * PCarMarket PROPER EXTRACTION - Full detail extraction with VIN dedup
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 100;
const PARALLEL = parseInt(process.argv[3]) || 2;

let vinToVehicleId = new Map();

async function loadExistingVins() {
  console.log('Loading existing VINs...');
  let offset = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?vin=not.is.null&select=id,vin&limit=1000&offset=${offset}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await res.json();
    if (data.length === 0) break;
    data.forEach(v => vinToVehicleId.set(v.vin, v.id));
    offset += 1000;
  }
  console.log(`Loaded ${vinToVehicleId.size} existing VINs\n`);
}

async function getVehiclesToProcess() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.pcarmarket&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

async function scrapeDetailPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);
    
    // Scroll for images
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }

    return await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      // VIN
      const vinMatch = bodyText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i);
      
      // Title
      const title = document.querySelector('h1')?.innerText?.trim();
      
      // Specs
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:miles|mi)/i);
      const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i) || bodyText.match(/(\d+\.?\d*[Ll]|Flat.?\d+|V\d+)/i);
      const transMatch = bodyText.match(/Transmission[:\s]+([^\n]+)/i) || bodyText.match(/(Manual|Automatic|PDK|Tiptronic)/i);
      const extColorMatch = bodyText.match(/(?:Exterior|Color)[:\s]+([^\n,]+)/i);
      const intColorMatch = bodyText.match(/Interior[:\s]+([^\n,]+)/i);
      
      // Sale info - PCarMarket shows current bid and time left
      const soldMatch = bodyText.match(/Sold\s*(?:for)?\s*\$?([\d,]+)/i);
      const currentBidMatch = bodyText.match(/(?:Current|Winning)\s*Bid[:\s]*\$?([\d,]+)/i);
      const reserveMatch = bodyText.match(/Reserve\s*(Met|Not Met)/i);
      
      // Seller info
      const sellerMatch = bodyText.match(/(?:Seller|Listed by)[:\s]+([^\n]+)/i);
      const locationMatch = bodyText.match(/Location[:\s]+([^\n]+)/i);
      
      // Description
      const descSection = bodyText.match(/(?:About|Description|Details)[:\s]*([\s\S]{100,2000}?)(?:Specifications|Equipment|Photos|Comments)/i);
      const description = descSection?.[1]?.trim();
      
      // Highlights/Equipment
      const highlights = [];
      document.querySelectorAll('li, .feature, .highlight').forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.length > 10 && text.length < 200) highlights.push(text);
      });
      
      // Images - PCarMarket uses cloudfront
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src)
        .filter(s => s && (s.includes('pcarmarket') || s.includes('cloudfront')))
        .filter(s => !s.includes('logo') && !s.includes('icon') && !s.includes('avatar') && !s.includes('placeholder'))
        .map(s => s.split('?')[0])
        .filter((v, i, a) => a.indexOf(v) === i);

      return {
        vin: vinMatch?.[1],
        title,
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        engine: engineMatch?.[1]?.trim(),
        transmission: transMatch?.[1]?.trim(),
        exterior_color: extColorMatch?.[1]?.trim(),
        interior_color: intColorMatch?.[1]?.trim(),
        sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
        current_bid: currentBidMatch ? parseInt(currentBidMatch[1].replace(/,/g, '')) : null,
        reserve_status: reserveMatch?.[1]?.toLowerCase(),
        seller: sellerMatch?.[1]?.trim(),
        location: locationMatch?.[1]?.trim(),
        description,
        highlights: highlights.slice(0, 20),
        images,
        outcome: soldMatch ? 'sold' : 'active'
      };
    });
  } catch (e) {
    return { error: e.message };
  }
}

async function upsertVehicle(vehicleId, data) {
  if (data.vin && vinToVehicleId.has(data.vin)) {
    return { vehicleId: vinToVehicleId.get(data.vin), isNew: false };
  }
  
  const updateData = {
    vin: data.vin,
    engine_size: data.engine,
    transmission: data.transmission,
    color: data.exterior_color,
    interior_color: data.interior_color,
    mileage: data.mileage,
    description: data.description?.slice(0, 5000),
    highlights: data.highlights,
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: data.vin ? 'active' : 'pending'
  };
  
  if (data.sold_price) updateData.sale_price = data.sold_price;
  else if (data.current_bid) updateData.sale_price = data.current_bid;
  
  Object.keys(updateData).forEach(k => { if (!updateData[k]) delete updateData[k]; });
  
  await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(updateData)
  });
  
  if (data.vin) vinToVehicleId.set(data.vin, vehicleId);
  return { vehicleId, isNew: true };
}

async function createAuctionEvent(vehicleId, sourceUrl, data) {
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?source_url=eq.${encodeURIComponent(sourceUrl)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();
  if (existing.length > 0) return { created: false };
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/auction_events`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle_id: vehicleId,
      source: 'pcarmarket',
      source_url: sourceUrl,
      outcome: data.outcome,
      winning_bid: data.sold_price,
      high_bid: data.current_bid,
      seller_name: data.seller,
      seller_location: data.location,
      raw_data: { extractor: 'pcarmarket-proper-extract', reserve_status: data.reserve_status }
    })
  });
  return { created: res.ok };
}

async function worker(workerId, browser, queue, stats) {
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  const page = await context.newPage();

  while (queue.length > 0) {
    const vehicle = queue.shift();
    if (!vehicle) break;

    const data = await scrapeDetailPage(page, vehicle.discovery_url);
    
    if (data.error) {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ${data.error.slice(0, 40)}`);
      continue;
    }

    const { vehicleId, isNew } = await upsertVehicle(vehicle.id, data);
    await createAuctionEvent(vehicleId, vehicle.discovery_url, data);
    
    const fields = [];
    if (data.vin) fields.push('VIN');
    if (data.mileage) fields.push('mi');
    if (data.engine) fields.push('eng');
    if (data.exterior_color) fields.push('clr');
    if (data.sold_price) fields.push('$' + (data.sold_price/1000).toFixed(0) + 'k');
    if (data.images?.length) fields.push(data.images.length + 'img');
    if (data.description) fields.push('desc');
    
    const dedup = !isNew ? ` [DEDUP→${vehicleId.slice(0,8)}]` : '';
    console.log(`[W${workerId}] ✓ ${fields.join(',')}${dedup}`);
    stats.processed++;
  }
  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PCarMarket PROPER EXTRACTION                              ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Workers: ${PARALLEL}                                   ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await loadExistingVins();
  const vehicles = await getVehiclesToProcess();
  console.log(`Found ${vehicles.length} pending vehicles\n`);
  if (vehicles.length === 0) return;

  const browser = await chromium.launch({ headless: true });
  const queue = [...vehicles];
  const stats = { processed: 0, errors: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) workers.push(worker(i, browser, queue, stats));
  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ PCarMarket: ${stats.processed} processed, ${stats.errors} errors`);
}

main().catch(console.error);
