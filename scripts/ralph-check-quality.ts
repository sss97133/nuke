/**
 * Check extraction quality of recently created BaT vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       RALPH EXTRACTION QUALITY CHECK               ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Get recent BaT vehicles
  const { data: vehicles, count } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, exterior_color, transmission, discovery_url, created_at')
    .ilike('discovery_url', '%bringatrailer%')
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`Recent BaT vehicles: ${vehicles?.length || 0}\n`);

  if (!vehicles || vehicles.length === 0) {
    console.log('No vehicles found');
    return;
  }

  // Calculate field coverage
  let vinCount = 0;
  let mileageCount = 0;
  let colorCount = 0;
  let transCount = 0;
  let valid17Vin = 0;

  for (const v of vehicles) {
    if (v.vin && v.vin.trim().length > 0) vinCount++;
    if (v.vin && v.vin.trim().length === 17) valid17Vin++;
    if (v.mileage && v.mileage > 0) mileageCount++;
    if (v.exterior_color && v.exterior_color.trim().length > 0) colorCount++;
    if (v.transmission && v.transmission.trim().length > 0) transCount++;
  }

  console.log('=== FIELD COVERAGE (last 100 BaT vehicles) ===');
  console.log(`VIN present: ${vinCount}% (${vinCount}/${vehicles.length})`);
  console.log(`VIN valid 17-char: ${valid17Vin}% (${valid17Vin}/${vehicles.length})`);
  console.log(`Mileage: ${mileageCount}% (${mileageCount}/${vehicles.length})`);
  console.log(`Exterior Color: ${colorCount}% (${colorCount}/${vehicles.length})`);
  console.log(`Transmission: ${transCount}% (${transCount}/${vehicles.length})`);

  // Check image coverage
  const vehicleIds = vehicles.map(v => v.id);
  const { data: imageData } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .in('vehicle_id', vehicleIds);

  const vehiclesWithImages = new Set(imageData?.map(i => i.vehicle_id) || []);
  console.log(`\nImage coverage: ${vehiclesWithImages.size}/${vehicles.length} (${((vehiclesWithImages.size / vehicles.length) * 100).toFixed(1)}%)`);

  // Show sample vehicles
  console.log('\n=== SAMPLE VEHICLES ===');
  for (const v of vehicles.slice(0, 5)) {
    console.log(`\n${v.year} ${v.make} ${v.model}`);
    console.log(`  VIN: ${v.vin || 'MISSING'}`);
    console.log(`  Mileage: ${v.mileage || 'MISSING'}`);
    console.log(`  Color: ${v.exterior_color || 'MISSING'}`);
    console.log(`  Trans: ${v.transmission || 'MISSING'}`);
    console.log(`  Has images: ${vehiclesWithImages.has(v.id) ? 'YES' : 'NO'}`);
  }

  // Check auction events
  const { data: auctionData } = await supabase
    .from('auction_events')
    .select('vehicle_id, winning_bid, high_bid')
    .in('vehicle_id', vehicleIds);

  const withWinningBid = auctionData?.filter(a => a.winning_bid && a.winning_bid > 0).length || 0;
  const withHighBid = auctionData?.filter(a => a.high_bid && a.high_bid > 0).length || 0;

  console.log('\n=== AUCTION DATA ===');
  console.log(`Vehicles with auction events: ${auctionData?.length || 0}`);
  console.log(`With winning_bid: ${withWinningBid}`);
  console.log(`With high_bid: ${withHighBid}`);
}

main().catch(console.error);
