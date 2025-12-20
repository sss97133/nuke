#!/usr/bin/env node

/**
 * Quick repair script - extracts all BaT data for a vehicle when you have the BaT URL
 * Usage: node scripts/repair-vehicle-with-bat-url.js <vehicle_id> <bat_url>
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPaths = [
  join(__dirname, '..', 'nuke_frontend', '.env.local'),
  join(__dirname, '..', '.env.local'),
];

for (const envPath of envPaths) {
  try {
    const envFile = readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    });
    break;
  } catch (error) {
    // Try next path
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const vehicleId = process.argv[2];
  const batUrl = process.argv[3];

  if (!vehicleId || !batUrl) {
    console.error('Usage: node scripts/repair-vehicle-with-bat-url.js <vehicle_id> <bat_url>');
    process.exit(1);
  }

  console.log(`🔧 Repairing vehicle ${vehicleId} with BaT URL: ${batUrl}\n`);

  // Verify vehicle exists
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError?.message);
    process.exit(1);
  }

  console.log(`📋 Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

  // Step 1: Import BaT listing (this will update the vehicle and extract data)
  console.log(`\n📥 Step 1: Importing BaT listing...`);
  try {
    const { data: importData, error: importError } = await supabase.functions.invoke('import-bat-listing', {
      body: {
        batUrl,
        vehicleId  // This will match and update the existing vehicle
      },
      headers: {
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (importError) {
      console.error('❌ Import error:', importError);
    } else if (importData?.vehicleId) {
      console.log('✅ BaT listing imported successfully!');
    } else {
      console.warn('⚠️  Import returned:', importData);
    }
  } catch (error) {
    console.error('❌ Error importing:', error.message);
  }

  // Step 2: Run comprehensive extraction to ensure all data is extracted
  console.log(`\n📥 Step 2: Running comprehensive BaT extraction...`);
  try {
    const { data: extractData, error: extractError } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: {
        batUrl,
        vehicleId
      },
      headers: {
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (extractError) {
      console.error('❌ Extraction error:', extractError);
    } else if (extractData?.success) {
      console.log('✅ Comprehensive extraction completed!');
      console.log('   Extracted:', {
        vin: extractData.data?.vin || 'N/A',
        mileage: extractData.data?.mileage || 'N/A',
        engine: extractData.data?.engine || 'N/A',
        sale_price: extractData.data?.sale_price || 'N/A',
        bid_count: extractData.data?.bid_count || 'N/A',
        comment_count: extractData.data?.comment_count || 'N/A',
      });
    } else {
      console.warn('⚠️  Extraction returned:', extractData);
    }
  } catch (error) {
    console.error('❌ Error extracting:', error.message);
  }

  // Step 3: Verify the data
  console.log(`\n🔍 Step 3: Verifying extracted data...`);
  const { data: updatedVehicle, error: verifyError } = await supabase
    .from('vehicles')
    .select(`
      *,
      vehicle_images(count),
      timeline_events(count)
    `)
    .eq('id', vehicleId)
    .single();

  if (!verifyError && updatedVehicle) {
    console.log('\n✅ Final vehicle data:');
    console.log(`   BaT URL: ${updatedVehicle.bat_auction_url || 'None'}`);
    console.log(`   VIN: ${updatedVehicle.vin || 'None'}`);
    console.log(`   Mileage: ${updatedVehicle.mileage || 'None'}`);
    console.log(`   Engine: ${updatedVehicle.engine_size || 'None'}`);
    console.log(`   Transmission: ${updatedVehicle.transmission || 'None'}`);
    console.log(`   Color: ${updatedVehicle.color || 'None'}`);
    console.log(`   Sale Price: ${updatedVehicle.sale_price ? `$${updatedVehicle.sale_price.toLocaleString()}` : 'None'}`);
    console.log(`   Bid Count: ${updatedVehicle.bat_bids || 'None'}`);
    console.log(`   Comment Count: ${updatedVehicle.bat_comments || 'None'}`);
    console.log(`   Images: ${updatedVehicle.vehicle_images?.[0]?.count || 0}`);
    console.log(`   Timeline Events: ${updatedVehicle.timeline_events?.[0]?.count || 0}`);
    console.log(`   Description: ${updatedVehicle.description ? `${updatedVehicle.description.substring(0, 100)}...` : 'None'}`);
  } else {
    console.error('❌ Error verifying data:', verifyError?.message);
  }

  console.log('\n✅ Repair complete!');
}

main().catch(console.error);

