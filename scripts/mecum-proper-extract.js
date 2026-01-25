#!/usr/bin/env node
/**
 * Mecum PROPER EXTRACTION
 * - Extracts ALL available data
 * - Deduplicates by VIN (one vehicle, many auction events)
 * - Creates auction_events timeline
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 100;
const PARALLEL = parseInt(process.argv[3]) || 2;

// Cache of existing VINs
let vinToVehicleId = new Map();

async function loadExistingVins() {
  console.log('Loading existing VINs...');
  let offset = 0;
  const limit = 1000;
  
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?vin=not.is.null&select=id,vin&limit=${limit}&offset=${offset}`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await res.json();
    if (data.length === 0) break;
    data.forEach(v => vinToVehicleId.set(v.vin, v.id));
    offset += limit;
  }
  
  console.log(`Loaded ${vinToVehicleId.size} existing VINs\n`);
}

async function getVehiclesToProcess() {
  // Get pending Mecum vehicles
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

async function scrapeDetailPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Try to expand photo gallery if exists
    try {
      const viewAllPhotos = await page.$('text=View All Photos');
      if (viewAllPhotos) {
        await viewAllPhotos.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) { /* ignore */ }

    // Scroll to load lazy images
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    return await page.evaluate(() => {
      const bodyText = document.body.innerText;
      
      const findAfter = (label) => {
        const regex = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
        return bodyText.match(regex)?.[1]?.trim() || null;
      };
      
      const findSection = (start, end) => {
        const regex = new RegExp(start + '([\\s\\S]*?)' + end, 'i');
        return bodyText.match(regex)?.[1]?.trim() || null;
      };

      // === VEHICLE IDENTITY ===
      const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);
      const rawTitle = document.querySelector('h1')?.innerText?.trim();

      // Parse year/make/model from title
      // Mecum titles are typically: "1970 Plymouth 'Cuda Convertible" or "2015 Ford Mustang GT"
      let title = rawTitle;
      let year = null;
      let make = null;
      let model = null;

      if (rawTitle) {
        // Clean up common Mecum title suffixes
        title = rawTitle
          .replace(/\s+\|.*$/i, '')
          .replace(/\s+-\s+Mecum.*$/i, '')
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
      
      // === AUCTION EVENT ===
      const lotMatch = bodyText.match(/LOT\s+([A-Z]?\d+)/i);
      const auctionMatch = bodyText.match(/\/\/\s*([A-Z]+\s+\d{4})/i);
      const dayMatch = bodyText.match(/(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),?\s+([A-Z]+\s+\d+)/i);
      
      // === SALE RESULT ===
      const soldMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
      const highBidMatch = bodyText.match(/High\s*Bid\s*\$?([\d,]+)/i);
      const bidToMatch = bodyText.match(/Bid\s*To\s*\$?([\d,]+)/i);
      const notSoldMatch = bodyText.match(/Did\s*Not\s*Sell/i);
      
      // === SPECS ===
      const mileageMatch = bodyText.match(/ODOMETER[^\d]*([\d,]+)/i);
      
      // === COLLECTION ===
      const collectionMatch = bodyText.match(/(?:from|part of)\s+(?:the\s+)?([A-Z][^\.\n]+Collection)/i);
      
      // === HIGHLIGHTS ===
      const highlightsSection = findSection('HIGHLIGHTS', 'PHOTOS|EQUIPMENT|Information found');
      const highlights = highlightsSection?.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 10 && s.length < 300 && !s.includes('VIEW ALL')) || [];
      
      // === EQUIPMENT ===
      const equipmentSection = findSection('EQUIPMENT', 'Information found|All rights');
      const equipment = equipmentSection?.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 5 && s.length < 200) || [];
      
      // === IMAGES ===
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src)
        .filter(s => s && s.includes('mecum') && s.includes('upload'))
        .filter(s => !s.includes('logo') && !s.includes('icon'))
        .map(s => s.replace(/w_\d+/, 'w_1920').split('?')[0])
        .filter((v, i, a) => a.indexOf(v) === i);

      // Determine outcome
      let outcome = 'unknown';
      if (soldMatch) outcome = 'sold';
      else if (notSoldMatch) outcome = 'not_sold';
      else if (highBidMatch || bidToMatch) outcome = 'bid_to';

      return {
        // Vehicle data
        vin: vinMatch?.[1],
        title,
        year,
        make,
        model,
        engine: findAfter('ENGINE'),
        transmission: findAfter('TRANSMISSION'),
        exterior_color: findAfter('EXTERIOR COLOR'),
        interior_color: findAfter('INTERIOR COLOR'),
        body_style: findAfter('BODY STYLE'),
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        highlights,
        equipment,
        images,
        
        // Auction event data
        auction_name: auctionMatch?.[1],
        lot_number: lotMatch?.[1],
        auction_day: dayMatch ? `${dayMatch[1]} ${dayMatch[2]}` : null,
        outcome,
        sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
        high_bid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null,
        collection: collectionMatch?.[1]
      };
    });
  } catch (e) {
    return { error: e.message };
  }
}

