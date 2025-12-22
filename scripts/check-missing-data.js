#!/usr/bin/env node
/**
 * Check what's missing from PCarMarket extraction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8';

async function checkMissing() {
  console.log('\n🔍 Checking what\'s missing from PCarMarket extraction...\n');
  
  // Get vehicle
  const { data: vehicle, error: vError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (vError || !vehicle) {
    console.error('❌ Vehicle not found:', vError);
    return;
  }
  
  // Get images
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', vehicleId);
  
  // Get org link
  const { data: orgLinks } = await supabase
    .from('organization_vehicles')
    .select('*, businesses(*)')
    .eq('vehicle_id', vehicleId);
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CURRENT DATA STATUS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('✅ PRESENT:');
  console.log(`   Vehicle record: ${vehicle.id}`);
  console.log(`   Year: ${vehicle.year || 'MISSING'}`);
  console.log(`   Make: ${vehicle.make || 'MISSING'}`);
  console.log(`   Model: ${vehicle.model || 'MISSING'}`);
  console.log(`   VIN: ${vehicle.vin || 'MISSING'}`);
  console.log(`   Profile Origin: ${vehicle.profile_origin || 'MISSING'}`);
  console.log(`   Discovery URL: ${vehicle.discovery_url || 'MISSING'}`);
  console.log(`   Origin Metadata: ${vehicle.origin_metadata ? '✅ Present' : '❌ MISSING'}`);
  console.log('');
  
  console.log('📸 IMAGES:');
  if (images && images.length > 0) {
    console.log(`   ✅ ${images.length} images found`);
    images.forEach((img, i) => {
      console.log(`   ${i+1}. ${img.is_primary ? '[PRIMARY]' : ''} ${img.image_url.substring(0, 60)}...`);
    });
  } else {
    console.log('   ❌ MISSING: No images found');
  }
  console.log('');
  
  console.log('🏢 ORGANIZATION LINK:');
  if (orgLinks && orgLinks.length > 0) {
    const org = orgLinks[0];
    console.log(`   ✅ Linked to: ${org.businesses?.business_name || 'Unknown'}`);
    console.log(`   Relationship: ${org.relationship_type}`);
    console.log(`   Status: ${org.listing_status}`);
  } else {
    console.log('   ❌ MISSING: No organization link found');
  }
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('MISSING FIELDS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const missing = [];
  
  // Core vehicle fields
  if (!vehicle.color) missing.push('color');
  if (!vehicle.transmission) missing.push('transmission');
  if (!vehicle.engine_size) missing.push('engine_size');
  if (!vehicle.drivetrain) missing.push('drivetrain');
  if (!vehicle.body_style) missing.push('body_style');
  
  // Auction fields
  if (!vehicle.auction_end_date && vehicle.auction_outcome === null) {
    missing.push('auction_end_date (for active listings)');
  }
  
  // Description (we only have title, not full description)
  if (!vehicle.description || vehicle.description === vehicle.origin_metadata?.pcarmarket_listing_title) {
    missing.push('full_description (only title captured, not detailed description)');
  }
  
  // Metadata fields that could be enhanced
  const metadata = vehicle.origin_metadata || {};
  if (!metadata.location) missing.push('location (in metadata)');
  if (!metadata.seller_name && !metadata.pcarmarket_seller_username) missing.push('seller_name (in metadata)');
  if (!metadata.auction_start_date) missing.push('auction_start_date (in metadata)');
  if (!metadata.bid_history) missing.push('bid_history (in metadata)');
  if (!metadata.comments_count) missing.push('comments_count (in metadata)');
  
  // Image issues
  if (!images || images.length === 0) {
    missing.push('vehicle_images (no images imported)');
  }
  
  // Org link issues
  if (!orgLinks || orgLinks.length === 0) {
    missing.push('organization_vehicles link');
  }
  
  if (missing.length === 0) {
    console.log('✅ All expected fields are present!');
  } else {
    console.log('❌ Missing fields:\n');
    missing.forEach(field => {
      console.log(`   - ${field}`);
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('POTENTIAL ENHANCEMENTS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('The following could be extracted from a full auction page scrape:');
  console.log('   - Color');
  console.log('   - Transmission type');
  console.log('   - Engine specifications');
  console.log('   - Drivetrain (RWD/AWD/etc)');
  console.log('   - Body style');
  console.log('   - Full description text');
  console.log('   - Seller name/business (beyond username)');
  console.log('   - Location');
  console.log('   - Auction dates (start/end)');
  console.log('   - Bid history');
  console.log('   - Comments count');
  console.log('   - View count (actual, not estimated)');
  console.log('   - Reserve price (if visible)');
  console.log('   - Buy-it-now price (if applicable)');
  console.log('   - Condition/grade');
  console.log('   - Service history');
  console.log('   - Modifications');
  
  console.log('\n✅ Current extraction covers basics - enhanced scraping would add these details.\n');
}

checkMissing();

