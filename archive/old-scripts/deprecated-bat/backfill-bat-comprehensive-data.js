#!/usr/bin/env node
/**
 * COMPREHENSIVE BAT DATA BACKFILL
 * 
 * For all BAT-sourced vehicles, this script:
 * 1. Extracts VINs (if missing)
 * 2. Extracts all auction data (dates, bids, views, reserve price)
 * 3. Extracts technical specs (engine, transmission, drivetrain, etc.)
 * 4. Creates timeline events for auction activity
 * 5. Updates vehicles and external_listings tables
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
async function extractComprehensiveBaTData(batUrl, vehicleId) {
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`   ❌ Extraction error: ${error.message}`);
    return null;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 COMPREHENSIVE BAT DATA BACKFILL\n');
  console.log('This will extract VINs, auction data, and create timeline events for all BAT vehicles.\n');
  
  // Find all BAT vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, bat_auction_url, discovery_url')
    .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer.com%');
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No BAT vehicles found!');
    return;
  }
  
  console.log(`📊 Found ${vehicles.length} BAT vehicles to process\n`);
  
  let processed = 0;
  let vinsAdded = 0;
  let timelineEventsCreated = 0;
  let errors = 0;
  let skipped = 0;
  
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
    
    if (!batUrl || !batUrl.includes('bringatrailer.com')) {
      console.log(`\n⏭️  [${i + 1}/${vehicles.length}] Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - no BAT URL`);
      skipped++;
      continue;
    }
    
    console.log(`\n[${i + 1}/${vehicles.length}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   ID: ${vehicle.id.substring(0, 8)}...`);
    console.log(`   Current VIN: ${vehicle.vin || 'MISSING'}`);
    console.log(`   URL: ${batUrl}`);
    
    const result = await extractComprehensiveBaTData(batUrl, vehicle.id);
    
    if (result && result.success) {
      processed++;
      
      if (result.data.vin && !vehicle.vin) {
        vinsAdded++;
        console.log(`   ✅ VIN extracted: ${result.data.vin}`);
      }
      
      if (result.data.auction_start_date || result.data.auction_end_date || result.data.sale_date) {
        timelineEventsCreated++;
        console.log(`   ✅ Auction timeline events created`);
      }
      
      if (result.data.bid_count || result.data.view_count) {
        console.log(`   ✅ Auction metrics: ${result.data.bid_count || 0} bids, ${result.data.view_count || 0} views`);
      }
      
      if (result.data.engine || result.data.transmission) {
        console.log(`   ✅ Technical specs extracted`);
      }
    } else {
      errors++;
      console.log(`   ❌ Failed to extract data`);
    }
    
    // Rate limiting: wait 2 seconds between requests to avoid overwhelming BaT
    if (i < vehicles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Processed: ${processed}`);
  console.log(`🔑 VINs added: ${vinsAdded}`);
  console.log(`📅 Timeline events created: ${timelineEventsCreated}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📈 Success rate: ${((processed / (vehicles.length - skipped)) * 100).toFixed(1)}%`);
  console.log('\n💡 Check individual vehicle profiles to see extracted data and timeline events.');
}

main().catch(console.error);

