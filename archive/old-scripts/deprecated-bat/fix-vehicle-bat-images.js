#!/usr/bin/env node

/**
 * Fix vehicle BAT images by:
 * 1. Re-scraping BAT gallery images
 * 2. Running cleanup to remove contamination
 * 3. Setting correct primary image
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = process.argv[2] || 'bfaf7f3c-9a6a-4164-bffb-1e9fae075883';

async function fixVehicleBATImages() {
  console.log(`\n🔧 Fixing BAT images for vehicle: ${VEHICLE_ID}\n`);
  console.log('='.repeat(80));

  // 1. Get vehicle data
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url, origin_metadata')
    .eq('id', VEHICLE_ID)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Error fetching vehicle:', vehicleError);
    return;
  }

  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com/listing/')) {
    console.error('❌ No BAT listing URL found for this vehicle');
    console.log(`   Discovery URL: ${vehicle.discovery_url || 'N/A'}`);
    console.log(`   BAT Auction URL: ${vehicle.bat_auction_url || 'N/A'}`);
    return;
  }

  console.log(`\n1️⃣  Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   BAT URL: ${batUrl}`);

  // 2. Check existing BAT images
  console.log('\n2️⃣  Checking existing BAT images...');
  const { data: existingBATImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source')
    .eq('vehicle_id', VEHICLE_ID)
    .or('image_url.ilike.%bringatrailer.com%,source.eq.bat_import');

  const hasBATImages = existingBATImages && existingBATImages.length > 0;
  console.log(`   Existing BAT images: ${existingBATImages?.length || 0}`);

  // 3. Import BAT listing with images
  if (!hasBATImages || (existingBATImages && existingBATImages.length < 10)) {
    console.log('\n3️⃣  Importing BAT listing with images...');
    try {
      const { data: importResult, error: importError } = await supabase.functions.invoke('import-bat-listing', {
        body: {
          url: batUrl,
          allowFuzzyMatch: false,
          imageBatchSize: 50,
          vehicle_id: VEHICLE_ID
        }
      });

      if (importError) {
        console.error('❌ Import error:', importError);
      } else {
        console.log('✅ Import result:', JSON.stringify(importResult, null, 2));
      }
    } catch (err) {
      console.error('❌ Import exception:', err);
    }
  } else {
    console.log('\n3️⃣  ✅ BAT images already exist, skipping import');
  }

  // 4. Run repair RPC to fix gallery ordering and contamination
  console.log('\n4️⃣  Running repair RPC to fix gallery...');
  try {
    const { data: repairResult, error: repairError } = await supabase.rpc('repair_bat_vehicle_gallery_images', {
      p_vehicle_id: VEHICLE_ID,
      p_dry_run: false
    });

    if (repairError) {
      console.error('❌ Repair error:', repairError);
    } else {
      console.log('✅ Repair result:', JSON.stringify(repairResult, null, 2));
    }
  } catch (err) {
    console.error('❌ Repair exception:', err);
  }

  // 5. Verify final state
  console.log('\n5️⃣  Verifying final state...');
  const { data: finalImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url, is_primary, position, source, is_duplicate, is_document')
    .eq('vehicle_id', VEHICLE_ID)
    .not('is_duplicate', 'is', true)
    .not('is_document', 'is', true)
    .order('position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  console.log(`   Total valid images: ${finalImages?.length || 0}`);
  console.log(`   Primary images: ${finalImages?.filter(img => img.is_primary).length || 0}`);
  
  if (finalImages && finalImages.length > 0) {
    const primary = finalImages.find(img => img.is_primary);
    if (primary) {
      console.log(`   ✅ Primary image: ${primary.image_url.substring(0, 100)}...`);
    } else {
      console.log('   ⚠️  No primary image set');
    }
  }

  // 6. Check RPC result
  console.log('\n6️⃣  Checking RPC result...');
  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_vehicle_profile_data', { p_vehicle_id: VEHICLE_ID });

  if (rpcError) {
    console.error('❌ RPC Error:', rpcError);
  } else {
    console.log(`   Vehicle: ${rpcData?.vehicle?.year} ${rpcData?.vehicle?.make} ${rpcData?.vehicle?.model}`);
    console.log(`   Images: ${rpcData?.images?.length || 0}`);
    console.log(`   Stats: ${JSON.stringify(rpcData?.stats || {}, null, 2)}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Fix complete!\n');
}

fixVehicleBATImages().catch(console.error);

