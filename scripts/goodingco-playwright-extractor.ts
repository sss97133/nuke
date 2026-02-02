#!/usr/bin/env node
/**
 * Gooding & Company Playwright Extractor
 * Handles sophisticated auction house extraction with full event mapping
 * - Extracts chassis numbers (critical for classic cars)
 * - Auction event dates and venues
 * - Complete provenance and history
 * - High-quality image galleries
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const GOODINGCO_ORG_ID = 'goodingco-org-id'; // TODO: Get actual org ID

interface GoodingCoData {
  url: string;
  lotNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis_number: string | null;
  engine_number: string | null;
  mileage: number | null;
  estimate: {
    low: number | null;
    high: number | null;
    currency: string;
  };
  soldPrice: number | null;
  auctionStatus: string;
  auctionName: string | null;
  auctionDate: string | null;
  auctionVenue: string | null;
  // Specs
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  bodyStyle: string | null;
  // Content
  description: string | null;
  provenance: string | null;
  literature: string | null;
  exhibitions: string | null;
  // Images
  images: string[];
}

let vinToVehicleId = new Map();

async function loadExistingVins() {
  console.log('Loading existing VINs...');
  let offset = 0;
  const limit = 1000;
  
  while (true) {
    const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/vehicles?vin=not.is.null&select=id,vin&limit=${limit}&offset=${offset}`, {
      headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
    });
    const data = await res.json();
    if (data.length === 0) break;
    data.forEach(v => vinToVehicleId.set(v.vin, v.id));
    offset += limit;
  }
  
  console.log(`Loaded ${vinToVehicleId.size} existing VINs\n`);
}

async function getVehiclesToProcess() {
  const res = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.goodingco&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  return await res.json();
}

async function scrapeGoodingCoPage(page: Page, url: string): Promise<GoodingCoData | { error: string }> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(5000);

    // Scroll to load all images
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }

    return await page.evaluate(() => {
      const bodyText = document.body.innerText;

      // Lot number
      const lotMatch = bodyText.match(/Lot\s*(\d+)/i) || 
                     document.querySelector('.lot-number')?.innerText?.match(/(\d+)/);

      // VIN and Chassis - critical for classic cars
      const vinMatch = bodyText.match(/VIN[:\s#]+([A-HJ-NPR-Z0-9]{17})/i);
      const chassisMatch = bodyText.match(/(?:Chassis|Frame|Chassis\s*#?)[:\s]+([A-HJ-NPR-Z0-9\-]+)/i) || 
                           bodyText.match(/chassis\s+([A-HJ-NPR-Z0-9\-]+)/i) ||
                           bodyText.match(/frame\s+([A-HJ-NPR-Z0-9\-]+)/i);
      
      // Engine number
      const engineNumberMatch = bodyText.match(/(?:Engine\s*#?|Engine\s*Number)[:\s]+([A-HJ-NPR-Z0-9\-]+)/i);

      // Title and basic info
      const title = document.querySelector('h1')?.innerText?.trim();
      
      // Parse year/make/model from title
      let year = null;
      let make = null;
      let model = null;
      
      if (title) {
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) year = parseInt(yearMatch[0]);
        
        // Extract make and model (simplified)
        const parts = title.replace(yearMatch?.[0] || '', '').trim().split(/\s+/);
        if (parts.length >= 2) {
          make = parts[0];
          model = parts.slice(1).join(' ');
        }
      }

      // Auction information
      const auctionNameMatch = bodyText.match(/(?:Auction|Event)[:\s]+([^\n]+)/i) ||
                               document.querySelector('.auction-title')?.innerText?.trim();
      
      const auctionDateMatch = bodyText.match(/(?:Auction|Sale|Event)\s*(?:Date|:)?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i) ||
                               bodyText.match(/(?:\d{1,2}[\s\/-])?[A-Za-z]+[\s\/-]\d{4}/i);
      
      const auctionVenueMatch = bodyText.match(/(?:Venue|Location)[:\s]+([^\n]+)/i) ||
                                document.querySelector('.auction-venue')?.innerText?.trim();

      // Estimates and pricing
      const estimateMatch = bodyText.match(/Estimate[:\s]*\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/i) ||
                           bodyText.match(/\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/i);
      
      const soldPriceMatch = bodyText.match(/Sold[:\s]*\$?([\d,]+)/i) ||
                            bodyText.match(/Hammer[:\s]*\$?([\d,]+)/i);

      // Vehicle specifications
      const mileageMatch = bodyText.match(/([\d,]+)\s*(?:miles|mi)/i);
      const engineMatch = bodyText.match(/Engine[:\s]+([^\n]+)/i);
      const transMatch = bodyText.match(/Transmission[:\s]+([^\n]+)/i);
      const extColorMatch = bodyText.match(/(?:Exterior\s*Color|Ext\.?\s*Color)[:\s]+([^\n]+)/i);
      const intColorMatch = bodyText.match(/(?:Interior\s*Color|Int\.?\s*Color)[:\s]+([^\n]+)/i);
      const bodyStyleMatch = bodyText.match(/(?:Body\s*Style|Body)[:\s]+([^\n]+)/i);

      // Rich content sections
      const descEl = document.querySelector('[class*="description"], [class*="about"], .lot-description, #description');
      const description = descEl?.innerText?.slice(0, 5000) || '';

      const provenanceEl = document.querySelector('[class*="provenance"], [class*="history"], .ownership-history');
      const provenance = provenanceEl?.innerText?.slice(0, 3000) || '';

      const literatureEl = document.querySelector('[class*="literature"], [class*="bibliography"], .documentation');
      const literature = literatureEl?.innerText?.slice(0, 2000) || '';

      const exhibitionsEl = document.querySelector('[class*="exhibition"], [class*="show"], .concours-history');
      const exhibitions = exhibitionsEl?.innerText?.slice(0, 2000) || '';

      // Images - Gooding & Co has high-quality galleries
      const images = [...document.querySelectorAll('img')]
        .map(i => i.src || i.dataset?.src || i.dataset?.lazySrc)
        .filter(s => s && (s.includes('goodingco') || s.includes('cloudinary') || s.includes('cdn')))
        .filter(s => !s.includes('logo') && !s.includes('icon') && !s.includes('avatar'))
        .filter(s => s.includes('/lot/') || s.includes('/image') || s.includes('/photo'))
        .map(s => s.split('?')[0])
        .filter((v, i, a) => a.indexOf(v) === i);

      // Determine auction status
      let auctionStatus = 'upcoming';
      if (soldPriceMatch) auctionStatus = 'sold';
      else if (/sold|hammer/i.test(bodyText)) auctionStatus = 'sold';
      else if (/not\s*sold|passed|unsold/i.test(bodyText)) auctionStatus = 'not_sold';

      return {
        url,
        lotNumber: lotMatch?.[1] || null,
        year,
        make,
        model,
        vin: vinMatch?.[1],
        chassis_number: chassisMatch?.[1],
        engine_number: engineNumberMatch?.[1],
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        estimate: {
          low: estimateMatch ? parseInt(estimateMatch[1].replace(/,/g, '')) : null,
          high: estimateMatch ? parseInt(estimateMatch[2].replace(/,/g, '')) : null,
          currency: 'USD'
        },
        soldPrice: soldPriceMatch ? parseInt(soldPriceMatch[1].replace(/,/g, '')) : null,
        auctionStatus,
        auctionName: auctionNameMatch?.trim(),
        auctionDate: auctionDateMatch?.[1],
        auctionVenue: auctionVenueMatch?.trim(),
        engine: engineMatch?.[1]?.trim(),
        transmission: transMatch?.[1]?.trim(),
        drivetrain: null, // Gooding rarely specifies
        exteriorColor: extColorMatch?.[1]?.trim(),
        interiorColor: intColorMatch?.[1]?.trim(),
        bodyStyle: bodyStyleMatch?.[1]?.trim(),
        description,
        provenance,
        literature,
        exhibitions,
        images
      };
    });
  } catch (e) {
    return { error: e.message };
  }
}

async function upsertVehicle(vehicleId: string, data: GoodingCoData) {
  if (data.vin && vinToVehicleId.has(data.vin)) {
    return { vehicleId: vinToVehicleId.get(data.vin), isNew: false };
  }

  const updateData = {
    vin: data.vin,
    chassis_number: data.chassis_number,
    engine_number: data.engine_number,
    year: data.year,
    make: data.make,
    model: data.model,
    engine_size: data.engine,
    transmission: data.transmission,
    color: data.exteriorColor,
    interior_color: data.interiorColor,
    body_style: data.bodyStyle,
    mileage: data.mileage,
    description: data.description?.slice(0, 5000),
    provenance: data.provenance?.slice(0, 3000),
    literature: data.literature?.slice(0, 2000),
    exhibitions: data.exhibitions?.slice(0, 2000),
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: data.vin ? 'active' : 'pending'
  };

  Object.keys(updateData).forEach(k => { if (!updateData[k]) delete updateData[k]; });

  await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
    method: 'PATCH',
    headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(updateData)
  });

  if (data.vin) vinToVehicleId.set(data.vin, vehicleId);
  return { vehicleId, isNew: true };
}

async function createAuctionEvent(vehicleId: string, sourceUrl: string, data: GoodingCoData) {
  const checkRes = await fetch(
    `${process.env.VITE_SUPABASE_URL}/rest/v1/auction_events?source_url=eq.${encodeURIComponent(sourceUrl)}&select=id`,
    { headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const existing = await checkRes.json();
  if (existing.length > 0) return { created: false };

  const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/auction_events`, {
    method: 'POST',
    headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle_id: vehicleId,
      source: 'goodingco',
      source_url: sourceUrl,
      outcome: data.auctionStatus,
      asking_price: data.estimate?.low,
      sale_price: data.soldPrice,
      estimate_low: data.estimate?.low,
      estimate_high: data.estimate?.high,
      auction_name: data.auctionName,
      auction_date: data.auctionDate,
      auction_venue: data.auctionVenue,
      lot_number: data.lotNumber,
      raw_data: { 
        extractor: 'goodingco-playwright-extractor',
        engine_number: data.engine_number,
        provenance: data.provenance,
        literature: data.literature,
        exhibitions: data.exhibitions
      }
    })
  });
  return { created: res.ok };
}

async function worker(workerId: number, browser: any, queue: any[], stats: { processed: number; errors: number }) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  while (queue.length > 0) {
    const vehicle = queue.shift();
    if (!vehicle) break;

    const data = await scrapeGoodingCoPage(page, vehicle.discovery_url);

    if ((data as any).error) {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ${(data as any).error.slice(0, 50)}`);
      await page.waitForTimeout(5000);
      continue;
    }

    const { vehicleId, isNew } = await upsertVehicle(vehicle.id, data as GoodingCoData);
    await createAuctionEvent(vehicleId, vehicle.discovery_url, data as GoodingCoData);

    const fields = [];
    if (data.vin) fields.push('VIN');
    if (data.chassis_number) fields.push('CHASSIS');
    if (data.engine_number) fields.push('ENGINE#');
    if (data.year) fields.push(data.year);
    if (data.make && data.model) fields.push(`${data.make} ${data.model}`);
    if (data.mileage) fields.push('mi');
    if (data.estimate?.low) fields.push(`$${(data.estimate.low/1000).toFixed(0)}k-${(data.estimate.high/1000).toFixed(0)}k`);
    if (data.soldPrice) fields.push(`SOLD $${(data.soldPrice/1000).toFixed(0)}k`);
    if (data.images?.length) fields.push(`${data.images.length}img`);
    if (data.provenance) fields.push('PROV');
    if (data.literature) fields.push('LIT');
    if (data.exhibitions) fields.push('EXHIB');

    const dedup = !isNew ? ` [DEDUP→${vehicleId.slice(0,8)}]` : '';
    console.log(`[W${workerId}] ✓ ${fields.join(',')}${dedup}`);
    stats.processed++;

    await page.waitForTimeout(3000);
  }
  await context.close();
}

const BATCH_SIZE = parseInt(process.argv[2]) || 20;
const PARALLEL = parseInt(process.argv[3]) || 2;

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Gooding & Company SOPHISTICATED EXTRACTOR                  ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Workers: ${PARALLEL} | Full event mapping     ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  await loadExistingVins();
  const vehicles = await getVehiclesToProcess();
  console.log(`Found ${vehicles.length} pending Gooding & Co vehicles\n`);
  if (vehicles.length === 0) return;

  const browser = await chromium.launch({ headless: true });
  const queue = [...vehicles];
  const stats = { processed: 0, errors: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) workers.push(worker(i, browser, queue, stats));
  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Gooding & Co: ${stats.processed} processed, ${stats.errors} errors`);
}

main().catch(console.error);
