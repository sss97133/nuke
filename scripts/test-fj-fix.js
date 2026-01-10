#!/usr/bin/env node
/**
 * QUICK TEST: Fix 1-2 Fantasy Junction vehicles to validate approach
 * Run this first before processing all 381
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

async function testFix() {
  console.log('🧪 Testing Fantasy Junction Fix on 1 Vehicle\n');
  
  // Get 1 Fantasy Junction vehicle with BaT URL missing VIN or trim
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', FJ_ORG_ID)
    .limit(50);
  
  if (!orgVehicles || orgVehicles.length === 0) {
    console.log('❌ No Fantasy Junction vehicles found');
    return;
  }
  
  const vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
  
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, vin, trim, drivetrain')
    .in('id', vehicleIds)
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%')
    .or('vin.is.null,trim.is.null')
    .limit(1);
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles need fixing (or no BaT URLs found)');
    return;
  }
  
  const vehicle = vehicles[0];
  const url = vehicle.discovery_url || vehicle.bat_auction_url;
  
  console.log(`Vehicle: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
  console.log(`Before: VIN=${vehicle.vin ? 'YES' : 'NO'}, trim=${vehicle.trim ? 'YES' : 'NO'}, drivetrain=${vehicle.drivetrain ? 'YES' : 'NO'}`);
  console.log(`URL: ${url}\n`);
  
  console.log('⏱️  Starting extraction (this should take 10-30 seconds)...\n');
  const startTime = Date.now();
  
  try {
    const { data: result, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: { url, max_vehicles: 1 }
    });
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (error) {
      console.log(`❌ FAILED after ${elapsed}s`);
      console.log(`   Error: ${error.message}`);
      console.log(`\n⚠️  Edge Function call failed - approach won't work`);
      return { success: false, reason: 'edge_function_error', time: elapsed };
    }
    
    if (!result || !result.success) {
      console.log(`❌ FAILED after ${elapsed}s`);
      console.log(`   Response: ${JSON.stringify(result, null, 2).substring(0, 300)}`);
      console.log(`\n⚠️  Edge Function returned failure - approach won't work`);
      return { success: false, reason: 'extraction_failed', time: elapsed };
    }
    
    console.log(`✅ Extraction completed in ${elapsed}s`);
    console.log(`   Vehicles updated: ${result.vehicles_updated || 0}`);
    console.log(`   Vehicles created: ${result.vehicles_created || 0}\n`);
    
    // Check if vehicle was actually fixed
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for DB update
    
    const { data: updated } = await supabase
      .from('vehicles')
      .select('vin, trim, drivetrain')
      .eq('id', vehicle.id)
      .single();
    
    console.log(`After: VIN=${updated?.vin ? 'YES (' + updated.vin.slice(0, 10) + '...)' : 'NO'}, trim=${updated?.trim ? 'YES' : 'NO'}, drivetrain=${updated?.drivetrain ? 'YES' : 'NO'}\n`);
    
    const wasFixed = (updated?.vin && !vehicle.vin) || (updated?.trim && !vehicle.trim);
    
    if (wasFixed) {
      console.log(`✅ SUCCESS - Vehicle was fixed!`);
      console.log(`   Estimated time for 381 vehicles: ${((elapsed * 381) / 60).toFixed(1)} minutes`);
      console.log(`   Recommendation: Run fix script with batches of 20-30 vehicles\n`);
      return { success: true, time: elapsed, fixed: wasFixed };
    } else {
      console.log(`⚠️  WARNING - Extraction ran but vehicle wasn't fixed`);
      console.log(`   This suggests the BaT listing doesn't have VIN/trim, or extraction failed\n`);
      return { success: false, reason: 'not_fixed', time: elapsed };
    }
    
  } catch (e) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`❌ EXCEPTION after ${elapsed}s`);
    console.log(`   Error: ${e.message}`);
    console.log(`\n⚠️  Approach won't work - check Edge Function status\n`);
    return { success: false, reason: 'exception', time: elapsed };
  }
}

testFix().then(result => {
  process.exit(result?.success ? 0 : 1);
}).catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
