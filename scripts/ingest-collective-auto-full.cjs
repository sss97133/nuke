#!/usr/bin/env node
/**
 * Full Collective Auto Group scraper - creates complete vehicle profiles
 * Usage: node scripts/ingest-collective-auto-full.js [max_pages]
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

// Load env vars from multiple sources
require('dotenv').config({ path: './.env' });  // Root .env for FIRECRAWL_API_KEY
require('dotenv').config({ path: './nuke_frontend/.env.local' });  // Frontend env for Supabase

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Use service_role auth options to bypass RLS
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
const ORG_ID = 'b8a962a3-1aeb-44a2-92be-e23a7728c277';
const MAX_PAGES = parseInt(process.argv[2]) || 30;
const RATE_LIMIT_MS = 1000; // Firecrawl handles rate limiting
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

if (!FIRECRAWL_KEY) {
  console.error('Missing FIRECRAWL_API_KEY - needed to bypass rate limiting');
  process.exit(1);
}

// Fetch URL via Firecrawl API (bypasses rate limiting and anti-bot)
async function fetchPage(url) {
  // For NHTSA API, use direct fetch
  if (url.includes('vpic.nhtsa.dot.gov')) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }
  
  // Use Firecrawl for all other URLs
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      waitFor: 2000,
      formats: ['html']
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl error ${response.status}: ${errorText}`);
  }
  
  const data = await response.json();
  if (!data.success || !data.data?.html) {
    throw new Error('Firecrawl returned no HTML');
  }
  
  return data.data.html;
}

// Decode VIN using NHTSA
async function decodeVIN(vin) {
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`;
    const data = await fetchPage(url);
    const json = JSON.parse(data);
    const results = json.Results || [];
    
    const getVal = (variableId) => {
      const item = results.find(r => r.VariableId === variableId);
      return item?.Value && item.Value !== 'Not Applicable' ? item.Value : null;
    };
    
    return {
      year: parseInt(getVal(29)) || null,
      make: getVal(26),
      model: getVal(28),
      series: getVal(34),
      trim: getVal(38),
      body_class: getVal(5),
      doors: parseInt(getVal(14)) || null,
      engine_cylinders: parseInt(getVal(9)) || null,
      engine_displacement: getVal(11),
      engine_code: getVal(13) || getVal(233),
      fuel_type: getVal(24),
      plant_country: getVal(75),
      plant_city: getVal(31),
      gvwr: getVal(25),
    };
  } catch (err) {
    console.log(`   Warning: VIN decode failed for ${vin}: ${err.message}`);
    return null;
  }
}

// Extract vehicle details from listing page
async function extractVehicleDetails(url) {
  try {
    const html = await fetchPage(url);
    
    // Extract VIN
    const vinMatch = html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    const vin = vinMatch ? vinMatch[1].toUpperCase() : null;
    
    // Extract mileage
    const mileageMatch = html.match(/([\d,]+)\s*(?:Miles|miles|mi\.?)\b/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;
    
    // Extract year from URL slug
    const urlYearMatch = url.match(/\/(\d{4})-/);
    const year = urlYearMatch ? parseInt(urlYearMatch[1]) : null;
    
    // Extract make/model from URL slug
    let make = null, model = null;
    const slugMatch = url.match(/\/\d{4}-([^/]+)$/);
    if (slugMatch) {
      const parts = slugMatch[1].split('-');
      make = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      model = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }
    
    // Extract image URLs
    const imageUrls = [];
    const imgMatches = html.matchAll(/https:\/\/cdn\.dealeraccelerate\.com\/collective\/[^"'\s<>]+/g);
    const seen = new Set();
    for (const m of imgMatches) {
      const imgUrl = m[0].replace(/1920x1440|800x600|400x300/g, '1920x1440');
      if (!seen.has(imgUrl)) {
        seen.add(imgUrl);
        imageUrls.push(imgUrl);
      }
    }
    
    return { vin, mileage, year, make, model, imageUrls };
  } catch (err) {
    console.log(`   Warning: Failed to extract details from ${url}: ${err.message}`);
    return null;
  }
}

// Create or update vehicle in database
async function upsertVehicle(listing, details, nhtsaData) {
  const { url, vin } = listing;
  
  // Check if vehicle already exists
  if (vin) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vin)
      .maybeSingle();
    
    if (existing) {
      console.log(`   Skipping ${vin} - already exists`);
      return { skipped: true, vehicleId: existing.id };
    }
  }
  
  // Merge data sources (engine_cylinders column doesn't exist, use engine_size for cylinder info)
  const vehicleData = {
    vin: vin || null,
    year: nhtsaData?.year || details?.year || listing.year,
    make: nhtsaData?.make || details?.make || listing.make,
    model: nhtsaData?.model || details?.model || listing.model,
    trim: nhtsaData?.trim || nhtsaData?.series,
    series: nhtsaData?.series,
    body_style: nhtsaData?.body_class,
    engine_size: nhtsaData?.engine_cylinders ? `${nhtsaData.engine_displacement || ''} ${nhtsaData.engine_cylinders}-cyl`.trim() : nhtsaData?.engine_displacement,
    engine_displacement: nhtsaData?.engine_displacement,
    engine_code: nhtsaData?.engine_code,
    engine_liters: nhtsaData?.engine_displacement ? parseFloat(nhtsaData.engine_displacement) : null,
    fuel_type: nhtsaData?.fuel_type,
    doors: nhtsaData?.doors,
    mileage: details?.mileage || listing.mileage,
    status: 'active',
    sale_status: 'sold',
    source: 'dealer_website',
    discovery_source: 'Collective Auto Group',
    discovery_url: url,
    listing_url: url,
    listing_source: 'Collective Auto Group',
    listing_title: `${details?.year || listing.year} ${details?.make || listing.make} ${details?.model || listing.model}`.trim(),
    city: 'Longwood',
    state: 'FL',
    country: 'USA',
    is_public: true,
    vin_source: vin ? 'Collective Auto Group listing' : null,
    year_source: 'Collective Auto Group listing',
    make_source: 'Collective Auto Group listing',
    model_source: 'Collective Auto Group listing',
    mileage_source: 'Collective Auto Group listing',
    profile_origin: 'organization_import',
    platform_source: 'Collective Auto Group',
    platform_url: 'https://www.collectiveauto.com',
    content_source_type: 'organization',
    provenance_metadata: {
      source: 'Collective Auto Group',
      scraped_at: new Date().toISOString(),
      nhtsa_decoded: !!nhtsaData,
      image_count: details?.imageUrls?.length || 0,
    },
  };
  
  // Set primary image
  if (details?.imageUrls?.[0]) {
    vehicleData.primary_image_url = details.imageUrls[0];
    vehicleData.image_url = details.imageUrls[0];
  }
  
  // Insert vehicle
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .insert(vehicleData)
    .select('id')
    .single();
  
  if (error) {
    console.log(`   Error inserting vehicle: ${error.message}`);
    return { error: true };
  }
  
  const vehicleId = vehicle.id;
  
  // Link to organization
  await supabase
    .from('organization_vehicles')
    .insert({
      organization_id: ORG_ID,
      vehicle_id: vehicleId,
      relationship_type: 'sold_by',
      status: 'sold',
      listing_status: 'sold',
      sale_date: new Date().toISOString().split('T')[0],
      notes: `Vehicle sold by Collective Auto Group. Source: ${url}`,
    });
  
  // Add timeline event (using base table timeline_events)
  await supabase
    .from('timeline_events')
    .insert({
      vehicle_id: vehicleId,
      event_type: 'sale',
      event_date: new Date().toISOString(),
      title: 'Sold by Collective Auto Group',
      description: `Listed and sold through Collective Auto Group in Longwood, FL.${details?.mileage ? ` Vehicle had ${details.mileage.toLocaleString()} miles at time of sale.` : ''}`,
      source: 'Collective Auto Group',
      mileage_at_event: details?.mileage,
      location_name: 'Collective Auto Group',
      location_address: '110 Bomar Ct Unit 122, Longwood, FL 32750',
      metadata: {
        seller: 'Collective Auto Group',
        seller_website: 'https://www.collectiveauto.com',
        listing_url: url,
        listing_status: 'sold',
        photo_count: details?.imageUrls?.length || 0,
        organization_id: ORG_ID,
      },
    });
  
  // Add images
  if (details?.imageUrls?.length > 0) {
    const imageInserts = details.imageUrls.map((imgUrl, idx) => ({
      vehicle_id: vehicleId,
      image_url: imgUrl,
      image_type: idx === 0 ? 'exterior' : 'gallery',
      category: idx === 0 ? 'hero' : 'gallery',
      position: idx + 1,
      is_primary: idx === 0,
      source: 'organization_import',
      source_url: url,
      is_external: true,
    }));
    
    await supabase
      .from('vehicle_images')
      .insert(imageInserts);
  }
  
  return { created: true, vehicleId };
}

async function scrapeListingsPage(pageNum) {
  const url = pageNum === 1 
    ? 'https://www.collectiveauto.com/vehicles/sold'
    : `https://www.collectiveauto.com/vehicles/sold?page=${pageNum}`;
  
  console.log(`\nScraping page ${pageNum}: ${url}`);
  
  const html = await fetchPage(url);
  
  // Extract all vehicle links
  const listings = [];
  const linkMatches = html.matchAll(/href="(\/vehicles\/\d+\/[^"]+)"/g);
  const seenUrls = new Set();
  
  for (const m of linkMatches) {
    const fullUrl = `https://www.collectiveauto.com${m[1]}`;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);
    
    // Extract year/make/model from URL
    const urlMatch = m[1].match(/\/(\d{4})-(.+)$/);
    if (urlMatch) {
      const year = parseInt(urlMatch[1]);
      const parts = urlMatch[2].split('-');
      const make = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      const model = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      
      // Try to extract VIN from page context
      const vinMatch = html.match(new RegExp(`${m[1]}[^"]*"[^>]*>[^<]*<[^>]*>\\s*([A-HJ-NPR-Z0-9]{17})`, 'i'));
      const vin = vinMatch ? vinMatch[1].toUpperCase() : null;
      
      listings.push({ url: fullUrl, year, make, model, vin });
    }
  }
  
  // Check for next page
  const hasNextPage = html.includes(`page=${pageNum + 1}`) || html.includes(`>Next<`) || html.includes(`»`);
  
  return { listings, hasNextPage };
}

async function main() {
  console.log('='.repeat(70));
  console.log('COLLECTIVE AUTO GROUP - FULL VEHICLE INGESTION');
  console.log('='.repeat(70));
  console.log(`Max pages: ${MAX_PAGES}`);
  console.log(`Organization ID: ${ORG_ID}\n`);
  
  // Collect all listings first
  let allListings = [];
  let currentPage = 1;
  let hasMorePages = true;
  
  while (hasMorePages && currentPage <= MAX_PAGES) {
    try {
      const { listings, hasNextPage } = await scrapeListingsPage(currentPage);
      console.log(`   Found ${listings.length} vehicles on page ${currentPage}`);
      allListings.push(...listings);
      
      hasMorePages = hasNextPage && listings.length > 0;
      currentPage++;
      
      if (hasMorePages) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      }
    } catch (err) {
      console.log(`   Error on page ${currentPage}: ${err.message}`);
      hasMorePages = false;
    }
  }
  
  console.log(`\nTotal listings found: ${allListings.length}`);
  console.log('\n' + '='.repeat(70));
  console.log('PROCESSING VEHICLES');
  console.log('='.repeat(70) + '\n');
  
  let created = 0, skipped = 0, errors = 0;
  
  for (let i = 0; i < allListings.length; i++) {
    const listing = allListings[i];
    console.log(`[${i + 1}/${allListings.length}] ${listing.year} ${listing.make} ${listing.model}`);
    
    try {
      // Get details from listing page
      const details = await extractVehicleDetails(listing.url);
      const vin = details?.vin || listing.vin;
      
      // Decode VIN if we have one
      let nhtsaData = null;
      if (vin) {
        listing.vin = vin;
        nhtsaData = await decodeVIN(vin);
        await new Promise(r => setTimeout(r, 100)); // NHTSA rate limit
      }
      
      // Create vehicle
      const result = await upsertVehicle(listing, details, nhtsaData);
      
      if (result.skipped) {
        skipped++;
      } else if (result.error) {
        errors++;
      } else {
        created++;
        console.log(`   Created vehicle ${result.vehicleId}${vin ? ` (VIN: ${vin})` : ''} with ${details?.imageUrls?.length || 0} images`);
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
      
    } catch (err) {
      console.log(`   Error: ${err.message}`);
      errors++;
    }
  }
  
  // Update business counts
  await supabase
    .from('businesses')
    .update({
      total_sold: created + skipped,
      total_listings: created + skipped,
    })
    .eq('id', ORG_ID);
  
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total found: ${allListings.length}`);
  console.log(`Created: ${created}`);
  console.log(`Skipped (duplicates): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log('='.repeat(70));
}

main().catch(console.error);

