#!/usr/bin/env node
/**
 * Fix Missing BaT Data
 * Re-extracts missing VINs, comments, specs, images, auction events, etc.
 * Uses the approved two-step workflow: extract-premium-auction + extract-auction-comments
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

// Configuration
const BATCH_SIZE = 3; // Process 3 at a time
const DELAY_BETWEEN_VEHICLES = 3000; // 3 seconds between vehicles
const DELAY_BETWEEN_BATCHES = 8000; // 8 seconds between batches
const MAX_VEHICLES = parseInt(process.argv[2]) || 0; // 0 = process all

async function getVehiclesNeedingFix() {
  console.log('🔍 Finding BaT vehicles needing data fixes...\n');
  
  // Get vehicles with BaT URLs that are missing critical data
  const { data: vehicles, error } = await supabase
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
      auction_outcome
    `)
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%')
    .limit(MAX_VEHICLES > 0 ? MAX_VEHICLES : 10000);
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    return [];
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No BaT vehicles found');
    return [];
  }
  
  // Check which ones have auction_events (needed for comments)
  const vehicleIds = vehicles.map(v => v.id);
  const { data: auctionEvents } = await supabase
    .from('auction_events')
    .select('vehicle_id')
    .in('vehicle_id', vehicleIds)
    .eq('platform', 'bat');
  
  const vehiclesWithAuctionEvents = new Set((auctionEvents || []).map(ae => ae.vehicle_id));
  
  // Score vehicles by missing data
  const scoredVehicles = vehicles.map(vehicle => {
    let score = 0;
    const issues = [];
    
    if (!vehicle.vin || vehicle.vin.trim() === '') {
      score += 2;
      issues.push('VIN');
    }
    
    if (!vehicle.mileage) {
      score += 1;
      issues.push('mileage');
    }
    
    if (!vehicle.color || vehicle.color.trim() === '') {
      score += 1;
      issues.push('color');
    }
    
    if (!vehicle.trim || vehicle.trim.trim() === '') {
      score += 1;
      issues.push('trim');
    }
    
    if (!vehicle.transmission || vehicle.transmission.trim() === '') {
      score += 1;
      issues.push('transmission');
    }
    
    if (!vehicle.engine_size || vehicle.engine_size.trim() === '') {
      score += 1;
      issues.push('engine_size');
    }
    
    if (!vehicle.drivetrain || vehicle.drivetrain.trim() === '') {
      score += 1;
      issues.push('drivetrain');
    }
    
    if (!vehicle.description || vehicle.description.length < 100) {
      score += 1;
      issues.push('description');
    }
    
    if (!vehicle.location || vehicle.location.trim() === '') {
      score += 1;
      issues.push('location');
    }
    
    if (!vehicle.sale_price && (!vehicle.auction_outcome || vehicle.auction_outcome === 'unknown')) {
      score += 1;
      issues.push('sale_info');
    }
    
    if (!vehiclesWithAuctionEvents.has(vehicle.id)) {
      score += 2;
      issues.push('auction_event');
    }
    
    return {
      ...vehicle,
      missing_score: score,
      issues: issues,
      has_auction_event: vehiclesWithAuctionEvents.has(vehicle.id)
    };
  }).filter(v => v.missing_score > 0)
    .sort((a, b) => b.missing_score - a.missing_score);
  
  console.log(`✅ Found ${scoredVehicles.length} vehicles needing fixes (out of ${vehicles.length} total)`);
  console.log(`   Top priority: ${scoredVehicles.slice(0, 10).length} vehicles with score ≥5\n`);
  
  return scoredVehicles;
}

async function extractVehicleData(vehicle) {
  const url = vehicle.discovery_url || vehicle.bat_auction_url;
  if (!url) {
    return { success: false, error: 'No URL found' };
  }
  
  try {
    // Step 1: Extract core data (VIN, specs, images, auction_events)
    console.log(`   📊 Step 1: Extracting core data...`);
    const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: url,
        max_vehicles: 1
      }
    });
    
    if (extractError) {
      return { success: false, error: `Extract error: ${extractError.message}` };
    }
    
    if (!extractResult || !extractResult.success) {
      return { success: false, error: extractResult?.error || 'Extraction failed' };
    }
    
    // Find the vehicle_id that was created/updated
    let vehicleId = vehicle.id;
    if (extractResult.updated_vehicle_ids && extractResult.updated_vehicle_ids.length > 0) {
      vehicleId = extractResult.updated_vehicle_ids[0];
    } else if (extractResult.created_vehicle_ids && extractResult.created_vehicle_ids.length > 0) {
      vehicleId = extractResult.created_vehicle_ids[0];
    }
    
    // Step 2: Extract comments if auction_event exists
    let commentsExtracted = 0;
    if (vehicle.has_auction_event || extractResult.vehicles_updated > 0 || extractResult.vehicles_created > 0) {
      // Check if auction_event exists now
      const { data: aeData } = await supabase
        .from('auction_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('platform', 'bat')
        .limit(1)
        .single();
      
      if (aeData && aeData.id) {
        console.log(`   💬 Step 2: Extracting comments...`);
        try {
          const { data: commentsResult, error: commentsError } = await supabase.functions.invoke('extract-auction-comments', {
            body: {
              auction_url: url,
              vehicle_id: vehicleId,
              auction_event_id: aeData.id
            }
          });
          
          if (!commentsError && commentsResult) {
            commentsExtracted = commentsResult.comments_extracted || 0;
          }
        } catch (e) {
          // Comments extraction is non-critical, continue
          console.log(`   ⚠️  Comments extraction failed (non-critical): ${e.message}`);
        }
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

async function fixMissingData() {
  console.log('🔧 Fixing Missing BaT Data');
  console.log('='.repeat(80));
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Delay between vehicles: ${DELAY_BETWEEN_VEHICLES}ms`);
  console.log(`Delay between batches: ${DELAY_BETWEEN_BATCHES}ms`);
  if (MAX_VEHICLES > 0) {
    console.log(`Max vehicles: ${MAX_VEHICLES}`);
  }
  console.log('');
  
  const vehicles = await getVehiclesNeedingFix();
  
  if (vehicles.length === 0) {
    console.log('✅ No vehicles need fixing!');
    return;
  }
  
  const toProcess = MAX_VEHICLES > 0 ? vehicles.slice(0, MAX_VEHICLES) : vehicles;
  
  console.log(`🚀 Processing ${toProcess.length} vehicles...\n`);
  
  let successCount = 0;
  let failCount = 0;
  let totalComments = 0;
  
  const startTime = Date.now();
  
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
    
    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} vehicles)`);
    console.log('-'.repeat(80));
    
    const batchResults = await Promise.all(batch.map(async (vehicle) => {
      const vehicleName = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;
      const urlSlug = (vehicle.discovery_url || vehicle.bat_auction_url || '').split('/').filter(Boolean).pop() || 'unknown';
      
      console.log(`\n🔧 [Score: ${vehicle.missing_score}] ${vehicleName}`);
      console.log(`   URL: ${urlSlug}`);
      console.log(`   Missing: ${vehicle.issues.join(', ')}`);
      
      const result = await extractVehicleData(vehicle);
      
      if (result.success) {
        console.log(`   ✅ Success!`);
        if (result.vehicles_updated > 0) console.log(`      - Updated vehicle`);
        if (result.vehicles_created > 0) console.log(`      - Created vehicle`);
        if (result.comments_extracted > 0) {
          console.log(`      - Extracted ${result.comments_extracted} comments`);
          totalComments += result.comments_extracted;
        }
        return { vehicle, result, success: true };
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
        return { vehicle, result, success: false };
      }
    }));
    
    // Count successes/failures
    batchResults.forEach(r => {
      if (r.success) {
        successCount++;
      } else {
        failCount++;
      }
    });
    
    // Delay between batches (except last batch)
    if (i + BATCH_SIZE < toProcess.length) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Processed: ${toProcess.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`💬 Total Comments Extracted: ${totalComments}`);
  console.log(`⏱️  Time Elapsed: ${elapsed} minutes`);
  console.log('='.repeat(80));
}

fixMissingData().catch(console.error);

