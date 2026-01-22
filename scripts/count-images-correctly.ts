/**
 * Count images correctly - the previous query was wrong
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== CORRECT IMAGE COUNT ===\n');

  // Get all distinct vehicle_ids from vehicle_images
  // The previous query might have been limited

  // Use a different approach - aggregate by vehicle_id
  const { data: imageCounts, error } = await supabase
    .rpc('get_vehicle_image_counts')
    .limit(10000);

  if (error) {
    console.log('RPC not available, using alternative approach');

    // Alternative: count via direct SQL-like query
    // Get total images
    const { count: totalImages } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true });
    console.log(`Total images: ${(totalImages || 0).toLocaleString()}`);

    // Get images with non-null vehicle_id
    const { count: linkedImages } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .not('vehicle_id', 'is', null);
    console.log(`Images with vehicle_id: ${(linkedImages || 0).toLocaleString()}`);

    // Get null vehicle_id images
    const { count: orphanedImages } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('vehicle_id', null);
    console.log(`Images with NULL vehicle_id: ${(orphanedImages || 0).toLocaleString()}`);

    // Sample approach - get batches of vehicle_ids
    let offset = 0;
    const batchSize = 1000;
    const allVehicleIds = new Set<string>();

    while (offset < 100000) {
      const { data: batch } = await supabase
        .from('vehicle_images')
        .select('vehicle_id')
        .not('vehicle_id', 'is', null)
        .range(offset, offset + batchSize - 1);

      if (!batch || batch.length === 0) break;

      for (const img of batch) {
        allVehicleIds.add(img.vehicle_id);
      }

      offset += batchSize;
      process.stdout.write(`\rScanned ${offset.toLocaleString()} images, found ${allVehicleIds.size.toLocaleString()} unique vehicles...`);
    }

    console.log(`\n\nUnique vehicle_ids with images: ${allVehicleIds.size.toLocaleString()}`);

    // Now check how many of those exist in vehicles table
    const vehicleIdArray = Array.from(allVehicleIds);
    let existingCount = 0;

    for (let i = 0; i < vehicleIdArray.length; i += 100) {
      const batch = vehicleIdArray.slice(i, i + 100);
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .in('id', batch);
      existingCount += (existing?.length || 0);
    }

    console.log(`Vehicles that exist: ${existingCount.toLocaleString()}`);
    console.log(`Orphaned vehicle_ids: ${(allVehicleIds.size - existingCount).toLocaleString()}`);

    // Get average images per vehicle
    if (allVehicleIds.size > 0) {
      console.log(`\nAverage images per vehicle: ${((linkedImages || 0) / allVehicleIds.size).toFixed(1)}`);
    }

    return;
  }

  console.log(`Found ${imageCounts?.length || 0} vehicles with images`);
}

main().catch(console.error);
