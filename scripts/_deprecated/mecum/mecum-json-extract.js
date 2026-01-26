#!/usr/bin/env node
/**
 * Mecum NEXT_DATA Extractor
 *
 * Extracts from __NEXT_DATA__ JSON which contains:
 * - hammerPrice (sale price!)
 * - saleResults (sold/not_sold)
 * - auctionId, auctionName
 * - runDates
 * - All vehicle specs
 * - Full image gallery
 *
 * This creates auction_events for timeline tracking - same vehicle
 * can appear at multiple auctions (provenance chain).
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const PARALLEL = parseInt(process.argv[3]) || 3;

// Cache of existing VINs for deduplication
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
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

async function extractFromNextData(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Extract __NEXT_DATA__ JSON
    const nextData = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      if (script) {
        try {
          return JSON.parse(script.textContent);
        } catch (e) {
          return null;
        }
      }
      return null;
    });

    if (!nextData?.props?.pageProps?.post) {
      // Fallback to text scraping if no NEXT_DATA
      return await fallbackTextExtract(page);
    }

    const post = nextData.props.pageProps.post;

    // Extract sale result
    const saleResult = post.saleResults?.edges?.[0]?.node?.slug || 'unknown';
    const hammerPrice = post.hammerPrice > 0 ? post.hammerPrice : null;
    const currentBid = post.currentBid > 0 ? post.currentBid : null;

    // Extract auction info
    const auctionTax = post.auctionsTax?.edges?.[0]?.node || {};
    const runDate = post.runDates?.edges?.[0]?.node?.slug || null;

    // Extract vehicle specs from lotFields
    const lotFields = post.lotFields || {};

    // Parse title for year/make/model
    const title = post.title?.replace(/&#039;/g, "'") || '';
    let year = null, make = null, model = null;
    const titleMatch = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    if (titleMatch) {
      year = parseInt(titleMatch[1]);
      make = titleMatch[2];
      model = titleMatch[3];
    }

    // Also check lotYears
    if (!year && post.lotYears?.edges?.[0]?.node?.name) {
      year = parseInt(post.lotYears.edges[0].node.name);
    }

    // Get images from lotGallery
    const images = (post.lotGallery || [])
      .map(img => img.mediaItemUrl || img.sourceUrl)
      .filter(Boolean)
      .map(url => url.replace(/w_\d+/, 'w_1920'));

    // If no gallery, try JSON-LD
    if (images.length === 0) {
      const jsonLdImages = await page.evaluate(() => {
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
      images.push(...jsonLdImages);
    }

    // Extract highlights and equipment from content
    const highlights = [];
    const equipment = [];
    if (post.content) {
      // Parse HTML content for highlights/equipment sections
      const tempDiv = await page.evaluate((html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        const text = div.innerText;
        return text;
      }, post.content);

      const hlMatch = tempDiv.match(/HIGHLIGHTS([\s\S]*?)(?:EQUIPMENT|PHOTOS|$)/i);
      if (hlMatch) {
        highlights.push(...hlMatch[1].split('\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 300));
      }

      const eqMatch = tempDiv.match(/EQUIPMENT([\s\S]*?)(?:PHOTOS|$)/i);
      if (eqMatch) {
        equipment.push(...eqMatch[1].split('\n').map(s => s.trim()).filter(s => s.length > 5 && s.length < 200));
      }
    }

    // Get VIN from page text (not in NEXT_DATA usually)
    const bodyText = await page.evaluate(() => document.body.innerText);
    const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);

    return {
      // Vehicle identity
      vin: vinMatch?.[1] || null,
      title,
      year,
      make,
      model,

      // Specs (from NEXT_DATA)
      engine: lotFields.engine || post.engine || null,
      transmission: post.transmission || lotFields.transmission || null,
      exterior_color: lotFields.exteriorColor || post.exterior || null,
      interior_color: lotFields.interiorColor || post.interior || null,
      body_style: lotFields.bodyStyle || null,
      mileage: post.odometer || lotFields.mileage || null,

      // Content
      highlights,
      equipment,
      images,
      description: post.content?.replace(/<[^>]+>/g, ' ').slice(0, 5000) || null,

      // Sale result (THE IMPORTANT PART!)
      sale_result: saleResult,
      hammer_price: hammerPrice,
      current_bid: currentBid,

      // Auction event data
      auction_id: auctionTax.auctionId || null,
      auction_name: auctionTax.name || null,
      auction_slug: auctionTax.slug || null,
      run_date: runDate,
      lot_number: post.lotNumber || null,

      // Metadata
      salesforce_id: post.salesforceItemId || null,
      post_date: post.date || null
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function fallbackTextExtract(page) {
  // Original text-based extraction as fallback
  const bodyText = await page.evaluate(() => document.body.innerText);

  const findAfter = (label) => {
    const regex = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
    return bodyText.match(regex)?.[1]?.trim() || null;
  };

  const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);
  const rawTitle = await page.evaluate(() => document.querySelector('h1')?.innerText?.trim());

  let title = rawTitle, year = null, make = null, model = null;
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

  const images = await page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .map(i => i.src || i.dataset?.src)
      .filter(s => s && s.includes('mecum') && s.includes('upload'))
      .filter(s => !s.includes('logo') && !s.includes('icon'))
      .map(s => s.replace(/w_\d+/, 'w_1920').split('?')[0])
      .filter((v, i, a) => a.indexOf(v) === i)
  );

  const soldMatch = bodyText.match(/Sold\s*(?:For)?\s*\$?([\d,]+)/i);
  const highBidMatch = bodyText.match(/High\s*Bid\s*\$?([\d,]+)/i);
  const mileageMatch = bodyText.match(/ODOMETER[^\d]*([\d,]+)/i);
  const lotMatch = bodyText.match(/LOT\s+([A-Z]?\d+)/i);

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
    mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
    images,
    hammer_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
    current_bid: highBidMatch ? parseInt(highBidMatch[1].replace(/,/g, '')) : null,
    sale_result: soldMatch ? 'sold' : (highBidMatch ? 'bid_to' : 'unknown'),
    lot_number: lotMatch?.[1],
    highlights: [],
    equipment: []
  };
}

async function upsertVehicle(vehicleId, data) {
  // Check if VIN already exists (deduplication)
  const existingVehicleId = data.vin && vinToVehicleId.has(data.vin)
    ? vinToVehicleId.get(data.vin)
    : null;

  const targetVehicleId = existingVehicleId || vehicleId;

  // Build description
  const descParts = [];
  if (data.highlights?.length) descParts.push('HIGHLIGHTS:\n' + data.highlights.join('\n'));
  if (data.equipment?.length) descParts.push('EQUIPMENT:\n' + data.equipment.join('\n'));
  const description = data.description || (descParts.length > 0 ? descParts.join('\n\n') : null);

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
    status: 'active'
  };

  // Set price based on sale result
  if (data.hammer_price) {
    updateData.sale_price = data.hammer_price;
    updateData.sold_price = data.hammer_price;
  } else if (data.current_bid) {
    updateData.high_bid = data.current_bid;
  }

  // Remove null values
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

  // Store images (don't delete existing - append for provenance)
  if (data.images?.length > 0) {
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
          vehicle_id: targetVehicleId,
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

  // Mark original as merged if deduplicated
  if (existingVehicleId && existingVehicleId !== vehicleId) {
    await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicleId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'merged', merged_into_vehicle_id: existingVehicleId })
    });
  }

  if (data.vin) vinToVehicleId.set(data.vin, targetVehicleId);

  return { vehicleId: targetVehicleId, isNew: !existingVehicleId };
}

async function createAuctionEvent(vehicleId, sourceUrl, data) {
  // Parse run_date to proper date format
  let auctionDate = null;
  if (data.run_date) {
    auctionDate = data.run_date; // Already in YYYY-MM-DD format
  }

  const eventData = {
    vehicle_id: vehicleId,
    source: 'mecum',
    source_url: sourceUrl,
    source_listing_id: data.salesforce_id?.toString(),
    lot_number: data.lot_number,
    auction_start_date: auctionDate,
    auction_end_date: auctionDate,
    outcome: data.sale_result === 'sold' ? 'sold' : (data.sale_result === 'not-sold' ? 'not_sold' : data.sale_result),
    high_bid: data.current_bid,
    winning_bid: data.hammer_price,
    raw_data: {
      auction_id: data.auction_id,
      auction_name: data.auction_name,
      auction_slug: data.auction_slug,
      post_date: data.post_date,
      extractor: 'mecum-json-extract'
    }
  };

  // Check if event already exists
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?source_url=eq.${encodeURIComponent(sourceUrl)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();

  if (existing.length > 0) {
    // Update existing event with new data
    await fetch(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventData)
    });
    return { created: false, updated: true, id: existing[0].id };
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

    const data = await extractFromNextData(page, vehicle.discovery_url);

    if (data.error) {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ERROR: ${data.error.slice(0, 50)}`);
      continue;
    }

    const { vehicleId, isNew } = await upsertVehicle(vehicle.id, data);
    const event = await createAuctionEvent(vehicleId, vehicle.discovery_url, data);

    // Build status line
    const fields = [];
    if (data.year) fields.push(data.year);
    if (data.make) fields.push(data.make);
    if (data.model) fields.push(data.model?.slice(0, 12));
    if (data.vin) fields.push('VIN');
    if (data.mileage) fields.push('mi');
    if (data.engine) fields.push('eng');
    if (data.exterior_color) fields.push('clr');

    // Price info (the important part!)
    if (data.hammer_price) {
      fields.push(`SOLD $${(data.hammer_price / 1000).toFixed(0)}k`);
      stats.sold++;
    } else if (data.current_bid) {
      fields.push(`bid $${(data.current_bid / 1000).toFixed(0)}k`);
    } else if (data.sale_result === 'not-sold') {
      fields.push('NOT SOLD');
      stats.notSold++;
    }

    if (data.images?.length) fields.push(data.images.length + 'img');

    // Auction info
    if (data.auction_name) fields.push(data.auction_name.slice(0, 12));

    const eventStatus = event.created ? '+event' : (event.updated ? '~event' : '');
    const dedup = !isNew ? ` [DEDUP→${vehicleId.slice(0, 8)}]` : '';

    console.log(`[W${workerId}] ✓ ${fields.join(',')} ${eventStatus}${dedup}`);
    stats.processed++;
    if (!isNew) stats.deduplicated++;
    if (event.created) stats.events++;
  }

  await context.close();
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Mecum JSON Extractor (NEXT_DATA)                            ║');
  console.log('║  Extracts hammerPrice, saleResults, auction events           ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Workers: ${PARALLEL}                                      ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await loadExistingVins();

  const vehicles = await getVehiclesToProcess();
  console.log(`Found ${vehicles.length} pending vehicles to process\n`);

  if (vehicles.length === 0) return;

  const browser = await chromium.launch({ headless: true });
  const queue = [...vehicles];
  const stats = { processed: 0, deduplicated: 0, events: 0, errors: 0, sold: 0, notSold: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, queue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Done!`);
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Sold (with price): ${stats.sold}`);
  console.log(`   Not sold: ${stats.notSold}`);
  console.log(`   Deduplicated: ${stats.deduplicated}`);
  console.log(`   Auction events: ${stats.events}`);
  console.log(`   Errors: ${stats.errors}`);
}

main().catch(console.error);
