#!/usr/bin/env node
/**
 * Re-import images for vehicles that need it
 * Uses extract-premium-auction to get full galleries
 * Run: node scripts/reimport-images-for-vehicles.js [batch-size] [start-index]
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

const BATCH_SIZE = parseInt(process.argv[2]) || 10;
const START_INDEX = parseInt(process.argv[3]) || 0;

async function reimportImages() {
  console.log(`🔄 Re-importing images for vehicles...\n`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Starting from index: ${START_INDEX}\n`);
  
  // Step 1: Find vehicles needing re-import
  console.log('   Finding vehicles needing re-import...');
  
  const { data: vehicles, error: findError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, platform_url')
    .not('discovery_url', 'is', null)
    .limit(10000);
  
  if (findError) {
    console.error('❌ Error:', findError);
    return;
  }
  
  // Filter to vehicles that need re-import
  const vehiclesNeedingReimport = [];
  
  for (const vehicle of vehicles || []) {
    const discoveryUrl = vehicle.discovery_url || vehicle.platform_url;
    
    // Skip if no URL
    if (!discoveryUrl) continue;
    
    // Check for /video URLs
    if (discoveryUrl.includes('/video') || discoveryUrl.endsWith('/video')) {
      vehiclesNeedingReimport.push({
        ...vehicle,
        cleanUrl: discoveryUrl.replace(/\/video\/?$/, '').replace(/\/video\//, '/')
      });
      continue;
    }
    
    // Check image count
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .not('is_document', 'is', true);
    
    const imageCount = images?.length || 0;
    
    // Include if < 5 images
    if (imageCount < 5) {
      vehiclesNeedingReimport.push({
        ...vehicle,
        cleanUrl: discoveryUrl,
        imageCount
      });
    }
  }
  
  console.log(`📊 Found ${vehiclesNeedingReimport.length} vehicles needing re-import\n`);
  
  const vehiclesToProcess = vehiclesNeedingReimport.slice(START_INDEX, START_INDEX + BATCH_SIZE);
  console.log(`🔄 Processing ${vehiclesToProcess.length} vehicles (${START_INDEX} to ${START_INDEX + vehiclesToProcess.length - 1})...\n`);
  
  const results = {
    processed: 0,
    fixed: 0,
    reExtracted: 0,
    errors: 0
  };
  
  for (const vehicle of vehiclesToProcess) {
    try {
      const listingUrl = vehicle.cleanUrl || vehicle.discovery_url || vehicle.platform_url;
      
      if (!listingUrl) {
        results.errors++;
        continue;
      }
      
      // Fix /video URLs first
      if (vehicle.discovery_url?.includes('/video') || vehicle.platform_url?.includes('/video')) {
        const cleanUrl = listingUrl.replace(/\/video\/?$/, '').replace(/\/video\//, '/');
        
        await supabase
          .from('vehicles')
          .update({
            discovery_url: cleanUrl,
            platform_url: cleanUrl
          })
          .eq('id', vehicle.id);
        
        results.fixed++;
        console.log(`   ✅ ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: Fixed /video URL`);
      }
      
      // Re-extract images using extract-premium-auction
      console.log(`   🔄 Re-extracting images for ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}...`);
      
      const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-premium-auction', {
        body: {
          url: listingUrl,
          max_vehicles: 1,
          debug: false
        }
      });
      
      if (extractError) {
        console.error(`   ❌ Extraction failed: ${extractError.message}`);
        results.errors++;
      } else {
        const imageCount = extractData?.vehicles_extracted?.[0]?.images?.length || 0;
        console.log(`   ✅ Re-extracted ${imageCount} images`);
        results.reExtracted++;
      }
      
      results.processed++;
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (e) {
      console.error(`   ❌ Error processing ${vehicle.id}: ${e.message}`);
      results.errors++;
    }
  }
  
  console.log(`\n📊 RESULTS:\n`);
  console.log(`   Processed: ${results.processed} vehicles`);
  console.log(`   Fixed URLs: ${results.fixed} vehicles`);
  console.log(`   Re-extracted: ${results.reExtracted} vehicles`);
  console.log(`   Errors: ${results.errors}`);
  
  const remaining = vehiclesNeedingReimport.length - (START_INDEX + vehiclesToProcess.length);
  if (remaining > 0) {
    console.log(`\n💡 ${remaining} vehicles remaining. Run again with:`);
    console.log(`   node scripts/reimport-images-for-vehicles.js ${BATCH_SIZE} ${START_INDEX + BATCH_SIZE}`);
  } else {
    console.log(`\n✅ All vehicles processed!`);
  }
}

reimportImages().catch(console.error);

