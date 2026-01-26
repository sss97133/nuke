#!/usr/bin/env node
/**
 * Mecum ULTIMATE Extractor - Captures EVERYTHING
 *
 * New fields discovered:
 * - vinSerial (separate from VIN search)
 * - highEstimate / lowEstimate
 * - engineNumber / frameNumber
 * - isActualMiles
 * - lotSeries (often contains provenance summary)
 * - Full content blocks (ownership history, restoration, events)
 * - Auction venue details (address, city, state, zip)
 * - collectionsTax (when from named collection)
 * - pageTemplate (premium = important car)
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const PARALLEL = parseInt(process.argv[3]) || 3;

let vinToVehicleId = new Map();
let collectionSlugToId = new Map();

async function loadExistingCollections() {
  console.log('Loading existing collections...');
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?type=eq.collection&select=id,slug,name`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  data.forEach(org => collectionSlugToId.set(org.slug, org.id));
  console.log(`Loaded ${collectionSlugToId.size} existing collections`);
}

async function getOrCreateCollection(name, slug, sourceUrl) {
  // Check cache first
  if (collectionSlugToId.has(slug)) {
    return collectionSlugToId.get(slug);
  }

  // Try to create
  const res = await fetch(`${SUPABASE_URL}/rest/v1/organizations`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=ignore-duplicates'
    },
    body: JSON.stringify({
      name: name,
      slug: slug,
      type: 'collection',
      discovered_via: 'mecum-extraction',
      source_url: sourceUrl,
      is_verified: false,
      is_active: true
    })
  });

  if (res.ok) {
    const [org] = await res.json();
    if (org) {
      collectionSlugToId.set(slug, org.id);
      console.log(`  📦 Created collection: ${name}`);
      return org.id;
    }
  }

  // If insert failed, try to fetch existing
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/organizations?slug=eq.${encodeURIComponent(slug)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();
  if (existing.length > 0) {
    collectionSlugToId.set(slug, existing[0].id);
    return existing[0].id;
  }

  return null;
}

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
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&status=eq.pending&select=id,discovery_url&limit=${BATCH_SIZE}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

async function extractFullData(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Get __NEXT_DATA__
    const nextData = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      return script ? JSON.parse(script.textContent) : null;
    });

    if (!nextData?.props?.pageProps?.post) {
      return { error: 'No NEXT_DATA' };
    }

    const post = nextData.props.pageProps.post;

    // Basic vehicle info
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

    // Sale result
    const saleResult = post.saleResults?.edges?.[0]?.node?.slug || 'unknown';
    const hammerPrice = post.hammerPrice > 0 ? post.hammerPrice : null;
    const currentBid = post.currentBid > 0 ? post.currentBid : null;

    // Auction info
    const auctionTax = post.auctionsTax?.edges?.[0]?.node || {};
    const runDate = post.runDates?.edges?.[0]?.node?.slug || null;
    const auctionFields = post.auction?.nodes?.[0]?.auctionFields || {};

    // Collection (owner info when present)
    const collection = post.collectionsTax?.edges?.[0]?.node || null;

    // Extract ALL content blocks for provenance
    const contentBlocks = [];
    const extractContent = (obj) => {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach(item => extractContent(item));
      } else if (typeof obj === 'object') {
        if (obj.content && typeof obj.content === 'string') {
          const text = obj.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length > 20) {
            contentBlocks.push(text);
          }
        }
        if (obj.innerBlocks) extractContent(obj.innerBlocks);
        if (obj.attributes) extractContent(obj.attributes);
        Object.values(obj).forEach(v => {
          if (typeof v === 'object') extractContent(v);
        });
      }
    };
    extractContent(post.blocks);

    // Parse ownership history from content
    const ownershipHistory = [];
    const fullContent = contentBlocks.join(' ');

    // Find owner mentions
    const ownerMatches = fullContent.match(
      /(?:original owner|sold to|owned by|acquired by|purchased by|kept by)\s+(?:was\s+)?([A-Z][a-zA-Z\s,]+?)(?:,?\s+(?:of|in|from)\s+([A-Z][a-zA-Z\s,]+?))?(?:\.|,|who|in\s+\d{4})/gi
    ) || [];
    ownershipHistory.push(...ownerMatches);

    // Get images from JSON-LD (more reliable)
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

    // Fallback to post.images
    if (images.length === 0 && post.images) {
      images.push(...post.images.map(i => i.url).filter(Boolean));
    }

    // Get VIN from page text (backup)
    const bodyText = await page.evaluate(() => document.body.innerText);
    const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);

    // Highlights extraction
    const highlightsMatch = bodyText.match(/HIGHLIGHTS([\s\S]*?)(?:EQUIPMENT|PHOTOS|Information|$)/i);
    const highlights = highlightsMatch
      ? highlightsMatch[1].split('\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 300)
      : [];

    return {
      // Vehicle identity
      vin: post.vinSerial || vinMatch?.[1] || null,
      title,
      year,
      make,
      model,

      // Specs
      engine: post.engine || null,
      transmission: post.transmission || null,
      exterior_color: post.color || null,
      interior_color: post.interior || null,
      mileage: post.odometer || null,
      odometer_units: post.odometerUnits || 'M',
      is_actual_miles: post.isActualMiles || null,

      // Additional identifiers
      engine_number: post.engineNumber || null,
      frame_number: post.frameNumber || null,

      // Content
      highlights,
      images,
      description: contentBlocks.join('\n\n'),
      lot_series: post.lotSeries || null,

      // Sale result
      sale_result: saleResult,
      hammer_price: hammerPrice,
      current_bid: currentBid,

      // Estimates
      high_estimate: post.highEstimate ? parseInt(post.highEstimate) : null,
      low_estimate: post.lowEstimate ? parseInt(post.lowEstimate) : null,

      // Auction event data
      auction_id: auctionTax.auctionId || null,
      auction_name: auctionTax.name || null,
      auction_slug: auctionTax.slug || null,
      run_date: runDate,
      lot_number: post.lotNumber || null,

      // Auction venue
      auction_venue: auctionFields.auctionVenue || null,
      auction_city: auctionFields.auctionCity || null,
      auction_state: auctionFields.auctionState || null,
      auction_address: auctionFields.auctionAddress || null,
      auction_zip: auctionFields.auctionZip || null,

      // Collection/Owner
      collection_name: collection?.name || null,
      collection_slug: collection?.slug || null,

      // Provenance
      ownership_history: ownershipHistory,
      provenance_content: contentBlocks.filter(b =>
        b.toLowerCase().includes('owner') ||
        b.toLowerCase().includes('sold to') ||
        b.toLowerCase().includes('restored') ||
        b.toLowerCase().includes('history') ||
        b.toLowerCase().includes('acquired')
      ),

      // Meta
      salesforce_id: post.salesforceItemId || null,
      database_id: post.databaseId || null,
      page_template: post.pageTemplate || 'standard',
      post_date: post.date || null
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function upsertVehicle(vehicleId, data, sourceUrl) {
  const existingVehicleId = data.vin && vinToVehicleId.has(data.vin)
    ? vinToVehicleId.get(data.vin)
    : null;

  const targetVehicleId = existingVehicleId || vehicleId;

  // Handle collection creation/linking
  let collectionId = null;
  if (data.collection_name && data.collection_slug) {
    collectionId = await getOrCreateCollection(data.collection_name, data.collection_slug, sourceUrl);
  }

  // Build comprehensive description
  let description = '';
  if (data.lot_series) description += `${data.lot_series}\n\n`;
  if (data.highlights?.length) description += 'HIGHLIGHTS:\n' + data.highlights.join('\n') + '\n\n';
  if (data.description) description += data.description;

  const updateData = {
    vin: data.vin,
    year: data.year,
    make: data.make,
    model: data.model,
    transmission: data.transmission,
    color: data.exterior_color,
    interior_color: data.interior_color,
    mileage: data.mileage,
    highlights: data.highlights,
    description: description || null,
    primary_image_url: data.images?.[0],
    image_url: data.images?.[0],
    status: 'active'
  };

  // Link to collection if found
  if (collectionId) {
    updateData.selling_organization_id = collectionId;
  }

  // Price fields - depends on sale result
  if (data.hammer_price) {
    if (data.sale_result === 'sold') {
      // Actually sold - hammer_price is the sale price
      updateData.sale_price = data.hammer_price;
      updateData.sold_price = data.hammer_price;
    } else {
      // bid-goes-on, not-sold, etc - hammer_price is the high bid
      updateData.high_bid = data.hammer_price;
    }
  } else if (data.current_bid) {
    updateData.high_bid = data.current_bid;
  }

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

  // Store images
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
          is_primary: i === 0,
          position: i,
          is_external: true
        })
      });
    }
  }

  // Mark as merged if deduplicated
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
  const eventData = {
    vehicle_id: vehicleId,
    source: 'mecum',
    source_url: sourceUrl,
    source_listing_id: data.salesforce_id?.toString(),
    lot_number: data.lot_number,
    auction_start_date: data.run_date,
    auction_end_date: data.run_date,
    outcome: data.sale_result === 'sold' ? 'sold' : data.sale_result,
    winning_bid: data.sale_result === 'sold' ? data.hammer_price : null,
    high_bid: data.sale_result !== 'sold' ? data.hammer_price : data.current_bid,
    estimate_low: data.low_estimate,
    estimate_high: data.high_estimate,
    seller_location: data.auction_city && data.auction_state
      ? `${data.auction_city}, ${data.auction_state}`
      : null,
    raw_data: {
      auction_id: data.auction_id,
      auction_name: data.auction_name,
      auction_slug: data.auction_slug,
      auction_venue: data.auction_venue,
      auction_address: data.auction_address,
      auction_zip: data.auction_zip,
      collection_name: data.collection_name,
      lot_series: data.lot_series,
      page_template: data.page_template,
      ownership_history: data.ownership_history,
      provenance_content: data.provenance_content,
      extractor: 'mecum-ultimate-extract'
    }
  };

  // Check for existing
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?source_url=eq.${encodeURIComponent(sourceUrl)}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();

  if (existing.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/auction_events?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventData)
    });
    return { updated: true, id: existing[0].id };
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
  return { error: await res.text() };
}

async function worker(workerId, browser, queue, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  while (queue.length > 0) {
    const vehicle = queue.shift();
    if (!vehicle) break;

    const data = await extractFullData(page, vehicle.discovery_url);

    if (data.error) {
      stats.errors++;
      console.log(`[W${workerId}] ✗ ${data.error.slice(0, 50)}`);
      continue;
    }

    const { vehicleId, isNew } = await upsertVehicle(vehicle.id, data, vehicle.discovery_url);
    const event = await createAuctionEvent(vehicleId, vehicle.discovery_url, data);

    // Build status
    const fields = [];
    if (data.year) fields.push(data.year);
    if (data.make) fields.push(data.make);
    if (data.model) fields.push(data.model?.slice(0, 10));
    if (data.vin) fields.push('VIN');

    if (data.hammer_price) {
      const priceStr = data.hammer_price >= 1000000
        ? `$${(data.hammer_price / 1000000).toFixed(1)}M`
        : `$${(data.hammer_price / 1000).toFixed(0)}k`;
      if (data.sale_result === 'sold') {
        fields.push(`SOLD ${priceStr}`);
        stats.sold++;
        stats.totalSales += data.hammer_price;
      } else {
        fields.push(`BID ${priceStr}`);
        stats.bidTo++;
      }
    }

    if (data.images?.length) fields.push(data.images.length + 'img');
    if (data.collection_name) {
      fields.push(`[${data.collection_name.slice(0, 12)}]`);
      stats.collections++;
    }
    if (data.ownership_history?.length) fields.push(`${data.ownership_history.length}own`);
    if (data.low_estimate) fields.push(`e$${(data.low_estimate/1000).toFixed(0)}k`);

    const eventStatus = event.created ? '+' : (event.updated ? '~' : '');
    const dedup = !isNew ? `→${vehicleId.slice(0, 5)}` : '';

    console.log(`[${workerId}] ${fields.join(' | ')} ${eventStatus}${dedup}`);
    stats.processed++;
    if (!isNew) stats.deduplicated++;
    if (event.created) stats.events++;
  }

  await context.close();
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  🏆 Mecum ULTIMATE Extractor                                  ║');
  console.log('║  Price + Estimates + Provenance + Ownership History           ║');
  console.log(`║  Batch: ${BATCH_SIZE} | Workers: ${PARALLEL}                                       ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  await loadExistingVins();
  await loadExistingCollections();

  const vehicles = await getVehiclesToProcess();
  console.log(`Found ${vehicles.length} pending vehicles\n`);

  if (vehicles.length === 0) return;

  const browser = await chromium.launch({ headless: true });
  const queue = [...vehicles];
  const stats = { processed: 0, deduplicated: 0, events: 0, errors: 0, sold: 0, bidTo: 0, totalSales: 0, collections: 0 };

  const workers = [];
  for (let i = 0; i < PARALLEL; i++) {
    workers.push(worker(i, browser, queue, stats));
  }

  await Promise.all(workers);
  await browser.close();

  console.log(`\n✅ Done!`);
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Sold: ${stats.sold} ($${(stats.totalSales/1000000).toFixed(1)}M total)`);
  console.log(`   Bid-to (unsold): ${stats.bidTo}`);
  console.log(`   Collections: ${stats.collections} (${collectionSlugToId.size} unique)`);
  console.log(`   Deduplicated: ${stats.deduplicated}`);
  console.log(`   Events: ${stats.events}`);
  console.log(`   Errors: ${stats.errors}`);
}

main().catch(console.error);
