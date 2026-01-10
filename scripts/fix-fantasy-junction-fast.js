#!/usr/bin/env node
/**
 * Fast fix for Fantasy Junction vehicles
 * Batch processes BaT listings via extract-premium-auction
 * Only fixes vehicles with missing critical data
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
const BATCH_SIZE = 5; // Process 5 at a time in parallel
const DELAY_BETWEEN_BATCHES = 5000;

async function getFantasyJunctionVehicles(limit = 100) {
  // Get vehicles via organization relationship
  const { data: orgVehicles } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', FJ_ORG_ID)
    .limit(limit);
  
  if (!orgVehicles || orgVehicles.length === 0) return [];
  
  const vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
  
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, vin, trim, drivetrain, mileage')
    .in('id', vehicleIds);
  
  // Filter to vehicles with BaT URLs and missing critical data
  return (vehicles || []).filter(v => {
    const hasBatUrl = (v.discovery_url || v.bat_auction_url || '').includes('bringatrailer.com/listing/');
    const missingCritical = !v.vin || !v.trim || !v.drivetrain || !v.mileage;
    return hasBatUrl && missingCritical;
  });
}

async function fixVehicleBatch(batch) {
  const results = await Promise.allSettled(
    batch.map(async (vehicle) => {
      const url = vehicle.discovery_url || vehicle.bat_auction_url;
      if (!url) return { vehicle_id: vehicle.id, success: false, error: 'No URL' };
      
      try {
        const { data: result, error } = await supabase.functions.invoke('extract-premium-auction', {
          body: { url, max_vehicles: 1 }
        });
        
        if (error || !result?.success) {
          return { vehicle_id: vehicle.id, success: false, error: error?.message || result?.error };
        }
        
        return { vehicle_id: vehicle.id, success: true };
      } catch (e) {
        return { vehicle_id: vehicle.id, success: false, error: e.message };
      }
    })
  );
  
  return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message || 'Unknown error' });
}

async function main() {
  console.log('🚀 Fast Fantasy Junction Data Fix');
  console.log('='.repeat(60));
  
  const maxVehicles = parseInt(process.argv[2]) || 50;
  console.log(`Processing up to ${maxVehicles} vehicles...\n`);
  
  const vehicles = await getFantasyJunctionVehicles(maxVehicles * 2); // Get more to filter
  const vehiclesToFix = vehicles.slice(0, maxVehicles);
  
  console.log(`Found ${vehiclesToFix.length} vehicles needing fixes\n`);
  
  let success = 0;
  let failed = 0;
  
  for (let i = 0; i < vehiclesToFix.length; i += BATCH_SIZE) {
    const batch = vehiclesToFix.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    console.log(`Batch ${batchNum}: Processing ${batch.length} vehicles...`);
    const results = await fixVehicleBatch(batch);
    
    results.forEach(r => {
      if (r.success) {
        success++;
        console.log(`  ✅ ${r.vehicle_id?.slice(0, 8) || 'Unknown'}`);
      } else {
        failed++;
        console.log(`  ❌ ${r.vehicle_id?.slice(0, 8) || 'Unknown'}: ${r.error}`);
      }
    });
    
    if (i + BATCH_SIZE < vehiclesToFix.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
