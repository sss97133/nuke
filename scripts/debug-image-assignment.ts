/**
 * Debug why images are only assigned to 12 vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== DEBUG IMAGE ASSIGNMENT ===\n');

  // 1. Get all 12 vehicle_ids that have images
  const { data: vehicleIdsWithImages } = await supabase
    .from('vehicle_images')
    .select('vehicle_id');

  const uniqueIds = [...new Set(vehicleIdsWithImages?.map(v => v.vehicle_id) || [])];
  console.log(`Vehicle IDs with images: ${uniqueIds.length}`);

  // 2. Check each vehicle
  for (const vehicleId of uniqueIds) {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, discovery_source, created_at')
      .eq('id', vehicleId)
      .single();

    const { count: imgCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    console.log(`\n${vehicle?.year} ${vehicle?.make} ${vehicle?.model}`);
    console.log(`  ID: ${vehicleId}`);
    console.log(`  Images: ${(imgCount || 0).toLocaleString()}`);
    console.log(`  Source: ${vehicle?.discovery_source}`);
    console.log(`  Created: ${vehicle?.created_at}`);
  }

  // 3. Check if there are images with null vehicle_id
  const { count: nullVehicleImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .is('vehicle_id', null);

  console.log(`\n\nImages with NULL vehicle_id: ${(nullVehicleImages || 0).toLocaleString()}`);

  // 4. Check sample of recent image inserts
  console.log('\n=== RECENT IMAGE INSERTS ===');
  const { data: recentImages } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, source, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  for (const img of recentImages || []) {
    console.log(`  ${img.vehicle_id?.substring(0, 8)}... | ${img.source} | ${img.created_at}`);
  }

  // 5. Check if there's a pattern - maybe images are being inserted with wrong vehicle_id
  const { data: sampleBatVehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .ilike('discovery_url', '%bringatrailer%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (sampleBatVehicle) {
    console.log(`\n=== SAMPLE BAT VEHICLE CHECK ===`);
    console.log(`Vehicle: ${sampleBatVehicle.year} ${sampleBatVehicle.make} ${sampleBatVehicle.model}`);
    console.log(`ID: ${sampleBatVehicle.id}`);

    const { count: thisVehicleImages } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', sampleBatVehicle.id);

    console.log(`Images for this vehicle: ${thisVehicleImages || 0}`);
  }
}

main().catch(console.error);
