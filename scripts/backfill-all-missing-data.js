#!/usr/bin/env node
/**
 * Backfill ALL missing data for BaT vehicles
 * - VINs, trim, description, specs, images, auction events, comments
 * Uses extract-premium-auction + extract-auction-comments
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const BATCH_SIZE = 3;
const DELAY_BETWEEN_VEHICLES = 3000;
const DELAY_BETWEEN_BATCHES = 8000;
const MAX_VEHICLES = parseInt(process.argv[2]) || 0; // 0 = process all

function calculateMissingScore(vehicle) {
  let score = 0;
  const missing = [];
  
  if (!vehicle.vin) { score += 3; missing.push('VIN'); }
  if (!vehicle.description) { score += 2; missing.push('description'); }
  if (!vehicle.trim) { score += 1; missing.push('trim'); }
  if (!vehicle.mileage) { score += 1; missing.push('mileage'); }
  if (!vehicle.color) { score += 1; missing.push('color'); }
  if (!vehicle.transmission) { score += 1; missing.push('transmission'); }
  if (!vehicle.engine_size) { score += 1; missing.push('engine_size'); }
  if (!vehicle.drivetrain) { score += 1; missing.push('drivetrain'); }
  if (!vehicle.location) { score += 1; missing.push('location'); }
  if (!vehicle.sale_price && !vehicle.high_bid) { score += 2; missing.push('sale_info'); }
  
  // Check for images
  // Check for auction_events
  // Check for comments
  
  return { score, missing };
}

async function getVehiclesNeedingBackfill() {
  console.log('🔍 Finding vehicles needing data backfill...\n');
  
  // Check if filtering by organization
  const orgFilter = process.argv.find(arg => arg.startsWith('--org='))?.split('=')[1];
  let vehicleIds = null;
  
  if (orgFilter) {
    console.log(`   Filtering by organization: ${orgFilter}\n`);
    const { data: orgVehicles } = await supabase
      .from('organization_vehicles')
      .select('vehicle_id')
      .eq('organization_id', orgFilter)
      .limit(10000);
    
    if (orgVehicles && orgVehicles.length > 0) {
      vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
      console.log(`   Found ${vehicleIds.length} vehicles in organization\n`);
    }
  }
  
  let query = supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      discovery_url,
      bat_auction_url,
      vin,
      mileage,
      color,
      trim,
      transmission,
      engine_size,
      drivetrain,
      description,
      location,
      sale_price,
      high_bid
    `);
  
  if (vehicleIds) {
    query = query.in('id', vehicleIds);
  } else {
    query = query.or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%');
  }
  
  const { data: vehicles, error } = await query.limit(MAX_VEHICLES > 0 ? MAX_VEHICLES : 10000);
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    return [];
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No BaT vehicles found');
    return [];
  }
  
  // Score vehicles by missing data
  const scoredVehicles = vehicles.map(vehicle => {
    const { score, missing } = calculateMissingScore(vehicle);
    return { ...vehicle, missing_score: score, missing_fields: missing };
  })
  .filter(v => v.missing_score > 0)
  .sort((a, b) => b.missing_score - a.missing_score);
  
  console.log(`✅ Found ${scoredVehicles.length} vehicles needing backfill (out of ${vehicles.length} total)`);
  console.log(`   Top priority: ${scoredVehicles.slice(0, 10).length} vehicles with score ≥5\n`);
  
  return scoredVehicles;
}

async function backfillVehicleData(vehicle) {
  const url = vehicle.discovery_url || vehicle.bat_auction_url;
  if (!url) {
    return { success: false, error: 'No URL found' };
  }
  
  try {
    console.log(`   📊 Extracting all missing data...`);
    const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: url,
        max_vehicles: 1,
        download_images: true
      }
    });
    
    if (extractError) {
      return { success: false, error: `Extract error: ${extractError.message}` };
    }
    
    if (!extractResult || !extractResult.success) {
      return { success: false, error: extractResult?.error || 'Extraction failed' };
    }
    
    const vehicleId = extractResult.updated_vehicle_ids?.[0] || extractResult.created_vehicle_ids?.[0] || vehicle.id;
    
    // Wait for auction_event to be created
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract comments if auction_event exists
    let commentsExtracted = 0;
    const { data: aeData } = await supabase
      .from('auction_events')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('platform', 'bat')
      .maybeSingle();
    
    if (aeData && aeData.id) {
      try {
        const { data: commentsResult } = await supabase.functions.invoke('extract-auction-comments', {
          body: {
            auction_url: url,
            vehicle_id: vehicleId,
            auction_event_id: aeData.id
          }
        });
        
        if (commentsResult && commentsResult.success !== false) {
          commentsExtracted = commentsResult.comments_extracted || commentsResult.comments?.length || 0;
        }
      } catch (e) {
        // Comments extraction is non-critical
      }
    }
    
    return {
      success: true,
      vehicle_id: vehicleId,
      vehicles_updated: extractResult.vehicles_updated || 0,
      vehicles_created: extractResult.vehicles_created || 0,
      comments_extracted: commentsExtracted
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Backfilling Missing BaT Data');
  console.log('='.repeat(80));
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Delay between vehicles: ${DELAY_BETWEEN_VEHICLES}ms`);
  console.log(`Delay between batches: ${DELAY_BETWEEN_BATCHES}ms`);
  console.log(`Max vehicles: ${MAX_VEHICLES || 'ALL'}\n`);
  
  const vehiclesToFix = await getVehiclesNeedingBackfill();
  
  if (vehiclesToFix.length === 0) {
    console.log('✅ No vehicles found needing backfill.');
    return;
  }
  
  console.log(`🚀 Processing ${vehiclesToFix.length} vehicles...\n`);
  
  let successCount = 0;
  let failCount = 0;
  let totalComments = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < vehiclesToFix.length; i += BATCH_SIZE) {
    const batch = vehiclesToFix.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(vehiclesToFix.length / BATCH_SIZE);
    
    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} vehicles)`);
    console.log('-'.repeat(80));
    
    for (const vehicle of batch) {
      const missingStr = vehicle.missing_fields.join(', ');
      console.log(`\n🔧 [Score: ${vehicle.missing_score}] ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
      console.log(`   URL: ${(vehicle.discovery_url || vehicle.bat_auction_url || '').split('/listing/')[1]?.split('/')[0] || 'N/A'}`);
      console.log(`   Missing: ${missingStr}`);
      
      const result = await backfillVehicleData(vehicle);
      
      if (result.success) {
        console.log(`   ✅ Success!`);
        if (result.vehicles_updated > 0) console.log(`      - Updated vehicle`);
        if (result.vehicles_created > 0) console.log(`      - Created vehicle`);
        if (result.comments_extracted > 0) {
          console.log(`      - Extracted ${result.comments_extracted} comments`);
          totalComments += result.comments_extracted;
        }
        successCount++;
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
        failCount++;
      }
      
      if (i + batch.length < vehiclesToFix.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VEHICLES));
      }
    }
    
    if (i + BATCH_SIZE < vehiclesToFix.length) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Processed: ${vehiclesToFix.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`💬 Total Comments Extracted: ${totalComments}`);
  console.log(`⏱️  Time Elapsed: ${elapsed} minutes`);
  console.log('='.repeat(80));
}

main().catch(console.error);
