#!/usr/bin/env node
/**
 * Extract a single Mecum vehicle by ID using JSON extraction
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VEHICLE_ID = process.argv[2];

if (!VEHICLE_ID) {
  console.error('Usage: node mecum-extract-one.js <vehicle-id>');
  process.exit(1);
}

async function getVehicle() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?id=eq.${VEHICLE_ID}&select=id,discovery_url`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return (await res.json())[0];
}

async function extractFromNextData(page, url) {
  console.log(`\nScraping: ${url}\n`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    return script ? JSON.parse(script.textContent) : null;
  });

  if (!nextData?.props?.pageProps?.post) {
    console.log('No __NEXT_DATA__ found, using fallback');
    return null;
  }

  const post = nextData.props.pageProps.post;

  // Sale result
  const saleResult = post.saleResults?.edges?.[0]?.node?.slug || 'unknown';
  const hammerPrice = post.hammerPrice > 0 ? post.hammerPrice : null;
  const currentBid = post.currentBid > 0 ? post.currentBid : null;

  // Auction info
  const auctionTax = post.auctionsTax?.edges?.[0]?.node || {};
  const runDate = post.runDates?.edges?.[0]?.node?.slug || null;

  // Parse title
  const title = post.title?.replace(/&#039;/g, "'") || '';
  let year = null, make = null, model = null;
  const titleMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
  if (titleMatch) {
    year = parseInt(titleMatch[1]);
    make = titleMatch[2];
    model = titleMatch[3];
  }
  if (!year && post.lotYears?.edges?.[0]?.node?.name) {
    year = parseInt(post.lotYears.edges[0].node.name);
  }

  // Get images from JSON-LD
  const images = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data['@type'] === 'Car' && data.image) {
          return Array.isArray(data.image) ? data.image : [data.image];
        }
      } catch (e) {}
    }
    return [];
  });

  // Get VIN from page text
  const bodyText = await page.evaluate(() => document.body.innerText);
  const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);

  // Highlights
  const highlightsMatch = bodyText.match(/HIGHLIGHTS([\s\S]*?)(?:EQUIPMENT|PHOTOS|Information|$)/i);
  const highlights = highlightsMatch
    ? highlightsMatch[1].split('\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 300)
    : [];

  return {
    vin: vinMatch?.[1],
    title,
    year,
    make,
    model,
    transmission: post.transmission,
    mileage: post.odometer,
    images,
    highlights,
    sale_result: saleResult,
    hammer_price: hammerPrice,
    current_bid: currentBid,
    auction_id: auctionTax.auctionId,
    auction_name: auctionTax.name,
    auction_slug: auctionTax.slug,
    run_date: runDate,
    lot_number: post.lotNumber,
    salesforce_id: post.salesforceItemId
  };
}

async function updateVehicle(vehicleId, data, sourceUrl) {
  console.log('=== EXTRACTED DATA ===');
  console.log(`  Title: ${data.title}`);
  console.log(`  Year: ${data.year}`);
  console.log(`  Make: ${data.make}`);
  console.log(`  Model: ${data.model}`);
  console.log(`  VIN: ${data.vin || 'not found'}`);
  console.log(`  Mileage: ${data.mileage || 'not found'}`);
  console.log(`  Transmission: ${data.transmission || 'not found'}`);
  console.log(`  Sale Result: ${data.sale_result}`);
  console.log(`  Hammer Price: ${data.hammer_price ? '$' + data.hammer_price.toLocaleString() : 'none'}`);
  console.log(`  Images: ${data.images?.length || 0}`);
  console.log(`  Highlights: ${data.highlights?.length || 0}`);
  console.log(`  Auction: ${data.auction_name} (${data.auction_id})`);
  console.log(`  Run Date: ${data.run_date}`);
  console.log(`  Lot: ${data.lot_number}`);

  const updateData = {
    vin: data.vin,
    year: data.year,
    make: data.make,
    model: data.model,
    transmission: data.transmission,
    mileage: data.mileage,
    highlights: data.highlights,
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: 'active'
  };

  if (data.hammer_price) {
    updateData.sale_price = data.hammer_price;
    updateData.sold_price = data.hammer_price;
  } else if (data.current_bid) {
    updateData.high_bid = data.current_bid;
  }

  Object.keys(updateData).forEach(k => { if (!updateData[k]) delete updateData[k]; });

  console.log('\n=== UPDATING VEHICLE ===');
  await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  });
  console.log('  Vehicle updated');

  // Images
  if (data.images?.length > 0) {
    console.log(`\n=== INSERTING ${data.images.length} IMAGES ===`);
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
          is_primary: i === 0,
          position: i,
          is_external: true
        })
      });
    }
    console.log('  Images inserted');
  }

  // Auction event
  console.log('\n=== CREATING AUCTION EVENT ===');
  const eventData = {
    vehicle_id: vehicleId,
    source: 'mecum',
    source_url: sourceUrl,
    source_listing_id: data.salesforce_id?.toString(),
    lot_number: data.lot_number,
    auction_start_date: data.run_date,
    auction_end_date: data.run_date,
    outcome: data.sale_result === 'sold' ? 'sold' : data.sale_result,
    winning_bid: data.hammer_price,
    high_bid: data.current_bid,
    raw_data: {
      auction_id: data.auction_id,
      auction_name: data.auction_name,
      auction_slug: data.auction_slug
    }
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/auction_events`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=ignore-duplicates'
    },
    body: JSON.stringify(eventData)
  });

  if (res.ok) {
    console.log('  Auction event created');
  } else {
    console.log('  Auction event:', await res.text());
  }
}

async function main() {
  console.log(`\n🔍 Extracting vehicle: ${VEHICLE_ID}`);

  const vehicle = await getVehicle();
  if (!vehicle) {
    console.error('Vehicle not found');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const data = await extractFromNextData(page, vehicle.discovery_url);

  if (data) {
    await updateVehicle(VEHICLE_ID, data, vehicle.discovery_url);
  }

  await browser.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
