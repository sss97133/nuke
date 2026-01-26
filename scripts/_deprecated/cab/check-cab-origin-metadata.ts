/**
 * Check what's in origin_metadata for C&B vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== CHECKING C&B ORIGIN METADATA ===\n');

  // Get a C&B vehicle with origin_metadata
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, discovery_url, origin_metadata')
    .ilike('discovery_url', '%carsandbids%')
    .not('origin_metadata', 'is', null)
    .limit(1)
    .single();

  if (!vehicle) {
    console.log('❌ No C&B vehicle with origin_metadata found');
    return;
  }

  console.log(`📋 Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   URL: ${vehicle.discovery_url}`);
  console.log(`   VIN in DB: ${vehicle.vin || 'NULL'}`);
  console.log(`   Mileage in DB: ${vehicle.mileage || 'NULL'}`);

  console.log('\n📦 ORIGIN METADATA:');
  console.log(JSON.stringify(vehicle.origin_metadata, null, 2));

  // Check if images are in origin_metadata
  const meta = vehicle.origin_metadata as any;
  if (meta?.images) {
    console.log(`\n📸 IMAGES IN ORIGIN_METADATA: ${meta.images.length}`);
    if (meta.images.length > 0) {
      console.log('   Sample:', meta.images[0]);
    }
  }

  // Check vehicle_images table for this vehicle
  const { count: dbImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id);

  console.log(`\n📸 IMAGES IN vehicle_images TABLE: ${dbImages || 0}`);

  // The issue: images are in origin_metadata but NOT in vehicle_images!
  if (meta?.images?.length > 0 && (dbImages || 0) === 0) {
    console.log('\n⚠️ ISSUE FOUND: Images exist in origin_metadata but NOT in vehicle_images table!');
    console.log('   This means extraction captures images but fails to insert them.');
  }
}

main();
