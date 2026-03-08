#!/usr/bin/env node
/**
 * Backfill VINs for BaT vehicles - showing successful results
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function backfillVINs() {
  console.log('🚀 BACKFILLING BaT VINs\n');
  console.log('='.repeat(80));
  
  // Get vehicles missing VINs
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, bat_auction_url')
    .not('bat_auction_url', 'is', null)
    .is('vin', null)
    .limit(10);
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles missing VINs!');
    return;
  }
  
  console.log(`Found ${vehicles.length} vehicles to backfill\n`);
  
  const results = [];
  
  for (const vehicle of vehicles) {
    if (!vehicle.bat_auction_url) continue;
    
    console.log(`\n📋 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   URL: ${vehicle.bat_auction_url}`);
    
    try {
      const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
        body: { batUrl: vehicle.bat_auction_url, vehicleId: vehicle.id }
      });
      
      if (error || !data || !data.success) {
        console.log(`   ❌ Failed: ${error?.message || 'Extraction failed'}`);
        results.push({ vehicle: vehicle.id, success: false });
        continue;
      }
      
      const extracted = data.data;
      console.log(`   ✅ Extracted VIN: ${extracted.vin || 'NOT FOUND'}`);
      console.log(`   ✅ Sale Price: ${extracted.sale_price ? '$' + extracted.sale_price.toLocaleString() : 'N/A'}`);
      console.log(`   ✅ Bid Count: ${extracted.bid_count || 0}`);
      console.log(`   ✅ View Count: ${extracted.view_count || 0}`);
      
      // Wait for DB update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if VIN was saved
      const { data: updated } = await supabase
        .from('vehicles')
        .select('vin, sale_price, bat_bids, bat_views')
        .eq('id', vehicle.id)
        .single();
      
      if (updated?.vin) {
        console.log(`   ✅✅ VIN SAVED TO DATABASE: ${updated.vin}`);
        results.push({ 
          vehicle: vehicle.id, 
          success: true, 
          vin: updated.vin,
          sale_price: updated.sale_price,
          bid_count: updated.bat_bids,
          view_count: updated.bat_views
        });
      } else {
        console.log(`   ⚠️  VIN extracted but not saved yet`);
        results.push({ vehicle: vehicle.id, success: false, vin_extracted: extracted.vin });
      }
      
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
      results.push({ vehicle: vehicle.id, success: false, error: error.message });
    }
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 BACKFILL SUMMARY\n');
  
  const successes = results.filter(r => r.success && r.vin).length;
  const partial = results.filter(r => r.vin_extracted && !r.vin).length;
  const failures = results.filter(r => !r.success && !r.vin_extracted).length;
  
  console.log(`Total Processed: ${results.length}`);
  console.log(`✅ Fully Successful (VIN saved): ${successes}`);
  console.log(`⚠️  Partial (VIN extracted, not saved): ${partial}`);
  console.log(`❌ Failed: ${failures}\n`);
  
  if (successes > 0) {
    console.log('✅ SUCCESSFUL EXTRACTIONS:\n');
    results.filter(r => r.success && r.vin).forEach((r, i) => {
      console.log(`${i + 1}. Vehicle ${r.vehicle.substring(0, 8)}...`);
      console.log(`   VIN: ${r.vin}`);
      console.log(`   Sale Price: ${r.sale_price ? '$' + r.sale_price.toLocaleString() : 'N/A'}`);
      console.log(`   Bid Count: ${r.bid_count || 0}`);
      console.log(`   View Count: ${r.view_count || 0}`);
      console.log('');
    });
  }
  
  console.log('='.repeat(80));
}

backfillVINs().catch(console.error);

