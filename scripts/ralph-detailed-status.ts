/**
 * Detailed status check with accurate image counting
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== RALPH DETAILED STATUS ===\n');

  // 1. Queue status
  const statuses = ['pending', 'processing', 'completed', 'failed', 'skipped'];
  console.log('📋 IMPORT QUEUE:');
  for (const status of statuses) {
    const { count } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', status);
    console.log(`   ${status}: ${(count || 0).toLocaleString()}`);
  }

  // 2. Analyze failed items
  console.log('\n📋 FAILED ITEMS ANALYSIS:');
  const { data: failedItems } = await supabase
    .from('import_queue')
    .select('error_message, listing_url')
    .eq('status', 'failed')
    .limit(500);

  const errorCounts: Record<string, number> = {};
  for (const item of failedItems || []) {
    const error = (item.error_message || 'Unknown').substring(0, 50);
    errorCounts[error] = (errorCounts[error] || 0) + 1;
  }

  Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([err, cnt]) => console.log(`   ${cnt}: ${err}`));

  // 3. Correct image counting - count vehicles that have at least one image
  console.log('\n📸 IMAGE COVERAGE (accurate):');
  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });

  // Query vehicles that have images
  const { data: vehiclesWithImagesData } = await supabase
    .from('vehicles')
    .select('id')
    .limit(15000);

  let vehiclesWithImages = 0;
  // Check in batches
  const vehicleIds = vehiclesWithImagesData?.map(v => v.id) || [];
  for (let i = 0; i < vehicleIds.length; i += 100) {
    const batch = vehicleIds.slice(i, i + 100);
    const { data: imagesForBatch } = await supabase
      .from('vehicle_images')
      .select('vehicle_id')
      .in('vehicle_id', batch);

    const uniqueVehicleIds = new Set(imagesForBatch?.map(img => img.vehicle_id) || []);
    vehiclesWithImages += uniqueVehicleIds.size;
  }

  const { count: totalImages } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true });

  console.log(`   Total vehicles: ${(totalVehicles || 0).toLocaleString()}`);
  console.log(`   Vehicles WITH images: ${vehiclesWithImages.toLocaleString()} (${((vehiclesWithImages / (totalVehicles || 1)) * 100).toFixed(1)}%)`);
  console.log(`   Total images: ${(totalImages || 0).toLocaleString()}`);

  // 4. BaT specific stats
  console.log('\n🏆 BaT EXTRACTION QUALITY:');
  const { data: batVehicles } = await supabase
    .from('vehicles')
    .select('id, vin, mileage, color, transmission, engine_size')
    .ilike('discovery_url', '%bringatrailer%')
    .limit(100);

  let batWithVin = 0, batWithMileage = 0, batWithColor = 0;
  for (const v of batVehicles || []) {
    if (v.vin && v.vin.length >= 11) batWithVin++;
    if (v.mileage) batWithMileage++;
    if (v.color) batWithColor++;
  }
  const batSample = batVehicles?.length || 1;
  console.log(`   Sample of ${batSample} BaT vehicles:`);
  console.log(`   With VIN: ${batWithVin} (${(batWithVin / batSample * 100).toFixed(0)}%)`);
  console.log(`   With Mileage: ${batWithMileage} (${(batWithMileage / batSample * 100).toFixed(0)}%)`);
  console.log(`   With Color: ${batWithColor} (${(batWithColor / batSample * 100).toFixed(0)}%)`);

  // 5. BaT images
  let batWithImages = 0;
  for (const v of batVehicles || []) {
    const { count } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true }).eq('vehicle_id', v.id);
    if ((count || 0) > 0) batWithImages++;
  }
  console.log(`   With Images: ${batWithImages} (${(batWithImages / batSample * 100).toFixed(0)}%)`);

  // 6. Craigslist stats
  console.log('\n🚗 CRAIGSLIST STATS:');
  const { count: clTotal } = await supabase.from('vehicles').select('*', { count: 'exact', head: true }).ilike('discovery_url', '%craigslist%');
  console.log(`   Total: ${(clTotal || 0).toLocaleString()}`);

  // 7. Auction events with prices
  console.log('\n💰 AUCTION PRICING:');
  const { count: eventsWithPrice } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true })
    .not('final_price', 'is', null);
  const { count: totalEvents } = await supabase.from('auction_events').select('*', { count: 'exact', head: true });
  console.log(`   Events with final_price: ${(eventsWithPrice || 0).toLocaleString()} / ${(totalEvents || 0).toLocaleString()}`);
}

main().catch(console.error);
