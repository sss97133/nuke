#!/usr/bin/env node
/**
 * Quick diagnostic to understand BaT extraction failures
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

async function testExtraction(batUrl, vehicleId) {
  console.log(`\n🧪 Testing: ${batUrl}`);
  console.log(`   Vehicle ID: ${vehicleId}`);
  
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    console.log(`   Response status: ${error ? 'ERROR' : 'OK'}`);
    
    if (error) {
      console.log(`   ❌ Error:`, error);
      return { success: false, error };
    }
    
    console.log(`   Response data keys:`, Object.keys(data || {}));
    console.log(`   Success: ${data?.success}`);
    console.log(`   Has data: ${!!data?.data}`);
    console.log(`   Has error in response: ${!!data?.error}`);
    
    if (data?.error) {
      console.log(`   ❌ Error in response:`, data.error);
    }
    
    if (data?.data) {
      const extracted = data.data;
      console.log(`   ✅ Extracted fields:`);
      console.log(`      - description: ${extracted.description ? extracted.description.substring(0, 50) + '...' : 'MISSING'}`);
      console.log(`      - features: ${extracted.features?.length || 0} items`);
      console.log(`      - sale_price: ${extracted.sale_price || 'MISSING'}`);
      console.log(`      - bid_count: ${extracted.bid_count || 'MISSING'}`);
      console.log(`      - comment_count: ${extracted.comment_count || 'MISSING'}`);
    }
    
    return { success: data?.success !== false, data };
  } catch (e) {
    console.log(`   ❌ Exception:`, e.message);
    return { success: false, error: e.message };
  }
}

async function main() {
  // Test with a few vehicles that might be failing
  console.log('🔍 DIAGNOSING BaT EXTRACTION FAILURES\n');
  
  // Get a few sample vehicles
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url')
    .or('discovery_url.ilike.%bringatrailer.com%,bat_auction_url.ilike.%bringatrailer.com%')
    .limit(5);
  
  if (!vehicles || vehicles.length === 0) {
    console.log('No BaT vehicles found');
    return;
  }
  
  for (const vehicle of vehicles) {
    const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
    if (!batUrl) continue;
    
    await testExtraction(batUrl, vehicle.id);
    
    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

main().catch(console.error);

