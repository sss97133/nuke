#!/usr/bin/env node
/**
 * Extract a single Mecum vehicle by ID
 * Usage: node extract-single-mecum.js <vehicle-id>
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VEHICLE_ID = process.argv[2];

if (!VEHICLE_ID) {
  console.error('Usage: node extract-single-mecum.js <vehicle-id>');
  process.exit(1);
}

async function getVehicle() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?id=eq.${VEHICLE_ID}&select=id,discovery_url`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return data[0];
}

async function scrapeDetailPage(page, url) {
  console.log(`Scraping: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Try to expand photo gallery
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

    // VIN
    const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);
    const rawTitle = document.querySelector('h1')?.innerText?.trim();

    // Parse title
    let title = rawTitle;
    let year = null, make = null, model = null;

    if (rawTitle) {
      title = rawTitle.replace(/\s+\|.*$/i, '').replace(/\s+-\s+Mecum.*$/i, '').trim();
      const yearMatch = title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[0]);
        const afterYear = title.slice(title.indexOf(yearMatch[0]) + yearMatch[0].length).trim();
        const parts = afterYear.split(/\s+/);
        make = parts[0] || null;
        model = parts.slice(1).join(' ') || null;
      }
    }

    // Auction event
    const lotMatch = bodyText.match(/LOT\s+([A-Z]?\d+)/i);
    const auctionMatch = bodyText.match(/\/\/\s*([A-Z]+\s+\d{4})/i);

    // Sale result
    const soldMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
    const highBidMatch = bodyText.match(/High\s*Bid\s*\$?([\d,]+)/i);
    const bidToMatch = bodyText.match(/Bid\s*To\s*\$?([\d,]+)/i);
    const notSoldMatch = bodyText.match(/Did\s*Not\s*Sell/i);

    // Specs
    const mileageMatch = bodyText.match(/ODOMETER[^\d]*([\d,]+)/i);

    // Highlights & Equipment
    const highlightsSection = findSection('HIGHLIGHTS', 'PHOTOS|EQUIPMENT|Information found');
    const highlights = highlightsSection?.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 10 && s.length < 300 && !s.includes('VIEW ALL')) || [];

    const equipmentSection = findSection('EQUIPMENT', 'Information found|All rights');
    const equipment = equipmentSection?.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 5 && s.length < 200) || [];

    // Images
    const images = [...document.querySelectorAll('img')]
      .map(i => i.src || i.dataset?.src)
      .filter(s => s && s.includes('mecum') && s.includes('upload'))
      .filter(s => !s.includes('logo') && !s.includes('icon'))
      .map(s => s.replace(/w_\d+/, 'w_1920').split('?')[0])
      .filter((v, i, a) => a.indexOf(v) === i);

    let outcome = 'unknown';
    if (soldMatch) outcome = 'sold';
    else if (notSoldMatch) outcome = 'not_sold';
    else if (highBidMatch || bidToMatch) outcome = 'bid_to';

    return {
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
      auction_name: auctionMatch?.[1],
      lot_number: lotMatch?.[1],
      outcome,
      sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
      high_bid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null
    };
  });
}

async function updateVehicle(vehicleId, data, sourceUrl) {
  // Build description
  const descParts = [];
  if (data.highlights?.length) descParts.push('HIGHLIGHTS:\n' + data.highlights.join('\n'));
  if (data.equipment?.length) descParts.push('EQUIPMENT:\n' + data.equipment.join('\n'));
  const description = descParts.length > 0 ? descParts.join('\n\n') : null;

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
    description,
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: 'active'
  };

  if (data.sold_price) updateData.sale_price = data.sold_price;
  else if (data.high_bid) updateData.high_bid = data.high_bid;

  Object.keys(updateData).forEach(k => { if (!updateData[k]) delete updateData[k]; });

  console.log('\n📝 Updating vehicle with:', JSON.stringify(updateData, null, 2));

  await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  });

  // Delete existing images first to avoid duplicates
  await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images?vehicle_id=eq.${vehicleId}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });

  // Insert all images
  if (data.images?.length > 0) {
    console.log(`\n🖼️  Inserting ${data.images.length} images...`);
    for (let i = 0; i < data.images.length; i++) {
      await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates'
        },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          image_url: data.images[i],
          source: 'mecum',
          source_url: data.images[i],
          is_primary: i === 0,
          position: i,
          is_external: true
        })
      });
    }
  }

  // Create auction event
  const eventData = {
    vehicle_id: vehicleId,
    source: 'mecum',
    source_url: sourceUrl,
    lot_number: data.lot_number,
    outcome: data.outcome,
    high_bid: data.high_bid,
    winning_bid: data.sold_price,
    raw_data: { auction_name: data.auction_name, extractor: 'extract-single-mecum' }
  };

  console.log('\n📅 Creating auction event...');
  await fetch(`${SUPABASE_URL}/rest/v1/auction_events`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates'
    },
    body: JSON.stringify(eventData)
  });
}

async function main() {
  console.log(`\n🔍 Extracting vehicle: ${VEHICLE_ID}\n`);

  const vehicle = await getVehicle();
  if (!vehicle) {
    console.error('Vehicle not found');
    process.exit(1);
  }

  console.log(`URL: ${vehicle.discovery_url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const data = await scrapeDetailPage(page, vehicle.discovery_url);

  console.log('\n📊 Extracted data:');
  console.log(`   VIN: ${data.vin || 'not found'}`);
  console.log(`   Year: ${data.year}`);
  console.log(`   Make: ${data.make}`);
  console.log(`   Model: ${data.model}`);
  console.log(`   Engine: ${data.engine || 'not found'}`);
  console.log(`   Transmission: ${data.transmission || 'not found'}`);
  console.log(`   Exterior: ${data.exterior_color || 'not found'}`);
  console.log(`   Interior: ${data.interior_color || 'not found'}`);
  console.log(`   Mileage: ${data.mileage || 'not found'}`);
  console.log(`   Price: ${data.sold_price ? '$' + data.sold_price.toLocaleString() : (data.high_bid ? 'Bid to $' + data.high_bid.toLocaleString() : 'not found')}`);
  console.log(`   Images: ${data.images?.length || 0}`);
  console.log(`   Highlights: ${data.highlights?.length || 0}`);
  console.log(`   Equipment: ${data.equipment?.length || 0}`);

  await updateVehicle(VEHICLE_ID, data, vehicle.discovery_url);

  await browser.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
