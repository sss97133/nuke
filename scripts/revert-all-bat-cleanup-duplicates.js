#!/usr/bin/env node
/**
 * REVERT ALL duplicate flags set by the cleanup script
 * The cleanup script was too aggressive and marked good images as duplicates
 * This reverts ALL is_duplicate flags for BaT vehicles
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

async function revertAllDuplicates() {
  console.log('🔄 Reverting ALL duplicate flags for BaT vehicles...\n');
  
  // Get all BaT vehicles
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('bat_auction_url.ilike.%bringatrailer.com%,discovery_url.ilike.%bringatrailer.com%')
    .limit(1000);
  
  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError);
    process.exit(1);
  }
  
  console.log(`📦 Found ${vehicles?.length || 0} BaT vehicles\n`);
  
  let totalReverted = 0;
  let vehiclesProcessed = 0;
  
  // Revert duplicates for all BaT vehicles
  for (const vehicle of vehicles || []) {
    const { data: updated, error } = await supabase
      .from('vehicle_images')
      .update({ is_duplicate: false })
      .eq('vehicle_id', vehicle.id)
      .eq('is_duplicate', true)
      .select('id');
    
    if (error) {
      console.error(`   ❌ Error for ${vehicle.year} ${vehicle.make} ${vehicle.model}: ${error.message}`);
      continue;
    }
    
    const reverted = updated?.length || 0;
    if (reverted > 0) {
      totalReverted += reverted;
      vehiclesProcessed++;
      console.log(`   ✅ ${vehicle.year} ${vehicle.make} ${vehicle.model}: Reverted ${reverted} images`);
    }
  }
  
  console.log(`\n✅ Revert complete!`);
  console.log(`   Vehicles processed: ${vehiclesProcessed}`);
  console.log(`   Total images reverted: ${totalReverted}`);
}

revertAllDuplicates().catch(console.error);

