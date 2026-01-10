#!/usr/bin/env node
/**
 * Simple, fast fix for Fantasy Junction vehicles
 * Uses existing extract-premium-auction Edge Function sequentially
 * Processes only vehicles with BaT URLs and missing critical data
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

const FJ_ORG_ID = '1d9122ea-1aaf-46ea-81ea-5f75cb259b69';
const MAX_VEHICLES = parseInt(process.argv[2]) || 20;
const DELAY_BETWEEN_VEHICLES = 5000; // 5 seconds

async function main() {
  console.log('🚀 Fantasy Junction Quick Fix');
  console.log('='.repeat(60));
  console.log(`Processing ${MAX_VEHICLES} vehicles with missing VIN/trim...\n`);
  
  // Get Fantasy Junction vehicles via org
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', FJ_ORG_ID)
    .limit(MAX_VEHICLES * 2);
  
  if (!orgVehicles || orgVehicles.length === 0) {
    console.log('❌ No Fantasy Junction vehicles found');
    return;
  }
  
  const vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
  
  // Get vehicles with BaT URLs missing VIN or trim
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, vin, trim')
    .in('id', vehicleIds)
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%')
    .or('vin.is.null,trim.is.null')
    .limit(MAX_VEHICLES);
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles need fixing');
    return;
  }
  
  console.log(`Found ${vehicles.length} vehicles to fix\n`);
  
  let success = 0;
  let failed = 0;
  
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    const url = vehicle.discovery_url || vehicle.bat_auction_url;
    
    if (!url || !url.includes('bringatrailer.com/listing/')) {
      console.log(`⏭️  ${vehicle.id.slice(0, 8)}... - No BaT URL`);
      continue;
    }
    
    console.log(`[${i + 1}/${vehicles.length}] ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
    console.log(`   URL: ${url.split('/listing/')[1]?.split('/')[0] || url.slice(0, 50)}`);
    
    try {
      const { data: result, error } = await supabase.functions.invoke('extract-premium-auction', {
        body: { url, max_vehicles: 1 }
      });
      
      if (error) {
        console.log(`   ❌ Error: ${error.message}`);
        failed++;
      } else if (result?.success) {
        console.log(`   ✅ Extracted`);
        success++;
      } else {
        console.log(`   ⚠️  Failed: ${result?.error || 'Unknown'}`);
        failed++;
      }
    } catch (e) {
      console.log(`   ❌ Exception: ${e.message}`);
      failed++;
    }
    
    if (i < vehicles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VEHICLES));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
