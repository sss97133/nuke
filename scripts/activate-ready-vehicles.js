#!/usr/bin/env node

/**
 * Activate Ready Vehicles
 * 
 * Finds pending vehicles that meet minimum requirements and activates them
 * Requirements: make, model, year, and at least 1 image OR valid VIN
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

async function activateVehicle(vehicle) {
  console.log(`\n🔍 Checking: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  
  // Check if it meets minimum requirements
  const hasMake = vehicle.make && vehicle.make !== '' && vehicle.make !== 'Unknown';
  const hasModel = vehicle.model && vehicle.model !== '' && vehicle.model !== 'Unknown';
  const hasYear = vehicle.year && vehicle.year >= 1885 && vehicle.year <= new Date().getFullYear() + 1;
  let hasImages = vehicle.image_count > 0;
  const hasVin = vehicle.vin && vehicle.vin.length === 17 && !vehicle.vin.startsWith('P'); // Not placeholder
  
  if (!hasMake || !hasModel || !hasYear) {
    console.log(`  ⏭️  Missing required fields (make/model/year)`);
    return { activated: false, reason: 'missing_fields' };
  }
  
  // Try to get images if missing
  if (!hasImages && vehicle.discovery_url) {
    console.log(`  🖼️  No images, attempting to backfill...`);
    try {
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: vehicle.discovery_url }
      });

      if (!scrapeError && scrapeData?.success && scrapeData.data?.images && scrapeData.data.images.length > 0) {
        console.log(`    Found ${scrapeData.data.images.length} images`);
        const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: vehicle.id,
            image_urls: scrapeData.data.images,
            source: 'activation_backfill',
            run_analysis: false
          }
        });

        if (!backfillError && backfillResult?.uploaded) {
          console.log(`    ✅ Backfilled ${backfillResult.uploaded} images`);
          // Re-check image count
          const { data: updatedVehicle } = await supabase
            .from('vehicles')
            .select('id')
            .eq('id', vehicle.id)
            .single();
          
          const { count: newImageCount } = await supabase
            .from('vehicle_images')
            .select('*', { count: 'exact', head: true })
            .eq('vehicle_id', vehicle.id);
          
          if (newImageCount > 0) {
            hasImages = true;
          }
        }
      }
    } catch (err) {
      console.log(`    ⚠️  Image backfill failed: ${err.message}`);
    }
  }
  
  // Validate using the function
  const { data: validation, error: validationError } = await supabase.rpc(
    'validate_vehicle_before_public',
    { p_vehicle_id: vehicle.id }
  );

  if (validationError) {
    console.log(`  ❌ Validation error: ${validationError.message}`);
    return { activated: false, reason: 'validation_error' };
  }

  if (validation && validation.can_go_live) {
    const { error: activateError } = await supabase
      .from('vehicles')
      .update({ status: 'active', is_public: true })
      .eq('id', vehicle.id);

    if (activateError) {
      console.log(`  ❌ Activation failed: ${activateError.message}`);
      return { activated: false, reason: 'activation_error' };
    }

    console.log(`  🎉 ACTIVATED! (Score: ${validation.quality_score}, Images: ${validation.image_count})`);
    return { activated: true, quality_score: validation.quality_score };
  } else {
    console.log(`  ⚠️  Not ready: ${validation?.recommendation || 'Unknown'}`);
    if (validation?.issues) {
      const criticalIssues = validation.issues.filter((i) => i.type === 'error');
      if (criticalIssues.length > 0) {
        console.log(`    Critical: ${criticalIssues.map((i) => i.message).join(', ')}`);
      }
    }
    return { activated: false, reason: validation?.recommendation || 'unknown' };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 50;

  console.log('🚀 Activating Ready Vehicles\n');

  // Get pending vehicles with make/model/year
  const { data: pendingVehicles, error } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      vin,
      discovery_url,
      status,
      is_public
    `)
    .eq('status', 'pending')
    .is('is_public', false)
    .not('make', 'is', null)
    .not('model', 'is', null)
    .not('year', 'is', null)
    .limit(batchSize);

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!pendingVehicles || pendingVehicles.length === 0) {
    console.log('✅ No pending vehicles to activate');
    return;
  }

  // Get image counts for each
  const vehiclesWithCounts = await Promise.all(
    pendingVehicles.map(async (vehicle) => {
      const { count } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);
      
      return { ...vehicle, image_count: count || 0 };
    })
  );

  console.log(`📋 Processing ${vehiclesWithCounts.length} vehicles...\n`);

  const results = {
    processed: 0,
    activated: 0,
    failed: 0
  };

  for (const vehicle of vehiclesWithCounts) {
    const result = await activateVehicle(vehicle);
    results.processed++;
    
    if (result.activated) {
      results.activated++;
    } else if (result.reason === 'validation_error' || result.reason === 'activation_error') {
      results.failed++;
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 1000));
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

