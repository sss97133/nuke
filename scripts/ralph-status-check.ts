import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkStatus() {
  console.log('=== RALPH STATUS CHECK ===\n');

  // 1. Import queue status
  const statuses = ['pending', 'processing', 'completed', 'failed', 'skipped'];
  console.log('📋 IMPORT QUEUE:');
  for (const status of statuses) {
    const { count } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', status);
    console.log(`   ${status}: ${(count || 0).toLocaleString()}`);
  }

  // 2. Vehicle count and image coverage
  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });

  // Get distinct vehicle_ids with images (paginated to handle large datasets)
  const uniqueVehicleIds = new Set<string>();
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data: batch } = await supabase
      .from('vehicle_images')
      .select('vehicle_id')
      .not('vehicle_id', 'is', null)
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;

    for (const row of batch) {
      if (row.vehicle_id) uniqueVehicleIds.add(row.vehicle_id);
    }

    offset += batchSize;
    // Limit to 200k images for speed
    if (offset >= 200000) break;
  }
  const vehiclesWithImagesCount = uniqueVehicleIds.size;

  const { count: totalImages } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true });

  console.log('\n🚗 VEHICLES:');
  console.log(`   Total: ${(totalVehicles || 0).toLocaleString()}`);
  console.log(`   With images: ${vehiclesWithImagesCount.toLocaleString()} (${(vehiclesWithImagesCount / (totalVehicles || 1) * 100).toFixed(1)}%)`);
  console.log(`   Total images: ${(totalImages || 0).toLocaleString()}`);

  // 3. VIN quality - sample
  const { data: vinStats } = await supabase
    .from('vehicles')
    .select('vin')
    .limit(5000);

  let validVins = 0;
  let invalidVins = 0;
  let nullVins = 0;
  for (const v of vinStats || []) {
    if (!v.vin) nullVins++;
    else if (v.vin.length === 17) validVins++;
    else invalidVins++;
  }
  const sampleSize = (vinStats || []).length;
  console.log(`\n🔍 VIN QUALITY (sample of ${sampleSize}):`);
  console.log(`   Valid (17 chars): ${validVins} (${(validVins / sampleSize * 100).toFixed(1)}%)`);
  console.log(`   Invalid length: ${invalidVins} (${(invalidVins / sampleSize * 100).toFixed(1)}%)`);
  console.log(`   NULL: ${nullVins} (${(nullVins / sampleSize * 100).toFixed(1)}%)`);

  // 4. Discovery sources
  console.log('\n📊 BY DISCOVERY SOURCE:');
  const sources = [
    { name: 'BaT', pattern: '%bringatrailer%' },
    { name: 'C&B', pattern: '%carsandbids%' },
    { name: 'Classic', pattern: '%classic.com%' },
    { name: 'Craigslist', pattern: '%craigslist%' },
    { name: 'Mecum', pattern: '%mecum.com%' },
  ];

  for (const src of sources) {
    const { count } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .ilike('discovery_url', src.pattern);
    console.log(`   ${src.name}: ${(count || 0).toLocaleString()}`);
  }

  // 5. Cars & Bids specific check
  console.log('\n🚨 CARS & BIDS EXTRACTION CHECK:');
  const { data: cabVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage')
    .ilike('discovery_url', '%carsandbids%')
    .limit(10);

  if (!cabVehicles || cabVehicles.length === 0) {
    console.log('   No C&B vehicles found');
  } else {
    for (const v of cabVehicles) {
      const { count: imgCount } = await supabase
        .from('vehicle_images')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', v.id);
      console.log(`   ${v.year} ${v.make} ${v.model}: VIN=${v.vin ? '✓' : '✗'} Miles=${v.mileage ? '✓' : '✗'} Images=${imgCount || 0}`);
    }
  }

  // 6. Check auction_events status
  console.log('\n📍 AUCTION EVENTS:');
  const { count: totalEvents } = await supabase.from('auction_events').select('*', { count: 'exact', head: true });
  const { count: eventsWithVehicle } = await supabase.from('auction_events').select('*', { count: 'exact', head: true }).not('vehicle_id', 'is', null);
  console.log(`   Total: ${(totalEvents || 0).toLocaleString()}`);
  console.log(`   Linked to vehicles: ${(eventsWithVehicle || 0).toLocaleString()}`);

  // 7. Check comments
  console.log('\n💬 AUCTION COMMENTS:');
  const { count: totalComments } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true });
  const { count: commentsWithVehicle } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true }).not('vehicle_id', 'is', null);
  console.log(`   Total: ${(totalComments || 0).toLocaleString()}`);
  console.log(`   Linked to vehicles: ${(commentsWithVehicle || 0).toLocaleString()}`);
}

checkStatus().catch(console.error);
