#!/usr/bin/env node
/**
 * BACKFILL MISSING VINS FROM BAT LISTINGS
 * 
 * For BAT-sourced vehicles missing VINs, this script:
 * 1. Finds all vehicles with BAT URLs but no VIN
 * 2. Scrapes each BAT listing to extract VIN (handles both "VIN:" and "Chassis:" labels)
 * 3. Updates vehicles with found VINs
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
 * Extract VIN from BAT listing HTML
 * Handles both "VIN:" and "Chassis:" labels
 */
function extractVIN(html) {
  // Try multiple patterns
  const patterns = [
    /(?:VIN|Chassis)[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
    /<li>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{17})<\/a><\/li>/i,
    /\b([A-HJ-NPR-Z0-9]{17})\b/  // Fallback: any 17-char alphanumeric (but validate)
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const vin = match[1].toUpperCase();
      // Validate: no I, O, Q and exactly 17 chars
      if (vin.length === 17 && !/[IOQ]/.test(vin)) {
        return vin;
      }
    }
  }
  
  return null;
}

/**
 * Scrape BAT listing and extract VIN
 */
async function scrapeBATVIN(batUrl) {
  try {
    console.log(`   📡 Fetching: ${batUrl}`);
    const response = await fetch(batUrl);
    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    const vin = extractVIN(html);
    
    if (vin) {
      console.log(`   ✅ Found VIN: ${vin}`);
      return vin;
    } else {
      console.log(`   ⚠️  No VIN found on page`);
      return null;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

/**
 * Update vehicle with VIN
 */
async function updateVehicleVIN(vehicleId, vin, batUrl) {
  const { error } = await supabase
    .from('vehicles')
    .update({ vin })
    .eq('id', vehicleId);
  
  if (error) {
    console.log(`   ❌ Update failed: ${error.message}`);
    return false;
  }
  
  // Add validation entry
  await supabase
    .from('data_validations')
    .insert({
      entity_type: 'vehicle',
      entity_id: vehicleId,
      field_name: 'vin',
      field_value: vin,
      validation_source: 'bat_listing',
      confidence_score: 100,
      source_url: batUrl,
      notes: `VIN backfilled from BaT listing`
    });
  
  return true;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 BACKFILLING MISSING VINS FROM BAT LISTINGS\n');
  
  // Find all BAT vehicles missing VINs
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, bat_auction_url, discovery_url')
    .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer.com%')
    .or('profile_origin.eq.bat_import,origin_metadata->>created_from_bat_profile.eq.true')
    .is('vin', null);
  
  if (error) {
    console.error('❌ Error fetching vehicles:', error);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No BAT vehicles missing VINs!');
    return;
  }
  
  console.log(`📊 Found ${vehicles.length} BAT vehicles missing VINs\n`);
  
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
    
    if (!batUrl || !batUrl.includes('bringatrailer.com')) {
      console.log(`\n⏭️  [${i + 1}/${vehicles.length}] Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - no BAT URL`);
      continue;
    }
    
    console.log(`\n[${i + 1}/${vehicles.length}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   ID: ${vehicle.id.substring(0, 8)}...`);
    
    const vin = await scrapeBATVIN(batUrl);
    
    if (vin) {
      const success = await updateVehicleVIN(vehicle.id, vin, batUrl);
      if (success) {
        updated++;
      } else {
        errors++;
      }
    } else {
      notFound++;
    }
    
    // Rate limiting: wait 1 second between requests
    if (i < vehicles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Updated with VIN: ${updated}`);
  console.log(`⚠️  VIN not found on page: ${notFound}`);
  console.log(`❌ Errors: ${errors}`);
  console.log(`📈 Success rate: ${((updated / vehicles.length) * 100).toFixed(1)}%`);
}

main().catch(console.error);

