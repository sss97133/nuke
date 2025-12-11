#!/usr/bin/env node

/**
 * Backfill and Activate Pending Vehicles
 * 
 * Processes pending vehicles by:
 * 1. Extracting missing data via AI
 * 2. Backfilling images
 * 3. Getting VINs
 * 4. Activating vehicles that pass validation
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function backfillVehicle(vehicle) {
  console.log(`\n🔄 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   URL: ${vehicle.discovery_url}`);
  
  if (!vehicle.discovery_url) {
    console.log(`   ⏭️  Skipping - no discovery URL`);
    return { success: false, reason: 'no_url' };
  }

  try {
    // Step 1: AI extraction
    console.log(`   🔍 Extracting data via AI...`);
    const { data: extractedData, error: extractError } = await supabase.functions.invoke('extract-vehicle-data-ai', {
      body: { url: vehicle.discovery_url }
    });

    if (extractError || !extractedData?.success) {
      console.log(`   ❌ Extraction failed: ${extractError?.message || 'Unknown'}`);
      return { success: false, reason: 'extraction_failed' };
    }

    const aiData = extractedData.data;
    const updates = {};

    // Step 2: Backfill missing fields
    if (!vehicle.description && aiData.description) {
      updates.description = aiData.description;
      console.log(`   ✅ Backfilled description`);
    }

    if (!vehicle.asking_price && aiData.asking_price) {
      updates.asking_price = aiData.asking_price;
      console.log(`   ✅ Backfilled price: $${aiData.asking_price}`);
    }

    if (!vehicle.vin && aiData.vin && aiData.vin.length === 17) {
      updates.vin = aiData.vin;
      console.log(`   ✅ Backfilled VIN: ${aiData.vin}`);
    }

    if (!vehicle.mileage && aiData.mileage) {
      updates.mileage = aiData.mileage;
      console.log(`   ✅ Backfilled mileage: ${aiData.mileage}`);
    }

    // Step 3: Backfill images
    if (aiData.images && aiData.images.length > 0) {
      console.log(`   🖼️  Backfilling ${aiData.images.length} images...`);
      const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
        body: {
          vehicle_id: vehicle.id,
          image_urls: aiData.images,
          source: 'pending_backfill',
          run_analysis: false
        }
      });

      if (!backfillError && backfillResult?.uploaded) {
        console.log(`   ✅ Backfilled ${backfillResult.uploaded} images`);
      } else {
        console.log(`   ⚠️  Image backfill failed: ${backfillError?.message || 'Unknown'}`);
      }
    }

    // Step 4: Update vehicle
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle.id);

      if (updateError) {
        console.log(`   ❌ Update failed: ${updateError.message}`);
        return { success: false, reason: 'update_failed' };
      }
    }

    // Step 5: Validate and activate
    console.log(`   🔍 Validating vehicle...`);
    const { data: validation, error: validationError } = await supabase.rpc(
      'validate_vehicle_before_public',
      { p_vehicle_id: vehicle.id }
    );

    if (validationError) {
      console.log(`   ⚠️  Validation error: ${validationError.message}`);
      return { success: false, reason: 'validation_error' };
    }

    if (validation && validation.can_go_live) {
      const { error: activateError } = await supabase
        .from('vehicles')
        .update({ status: 'active', is_public: true })
        .eq('id', vehicle.id);

      if (activateError) {
        console.log(`   ❌ Activation failed: ${activateError.message}`);
        return { success: false, reason: 'activation_failed' };
      }

      console.log(`   🎉 VEHICLE ACTIVATED!`);
      return { success: true, activated: true };
    } else {
      console.log(`   ⚠️  Not ready: ${validation?.recommendation || 'Unknown'}`);
      return { success: true, activated: false, reason: validation?.recommendation };
    }

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 20;

  console.log('🚀 Backfilling and Activating Pending Vehicles\n');

  // Get pending vehicles with URLs
  const { data: pendingVehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, description, asking_price, vin, mileage')
    .eq('status', 'pending')
    .is('is_public', false)
    .not('discovery_url', 'is', null)
    .limit(batchSize);

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!pendingVehicles || pendingVehicles.length === 0) {
    console.log('✅ No pending vehicles to process');
    return;
  }

  console.log(`📋 Processing ${pendingVehicles.length} vehicles...\n`);

  const results = {
    processed: 0,
    activated: 0,
    failed: 0
  };

  for (const vehicle of pendingVehicles) {
    const result = await backfillVehicle(vehicle);
    results.processed++;
    
    if (result.success && result.activated) {
      results.activated++;
    } else if (!result.success) {
      results.failed++;
    }

    // Small delay between vehicles
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n✅ Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Activated: ${results.activated}`);
  console.log(`   Failed: ${results.failed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

