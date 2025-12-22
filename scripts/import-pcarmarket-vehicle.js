#!/usr/bin/env node
/**
 * IMPORT PCARMARKET VEHICLE TO DATABASE
 * 
 * Imports a single PCarMarket listing into the vehicles table
 * Follows BaT import pattern with pcarmarket-specific metadata
 * 
 * Usage:
 *   node scripts/import-pcarmarket-vehicle.js <auction_url>
 * 
 * Example:
 *   node scripts/import-pcarmarket-vehicle.js https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { scrapeAuctionPage, parseVehicleFromListing } from './scrape-pcarmarket-listings.js';

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

// PCarMarket Organization ID (to be created)
// This should be created first using scripts/setup-pcarmarket-org.js
const PCARMARKET_ORG_ID = process.env.PCARMARKET_ORG_ID || null;

/**
 * Find or create PCarMarket organization
 */
async function findOrCreatePCarMarketOrg() {
  if (PCARMARKET_ORG_ID) {
    const { data: existing } = await supabase
      .from('businesses')
      .select('id, business_name')
      .eq('id', PCARMARKET_ORG_ID)
      .single();
    
    if (existing) {
      return existing.id;
    }
  }
  
  // Check if org already exists
  const { data: existing } = await supabase
    .from('businesses')
    .select('id, business_name')
    .eq('website', 'https://www.pcarmarket.com')
    .maybeSingle();
  
  if (existing) {
    console.log(`   Found existing organization: ${existing.business_name} (${existing.id})`);
    return existing.id;
  }
  
  // Create new organization
  const { data: newOrg, error } = await supabase
    .from('businesses')
    .insert({
      business_name: 'PCarMarket',
      business_type: 'auction_house',
      website: 'https://www.pcarmarket.com',
      description: 'Premium car auction marketplace',
      is_verified: false,
      is_public: true
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('   ❌ Error creating organization:', error);
    return null;
  }
  
  console.log(`   ✅ Created organization: PCarMarket (${newOrg.id})`);
  return newOrg.id;
}

/**
 * Find existing vehicle by VIN or URL
 */
async function findExistingVehicle(vehicleData) {
  // First try by VIN
  if (vehicleData.vin) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, vin, discovery_url')
      .eq('vin', vehicleData.vin.toUpperCase())
      .maybeSingle();
    
    if (existing) {
      console.log(`   Found existing vehicle by VIN: ${existing.id}`);
      return existing;
    }
  }
  
  // Then try by discovery_url
  if (vehicleData.url) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, vin, discovery_url')
      .eq('discovery_url', vehicleData.url)
      .maybeSingle();
    
    if (existing) {
      console.log(`   Found existing vehicle by URL: ${existing.id}`);
      return existing;
    }
  }
  
  // Try by year/make/model + URL pattern
  if (vehicleData.year && vehicleData.make && vehicleData.model) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, vin, discovery_url, year, make, model')
      .eq('year', vehicleData.year)
      .eq('make', vehicleData.make.toLowerCase())
      .eq('model', vehicleData.model.toLowerCase())
      .ilike('discovery_url', '%pcarmarket.com%')
      .maybeSingle();
    
    if (existing) {
      console.log(`   Found existing vehicle by YMM: ${existing.id}`);
      return existing;
    }
  }
  
  return null;
}

/**
 * Import vehicle images
 */
async function importVehicleImages(vehicleId, images, userId = null) {
  if (!images || images.length === 0) {
    return;
  }
  
  console.log(`   📸 Importing ${images.length} images...`);
  
  const imageInserts = images.slice(0, 20).map((imageUrl, index) => ({
    vehicle_id: vehicleId,
    image_url: imageUrl,
    user_id: userId,
    category: 'pcarmarket_listing',
    source: 'pcarmarket_listing',
    is_primary: index === 0,
    filename: `pcarmarket_${index}.jpg`,
    uploaded_at: new Date().toISOString()
  }));
  
  const { error } = await supabase
    .from('vehicle_images')
    .insert(imageInserts);
  
  if (error) {
    console.error('   ⚠️  Error importing images:', error.message);
  } else {
    console.log(`   ✅ Imported ${imageInserts.length} images`);
  }
}

/**
 * Link vehicle to organization
 */
async function linkVehicleToOrg(vehicleId, orgId, vehicleData) {
  if (!orgId) return;
  
  const relationshipType = vehicleData.auctionOutcome === 'sold' ? 'sold_by' : 'consigner';
  
  const { error } = await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      relationship_type: relationshipType,
      status: 'active',
      listing_status: vehicleData.auctionOutcome === 'sold' ? 'sold' : 'listed',
      sale_price: vehicleData.salePrice,
      sale_date: vehicleData.saleDate,
      listing_url: vehicleData.url,
      auto_tagged: true
    }, {
      onConflict: 'organization_id,vehicle_id,relationship_type'
    });
  
  if (error) {
    console.error('   ⚠️  Error linking to organization:', error.message);
  } else {
    console.log(`   ✅ Linked to organization`);
  }
}

/**
 * Import vehicle from PCarMarket listing
 */