async function upsertVehicle(vehicleId, data) {
  // Check if VIN already exists
  const existingVehicleId = data.vin && vinToVehicleId.has(data.vin)
    ? vinToVehicleId.get(data.vin)
    : null;

  const targetVehicleId = existingVehicleId || vehicleId;

  // Build description from highlights + equipment
  const descParts = [];
  if (data.highlights?.length) {
    descParts.push('HIGHLIGHTS:\n' + data.highlights.join('\n'));
  }
  if (data.equipment?.length) {
    descParts.push('EQUIPMENT:\n' + data.equipment.join('\n'));
  }
  const description = descParts.length > 0 ? descParts.join('\n\n') : null;

  // Update vehicle with extracted data
  const updateData = {
    vin: data.vin,
    year: data.year,
    make: data.make,
    model: data.model,
    engine_size: data.engine,
    transmission: data.transmission,
    color: data.exterior_color,
    interior_color: data.interior_color,
    body_style: data.body_style,
    mileage: data.mileage,
    highlights: data.highlights,
    equipment: data.equipment,
    description: description,
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: 'active'  // Always activate - we extracted data
  };

  // Add sale price if available
  if (data.sold_price) updateData.sale_price = data.sold_price;
  else if (data.high_bid) updateData.sale_price = data.high_bid;

  Object.keys(updateData).forEach(k => { if (!updateData[k]) delete updateData[k]; });

  await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${targetVehicleId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  });

  // Store ALL images to vehicle_images table
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
          source: 'mecum',
          source_url: url,
          is_primary: i === 0,
          position: i,
          is_external: true
        })
      });
    }
  }

  // Mark original vehicle as merged if we deduplicated
  if (existingVehicleId && existingVehicleId !== vehicleId) {
    await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'merged', merged_into: existingVehicleId })
    });
  }

  // Cache the VIN
  if (data.vin) vinToVehicleId.set(data.vin, targetVehicleId);

  return { vehicleId: targetVehicleId, isNew: !existingVehicleId };
}

async function createAuctionEvent(vehicleId, sourceUrl, data) {
  const eventData = {
    vehicle_id: vehicleId,
    source: 'mecum',
    source_url: sourceUrl,
    lot_number: data.lot_number,
    outcome: data.outcome,
    high_bid: data.high_bid,
    winning_bid: data.sold_price,
    raw_data: {
      auction_name: data.auction_name,
      auction_day: data.auction_day,
      collection: data.collection,
      extractor: 'mecum-proper-extract'
    }
  };
  
  // Check if event already exists for this URL
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?source_url=eq.${encodeURIComponent(sourceUrl)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();
  
  if (existing.length > 0) {
    return { created: false, id: existing[0].id };
  }
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/auction_events`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(eventData)
  });
  
  if (res.ok) {
    const [event] = await res.json();
    return { created: true, id: event.id };
  }
  return { created: false, error: await res.text() };
}

async function worker(workerId, browser, queue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  while (queue.length > 0) {
    const vehicle = queue.shift();
    if (!vehicle) break;

    const data = await scrapeDetailPage(page, vehicle.discovery_url);
    
    if (data.error) {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ERROR: ${data.error.slice(0, 50)}`);
      continue;
    }

    // Upsert vehicle (handles VIN deduplication)
    const { vehicleId, isNew } = await upsertVehicle(vehicle.id, data);
    
    // Always create auction event for timeline
    const event = await createAuctionEvent(vehicleId, vehicle.discovery_url, data);
    
    // Build status string
    const fields = [];
    if (data.year) fields.push(data.year);
    if (data.make) fields.push(data.make);
    if (data.model) fields.push(data.model.slice(0, 15));
    if (data.vin) fields.push('VIN');
    if (data.mileage) fields.push('mi');
    if (data.engine) fields.push('eng');
    if (data.exterior_color) fields.push('clr');
    if (data.sold_price) fields.push('$' + (data.sold_price/1000).toFixed(0) + 'k');
    else if (data.high_bid) fields.push('bid$' + (data.high_bid/1000).toFixed(0) + 'k');
    if (data.images?.length) fields.push(data.images.length + 'img');
    if (data.highlights?.length) fields.push(data.highlights.length + 'hl');
    if (data.equipment?.length) fields.push(data.equipment.length + 'eq');

    const eventStatus = event.created ? '+event' : (isNew ? '' : 'linked');
    const dedup = !isNew ? ' [DEDUP→' + vehicleId.slice(0,8) + ']' : '';

    console.log(`[W${workerId}] ✓ ${fields.join(',')} ${eventStatus}${dedup}`);
    stats.processed++;
    if (!isNew) stats.deduplicated++;
    if (event.created) stats.events++;
  }

  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Mecum PROPER EXTRACTION                                   ║');
  console.log('║  VIN deduplication + auction_events timeline               ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Workers: ${PARALLEL}                                   ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await loadExistingVins();
  
  const vehicles = await getVehiclesToProcess();
  console.log(`Found ${vehicles.length} pending vehicles to process\n`);
  
  if (vehicles.length === 0) return;

  const browser = await chromium.launch({ headless: true });
  const queue = [...vehicles];
  const stats = { processed: 0, deduplicated: 0, events: 0, errors: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, queue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Done!`);
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Deduplicated (linked to existing VIN): ${stats.deduplicated}`);
  console.log(`   Auction events created: ${stats.events}`);
  console.log(`   Errors: ${stats.errors}`);
}

main().catch(console.error);
