#!/usr/bin/env node
/**
 * BACKFILL MISSING VINS ONLY
 * 
 * Re-extracts VINs for vehicles that are still missing them.
 * VINs are ALWAYS in the BaT essentials div.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase key not found in environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Call the comprehensive BaT extraction edge function
 */
async function extractVINFromBaT(batUrl, vehicleId) {
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    if (error) throw error;
    return data?.data?.vin || null;
  } catch (error) {
    console.error(`   ❌ Extraction error: ${error.message}`);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🔑 BACKFILLING MISSING VINS FROM BAT ESSENTIALS DIV\n');
  console.log('VINs are ALWAYS in the BaT essentials div - re-extracting...\n');
  
  // Find all BAT vehicles missing VINs
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, bat_auction_url, discovery_url')
    .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer.com%')
    .or('vin.is.null,vin.eq.');
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    process.exit(1);
  }
  
  // Filter to only those missing VINs
  const missingVINVehicles = vehicles.filter(v => !v.vin || v.vin === '');
  
  if (!missingVINVehicles || missingVINVehicles.length === 0) {
    console.log('✅ No BAT vehicles missing VINs!');
    return;
  }
  
  console.log(`📊 Found ${missingVINVehicles.length} BAT vehicles missing VINs\n`);
  
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  let skipped = 0;
  
  for (let i = 0; i < missingVINVehicles.length; i++) {
    const vehicle = missingVINVehicles[i];
    const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
    
    if (!batUrl || !batUrl.includes('bringatrailer.com')) {
      console.log(`\n⏭️  [${i + 1}/${missingVINVehicles.length}] Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - no BAT URL`);
      skipped++;
      continue;
    }
    
    console.log(`\n[${i + 1}/${missingVINVehicles.length}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   ID: ${vehicle.id.substring(0, 8)}...`);
    console.log(`   URL: ${batUrl}`);
    
    const vin = await extractVINFromBaT(batUrl, vehicle.id);
    
    if (vin) {
      // Update vehicle with VIN using RPC function
      let updateSuccess = false;
      
      try {
        const { error: rpcError } = await supabase.rpc('update_vehicle_vin', {
          p_vehicle_id: vehicle.id,
          p_vin: vin
        });
        
        if (!rpcError) {
          updateSuccess = true;
        } else {
          // Fallback to direct update
          const { error: updateError } = await supabase
            .from('vehicles')
            .update({ vin })
            .eq('id', vehicle.id);
          
          if (!updateError) {
            updateSuccess = true;
          } else {
            console.log(`   ❌ Update failed: ${updateError.message}`);
            errors++;
          }
        }
      } catch (err) {
        // Try direct update on error
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({ vin })
          .eq('id', vehicle.id);
        
        if (!updateError) {
          updateSuccess = true;
        } else {
          console.log(`   ❌ Update failed: ${updateError.message}`);
          errors++;
        }
      }
      
      if (updateSuccess) {
        // Add validation entry
        await supabase
          .from('data_validations')
          .upsert({
            entity_type: 'vehicle',
            entity_id: vehicle.id,
            field_name: 'vin',
            field_value: vin,
            validation_source: 'bat_listing',
            confidence_score: 100,
            source_url: batUrl,
            notes: `VIN extracted from BaT essentials div`
          }, {
            onConflict: 'vehicle_id,field_name'
          });
        
        console.log(`   ✅ VIN extracted and saved: ${vin}`);
        updated++;
      }
    } else {
      console.log(`   ⚠️  VIN not found in essentials div`);
      notFound++;
    }
    
    // Rate limiting: wait 2 seconds between requests
    if (i < missingVINVehicles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ VINs extracted and saved: ${updated}`);
  console.log(`⚠️  VIN not found: ${notFound}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  if (updated + notFound > 0) {
    console.log(`📈 Success rate: ${((updated / (updated + notFound)) * 100).toFixed(1)}%`);
  }
}

main().catch(console.error);

