#!/usr/bin/env node
/**
 * Cars & Bids PROPER EXTRACTION
 * - Extracts ALL available data from detail pages
 * - Deduplicates by VIN
 * - Creates auction_events timeline
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 100;
const PARALLEL = parseInt(process.argv[3]) || 3;

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
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.carsandbids&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

async function scrapeDetailPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(4000);

    // Scroll to load all images
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
    }

    return await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // VIN - C&B shows VIN in specs
      const vinMatch = bodyText.match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);

      // Title
      const title = document.querySelector('h1')?.innerText?.trim();

      // Quick facts section - C&B has structured specs
      const getSpec = (label) => {
        // Try various patterns
        const patterns = [
          new RegExp(label + '\\s*\\n\\s*([^\\n]+)', 'i'),
          new RegExp(label + '[:\\s]+([^\\n]+)', 'i')
        ];
        for (const p of patterns) {
          const m = bodyText.match(p);
          if (m && m[1] && m[1].length < 100) return m[1].trim();
        }
        return null;
      };

      const mileage = getSpec('Mileage') || getSpec('Miles');
      const engine = getSpec('Engine');
      const transmission = getSpec('Transmission');
      const drivetrain = getSpec('Drivetrain');
      const exteriorColor = getSpec('Exterior Color') || getSpec('Exterior');
      const interiorColor = getSpec('Interior Color') || getSpec('Interior');
      const bodyStyle = getSpec('Body Style');
      const titleStatus = getSpec('Title Status');

      // Parse mileage number
      const mileageNum = mileage ? parseInt(mileage.replace(/[^\d]/g, '')) : null;

      // Seller info
      const sellerMatch = bodyText.match(/Seller[:\s]+([^\n]+)/i);
      const locationMatch = bodyText.match(/Location[:\s]+([^\n]+)/i);

      // Sale info
      const soldMatch = bodyText.match(/Sold\s*(?:for|:)?\s*\$?([\d,]+)/i);
      const currentBidMatch = bodyText.match(/(?:Current|Winning|High)\s*Bid[:\s]*\$?([\d,]+)/i);
      const bidCountMatch = bodyText.match(/(\d+)\s*(?:bids?)/i);

      // Reserve status
      const reserveMatch = bodyText.match(/Reserve\s*(Met|Not Met)/i);
      const noReserve = /No Reserve/i.test(bodyText);

      // Description - usually in a specific section
      let description = '';
      const descEl = document.querySelector('[class*="description"], [class*="about"], .listing-description');
      if (descEl) {
        description = descEl.innerText?.slice(0, 3000);
      }

      // Highlights/features
      const highlights = [];
      document.querySelectorAll('li, .feature, .highlight, .quick-fact').forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.length > 10 && text.length < 200 && !text.includes('Sign in')) {
          highlights.push(text);
        }
      });

      // Images - C&B uses various CDN patterns
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src)
        .filter(s => s && (s.includes('carsandbids') || s.includes('cloudfront') || s.includes('imgix')))
        .filter(s => !s.includes('logo') && !s.includes('icon') && !s.includes('avatar') && !s.includes('placeholder'))
        .filter(s => s.includes('auctions') || s.includes('image') || s.includes('photo'))
        .map(s => s.split('?')[0])
        .filter((v, i, a) => a.indexOf(v) === i);

      // Determine outcome
      let outcome = 'active';
      if (soldMatch) outcome = 'sold';
      else if (/not sold|no sale|ended/i.test(bodyText)) outcome = 'not_sold';

      return {
        vin: vinMatch?.[1],
        title,
        mileage: mileageNum,
        engine,
        transmission,
        drivetrain,
        exterior_color: exteriorColor,
        interior_color: interiorColor,
        body_style: bodyStyle,
        title_status: titleStatus,
        seller: sellerMatch?.[1]?.trim(),
        location: locationMatch?.[1]?.trim(),
        sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
        current_bid: currentBidMatch ? parseInt(currentBidMatch[1].replace(/,/g, '')) : null,
        bid_count: bidCountMatch ? parseInt(bidCountMatch[1]) : null,
        reserve_met: reserveMatch?.[1]?.toLowerCase() === 'met',
        no_reserve: noReserve,
        description,
        highlights: highlights.slice(0, 30),
        images,
        outcome
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
    drivetrain: data.drivetrain,
    color: data.exterior_color,
    interior_color: data.interior_color,
    body_style: data.body_style,
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
      source: 'carsandbids',
      source_url: sourceUrl,
      outcome: data.outcome,
      winning_bid: data.sold_price,
      high_bid: data.current_bid,
      bid_count: data.bid_count,
      seller_name: data.seller,
      seller_location: data.location,
      raw_data: {
        extractor: 'carsandbids-proper-extract',
        reserve_met: data.reserve_met,
        no_reserve: data.no_reserve,
        title_status: data.title_status
      }
    })
  });
  return { created: res.ok };
}

async function worker(workerId, browser, queue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  while (queue.length > 0) {
    const vehicle = queue.shift();
    if (!vehicle) break;

    const data = await scrapeDetailPage(page, vehicle.discovery_url);

    if (data.error) {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ${data.error.slice(0, 50)}`);
      continue;
    }

    const { vehicleId, isNew } = await upsertVehicle(vehicle.id, data);
    await createAuctionEvent(vehicleId, vehicle.discovery_url, data);

    const fields = [];
    if (data.vin) fields.push('VIN');
    if (data.mileage) fields.push('mi');
    if (data.engine) fields.push('eng');
    if (data.exterior_color) fields.push('clr');
    if (data.sold_price) fields.push('$' + (data.sold_price / 1000).toFixed(0) + 'k');
    if (data.images?.length) fields.push(data.images.length + 'img');
    if (data.description) fields.push('desc');

    const dedup = !isNew ? ` [DEDUP→${vehicleId.slice(0, 8)}]` : '';
    console.log(`[W${workerId}] ✓ ${fields.join(',')}${dedup}`);
    stats.processed++;
  }
  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Cars & Bids PROPER EXTRACTION                             ║');
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

  console.log(`\n✅ C&B: ${stats.processed} processed, ${stats.errors} errors`);
}

main().catch(console.error);
