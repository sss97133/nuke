#!/usr/bin/env node
/**
 * BACKFILL ORGANIZATION VEHICLES FROM BAT PROFILE
 * 
 * For a given organization, this script:
 * 1. Scrapes all listings from their BAT profile
 * 2. Gets all vehicles currently linked to the organization
 * 3. Matches vehicles to BAT listings by year/make/model (with make normalization: CHEV→Chevrolet, etc.)
 * 4. Backfills missing BAT data (URLs, sale prices, sale dates, images, etc.)
 * 5. Creates NEW vehicle profiles for ALL unmatched BAT listings
 *    - This increases the organization's sold inventory count
 *    - Merge proposals will automatically detect any duplicates
 * 
 * Make Normalization:
 * - CHEV/CHEVY → Chevrolet
 * - Benz/Mercedes/MB → Mercedes-Benz
 * - VW/Volks → Volkswagen
 * - And 40+ other common abbreviations
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase key not found in environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Organization ID from URL: c433d27e-2159-4f8c-b4ae-32a5e44a77cf
const ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_BAT_PROFILE = 'https://bringatrailer.com/member/vivalasvegasautos/';
const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

console.log('🚀 BACKFILLING ORGANIZATION VEHICLES FROM BAT PROFILE\n');
console.log(`Organization: ${ORG_ID}`);
console.log(`BAT Profile: ${VIVA_BAT_PROFILE}\n`);

// Step 1: Scrape all BAT listings from the profile
async function scrapeBATProfile() {
  console.log('📋 Scraping BAT profile for listings...\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(VIVA_BAT_PROFILE, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    // Click "Show more" until all listings are loaded
    let showMoreClicked = 0;
    while (true) {
      try {
        const showMoreButton = await page.$('button:has-text("Show more"), button:has-text("Load more")');
        if (!showMoreButton) break;
        
        const isDisabled = await showMoreButton.isDisabled();
        if (isDisabled) break;
        
        await showMoreButton.click();
        await page.waitForTimeout(2000);
        showMoreClicked++;
        console.log(`   Loaded more listings (${showMoreClicked})...`);
      } catch (e) {
        break;
      }
    }
    
    // Extract all listing URLs and basic info
    const listings = await page.$$eval('a[href*="/listing/"]', (links) => {
      const seen = new Set();
      return links
        .map(link => {
          const href = link.getAttribute('href');
          if (!href || !href.includes('/listing/')) return null;
          
          const fullUrl = href.startsWith('http') ? href : `https://bringatrailer.com${href}`;
          if (seen.has(fullUrl)) return null;
          seen.add(fullUrl);
          
          const text = link.textContent?.trim() || '';
          return {
            url: fullUrl,
            title: text
          };
        })
        .filter(Boolean);
    });
    
    await browser.close();
    
    console.log(`   Found ${listings.length} unique listings\n`);
    return listings;
    
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// Step 2: Parse a BAT listing to extract vehicle data
// Uses scrape-vehicle edge function for faster parsing (no browser overhead)
async function parseBATListing(batUrl) {
  try {
    // Use the scrape-vehicle edge function instead of Playwright for much faster parsing
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-vehicle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ url: batUrl })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success || !result.data) {
      return null;
    }

    const scrapedData = result.data;
    
    // Transform edge function output to our format
    const data = {
      title: scrapedData.title || scrapedData.listing_title || '',
      year: scrapedData.year || null,
      make: scrapedData.make ? scrapedData.make.toLowerCase() : null,
      model: scrapedData.model ? scrapedData.model.toLowerCase() : null,
      vin: scrapedData.vin || null,
      salePrice: scrapedData.sold_price || scrapedData.sale_price || scrapedData.price || null,
      saleDate: scrapedData.sold_date || scrapedData.sale_date || null,
      seller: scrapedData.seller || scrapedData.consignor || null,
      images: (scrapedData.images || []).slice(0, 20).map(img => 
        typeof img === 'string' ? img : img.url || img.src
      ).filter(Boolean)
    };
    
    return { ...data, batUrl };
    
  } catch (error) {
    console.error(`   ❌ Error parsing ${batUrl}:`, error.message);
    return null;
  }
}

// Normalize make abbreviations (CHEV -> Chevrolet, etc.)
function normalizeMake(make) {
  if (!make) return null;
  
  const normalized = make.toLowerCase().trim();
  
  // Common abbreviations
  const abbreviations = {
    'chev': 'chevrolet',
    'chevy': 'chevrolet',
    'benz': 'mercedes-benz',
    'mercedes': 'mercedes-benz',
    'mb': 'mercedes-benz',
    'vw': 'volkswagen',
    'volks': 'volkswagen',
    'bmw': 'bmw', // already normalized
    'ford': 'ford',
    'dodge': 'dodge',
    'toyota': 'toyota',
    'gmc': 'gmc',
    'cadillac': 'cadillac',
    'caddy': 'cadillac',
    'pontiac': 'pontiac',
    'buick': 'buick',
    'olds': 'oldsmobile',
    'oldsmobile': 'oldsmobile',
    'chrysler': 'chrysler',
    'plymouth': 'plymouth',
    'jeep': 'jeep',
    'ram': 'ram',
    'lincoln': 'lincoln',
    'mercury': 'mercury',
    'infiniti': 'infiniti',
    'lexus': 'lexus',
    'acura': 'acura',
    'honda': 'honda',
    'nissan': 'nissan',
    'mazda': 'mazda',
    'subaru': 'subaru',
    'mitsubishi': 'mitsubishi',
    'porsche': 'porsche',
    'ferrari': 'ferrari',
    'lamborghini': 'lamborghini',
    'bentley': 'bentley',
    'rolls': 'rolls-royce',
    'rolls-royce': 'rolls-royce',
    'jaguar': 'jaguar',
    'land rover': 'land rover',
    'range rover': 'range rover',
    'volvo': 'volvo',
    'saab': 'saab',
    'audi': 'audi',
    'mini': 'mini',
    'fiat': 'fiat',
    'alfa': 'alfa romeo',
    'alfa romeo': 'alfa romeo',
    'maserati': 'maserati',
    'mclaren': 'mclaren',
    'aston': 'aston martin',
    'aston martin': 'aston martin',
    'lotus': 'lotus',
    'tesla': 'tesla',
    'rivian': 'rivian',
    'lucid': 'lucid'
  };
  
  return abbreviations[normalized] || normalized;
}

// Step 3: Get all vehicles for the organization
async function getOrganizationVehicles() {
  console.log('📋 Loading organization vehicles...\n');
  
  const { data, error } = await supabase
    .from('organization_vehicles')
    .select(`
      vehicle_id,
      vehicles!inner(
        id,
        year,
        make,
        model,
        vin,
        bat_auction_url,
        discovery_url,
        sale_price,
        sale_date,
        bat_seller,
        bat_listing_title,
        profile_origin,
        origin_metadata
      )
    `)
    .eq('organization_id', ORG_ID)
    .eq('status', 'active');
  
  if (error) throw error;
  
  const vehicles = (data || []).map(ov => ov.vehicles).filter(Boolean);
  console.log(`   Found ${vehicles.length} vehicles linked to organization\n`);
  
  return vehicles;
}

// Check if BAT listing matches any existing vehicle
function findExistingVehicleForBAT(batListing, existingVehicles) {
  if (!batListing.year || !batListing.make || !batListing.model) return null;
  
  const normalizeModel = (model) => {
    return model.toLowerCase()
      .replace(/\s+(pickup|truck|wagon|sedan|coupe|convertible|k10|k20|k30|c10|c20|c30)$/i, '')
      .trim();
  };
  
  const batMake = normalizeMake(batListing.make);
  const batModel = normalizeModel(batListing.model);
  
  for (const vehicle of existingVehicles) {
    if (!vehicle.year || !vehicle.make || !vehicle.model) continue;
    
    const vehicleMake = normalizeMake(vehicle.make);
    
    if (vehicle.year === batListing.year && vehicleMake === batMake) {
      const vehicleModel = normalizeModel(vehicle.model);
      
      // Exact model match
      if (vehicleModel === batModel) {
        return vehicle;
      }
      
      // Fuzzy match (substring)
      if (vehicleModel.includes(batModel) || batModel.includes(vehicleModel)) {
        return vehicle;
      }
    }
  }
  
  // Try VIN match if available
  if (batListing.vin && batListing.vin.length >= 11) {
    for (const vehicle of existingVehicles) {
      if (vehicle.vin && vehicle.vin === batListing.vin) {
        return vehicle;
      }
    }
  }
  
  return null;
}

// Create vehicle profile from BAT listing (for unmatched listings)
async function createVehicleFromBAT(batData) {
  // Create vehicle
  const { data: vehicle, error: vError } = await supabase
    .from('vehicles')
    .insert({
      year: batData.year,
      make: normalizeMake(batData.make) || batData.make.toLowerCase(),
      model: batData.model.toLowerCase(),
      vin: batData.vin,
      sale_price: batData.salePrice,
      sale_date: batData.saleDate,
      bat_auction_url: batData.batUrl,
      discovery_url: batData.batUrl,
      bat_seller: batData.seller,
      bat_listing_title: batData.title,
      description: batData.salePrice 
        ? `Sold on Bring a Trailer for $${batData.salePrice.toLocaleString()}` 
        : 'Listed on Bring a Trailer',
      is_public: true,
      uploaded_by: VIVA_USER_ID,
      profile_origin: 'bat_import',
      origin_metadata: {
        bat_seller: batData.seller,
        bat_listing_title: batData.title,
        created_from_bat_profile: true,
        created_at: new Date().toISOString()
      }
    })
    .select('id')
    .single();
  
  if (vError) throw vError;
  
  const vehicleId = vehicle.id;
  
  // Link to Viva organization
  await supabase
    .from('organization_vehicles')
    .insert({
      organization_id: ORG_ID,
      vehicle_id: vehicleId,
      relationship_type: 'sold_by',
      listing_status: batData.saleDate ? 'sold' : 'listed',
      sale_price: batData.salePrice,
      sale_date: batData.saleDate,
      auto_tagged: true,
      linked_by_user_id: VIVA_USER_ID
    });
  
  // Add images
  if (batData.images && batData.images.length > 0) {
    const imageInserts = batData.images.slice(0, 10).map((url, i) => ({
      vehicle_id: vehicleId,
      image_url: url,
      user_id: VIVA_USER_ID,
      category: 'bat_listing',
      source: 'bat_listing',
      is_primary: i === 0,
      filename: `bat_${i}.jpg`
    }));
    
    await supabase.from('vehicle_images').insert(imageInserts);
  }
  
  return vehicleId;
}

// Step 4: Match vehicle to BAT listing
function matchVehicleToBAT(vehicle, batListings) {
  if (!vehicle.year || !vehicle.make || !vehicle.model) return null;
  
  // Normalize make and model
  const normalizeModel = (model) => {
    return model.toLowerCase()
      .replace(/\s+(pickup|truck|wagon|sedan|coupe|convertible|k10|k20|k30|c10|c20|c30)$/i, '')
      .trim();
  };
  
  const vehicleMake = normalizeMake(vehicle.make);
  const vehicleModel = normalizeModel(vehicle.model);
  
  // Try exact match first
  for (const listing of batListings) {
    if (!listing.year || !listing.make || !listing.model) continue;
    
    const listingMake = normalizeMake(listing.make);
    
    if (listing.year === vehicle.year && listingMake === vehicleMake) {
      const listingModel = normalizeModel(listing.model);
      
      // Exact model match
      if (listingModel === vehicleModel) {
        return listing;
      }
      
      // Fuzzy match (substring)
      if (listingModel.includes(vehicleModel) || vehicleModel.includes(listingModel)) {
        return listing;
      }
    }
  }
  
  // Try VIN match if available
  if (vehicle.vin && vehicle.vin.length >= 11) {
    for (const listing of batListings) {
      if (listing.vin && listing.vin === vehicle.vin) {
        return listing;
      }
    }
  }
  
  return null;
}

// Step 5: Backfill vehicle with BAT data
async function backfillVehicle(vehicle, batData) {
  const updates = {};
  const needsUpdate = [];
  
  // Update BAT URL if missing
  if (!vehicle.bat_auction_url && batData.batUrl) {
    updates.bat_auction_url = batData.batUrl;
    needsUpdate.push('BAT URL');
  }
  
  // Update discovery URL if missing
  if (!vehicle.discovery_url && batData.batUrl) {
    updates.discovery_url = batData.batUrl;
    needsUpdate.push('discovery URL');
  }
  
  // Update sale price if missing or different
  if (batData.salePrice && (!vehicle.sale_price || vehicle.sale_price !== batData.salePrice)) {
    updates.sale_price = batData.salePrice;
    needsUpdate.push('sale price');
  }
  
  // Update sale date if missing
  if (batData.saleDate && !vehicle.sale_date) {
    updates.sale_date = batData.saleDate;
    needsUpdate.push('sale date');
  }
  
  // Update seller if missing
  if (batData.seller && !vehicle.bat_seller) {
    updates.bat_seller = batData.seller;
    needsUpdate.push('seller');
  }
  
  // Update listing title if missing
  if (batData.title && !vehicle.bat_listing_title) {
    updates.bat_listing_title = batData.title;
    needsUpdate.push('listing title');
  }
  
  // Update profile origin if missing
  if (!vehicle.profile_origin || vehicle.profile_origin === 'manual_entry') {
    updates.profile_origin = 'bat_import';
    needsUpdate.push('profile origin');
  }
  
  // Update origin metadata
  const metadata = {
    ...(vehicle.origin_metadata || {}),
    bat_seller: batData.seller || vehicle.origin_metadata?.bat_seller,
    bat_listing_title: batData.title || vehicle.origin_metadata?.bat_listing_title,
    backfilled: true,
    backfilled_at: new Date().toISOString(),
    backfill_source: 'bat_profile_scrape'
  };
  updates.origin_metadata = metadata;
  
  if (Object.keys(updates).length === 0) {
    return { updated: false, reason: 'No updates needed' };
  }
  
  // Update vehicle
  const { error } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicle.id);
  
  if (error) {
    return { updated: false, reason: error.message };
  }
  
  // Add images if missing
  let imagesAdded = 0;
  if (batData.images && batData.images.length > 0) {
    // Check if vehicle already has images
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .limit(1);
    
    if (!existingImages || existingImages.length === 0) {
      const imageInserts = batData.images.slice(0, 10).map((url, i) => ({
        vehicle_id: vehicle.id,
        image_url: url,
        user_id: VIVA_USER_ID,
        category: 'bat_listing',
        is_primary: i === 0,
        filename: `bat_${i}.jpg`,
        source: 'bat_listing'
      }));
      
      const { error: imgError } = await supabase
        .from('vehicle_images')
        .insert(imageInserts);
      
      if (!imgError) {
        imagesAdded = imageInserts.length;
        needsUpdate.push(`${imagesAdded} images`);
      }
    }
  }
  
  // Update organization_vehicles relationship if needed
  const { data: orgLink } = await supabase
    .from('organization_vehicles')
    .select('id, sale_price, sale_date')
    .eq('organization_id', ORG_ID)
    .eq('vehicle_id', vehicle.id)
    .eq('status', 'active')
    .maybeSingle();
  
  if (orgLink) {
    const orgUpdates = {};
    if (batData.salePrice && !orgLink.sale_price) {
      orgUpdates.sale_price = batData.salePrice;
    }
    if (batData.saleDate && !orgLink.sale_date) {
      orgUpdates.sale_date = batData.saleDate;
    }
    
    if (Object.keys(orgUpdates).length > 0) {
      await supabase
        .from('organization_vehicles')
        .update(orgUpdates)
        .eq('id', orgLink.id);
    }
  }
  
  return { 
    updated: true, 
    fields: needsUpdate,
    imagesAdded 
  };
}

// Main execution
async function main() {
  let createdInRealTime = 0; // Track real-time creates at main scope
  
  try {
    // Step 1: Scrape BAT profile
    const batListingUrls = await scrapeBATProfile();
    
    if (batListingUrls.length === 0) {
      console.log('❌ No BAT listings found. Exiting.');
      return;
    }
    
    // Step 2: Parse each BAT listing and create profiles in REAL-TIME
    console.log('📥 Parsing BAT listings and creating profiles in real-time...\n');
    
    // First, check which BAT URLs we already have in the database
    const { data: existingBATVehicles } = await supabase
      .from('vehicles')
      .select('bat_auction_url, year, make, model, vin, sale_price, sale_date, bat_seller, bat_listing_title')
      .not('bat_auction_url', 'is', null)
      .limit(10000);
    
    const existingBATUrls = new Set((existingBATVehicles || []).map(v => v.bat_auction_url));
    console.log(`   Found ${existingBATUrls.size} vehicles with existing BAT URLs\n`);
    
    const batListings = [];
    let skippedExisting = 0;
    let parsedNew = 0;
    
    // Load existing vehicles for matching
    const currentVehicles = await getOrganizationVehicles();
    
    for (let i = 0; i < batListingUrls.length; i++) {
      const listing = batListingUrls[i];
      
      // Skip if we already have this BAT URL in the database
      if (existingBATUrls.has(listing.url)) {
        skippedExisting++;
        if (skippedExisting % 50 === 0) {
          process.stdout.write(`   ⏭️  Skipped ${skippedExisting} existing BAT URLs...\r`);
        }
        
        // Still add to batListings for matching purposes
        const existing = existingBATVehicles.find(v => v.bat_auction_url === listing.url);
        if (existing) {
          batListings.push({
            batUrl: existing.bat_auction_url,
            year: existing.year,
            make: existing.make.toLowerCase(),
            model: existing.model.toLowerCase(),
            vin: existing.vin,
            salePrice: existing.sale_price,
            saleDate: existing.sale_date,
            seller: existing.bat_seller,
            title: existing.bat_listing_title,
            images: []
          });
        }
        continue;
      }
      
      process.stdout.write(`[${parsedNew + 1}/${batListingUrls.length - skippedExisting}] ${listing.title.substring(0, 50)}... `);
      
      const parsed = await parseBATListing(listing.url);
      if (parsed && parsed.year && parsed.make && parsed.model) {
        batListings.push(parsed);
        parsedNew++;
        console.log(`✅ ${parsed.year} ${parsed.make} ${parsed.model}`);
        
        // REAL-TIME: Check if this should create a profile immediately
        const existingMatch = findExistingVehicleForBAT(parsed, currentVehicles);
        if (!existingMatch) {
          // No match found - create profile immediately
          process.stdout.write(`   🆕 Creating profile... `);
          try {
            const vehicleId = await createVehicleFromBAT(parsed);
            console.log(`✅ CREATED (${vehicleId.substring(0, 8)}...) - INVENTORY UPDATED NOW`);
            createdInRealTime++;
            
            // Add to currentVehicles so future matches work
            currentVehicles.push({
              id: vehicleId,
              year: parsed.year,
              make: parsed.make,
              model: parsed.model,
              vin: parsed.vin
            });
          } catch (error) {
            console.log(`❌ Error: ${error.message}`);
            errors++;
          }
        }
      } else {
        console.log('❌ Parse failed');
      }
      
      // Rate limit (reduced since edge function is faster)
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`\n   ✅ Parsed ${parsedNew} new listings, reused ${skippedExisting} existing`);
    console.log(`   🚀 Created ${createdInRealTime} profiles in real-time during parsing\n`);
    
    console.log(`\n   Parsed ${batListings.length} valid listings\n`);
    
    // Step 3: Get organization vehicles
    const vehicles = await getOrganizationVehicles();
    
    if (vehicles.length === 0) {
      console.log('❌ No vehicles found for organization. Exiting.');
      return;
    }
    
    // Step 4: Match and backfill existing vehicles
    console.log('🔄 Matching vehicles to BAT listings and backfilling...\n');
    
    let matched = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    // Track which BAT listings were matched
    const matchedBATListings = new Set();
    
    for (const vehicle of vehicles) {
      const vehicleName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;
      process.stdout.write(`🔍 ${vehicleName}... `);
      
      const batMatch = matchVehicleToBAT(vehicle, batListings);
      
      if (!batMatch) {
        console.log('⏭️  No BAT match');
        skipped++;
        continue;
      }
      
      console.log(`✅ Matched to BAT`);
      matched++;
      matchedBATListings.add(batMatch.batUrl);
      
      const result = await backfillVehicle(vehicle, batMatch);
      
      if (result.updated) {
        console.log(`   📝 Updated: ${result.fields.join(', ')}`);
        updated++;
      } else {
        console.log(`   ⚠️  ${result.reason}`);
      }
    }
    
    // Note: Profiles are created in real-time during Step 2 parsing
    // This ensures inventory updates immediately as we process
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 BACKFILL SUMMARY:');
    console.log(`   BAT listings scraped: ${batListingUrls.length}`);
    console.log(`   BAT listings parsed: ${batListings.length}`);
    console.log(`   Organization vehicles: ${vehicles.length}`);
    console.log(`   Vehicles matched: ${matched}`);
    console.log(`   Vehicles updated: ${updated}`);
    console.log(`   New vehicles created (real-time): ${createdInRealTime}`);
    console.log(`   Vehicles skipped (no match): ${skipped}`);
    console.log(`   Errors: ${errors}`);
    console.log('='.repeat(80));
    console.log(`\n💡 NOTE: ${createdInRealTime} new vehicle profiles created in REAL-TIME.`);
    console.log(`   Inventory was updated immediately as each listing was processed.`);
    console.log(`   Merge proposals will detect any duplicates automatically.`);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

