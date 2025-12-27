#!/usr/bin/env node
/**
 * Diagnose the scope of the import_queue logo issue
 * Run: node scripts/diagnose-import-queue-issue.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('🔍 Diagnosing import_queue logo issue...\n');
  
  // Step 1: Count total vehicles with import_queue images
  console.log('📊 Step 1: Finding vehicles with import_queue images...\n');
  
  const { data: vehiclesWithImportQueue, error: countError } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .or('storage_path.ilike.%import_queue%,image_url.ilike.%import_queue%')
    .limit(10000);
  
  if (countError) {
    console.error('❌ Error:', countError);
    return;
  }
  
  const uniqueVehicleIds = [...new Set((vehiclesWithImportQueue || []).map(v => v.vehicle_id))];
  console.log(`   Found ${uniqueVehicleIds.length} unique vehicles with import_queue images`);
  
  // Step 2: Get detailed breakdown for a sample
  const sampleSize = Math.min(100, uniqueVehicleIds.length);
  const sampleIds = uniqueVehicleIds.slice(0, sampleSize);
  
  console.log(`\n📊 Step 2: Analyzing ${sampleSize} vehicles (sample)...\n`);
  
  const { data: vehicles, error: vError } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      platform_url,
      discovery_url,
      origin_metadata,
      primary_image_url
    `)
    .in('id', sampleIds);
  
  if (vError) {
    console.error('❌ Error:', vError);
    return;
  }
  
  const stats = {
    totalAnalyzed: 0,
    withImportQueueImages: 0,
    withPrimaryAsImportQueue: 0,
    withNoGoodImages: 0,
    withOriginMetadata: 0,
    withListingUrl: 0,
    totalImportQueueImages: 0,
    totalGoodImages: 0,
    vehiclesByIssue: {
      onlyImportQueue: [],
      primaryIsImportQueue: [],
      hasOriginMetadata: [],
      hasListingUrl: [],
      noImagesAtAll: []
    }
  };
  
  for (const vehicle of vehicles || []) {
    stats.totalAnalyzed++;
    
    // Get all images
    const { data: images, error: imgError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, storage_path, is_primary, source')
      .eq('vehicle_id', vehicle.id);
    
    if (imgError) continue;
    
    const importQueueImages = (images || []).filter(img => 
      img.storage_path?.includes('import_queue') || 
      img.image_url?.includes('import_queue')
    );
    
    const goodImages = (images || []).filter(img => 
      !img.storage_path?.includes('import_queue') && 
      !img.image_url?.includes('import_queue') &&
      !img.image_url?.includes('organization-logos') &&
      !img.image_url?.includes('uploads/dealer/')
    );
    
    const primaryIsImportQueue = importQueueImages.some(img => img.is_primary);
    const hasOnlyImportQueue = importQueueImages.length > 0 && goodImages.length === 0;
    const hasNoImages = (images || []).length === 0;
    
    const originImages = vehicle.origin_metadata?.image_urls || 
                        vehicle.origin_metadata?.external_images || [];
    const hasOriginMetadata = Array.isArray(originImages) && originImages.length > 0;
    const hasListingUrl = !!(vehicle.discovery_url || vehicle.platform_url);
    
    if (importQueueImages.length > 0) {
      stats.withImportQueueImages++;
      stats.totalImportQueueImages += importQueueImages.length;
      stats.totalGoodImages += goodImages.length;
      
      if (primaryIsImportQueue) {
        stats.withPrimaryAsImportQueue++;
        stats.vehiclesByIssue.primaryIsImportQueue.push({
          id: vehicle.id,
          name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          importQueueCount: importQueueImages.length,
          goodImageCount: goodImages.length,
          hasOriginMetadata,
          hasListingUrl
        });
      }
      
      if (hasOnlyImportQueue) {
        stats.withNoGoodImages++;
        stats.vehiclesByIssue.onlyImportQueue.push({
          id: vehicle.id,
          name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          importQueueCount: importQueueImages.length,
          hasOriginMetadata,
          hasListingUrl,
          originImageCount: Array.isArray(originImages) ? originImages.length : 0
        });
      }
    }
    
    if (hasOriginMetadata) stats.withOriginMetadata++;
    if (hasListingUrl) stats.withListingUrl++;
    if (hasNoImages) {
      stats.vehiclesByIssue.noImagesAtAll.push({
        id: vehicle.id,
        name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        hasOriginMetadata,
        hasListingUrl
      });
    }
  }
  
  // Step 3: Estimate for all vehicles
  const estimateTotal = Math.floor((stats.withImportQueueImages / stats.totalAnalyzed) * uniqueVehicleIds.length);
  const estimatePrimaryIssue = Math.floor((stats.withPrimaryAsImportQueue / stats.totalAnalyzed) * uniqueVehicleIds.length);
  const estimateNoGood = Math.floor((stats.withNoGoodImages / stats.totalAnalyzed) * uniqueVehicleIds.length);
  
  // Print results
  console.log('\n📈 DIAGNOSIS RESULTS:\n');
  console.log(`Sample Size: ${stats.totalAnalyzed} vehicles`);
  console.log(`Vehicles with import_queue images: ${stats.withImportQueueImages} (${((stats.withImportQueueImages/stats.totalAnalyzed)*100).toFixed(1)}%)`);
  console.log(`Vehicles with primary as import_queue: ${stats.withPrimaryAsImportQueue} (${((stats.withPrimaryAsImportQueue/stats.totalAnalyzed)*100).toFixed(1)}%)`);
  console.log(`Vehicles with ONLY import_queue images: ${stats.withNoGoodImages} (${((stats.withNoGoodImages/stats.totalAnalyzed)*100).toFixed(1)}%)`);
  console.log(`\nEstimated Totals (extrapolated from ${uniqueVehicleIds.length} total):`);
  console.log(`  - Total vehicles with import_queue: ~${estimateTotal}`);
  console.log(`  - With primary as import_queue: ~${estimatePrimaryIssue}`);
  console.log(`  - With ONLY import_queue: ~${estimateNoGood}`);
  console.log(`\nImage Counts:`);
  console.log(`  - Total import_queue images: ${stats.totalImportQueueImages}`);
  console.log(`  - Total good images: ${stats.totalGoodImages}`);
  console.log(`  - Average import_queue per vehicle: ${stats.withImportQueueImages > 0 ? (stats.totalImportQueueImages/stats.withImportQueueImages).toFixed(1) : 0}`);
  console.log(`  - Average good images per vehicle: ${stats.withImportQueueImages > 0 ? (stats.totalGoodImages/stats.withImportQueueImages).toFixed(1) : 0}`);
  
  console.log(`\nRecovery Potential:`);
  console.log(`  - Vehicles with origin_metadata images: ${stats.withOriginMetadata} (${((stats.withOriginMetadata/stats.totalAnalyzed)*100).toFixed(1)}%)`);
  console.log(`  - Vehicles with listing URLs: ${stats.withListingUrl} (${((stats.withListingUrl/stats.totalAnalyzed)*100).toFixed(1)}%)`);
  
  console.log(`\n📋 Sample Vehicles Needing Fix:`);
  console.log(`\n  Only Import Queue (${stats.vehiclesByIssue.onlyImportQueue.length}):`);
  stats.vehiclesByIssue.onlyImportQueue.slice(0, 10).forEach(v => {
    console.log(`    - ${v.name}: ${v.importQueueCount} import_queue, ${v.originImageCount} origin images, URL: ${v.hasListingUrl ? 'YES' : 'NO'}`);
  });
  
  console.log(`\n  Primary is Import Queue (${stats.vehiclesByIssue.primaryIsImportQueue.length}):`);
  stats.vehiclesByIssue.primaryIsImportQueue.slice(0, 10).forEach(v => {
    console.log(`    - ${v.name}: ${v.importQueueCount} import_queue, ${v.goodImageCount} good, URL: ${v.hasListingUrl ? 'YES' : 'NO'}`);
  });
  
  return {
    totalVehiclesWithIssue: uniqueVehicleIds.length,
    estimatedStats: {
      withImportQueue: estimateTotal,
      withPrimaryAsImportQueue: estimatePrimaryIssue,
      withOnlyImportQueue: estimateNoGood,
      withOriginMetadata: Math.floor((stats.withOriginMetadata / stats.totalAnalyzed) * uniqueVehicleIds.length),
      withListingUrl: Math.floor((stats.withListingUrl / stats.totalAnalyzed) * uniqueVehicleIds.length)
    },
    sampleStats: stats
  };
}

diagnose().catch(console.error);

