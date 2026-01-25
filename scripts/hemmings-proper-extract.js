#!/usr/bin/env node
/**
 * Hemmings PROPER EXTRACTION
 * - Extracts ALL available data from detail pages
 * - Deduplicates by VIN
 * - Creates auction_events timeline
 * - Note: Hemmings has rate limiting, using conservative delays
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50; // Conservative batch size
const PARALLEL = parseInt(process.argv[3]) || 1;    // Single worker to avoid rate limits

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
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.hemmings&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

async function scrapeDetailPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(8000); // Longer wait for Hemmings

    // Scroll to load all images
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    return await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // VIN - Hemmings shows it in specs
      const vinMatch = bodyText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i);

      // Title
      const title = document.querySelector('h1')?.innerText?.trim();

      // Specs - Hemmings has structured specs
      const mileageMatch = bodyText.match(/(?:Mileage|Miles)[:\s]+([0-9,]+)/i);
      const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i) || bodyText.match(/(\d+\.?\d*[Ll]|V\d+|[Ii]nline.?\d+|Flat.?\d+)[^\n]*/i);
      const transMatch = bodyText.match(/Transmission[:\s]+([^\n]+)/i);
      const extColorMatch = bodyText.match(/(?:Exterior\s*Color|Ext\.?\s*Color)[:\s]+([^\n]+)/i);
      const intColorMatch = bodyText.match(/(?:Interior\s*Color|Int\.?\s*Color)[:\s]+([^\n]+)/i);
      const drivetrainMatch = bodyText.match(/Drivetrain[:\s]+([^\n]+)/i);

      // Price
      const priceMatch = bodyText.match(/\$([0-9,]+)/) || bodyText.match(/Price[:\s]+\$?([0-9,]+)/i);

      // Stock/Dealer info
      const stockMatch = bodyText.match(/Stock\s*#?[:\s]+([^\n]+)/i);
      const dealerMatch = bodyText.match(/(?:Seller|Dealer|Offered By)[:\s]+([^\n]+)/i);
      const locationMatch = bodyText.match(/(?:Location|Located)[:\s]+([^\n]+)/i);

      // Description
      const descEl = document.querySelector('[class*="description"], [class*="about"], .listing-description, #description');
      const description = descEl?.innerText?.slice(0, 2000) || '';

      // Features/Equipment
      const features = [];
      document.querySelectorAll('li, .feature, .option, .equipment-item').forEach(el => {
        const text = el.innerText?.trim();
        if (text && text.length > 5 && text.length < 150) features.push(text);
      });

      // Images - Hemmings uses various CDN patterns
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src || i.dataset?.lazySrc)
        .filter(s => s && (s.includes('hemmings') || s.includes('cloudinary') || s.includes('cloudfront')))
        .filter(s => !s.includes('logo') && !s.includes('icon') && !s.includes('avatar') && !s.includes('placeholder'))
        .filter(s => s.includes('/listings/') || s.includes('upload') || s.includes('image'))
        .map(s => s.split('?')[0])
        .filter((v, i, a) => a.indexOf(v) === i);

      return {
        vin: vinMatch?.[1],
        title,
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        engine: engineMatch?.[1]?.trim(),
        transmission: transMatch?.[1]?.trim(),
        drivetrain: drivetrainMatch?.[1]?.trim(),
        exterior_color: extColorMatch?.[1]?.trim(),
        interior_color: intColorMatch?.[1]?.trim(),
        price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
        stock_number: stockMatch?.[1]?.trim(),
        dealer: dealerMatch?.[1]?.trim(),
        location: locationMatch?.[1]?.trim(),
        description,
        features: features.slice(0, 30),
        images,
        outcome: 'listed' // Hemmings is marketplace, not auction
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
    mileage: data.mileage,
    description: data.description?.slice(0, 5000),
    highlights: data.features,
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: data.vin ? 'active' : 'pending'
  };

  if (data.price) updateData.sale_price = data.price;

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
      source: 'hemmings',
      source_url: sourceUrl,
      outcome: data.outcome,
      asking_price: data.price,
      seller_name: data.dealer,
      seller_location: data.location,
      raw_data: { extractor: 'hemmings-proper-extract', stock_number: data.stock_number }
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
      // Rate limit handling - longer pause on error
      await page.waitForTimeout(10000);
      continue;
    }

    const { vehicleId, isNew } = await upsertVehicle(vehicle.id, data);
    await createAuctionEvent(vehicleId, vehicle.discovery_url, data);

    const fields = [];
    if (data.vin) fields.push('VIN');
    if (data.mileage) fields.push('mi');
    if (data.engine) fields.push('eng');
    if (data.exterior_color) fields.push('clr');
    if (data.price) fields.push('$' + (data.price/1000).toFixed(0) + 'k');
    if (data.images?.length) fields.push(data.images.length + 'img');
    if (data.description) fields.push('desc');

    const dedup = !isNew ? ` [DEDUP→${vehicleId.slice(0,8)}]` : '';
    console.log(`[W${workerId}] ✓ ${fields.join(',')}${dedup}`);
    stats.processed++;

    // Rate limiting - pause between requests
    await page.waitForTimeout(3000);
  }
  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Hemmings PROPER EXTRACTION                                ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Workers: ${PARALLEL} (conservative for rate limits)    ║`);
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

  console.log(`\n✅ Hemmings: ${stats.processed} processed, ${stats.errors} errors`);
}

main().catch(console.error);
