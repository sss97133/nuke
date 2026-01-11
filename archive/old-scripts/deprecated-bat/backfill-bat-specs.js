#!/usr/bin/env node

/**
 * Backfill Missing Specs for BaT Vehicles
 * Re-extracts missing VINs, engine, transmission, and other specs
 * for the 1,047 existing BaT vehicles using comprehensive-bat-extraction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env.local' });
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 10; // Process in smaller batches to avoid timeouts
const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches

async function findVehiclesNeedingBackfill() {
  console.log('🔍 Finding BaT vehicles with missing specs...\n');

  const { data, error } = await supabase
    .from('vehicles')
    .select('id, make, model, year, bat_auction_url, vin, mileage, description')
    .not('bat_auction_url', 'is', null)
    .ilike('bat_auction_url', '%bringatrailer.com%')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch BaT vehicles: ${error.message}`);
  }

  console.log(`📊 Found ${data.length} total BaT vehicles`);

  // Analyze what's missing
  const missingVin = data.filter(v => !v.vin).length;
  const missingMileage = data.filter(v => !v.mileage).length;
  const missingDescription = data.filter(v => !v.description || v.description.length < 100).length;

  // Vehicles with any missing critical data
  const needsBackfill = data.filter(v =>
    !v.vin ||
    !v.mileage ||
    !v.description ||
    v.description.length < 100
  );

  console.log(`\n📋 Missing Data Analysis:`);
  console.log(`   Missing VIN: ${missingVin} vehicles`);
  console.log(`   Missing Mileage: ${missingMileage} vehicles`);
  console.log(`   Missing/Poor Description: ${missingDescription} vehicles`);
  console.log(`   Total needing backfill: ${needsBackfill.length} vehicles\n`);

  return needsBackfill;
}

async function backfillVehicle(vehicle) {
  console.log(`🔧 Backfilling: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   URL: ${vehicle.bat_auction_url}`);
  console.log(`   Missing: ${!vehicle.vin ? 'VIN ' : ''}${!vehicle.mileage ? 'Mileage ' : ''}${(!vehicle.description || vehicle.description.length < 100) ? 'Description' : ''}`);

  try {
    // Call comprehensive-bat-extraction function
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: {
        url: vehicle.bat_auction_url,
        vehicle_id: vehicle.id,
        backfill_mode: true
      }
    });

    if (error) {
      console.error(`   ❌ Extraction failed: ${error.message}`);
      return { success: false, error: error.message };
    }

    if (!data || !data.success) {
      console.error(`   ❌ Extraction returned no data: ${JSON.stringify(data)}`);
      return { success: false, error: 'No data returned from extraction' };
    }

    // The comprehensive-bat-extraction function should update the vehicle directly
    // But let's verify what was extracted
    const extracted = data.data || {};
    const improvements = [];

    if (!vehicle.vin && extracted.vin) improvements.push(`VIN: ${extracted.vin}`);
    if (!vehicle.mileage && extracted.mileage) improvements.push(`Mileage: ${extracted.mileage.toLocaleString()}`);
    if ((!vehicle.description || vehicle.description.length < 100) && extracted.description) {
      improvements.push(`Description: ${extracted.description.length} chars`);
    }

    console.log(`   ✅ Extracted: ${improvements.length > 0 ? improvements.join(', ') : 'No new data'}`);

    return {
      success: true,
      improvements: improvements.length,
      extracted_fields: Object.keys(extracted).length
    };

  } catch (err) {
    console.error(`   ❌ Unexpected error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 BaT SPECS BACKFILL - COMPREHENSIVE DATA EXTRACTION');
  console.log('='.repeat(70));

  try {
    // Find vehicles needing backfill
    const vehiclesToBackfill = await findVehiclesNeedingBackfill();

    if (vehiclesToBackfill.length === 0) {
      console.log('✅ All BaT vehicles already have complete specs!');
      return;
    }

    console.log(`📊 Processing ${vehiclesToBackfill.length} vehicles in batches of ${BATCH_SIZE}...\n`);

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalImprovements = 0;

    // Process in batches
    for (let i = 0; i < vehiclesToBackfill.length; i += BATCH_SIZE) {
      const batch = vehiclesToBackfill.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(vehiclesToBackfill.length / BATCH_SIZE);

      console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} vehicles)`);
      console.log('-'.repeat(50));

      // Process batch sequentially to avoid overwhelming the API
      for (const vehicle of batch) {
        const result = await backfillVehicle(vehicle);
        totalProcessed++;

        if (result.success) {
          totalSuccessful++;
          totalImprovements += result.improvements || 0;
        }

        // Small delay between individual requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Delay between batches
      if (i + BATCH_SIZE < vehiclesToBackfill.length) {
        console.log(`\n⏱️  Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 BACKFILL COMPLETE');
    console.log('='.repeat(70));
    console.log(`   Vehicles processed: ${totalProcessed}`);
    console.log(`   Successful extractions: ${totalSuccessful}`);
    console.log(`   Failed extractions: ${totalProcessed - totalSuccessful}`);
    console.log(`   Total data improvements: ${totalImprovements}`);
    console.log(`   Success rate: ${((totalSuccessful / totalProcessed) * 100).toFixed(1)}%`);

    if (totalSuccessful > 0) {
      console.log(`\n✅ Backfill completed! ${totalImprovements} data improvements made.`);
      console.log('💡 Consider running image deduplication next: scripts/deduplicate-vehicle-images.sql');
    } else {
      console.log(`\n⚠️  No successful extractions. Check function logs in Supabase dashboard.`);
    }

  } catch (error) {
    console.error(`\n❌ Backfill failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);