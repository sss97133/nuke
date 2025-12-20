#!/usr/bin/env node
/**
 * Re-extract images from BaT listings using improved extraction code
 * Calls import-bat-listing for each vehicle to update origin_metadata.image_urls with clean images
 * 
 * Usage: 
 *   node scripts/re-extract-bat-images-batch.js [limit]
 *   If limit provided, only process that many vehicles (for testing)
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

async function reExtractImagesForVehicle(vehicle) {
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    return { skipped: true, reason: 'no_bat_url' };
  }
  
  try {
    console.log(`\n🔄 Re-extracting: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    
    // Call import-bat-listing which will:
    // 1. Use improved extractBatDomMap (targets #bat_listing_page_photo_gallery)
    // 2. Update origin_metadata.image_urls with clean images
    // 3. Upload images via backfill-images
    const { data, error } = await supabase.functions.invoke('import-bat-listing', {
      body: { batUrl, vehicleId: vehicle.id }
    });
    
    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      return { success: false, error: error.message };
    }
    
    // Wait for DB update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check updated image URLs
    const { data: updated } = await supabase
      .from('vehicles')
      .select('origin_metadata')
      .eq('id', vehicle.id)
      .single();
    
    const oldCount = vehicle.origin_metadata?.image_urls?.length || 0;
    const newCount = updated?.origin_metadata?.image_urls?.length || 0;
    
    console.log(`   ✅ Updated: ${oldCount} → ${newCount} image URLs`);
    
    return { success: true, oldCount, newCount };
  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || '10');
  console.log(`🔄 Re-extracting images for up to ${limit} BaT vehicles...\n`);
  
  // Get BaT vehicles that have bat_auction_url or discovery_url
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, discovery_url, origin_metadata')
    .or('bat_auction_url.ilike.%bringatrailer.com%,discovery_url.ilike.%bringatrailer.com%')
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    process.exit(1);
  }
  
  console.log(`📦 Found ${vehicles?.length || 0} vehicles to process\n`);
  
  const results = {
    total: vehicles?.length || 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0
  };
  
  for (const vehicle of vehicles || []) {
    const result = await reExtractImagesForVehicle(vehicle);
    results.processed++;
    
    if (result.skipped) {
      results.skipped++;
    } else if (result.success) {
      results.succeeded++;
    } else {
      results.failed++;
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n✅ Batch complete!`);
  console.log(`   Total: ${results.total}`);
  console.log(`   Succeeded: ${results.succeeded}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Skipped: ${results.skipped}`);
}

main().catch(console.error);

