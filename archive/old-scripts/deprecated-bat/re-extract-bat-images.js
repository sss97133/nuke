#!/usr/bin/env node
/**
 * Re-extract images from BaT listings using the improved extraction code
 * This will update origin_metadata.image_urls with clean images from #bat_listing_page_photo_gallery
 * 
 * Usage: node scripts/re-extract-bat-images.js [vehicle_id]
 * If no vehicle_id provided, processes all BaT vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function reExtractImages(vehicleId) {
  console.log(`🔄 Re-extracting images for vehicle: ${vehicleId}\n`);
  
  // Get vehicle
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, discovery_url, origin_metadata')
    .eq('id', vehicleId)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Error fetching vehicle:', vehicleError);
    return;
  }
  
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    console.error('❌ No BaT URL found for this vehicle');
    return;
  }
  
  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`BaT URL: ${batUrl}`);
  
  // Call comprehensive extraction which uses the improved batDomMap extraction
  console.log('\n📥 Fetching BaT listing and extracting images...');
  
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    if (error) {
      console.error('❌ Extraction error:', error);
      return;
    }
    
    if (!data || !data.success) {
      console.error('❌ Extraction failed:', data?.error || 'Unknown error');
      return;
    }
    
    console.log('✅ Extraction completed');
    
    // Wait a moment for DB to update
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check updated vehicle
    const { data: updated, error: updatedError } = await supabase
      .from('vehicles')
      .select('origin_metadata')
      .eq('id', vehicleId)
      .single();
    
    if (updatedError) {
      console.error('❌ Error fetching updated vehicle:', updatedError);
      return;
    }
    
    const oldUrls = vehicle.origin_metadata?.image_urls || [];
    const newUrls = updated.origin_metadata?.image_urls || [];
    
    console.log(`\n📊 Results:`);
    console.log(`   Old image URLs: ${oldUrls.length}`);
    console.log(`   New image URLs: ${newUrls.length}`);
    console.log(`   Difference: ${newUrls.length - oldUrls.length}`);
    
    if (newUrls.length > 0) {
      console.log(`\n✅ Successfully updated image URLs in origin_metadata`);
      console.log(`   First 3 URLs: ${newUrls.slice(0, 3).map(u => u.substring(u.lastIndexOf('/') + 1, u.indexOf('?') > 0 ? u.indexOf('?') : Math.min(u.length, u.lastIndexOf('/') + 40))).join(', ')}`);
    }
    
  } catch (err) {
    console.error('❌ Exception:', err);
  }
}

async function main() {
  const vehicleId = process.argv[2];
  
  if (vehicleId) {
    await reExtractImages(vehicleId);
  } else {
    console.log('Usage: node scripts/re-extract-bat-images.js <vehicle_id>');
    console.log('Or process all BaT vehicles by calling comprehensive-bat-extraction for each');
  }
}

main().catch(console.error);

