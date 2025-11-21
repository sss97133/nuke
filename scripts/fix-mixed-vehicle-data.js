/**
 * Fix mixed vehicle data - reorganize BAT images and data to correct vehicles
 * 
 * Issues:
 * 1. Vehicle 9f69eaaf-15ab-417d-bea1-80603a5b6372 has BAT images but wrong VIN
 * 2. Vehicle e1b9c9ba-94e9-4a45-85c0-30bac65a40f8 should receive BAT data
 * 3. Vehicle 7176a5fc-24ae-4b42-9e65-0b96c4f9e50c has wrong year, need to check SPID
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// BAT listing VIN from the actual listing
const BAT_VIN = 'TKL149J507665';
const BAT_URL = 'https://bringatrailer.com/listing/1979-gmc-k1500/';

async function main() {
  console.log('🔧 Fixing mixed vehicle data...\n');

  // 1. Move BAT images from wrong vehicle to correct vehicle
  console.log('1. Moving BAT images...');
  
  const wrongVehicleId = '9f69eaaf-15ab-417d-bea1-80603a5b6372';
  const correctVehicleId = 'e1b9c9ba-94e9-4a45-85c0-30bac65a40f8';
  
  // Get BAT images from wrong vehicle
  const { data: batImages, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', wrongVehicleId)
    .eq('category', 'bat_listing');
  
  if (fetchError) {
    console.error('Error fetching BAT images:', fetchError);
    return;
  }
  
  console.log(`   Found ${batImages.length} BAT images to move`);
  
  // Move each image to correct vehicle
  for (const img of batImages) {
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({ vehicle_id: correctVehicleId })
      .eq('id', img.id);
    
    if (updateError) {
      console.error(`   ❌ Error moving image ${img.id}:`, updateError);
    } else {
      console.log(`   ✅ Moved image: ${img.filename || img.id}`);
    }
  }
  
  // 2. Remove BAT URL and metadata from wrong vehicle
  console.log('\n2. Cleaning wrong vehicle...');
  const { error: cleanError } = await supabase
    .from('vehicles')
    .update({
      bat_auction_url: null,
      origin_metadata: {},
      profile_origin: 'manual_entry'
    })
    .eq('id', wrongVehicleId);
  
  if (cleanError) {
    console.error('   ❌ Error cleaning vehicle:', cleanError);
  } else {
    console.log('   ✅ Removed BAT data from wrong vehicle');
  }
  
  // 3. Update correct vehicle with BAT data
  console.log('\n3. Updating correct vehicle with BAT data...');
  const { error: updateError } = await supabase
    .from('vehicles')
    .update({
      vin: BAT_VIN,
      bat_auction_url: BAT_URL,
      profile_origin: 'bat_import',
      origin_organization_id: 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf', // Viva! Las Vegas Autos
      origin_metadata: {
        bat_seller: 'VivaLasVegasAutos',
        import_source: 'bat_manual_fix',
        import_date: new Date().toISOString().split('T')[0],
        bat_url: BAT_URL,
        vin_validated: true,
        fixed_at: new Date().toISOString()
      }
    })
    .eq('id', correctVehicleId);
  
  if (updateError) {
    console.error('   ❌ Error updating vehicle:', updateError);
  } else {
    console.log('   ✅ Updated correct vehicle with BAT data');
    console.log(`      VIN: ${BAT_VIN}`);
    console.log(`      BAT URL: ${BAT_URL}`);
  }
  
  // 4. Check SPID sheet for vehicle 7176a5fc-24ae-4b42-9e65-0b96c4f9e50c
  console.log('\n4. Checking SPID sheet for year/VIN correction...');
  const spidVehicleId = '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c';
  
  // Get images that might contain SPID
  const { data: spidImages } = await supabase
    .from('vehicle_images')
    .select('image_url, filename')
    .eq('vehicle_id', spidVehicleId)
    .order('created_at');
  
  console.log(`   Found ${spidImages.length} images - need manual review for SPID sheet`);
  console.log('   ⚠️  Manual step required: Review SPID sheet image to extract correct VIN and year');
  
  console.log('\n✅ Data reorganization complete!');
  console.log('\n📋 Summary:');
  console.log(`   - Moved ${batImages.length} BAT images from wrong vehicle to correct vehicle`);
  console.log(`   - Updated vehicle ${correctVehicleId} with BAT VIN: ${BAT_VIN}`);
  console.log(`   - Cleaned BAT data from vehicle ${wrongVehicleId}`);
  console.log(`   - ⚠️  Vehicle ${spidVehicleId} needs manual SPID review for year/VIN`);
}

main().catch(console.error);

