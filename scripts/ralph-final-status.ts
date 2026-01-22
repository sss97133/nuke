/**
 * Ralph Final Status Report
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
  console.log('║         RALPH FINAL STATUS REPORT                  ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Queue status
  console.log('📋 IMPORT QUEUE:');
  const statuses = ['pending', 'processing', 'completed', 'failed', 'skipped'];
  for (const status of statuses) {
    const { count } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', status);
    console.log(`   ${status.padEnd(12)}: ${(count || 0).toLocaleString().padStart(6)}`);
  }

  // Vehicle counts
  console.log('\n🚗 VEHICLES:');
  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  console.log(`   Total: ${(totalVehicles || 0).toLocaleString()}`);

  // By source
  const sources = [
    { name: 'BaT', pattern: '%bringatrailer%' },
    { name: 'C&B', pattern: '%carsandbids%' },
    { name: 'Craigslist', pattern: '%craigslist%' },
    { name: 'Mecum', pattern: '%mecum%' },
    { name: 'Classic.com', pattern: '%classic.com%' },
  ];
  for (const src of sources) {
    const { count } = await supabase.from('vehicles').select('*', { count: 'exact', head: true }).ilike('discovery_url', src.pattern);
    console.log(`   ${src.name.padEnd(12)}: ${(count || 0).toLocaleString().padStart(6)}`);
  }

  // Image coverage (accurate)
  console.log('\n📸 IMAGE COVERAGE:');
  const { count: totalImages } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true });
  const { count: nullImages } = await supabase.from('vehicle_images').select('*', { count: 'exact', head: true }).is('vehicle_id', null);
  console.log(`   Total images: ${(totalImages || 0).toLocaleString()}`);
  console.log(`   Orphaned (no vehicle_id): ${(nullImages || 0).toLocaleString()}`);

  // Estimate vehicles with images (scan a batch)
  let vehiclesWithImages = 0;
  let offset = 0;
  const seenVehicles = new Set<string>();
  while (offset < 50000) {
    const { data: batch } = await supabase
      .from('vehicle_images')
      .select('vehicle_id')
      .not('vehicle_id', 'is', null)
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    for (const img of batch) seenVehicles.add(img.vehicle_id);
    offset += 1000;
  }
  console.log(`   Vehicles with images: ${seenVehicles.size.toLocaleString()} (${((seenVehicles.size / (totalVehicles || 1)) * 100).toFixed(1)}%)`);

  // Auction events
  console.log('\n📍 AUCTION EVENTS:');
  const { count: totalEvents } = await supabase.from('auction_events').select('*', { count: 'exact', head: true });
  const { count: withWinningBid } = await supabase.from('auction_events').select('*', { count: 'exact', head: true }).not('winning_bid', 'is', null);
  const { count: withHighBid } = await supabase.from('auction_events').select('*', { count: 'exact', head: true }).not('high_bid', 'is', null);
  console.log(`   Total: ${(totalEvents || 0).toLocaleString()}`);
  console.log(`   With winning_bid: ${(withWinningBid || 0).toLocaleString()} (${((withWinningBid || 0) / (totalEvents || 1) * 100).toFixed(0)}%)`);
  console.log(`   With high_bid: ${(withHighBid || 0).toLocaleString()} (${((withHighBid || 0) / (totalEvents || 1) * 100).toFixed(0)}%)`);

  // External listings
  console.log('\n🔗 EXTERNAL LISTINGS:');
  const { count: totalListings } = await supabase.from('external_listings').select('*', { count: 'exact', head: true });
  const { count: withFinalPrice } = await supabase.from('external_listings').select('*', { count: 'exact', head: true }).not('final_price', 'is', null);
  console.log(`   Total: ${(totalListings || 0).toLocaleString()}`);
  console.log(`   With final_price: ${(withFinalPrice || 0).toLocaleString()} (${((withFinalPrice || 0) / (totalListings || 1) * 100).toFixed(0)}%)`);

  // Comments
  console.log('\n💬 AUCTION COMMENTS:');
  const { count: totalComments } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true });
  const { count: linkedComments } = await supabase.from('auction_comments').select('*', { count: 'exact', head: true }).not('vehicle_id', 'is', null);
  console.log(`   Total: ${(totalComments || 0).toLocaleString()}`);
  console.log(`   Linked to vehicles: ${(linkedComments || 0).toLocaleString()} (${((linkedComments || 0) / (totalComments || 1) * 100).toFixed(0)}%)`);

  // BaT extraction quality
  console.log('\n🏆 BaT EXTRACTION QUALITY (sample of 100):');
  const { data: batSample } = await supabase
    .from('vehicles')
    .select('vin, mileage, color, transmission')
    .ilike('discovery_url', '%bringatrailer%')
    .limit(100);

  let withVin = 0, withMileage = 0, withColor = 0, withTrans = 0;
  for (const v of batSample || []) {
    if (v.vin && v.vin.length >= 11) withVin++;
    if (v.mileage) withMileage++;
    if (v.color) withColor++;
    if (v.transmission) withTrans++;
  }
  const sampleSize = batSample?.length || 1;
  console.log(`   VIN: ${withVin}% | Mileage: ${withMileage}% | Color: ${withColor}% | Trans: ${withTrans}%`);

  console.log('\n════════════════════════════════════════════════════════');
}

main().catch(console.error);
