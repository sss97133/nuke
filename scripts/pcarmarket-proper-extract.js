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
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.PCARMARKET&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
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
      
      // VIN and Chassis - critical for classic/collector cars
      const vinMatch = bodyText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i);
      const chassisMatch = bodyText.match(/(?:Chassis|Frame|Chassis\s*#?)[:\s]+([A-HJ-NPR-Z0-9\-]+)/i) || 
                            bodyText.match(/chassis\s+([A-HJ-NPR-Z0-9\-]+)/i) ||
                            bodyText.match(/frame\s+([A-HJ-NPR-Z0-9\-]+)/i);

      // Title and year/make/model parsing
      const rawTitle = document.querySelector('h1')?.innerText?.trim();

      // Parse year/make/model from title
      // PCarMarket titles are typically: "1975 Porsche 911 Carrera" or "2018 Porsche 911 GT3"
      let title = rawTitle;
      let year = null;
      let make = null;
      let model = null;

      if (rawTitle) {
        // Clean up PCarMarket title suffixes
        title = rawTitle
          .replace(/\s+\|.*$/i, '')
          .replace(/\s+-\s+PCarMarket.*$/i, '')
          .trim();

        // Extract year (4-digit starting with 19 or 20)
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          year = parseInt(yearMatch[0]);

          // Everything after the year is make + model
          const afterYear = title.slice(title.indexOf(yearMatch[0]) + yearMatch[0].length).trim();
          const parts = afterYear.split(/\s+/);

          // First word is typically the make
          make = parts[0] || null;

          // Rest is model (may include trim level, body style, etc.)
          model = parts.slice(1).join(' ') || null;
        }
      }
      
      // Specs
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:miles|mi)/i);
      const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i) || bodyText.match(/(\d+\.?\d*[Ll]|Flat.?\d+|V\d+)/i);
      const transMatch = bodyText.match(/Transmission[:\s]+([^\n]+)/i) || bodyText.match(/(Manual|Automatic|PDK|Tiptronic)/i);
      const extColorMatch = bodyText.match(/(?:Exterior|Color)[:\s]+([^\n,]+)/i);
      const intColorMatch = bodyText.match(/Interior[:\s]+([^\n,]+)/i);
      
      // Price - sophisticated attribution to avoid irrelevant prices
      let askingPrice = null;
      let soldPrice = null;
      let estimateLow = null;
      let estimateHigh = null;
      
      // Asking/Listing price (current for sale)
      const askingMatch = bodyText.match(/(?:Asking|Listed?|Price|For Sale)[:\s]*\$?([\d,]+)/i) ||
                          bodyText.match(/\$([\d,]+)\s*(?:asking|listed?|for sale)/i);
      
      // Sold price (final sale price)
      const soldMatch = bodyText.match(/Sold[:\s]*\$?([\d,]+)/i) ||
                        bodyText.match(/Hammer[:\s]*\$?([\d,]+)/i) ||
                        bodyText.match(/Final[:\s]*\$?([\d,]+)/i);
      
      // Estimate ranges
      const estimateMatch = bodyText.match(/Estimate[:\s]*\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/i) ||
                           bodyText.match(/Est(?:\.|imate)?[:\s]*\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/i);
      
      // Current bid (for active auctions)
      const currentBidMatch = bodyText.match(/(?:Current|Winning|High)\s*Bid[:\s]*\$?([\d,]+)/i);
      
      // Convert to numbers, filtering out unrealistic values
      const parsePrice = (match) => match ? parseInt(match.replace(/,/g, '')) : null;
      const isValidPrice = (price) => price && price > 100 && price < 10000000; // Filter out $1 or $10M+
      
      askingPrice = parsePrice(askingMatch?.[1]);
      soldPrice = parsePrice(soldMatch?.[1]);
      estimateLow = parsePrice(estimateMatch?.[1]);
      estimateHigh = parsePrice(estimateMatch?.[2]);
      const currentBid = parsePrice(currentBidMatch?.[1]);
      
      // Validate prices
      askingPrice = isValidPrice(askingPrice) ? askingPrice : null;
      soldPrice = isValidPrice(soldPrice) ? soldPrice : null;
      estimateLow = isValidPrice(estimateLow) ? estimateLow : null;
      estimateHigh = isValidPrice(estimateHigh) ? estimateHigh : null;
      
      // For PCA Market (auction platform), prioritize current bid or sold price
      const price = currentBid || soldPrice || askingPrice;

      // Sale info - PCarMarket shows current bid and time left
      const soldMatch2 = bodyText.match(/Sold\s*(?:for)?\s*\$?([\d,]+)/i);
      const currentBidMatch2 = bodyText.match(/(?:Current|Winning)\s*Bid[:\s]*\$?([\d,]+)/i);
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
        year,
        make,
        model,
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
  // Check for duplicate VIN
  let targetVehicleId = vehicleId;
  let isNew = true;
  
  if (data.vin && vinToVehicleId.has(data.vin)) {
    targetVehicleId = vinToVehicleId.get(data.vin);
    isNew = false;
    // Mark the duplicate pending vehicle as merged
    await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'merged', merged_into: targetVehicleId })
    });
  } else {
    // Update vehicle data for new vehicles
    const updateData = {
      vin: data.vin,
      year: data.year,
      make: data.make,
      model: data.model,
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
  }

  // Store ALL images to vehicle_images table (for both new and deduped vehicles)
  if (data.images?.length > 0) {
    for (let i = 0; i < data.images.length; i++) {
      const url = data.images[i];
      await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates'
        },
        body: JSON.stringify({
          vehicle_id: targetVehicleId,
          image_url: url,
          source: 'pcarmarket',
          source_url: url,
          is_primary: i === 0 && isNew,
          position: i,
          is_external: true
        })
      });
    }
  }

  return { vehicleId: targetVehicleId, isNew };
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
    if (data.year) fields.push(data.year);
    if (data.make) fields.push(data.make);
    if (data.model) fields.push(data.model.slice(0, 15));
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
