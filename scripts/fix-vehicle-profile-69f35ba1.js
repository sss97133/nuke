#!/usr/bin/env node
/**
 * Fix vehicle profile 69f35ba1-00d3-4b63-8406-731d226c45e1
 * Issues:
 * 1. Primary image has position 15 (should be 0)
 * 2. Images have non-sequential positions (9-33)
 * 3. Missing listing_location
 * 4. No auction comments extracted
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = '69f35ba1-00d3-4b63-8406-731d226c45e1';

async function fixVehicleProfile() {
  try {
    console.log(`\n🔧 Fixing vehicle profile: ${vehicleId}\n`);

    // Step 1: Get all images and reorder them
    console.log('📸 Step 1: Fixing image positions...');
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, is_primary, position, created_at, image_url')
      .eq('vehicle_id', vehicleId)
      .not('is_document', 'is', true)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (imagesError) throw imagesError;

    console.log(`   Found ${images.length} images`);

    // Reorder: primary first (position 0), then sequential
    const updates = [];
    let newPosition = 0;
    
    for (const img of images) {
      if (img.position !== newPosition) {
        updates.push({
          id: img.id,
          position: newPosition
        });
        console.log(`   Image ${img.id.substring(0, 8)}: position ${img.position} → ${newPosition}${img.is_primary ? ' (PRIMARY)' : ''}`);
      }
      newPosition++;
    }

    if (updates.length > 0) {
      // Update in batches
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('vehicle_images')
          .update({ position: update.position })
          .eq('id', update.id);
        
        if (updateError) {
          console.error(`   ❌ Failed to update image ${update.id}:`, updateError.message);
        }
      }
      console.log(`   ✅ Updated ${updates.length} image positions`);
    } else {
      console.log('   ✅ Image positions already correct');
    }

    // Step 2: Fix listing_location
    console.log('\n📍 Step 2: Fixing listing_location...');
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, listing_location, description, discovery_url')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) throw vehicleError;

    // Extract location from description if available
    // Description contains: "Location Cresson, TX 76035"
    let location = vehicle.listing_location;
    
    if (!location && vehicle.description) {
      const locationMatch = vehicle.description.match(/Location\s+([^•\n]+)/i);
      if (locationMatch) {
        location = locationMatch[1].trim();
        console.log(`   Found location in description: ${location}`);
      }
    }

    // Also check external_listings
    if (!location) {
      const { data: externalListing } = await supabase
        .from('external_listings')
        .select('metadata')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();
      
      if (externalListing?.metadata?.location) {
        location = externalListing.metadata.location;
        console.log(`   Found location in external_listing: ${location}`);
      }
    }

    if (location && location !== vehicle.listing_location) {
      const { error: locationError } = await supabase
        .from('vehicles')
        .update({ listing_location: location })
        .eq('id', vehicleId);
      
      if (locationError) {
        console.error(`   ❌ Failed to update listing_location:`, locationError.message);
      } else {
        console.log(`   ✅ Updated listing_location: ${location}`);
      }
    } else if (location) {
      console.log(`   ✅ listing_location already set: ${location}`);
    } else {
      console.log(`   ⚠️  Could not determine location`);
    }

    // Step 3: Check price/bid display
    console.log('\n💰 Step 3: Checking price/bid data...');
    const { data: vehiclePrice, error: priceError } = await supabase
      .from('vehicles')
      .select('id, sale_price, winning_bid, asking_price, current_value')
      .eq('id', vehicleId)
      .single();

    if (priceError) throw priceError;

    const { data: externalListing } = await supabase
      .from('external_listings')
      .select('current_bid, final_price, listing_status')
      .eq('vehicle_id', vehicleId)
      .maybeSingle();

    console.log(`   Vehicle sale_price: ${vehiclePrice.sale_price || 'null'}`);
    console.log(`   Vehicle winning_bid: ${vehiclePrice.winning_bid || 'null'}`);
    console.log(`   Vehicle asking_price: ${vehiclePrice.asking_price || 'null'}`);
    if (externalListing) {
      console.log(`   External listing current_bid: ${externalListing.current_bid || 'null'}`);
      console.log(`   External listing final_price: ${externalListing.final_price || 'null'}`);
      console.log(`   External listing status: ${externalListing.listing_status || 'null'}`);
    } else {
      console.log(`   ⚠️  No external_listing found`);
    }

    // Step 4: Verify final state
    console.log('\n✅ Step 4: Verifying fixes...');
    const { data: finalImages } = await supabase
      .from('vehicle_images')
      .select('id, is_primary, position')
      .eq('vehicle_id', vehicleId)
      .not('is_document', 'is', true)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true, nullsFirst: false })
      .limit(5);

    const primaryImage = finalImages?.find(img => img.is_primary);
    if (primaryImage) {
      if (primaryImage.position === 0) {
        console.log(`   ✅ Primary image is at position 0`);
      } else {
        console.log(`   ❌ Primary image is at position ${primaryImage.position} (should be 0)`);
      }
    } else {
      console.log(`   ⚠️  No primary image found`);
    }

    const { data: finalVehicle } = await supabase
      .from('vehicles')
      .select('listing_location')
      .eq('id', vehicleId)
      .single();

    if (finalVehicle?.listing_location) {
      console.log(`   ✅ listing_location set: ${finalVehicle.listing_location}`);
    } else {
      console.log(`   ⚠️  listing_location still missing`);
    }

    console.log('\n✨ Fix complete!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

fixVehicleProfile();

