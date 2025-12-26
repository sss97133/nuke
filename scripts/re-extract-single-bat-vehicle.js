#!/usr/bin/env node
/**
 * Re-extract BaT images for a single vehicle using comprehensive-bat-extraction
 * This ensures all 120+ full-resolution images from data-gallery-items are extracted
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function reExtractVehicle(vehicleId) {
  console.log(`\n🔄 Re-extracting BaT images for vehicle: ${vehicleId}`);
  
  // Get vehicle info
  const { data: vehicle, error: vehError } = await supabase
    .from('vehicles')
    .select('id, discovery_url, bat_auction_url, origin_metadata')
    .eq('id', vehicleId)
    .single();
  
  if (vehError || !vehicle) {
    console.error(`❌ Error loading vehicle: ${vehError?.message}`);
    return { success: false, error: vehError?.message };
  }
  
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com/listing/')) {
    console.error(`❌ No valid BaT URL found for vehicle`);
    return { success: false, error: 'No BaT URL' };
  }
  
  console.log(`📸 BaT URL: ${batUrl}`);
  
  const oldCount = vehicle.origin_metadata?.image_urls?.length || 0;
  console.log(`📊 Current image count in origin_metadata: ${oldCount}`);
  
  try {
    // Use import-bat-listing which properly extracts from data-gallery-items
    console.log(`\n🚀 Calling import-bat-listing...`);
    const { data, error } = await supabase.functions.invoke('import-bat-listing', {
      body: { batUrl, vehicleId }
    });
    
    if (error) {
      console.error(`❌ Function error: ${error.message}`);
      return { success: false, error: error.message };
    }
    
    if (!data || !data.success) {
      console.error(`❌ Extraction failed: ${data?.error || 'Unknown error'}`);
      return { success: false, error: data?.error || 'Extraction failed' };
    }
    
    console.log(`✅ Extraction completed!`);
    
    // Wait for DB update
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check updated image URLs
    const { data: updated, error: checkError } = await supabase
      .from('vehicles')
      .select('origin_metadata')
      .eq('id', vehicleId)
      .single();
    
    if (checkError) {
      console.error(`❌ Error checking results: ${checkError.message}`);
      return { success: false, error: checkError.message };
    }
    
    const newCount = updated?.origin_metadata?.image_urls?.length || 0;
    console.log(`\n📊 Results:`);
    console.log(`   Before: ${oldCount} images`);
    console.log(`   After:  ${newCount} images`);
    console.log(`   Change: ${newCount - oldCount > 0 ? '+' : ''}${newCount - oldCount}`);
    
    // Check vehicle_images count
    const { count: dbImageCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId)
      .not('is_document', 'is', true);
    
    console.log(`   Database images: ${dbImageCount || 0}`);
    
    return { 
      success: true, 
      oldCount, 
      newCount, 
      dbImageCount: dbImageCount || 0,
      change: newCount - oldCount 
    };
  } catch (err) {
    console.error(`❌ Exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function main() {
  const vehicleId = process.argv[2];
  
  if (!vehicleId) {
    console.error('Usage: node re-extract-single-bat-vehicle.js <vehicle_id>');
    process.exit(1);
  }
  
  const result = await reExtractVehicle(vehicleId);
  
  if (result.success) {
    console.log(`\n✅ Re-extraction complete!`);
    process.exit(0);
  } else {
    console.error(`\n❌ Re-extraction failed: ${result.error}`);
    process.exit(1);
  }
}

main().catch(console.error);

