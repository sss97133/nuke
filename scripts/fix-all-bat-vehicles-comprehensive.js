#!/usr/bin/env node
/**
 * URGENT FIX: Re-extract ALL BaT vehicles with comprehensive extraction
 * 
 * This fixes:
 * - Missing descriptions
 * - Missing features (bat_features)
 * - Missing auction data (dates, prices, bids, views, comments)
 * - Contaminated image URLs
 * 
 * Scope: ~740 BaT vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BATCH_SIZE = 10; // Process 10 at a time
const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches
const DELAY_BETWEEN_REQUESTS = 1000; // 1 second between individual requests

/**
 * Get BaT URL from vehicle record
 */
function getBaTUrl(vehicle) {
  return vehicle.bat_auction_url 
    || vehicle.discovery_url 
    || vehicle.origin_metadata?.listing_url
    || null;
}

/**
 * Call comprehensive-bat-extraction edge function
 */
async function extractComprehensiveData(batUrl, vehicleId) {
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Process a single vehicle
 */
async function processVehicle(vehicle, index, total) {
  const batUrl = getBaTUrl(vehicle);
  
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    console.log(`⏭️  [${index + 1}/${total}] ${vehicle.year} ${vehicle.make} ${vehicle.model || ''} - No BaT URL, skipping`);
    return { success: false, reason: 'No BaT URL' };
  }
  
  console.log(`\n🔄 [${index + 1}/${total}] Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model || ''}`);
  console.log(`   Vehicle ID: ${vehicle.id}`);
  console.log(`   URL: ${batUrl}`);
  
  // Check current state
  const hasDescription = vehicle.description && vehicle.description.length > 50;
  const hasFeatures = vehicle.origin_metadata?.bat_features && Array.isArray(vehicle.origin_metadata.bat_features) && vehicle.origin_metadata.bat_features.length > 0;
  const hasSaleDate = !!vehicle.sale_date;
  const hasComments = vehicle.bat_comments !== null && vehicle.bat_comments !== undefined;
  
  console.log(`   Current state: desc=${hasDescription ? '✅' : '❌'}, features=${hasFeatures ? '✅' : '❌'}, sale_date=${hasSaleDate ? '✅' : '❌'}, comments=${hasComments ? '✅' : '❌'}`);
  
  const result = await extractComprehensiveData(batUrl, vehicle.id);
  
  if (!result.success) {
    console.log(`   ❌ Extraction failed: ${result.error}`);
    return { success: false, error: result.error };
  }
  
  console.log(`   ✅ Extraction complete`);
  
  // Wait a bit and verify update
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const { data: updated } = await supabase
    .from('vehicles')
    .select('description, origin_metadata, sale_date, bat_comments, bat_bids, bat_views')
    .eq('id', vehicle.id)
    .single();
  
  if (updated) {
    const nowHasDescription = updated.description && updated.description.length > 50;
    const nowHasFeatures = updated.origin_metadata?.bat_features && Array.isArray(updated.origin_metadata.bat_features) && updated.origin_metadata.bat_features.length > 0;
    const nowHasSaleDate = !!updated.sale_date;
    const nowHasComments = updated.bat_comments !== null && updated.bat_comments !== undefined;
    
    console.log(`   📊 After update: desc=${nowHasDescription ? '✅' : '❌'}, features=${nowHasFeatures ? '✅' : '❌'}, sale_date=${nowHasSaleDate ? '✅' : '❌'}, comments=${nowHasComments ? '✅' : '❌'}`);
    
    if (nowHasFeatures) {
      console.log(`   📋 Features: ${updated.origin_metadata.bat_features.length} items`);
    }
    if (updated.bat_bids) {
      console.log(`   💰 Bids: ${updated.bat_bids}, Views: ${updated.bat_views}`);
    }
  }
  
  return { success: true };
}

/**
 * Process vehicles in batches
 */
async function processBatch(vehicles, startIndex) {
  const batch = vehicles.slice(startIndex, startIndex + BATCH_SIZE);
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📦 Processing batch ${Math.floor(startIndex / BATCH_SIZE) + 1} (vehicles ${startIndex + 1}-${Math.min(startIndex + BATCH_SIZE, vehicles.length)})`);
  console.log(`${'='.repeat(80)}`);
  
  const results = [];
  
  for (let i = 0; i < batch.length; i++) {
    const vehicle = batch[i];
    const globalIndex = startIndex + i;
    
    const result = await processVehicle(vehicle, globalIndex, vehicles.length);
    results.push(result);
    
    // Delay between requests
    if (i < batch.length - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS));
    }
  }
  
  return results;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚨 URGENT: FIXING ALL BaT VEHICLES\n');
  console.log('This will re-extract comprehensive data for all BaT vehicles');
  console.log('including descriptions, features, auction data, and clean images.\n');
  
  // Get all BaT vehicles that need fixing
  console.log('📊 Fetching BaT vehicles...\n');
  
  const { data: vehicles, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, origin_metadata, description, sale_date, bat_comments, bat_bids, bat_views')
    .or('discovery_url.ilike.%bringatrailer.com%,bat_auction_url.ilike.%bringatrailer.com%')
    .order('created_at', { ascending: false });
  
  if (fetchError) {
    console.error('❌ Error fetching vehicles:', fetchError);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No BaT vehicles found');
    return;
  }
  
  console.log(`📊 Found ${vehicles.length} BaT vehicles\n`);
  
  // Filter to vehicles that need fixing (missing critical data)
  const vehiclesNeedingFix = vehicles.filter(v => {
    const batUrl = getBaTUrl(v);
    if (!batUrl) return false;
    
    // Need fixing if missing any of: description, features, sale_date, comments
    const needsDescription = !v.description || v.description.length < 50;
    const needsFeatures = !v.origin_metadata?.bat_features || !Array.isArray(v.origin_metadata.bat_features) || v.origin_metadata.bat_features.length === 0;
    const needsSaleDate = !v.sale_date;
    const needsComments = v.bat_comments === null || v.bat_comments === undefined;
    
    return needsDescription || needsFeatures || needsSaleDate || needsComments;
  });
  
  console.log(`🎯 ${vehiclesNeedingFix.length} vehicles need comprehensive data extraction\n`);
  
  if (vehiclesNeedingFix.length === 0) {
    console.log('✅ All vehicles already have comprehensive data!');
    return;
  }
  
  // Process in batches
  const allResults = [];
  let processed = 0;
  
  for (let i = 0; i < vehiclesNeedingFix.length; i += BATCH_SIZE) {
    const batchResults = await processBatch(vehiclesNeedingFix, i);
    allResults.push(...batchResults);
    processed += batchResults.length;
    
    console.log(`\n✅ Completed ${processed}/${vehiclesNeedingFix.length} vehicles`);
    
    // Delay between batches (except for last batch)
    if (i + BATCH_SIZE < vehiclesNeedingFix.length) {
      console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...\n`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 FINAL SUMMARY');
  console.log(`${'='.repeat(80)}\n`);
  
  const successCount = allResults.filter(r => r.success).length;
  const failCount = allResults.filter(r => !r.success).length;
  
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📊 Total processed: ${allResults.length}`);
  
  if (failCount > 0) {
    console.log(`\n⚠️  Some vehicles failed. You may want to retry failed ones.`);
  } else {
    console.log(`\n🎉 All vehicles processed successfully!`);
  }
}

// Run
main().catch(console.error);

