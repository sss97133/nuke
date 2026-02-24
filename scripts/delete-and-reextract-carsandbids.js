#!/usr/bin/env node
/**
 * Delete a Cars & Bids vehicle and re-extract it with improved extraction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function deleteAndReextract(listingUrl) {
  console.log(`\n🔍 Finding vehicle for: ${listingUrl}\n`);
  
  // Find vehicle by discovery_url or listing_url
  const { data: vehicles, error: findError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, listing_url')
    .or(`discovery_url.eq.${listingUrl},listing_url.eq.${listingUrl}`);
  
  if (findError) {
    console.error('❌ Error finding vehicle:', findError);
    return;
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('ℹ️  No vehicle found for that URL. Proceeding with extraction...\n');
  } else {
    const vehicle = vehicles[0];
    console.log(`📋 Found vehicle: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'} (${vehicle.id})\n`);
    
    console.log('🗑️  Deleting vehicle and related data...\n');
    
    // Delete in order (respecting foreign key constraints)
    const vehicleId = vehicle.id;
    
    // 1. Delete auction_comments
    const { error: commentsError } = await supabase
      .from('auction_comments')
      .delete()
      .eq('vehicle_id', vehicleId);
    if (commentsError) console.warn('⚠️  Error deleting comments:', commentsError.message);
    else console.log('✅ Deleted auction_comments');
    
    // 2. Delete auction_events
    const { error: eventsError } = await supabase
      .from('auction_events')
      .delete()
      .eq('vehicle_id', vehicleId);
    if (eventsError) console.warn('⚠️  Error deleting auction_events:', eventsError.message);
    else console.log('✅ Deleted auction_events');
    
    // 3. Delete external_listings
    const { error: listingsError } = await supabase
      .from('external_listings')
      .delete()
      .eq('vehicle_id', vehicleId);
    if (listingsError) console.warn('⚠️  Error deleting external_listings:', listingsError.message);
    else console.log('✅ Deleted external_listings');
    
    // 4. Delete vehicle_images
    const { error: imagesError } = await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId);
    if (imagesError) console.warn('⚠️  Error deleting vehicle_images:', imagesError.message);
    else console.log('✅ Deleted vehicle_images');
    
    // 5. Delete timeline_events
    const { error: timelineError } = await supabase
      .from('timeline_events')
      .delete()
      .eq('vehicle_id', vehicleId);
    if (timelineError) console.warn('⚠️  Error deleting timeline_events:', timelineError.message);
    else console.log('✅ Deleted timeline_events');
    
    // 6. Delete vehicle
    const { error: vehicleError } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', vehicleId);
    if (vehicleError) {
      console.error('❌ Error deleting vehicle:', vehicleError);
      return;
    }
    console.log('✅ Deleted vehicle\n');
  }
  
  // Now re-extract
  console.log('🔄 Re-extracting with improved extraction...\n');
  
  // Use Supabase function invoke which handles timeouts better
  const { data: result, error: invokeError } = await supabase.functions.invoke('extract-premium-auction', {
    body: {
      url: listingUrl,
      site_type: 'carsandbids',
      max_vehicles: 1,
      debug: true,
    },
  });
  
  if (invokeError) {
    console.error('❌ Function invocation error:', invokeError);
    return;
  }
  
  console.log('\n📊 Extraction Results:');
  console.log(`   Vehicles extracted: ${result.vehicles_extracted || 0}`);
  console.log(`   Vehicles created: ${result.vehicles_created || 0}`);
  console.log(`   Vehicles updated: ${result.vehicles_updated || 0}`);
  
  if (result.issues && result.issues.length > 0) {
    console.log('\n⚠️  Issues:');
    result.issues.forEach(issue => console.log(`   - ${issue}`));
  }
  
  if (result.created_vehicle_ids && result.created_vehicle_ids.length > 0) {
    const vehicleId = result.created_vehicle_ids[0];
    console.log(`\n✅ New vehicle ID: ${vehicleId}`);
    console.log(`   View at: https://nuke.ag/vehicle/${vehicleId}`);
  }
  
  console.log('\n✅ Done!\n');
}

// Get URL from command line or use test URL
const listingUrl = process.argv[2] || 'https://carsandbids.com/auctions/rEMkxX5e/1999-chevrolet-corvette-convertible';

deleteAndReextract(listingUrl).catch(console.error);

