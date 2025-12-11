#!/usr/bin/env node
/**
 * Batch test comprehensive BaT extraction on multiple vehicles
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

async function batchTest() {
  console.log('🚀 BATCH TESTING BaT EXTRACTION\n');
  console.log('='.repeat(80));
  
  // Get vehicles missing VINs
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, bat_auction_url')
    .not('bat_auction_url', 'is', null)
    .is('vin', null)
    .limit(5);
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles found missing VINs');
    return;
  }
  
  console.log(`Found ${vehicles.length} vehicles to test\n`);
  
  const results = [];
  
  for (const vehicle of vehicles) {
    if (!vehicle.bat_auction_url) continue;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`URL: ${vehicle.bat_auction_url}`);
    console.log(`Vehicle ID: ${vehicle.id}`);
    console.log(`Current VIN: ${vehicle.vin || 'MISSING'}\n`);
    
    try {
      const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
        body: { batUrl: vehicle.bat_auction_url, vehicleId: vehicle.id }
      });
      
      if (error) {
        console.error(`❌ Error:`, error);
        results.push({ vehicle: vehicle.id, success: false, error: error.message });
        continue;
      }
      
      if (!data || !data.success) {
        console.error(`❌ Extraction failed:`, data);
        results.push({ vehicle: vehicle.id, success: false, error: 'Extraction failed' });
        continue;
      }
      
      const extracted = data.data;
      console.log(`✅ Extraction successful`);
      console.log(`   VIN extracted: ${extracted.vin || 'NOT FOUND'}`);
      console.log(`   Sale Price: ${extracted.sale_price ? '$' + extracted.sale_price.toLocaleString() : 'N/A'}`);
      console.log(`   Bid Count: ${extracted.bid_count || 0}`);
      console.log(`   View Count: ${extracted.view_count || 0}`);
      console.log(`   Sale Date: ${extracted.sale_date || 'N/A'}`);
      
      // Check database after update
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for DB update
      
      const { data: updated } = await supabase
        .from('vehicles')
        .select('vin, bat_bids, bat_views, sale_price, bat_seller')
        .eq('id', vehicle.id)
        .single();
      
      console.log(`\n📊 Database Status:`);
      console.log(`   VIN in DB: ${updated?.vin || 'STILL MISSING'}`);
      console.log(`   Bids in DB: ${updated?.bat_bids || 'NOT SET'}`);
      console.log(`   Views in DB: ${updated?.bat_views || 'NOT SET'}`);
      console.log(`   Seller in DB: ${updated?.bat_seller || 'NOT SET'}`);
      
      const success = updated?.vin === extracted.vin;
      results.push({
        vehicle: vehicle.id,
        success,
        vin_extracted: extracted.vin,
        vin_in_db: updated?.vin,
        sale_price: extracted.sale_price,
        bid_count: extracted.bid_count,
      });
      
      if (success) {
        console.log(`\n✅ SUCCESS: VIN saved to database!`);
      } else {
        console.log(`\n⚠️  WARNING: VIN extracted but not saved`);
      }
      
    } catch (error) {
      console.error(`❌ Test failed:`, error);
      results.push({ vehicle: vehicle.id, success: false, error: error.message });
    }
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 BATCH TEST SUMMARY\n');
  
  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success).length;
  
  console.log(`Total: ${results.length}`);
  console.log(`✅ Successes: ${successes}`);
  console.log(`❌ Failures: ${failures}\n`);
  
  results.forEach((r, i) => {
    if (r.success) {
      console.log(`${i + 1}. ✅ ${r.vehicle} - VIN: ${r.vin_in_db}`);
    } else {
      console.log(`${i + 1}. ❌ ${r.vehicle} - ${r.error || 'Failed'}`);
    }
  });
  
  console.log(`\n${'='.repeat(80)}`);
}

batchTest().catch(console.error);