async function importVehicle(auctionUrl) {
  console.log(`\n🚀 Importing PCarMarket listing: ${auctionUrl}\n`);
  
  // Step 1: Scrape auction page
  console.log('📋 Step 1: Scraping auction page...');
  const detailedData = await scrapeAuctionPage(auctionUrl);
  
  if (!detailedData) {
    console.error('❌ Failed to scrape auction page');
    return null;
  }
  
  const listing = {
    url: auctionUrl,
    title: detailedData.title,
    imageUrl: detailedData.images?.[0] || null,
    bidAmount: detailedData.salePrice || null,
    status: detailedData.salePrice ? 'sold' : 'unsold',
    slug: detailedData.slug || null
  };
  
  const vehicleData = parseVehicleFromListing(listing, detailedData);
  
  console.log('✅ Scraped vehicle data:');
  console.log(`   Year: ${vehicleData.year || 'N/A'}`);
  console.log(`   Make: ${vehicleData.make || 'N/A'}`);
  console.log(`   Model: ${vehicleData.model || 'N/A'}`);
  console.log(`   VIN: ${vehicleData.vin || 'N/A'}`);
  console.log(`   Status: ${vehicleData.auctionOutcome || 'N/A'}`);
  console.log(`   Price: $${vehicleData.salePrice || 'N/A'}`);
  
  if (!vehicleData.year || !vehicleData.make || !vehicleData.model) {
    console.error('❌ Missing required fields (year, make, model)');
    return null;
  }
  
  // Step 2: Find or create organization
  console.log('\n📋 Step 2: Finding/Creating organization...');
  const orgId = await findOrCreatePCarMarketOrg();
  
  // Step 3: Find existing vehicle
  console.log('\n📋 Step 3: Checking for existing vehicle...');
  const existing = await findExistingVehicle(vehicleData);
  
  let vehicleId;
  let created = false;
  
  if (existing) {
    vehicleId = existing.id;
    console.log(`   Using existing vehicle: ${vehicleId}`);
    
    // Update with PCarMarket data if missing
    const updates = {};
    if (!existing.discovery_url || !existing.discovery_url.includes('pcarmarket')) {
      updates.discovery_url = vehicleData.url;
      updates.listing_url = vehicleData.url;
    }
    if (vehicleData.salePrice && !existing.sale_price) {
      updates.sale_price = vehicleData.salePrice;
    }
    if (vehicleData.saleDate && !existing.sale_date) {
      updates.sale_date = vehicleData.saleDate;
    }
    
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicleId);
      
      if (error) {
        console.error('   ⚠️  Error updating vehicle:', error.message);
      } else {
        console.log('   ✅ Updated vehicle data');
      }
    }
  } else {
    // Step 4: Create new vehicle
    console.log('\n📋 Step 4: Creating new vehicle...');
    
    const vehicleInsert = {
      year: vehicleData.year,
      make: vehicleData.make.toLowerCase(),
      model: vehicleData.model.toLowerCase(),
      trim: vehicleData.trim?.toLowerCase() || null,
      vin: vehicleData.vin ? vehicleData.vin.toUpperCase() : null,
      mileage: vehicleData.mileage || null,
      color: vehicleData.color?.toLowerCase() || null,
      transmission: vehicleData.transmission?.toLowerCase() || null,
      engine_size: vehicleData.engine || null,
      sale_price: vehicleData.salePrice || null,
      sale_date: vehicleData.saleDate || null,
      auction_end_date: vehicleData.auctionEndDate || null,
      auction_outcome: vehicleData.auctionOutcome || null,
      description: vehicleData.description || vehicleData.title || null,
      
      // Origin tracking
      profile_origin: 'pcarmarket_import',
      discovery_source: 'pcarmarket',
      discovery_url: vehicleData.url,
      listing_url: vehicleData.url,
      
      origin_metadata: {
        source: 'pcarmarket_import',
        pcarmarket_url: vehicleData.url,
        pcarmarket_listing_title: vehicleData.title,
        pcarmarket_seller_username: vehicleData.sellerUsername || null,
        pcarmarket_buyer_username: vehicleData.buyerUsername || null,
        pcarmarket_auction_id: vehicleData.auctionId || null,
        pcarmarket_auction_slug: vehicleData.slug || null,
        bid_count: vehicleData.bidCount || null,
        view_count: vehicleData.viewCount || null,
        sold_status: vehicleData.auctionOutcome === 'sold' ? 'sold' : 'unsold',
        imported_at: new Date().toISOString()
      },
      
      is_public: true,
      status: 'active'
    };
    
    const { data: newVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert(vehicleInsert)
      .select('id')
      .single();
    
    if (vehicleError) {
      console.error('   ❌ Error creating vehicle:', vehicleError);
      return null;
    }
    
    vehicleId = newVehicle.id;
    created = true;
    console.log(`   ✅ Created vehicle: ${vehicleId}`);
  }
  
  // Step 5: Import images
  if (vehicleData.images && vehicleData.images.length > 0) {
    console.log('\n📋 Step 5: Importing images...');
    await importVehicleImages(vehicleId, vehicleData.images);
  }
  
  // Step 6: Link to organization
  if (orgId) {
    console.log('\n📋 Step 6: Linking to organization...');
    await linkVehicleToOrg(vehicleId, orgId, vehicleData);
  }
  
  console.log(`\n✅ Import complete! Vehicle ID: ${vehicleId}\n`);
  return vehicleId;
}

/**
 * Main execution
 */
async function main() {
  const auctionUrl = process.argv[2];
  
  if (!auctionUrl) {
    console.error('❌ Error: Please provide an auction URL');
    console.error('Usage: node scripts/import-pcarmarket-vehicle.js <auction_url>');
    process.exit(1);
  }
  
  if (!auctionUrl.includes('pcarmarket.com')) {
    console.error('❌ Error: URL must be from pcarmarket.com');
    process.exit(1);
  }
  
  try {
    await importVehicle(auctionUrl);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { importVehicle, findOrCreatePCarMarketOrg, findExistingVehicle };

