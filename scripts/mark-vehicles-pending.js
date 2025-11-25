#!/usr/bin/env node
/**
 * Mark vehicles as 'pending' if they have no images
 * Uses Supabase REST API to execute SQL
 */

import { createClient } from '@supabase/supabase-js';

// Get credentials from environment (with fallback for local testing)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variable');
  console.error('   Set SUPABASE_SERVICE_ROLE_KEY in your environment or .env.local file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const vehicleIds = [
  '21b489eb-6449-4096-a74a-fb9b5df33772',
  '24f38dc3-b970-45b5-8063-27dd7a59445f',
  '483f6a7c-8beb-45fd-afd1-9d8e3313bec6',
  '62fe83e8-e789-4275-81b5-f2fe53f0103f'
];

async function markVehiclesPending() {
  console.log('🔍 Checking vehicles for images...\n');

  for (const vehicleId of vehicleIds) {
    // Get vehicle info
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, status')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) {
      console.error(`❌ Error fetching vehicle ${vehicleId}:`, vehicleError.message);
      continue;
    }

    if (!vehicle) {
      console.log(`⚠️  Vehicle ${vehicleId} not found`);
      continue;
    }

    // Count images
    const { count: imageCount, error: imageError } = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    if (imageError) {
      console.error(`❌ Error counting images for ${vehicleId}:`, imageError.message);
      continue;
    }

    const hasImages = (imageCount || 0) > 0;
    const currentStatus = vehicle.status || 'active';

    console.log(`📋 ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   ID: ${vehicleId}`);
    console.log(`   Current status: ${currentStatus}`);
    console.log(`   Image count: ${imageCount || 0}`);

    if (!hasImages) {
      if (currentStatus !== 'pending') {
        // Update to pending
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({ status: 'pending' })
          .eq('id', vehicleId);

        if (updateError) {
          console.error(`   ❌ Failed to update status:`, updateError.message);
        } else {
          console.log(`   ✅ Updated status to 'pending'`);
        }
      } else {
        console.log(`   ℹ️  Already set to 'pending'`);
      }
    } else {
      console.log(`   ℹ️  Has images, keeping current status`);
    }
    console.log('');
  }

  console.log('✅ Done!');
}

markVehiclesPending().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

