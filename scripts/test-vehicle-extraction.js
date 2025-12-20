#!/usr/bin/env node
/**
 * Test comprehensive extraction for a specific vehicle
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

async function testVehicleExtraction(vehicleId) {
  console.log(`\n🧪 Testing extraction for vehicle: ${vehicleId}\n`);
  
  // Get vehicle data
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, discovery_url, bat_comments, origin_metadata, auction_end_date, description')
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
  console.log(`\n📊 Current state:`);
  console.log(`   Description: ${vehicle.description ? '✅ (' + vehicle.description.length + ' chars)' : '❌ MISSING'}`);
  console.log(`   Comments: ${vehicle.bat_comments !== null ? '✅ (' + vehicle.bat_comments + ')' : '❌ MISSING'}`);
  console.log(`   Features: ${vehicle.origin_metadata?.bat_features ? '✅ (' + vehicle.origin_metadata.bat_features.length + ')' : '❌ MISSING'}`);
  console.log(`   Auction End Date: ${vehicle.auction_end_date ? '✅ (' + vehicle.auction_end_date + ')' : '❌ MISSING'}`);
  
  console.log(`\n🔄 Running comprehensive extraction...\n`);
  
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    if (error) {
      console.error('❌ Extraction error:', error);
      return;
    }
    
    if (!data || !data.success) {
      console.error('❌ Extraction failed:', data);
      return;
    }
    
    console.log('✅ Extraction completed successfully!\n');
    console.log('📋 Extracted data summary:');
    console.log(JSON.stringify(data.data || data, null, 2));
    console.log('\n');
    
    // Wait a moment for DB to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check updated vehicle
    const { data: updated, error: updatedError } = await supabase
      .from('vehicles')
      .select('bat_comments, origin_metadata, auction_end_date, description, bat_bids, bat_views, sale_price, sale_date')
      .eq('id', vehicleId)
      .single();
    
    if (updatedError) {
      console.error('❌ Error fetching updated vehicle:', updatedError);
      return;
    }
    
    console.log(`📊 Updated state:`);
    console.log(`   Description: ${updated.description ? '✅ (' + updated.description.length + ' chars)' : '❌ STILL MISSING'}`);
    console.log(`   Comments: ${updated.bat_comments !== null ? '✅ (' + updated.bat_comments + ')' : '❌ STILL MISSING'}`);
    console.log(`   Features: ${updated.origin_metadata?.bat_features ? '✅ (' + updated.origin_metadata.bat_features.length + ' items)' : '❌ STILL MISSING'}`);
    console.log(`   Auction End Date: ${updated.auction_end_date ? '✅ (' + updated.auction_end_date + ')' : '❌ STILL MISSING'}`);
    console.log(`   Bids: ${updated.bat_bids || 'N/A'}`);
    console.log(`   Views: ${updated.bat_views || 'N/A'}`);
    console.log(`   Sale Price: ${updated.sale_price ? '$' + updated.sale_price.toLocaleString() : 'N/A'}`);
    console.log(`   Sale Date: ${updated.sale_date || 'N/A'}`);
    
    if (updated.origin_metadata?.bat_features && updated.origin_metadata.bat_features.length > 0) {
      console.log(`\n   Features list:`);
      updated.origin_metadata.bat_features.slice(0, 10).forEach((f, i) => {
        console.log(`      ${i + 1}. ${f}`);
      });
      if (updated.origin_metadata.bat_features.length > 10) {
        console.log(`      ... and ${updated.origin_metadata.bat_features.length - 10} more`);
      }
    }
    
  } catch (err) {
    console.error('❌ Exception:', err);
  }
}

const vehicleId = process.argv[2] || 'b808736f-2132-4a9f-aff3-3353b6cae80c';
testVehicleExtraction(vehicleId).catch(console.error);

