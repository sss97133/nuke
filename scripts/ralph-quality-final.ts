/**
 * Final extraction quality report
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
  console.log('║       RALPH EXTRACTION QUALITY REPORT              ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Get sample of BaT vehicles
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, color, transmission')
    .like('discovery_url', '%bringatrailer%')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Query error:', error.message);
    return;
  }

  const count = vehicles?.length || 0;
  console.log(`Sample size: ${count} BaT vehicles\n`);

  if (count === 0) {
    console.log('No vehicles found');
    return;
  }

  // Calculate coverage
  let vinCount = 0, valid17 = 0, mileageCount = 0, colorCount = 0, transCount = 0;

  for (const v of vehicles) {
    const vin = v.vin || '';
    if (vin.trim()) vinCount++;
    if (vin.trim().length === 17) valid17++;
    if (v.mileage && v.mileage > 0) mileageCount++;
    if (v.color && v.color.trim()) colorCount++;
    if (v.transmission && v.transmission.trim()) transCount++;
  }

  const n = count;
  console.log('=== FIELD COVERAGE (last 100 BaT vehicles) ===');
  console.log(`VIN present:     ${vinCount.toString().padStart(3)}/${n} (${Math.round(vinCount/n*100)}%)`);
  console.log(`VIN 17-char:     ${valid17.toString().padStart(3)}/${n} (${Math.round(valid17/n*100)}%)`);
  console.log(`Mileage:         ${mileageCount.toString().padStart(3)}/${n} (${Math.round(mileageCount/n*100)}%)`);
  console.log(`Color:           ${colorCount.toString().padStart(3)}/${n} (${Math.round(colorCount/n*100)}%)`);
  console.log(`Transmission:    ${transCount.toString().padStart(3)}/${n} (${Math.round(transCount/n*100)}%)`);

  // Check images
  const ids = vehicles.map(v => v.id);
  const { data: imgs } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .in('vehicle_id', ids);

  const withImgs = new Set((imgs || []).map(i => i.vehicle_id));
  console.log(`\nWith images:     ${withImgs.size.toString().padStart(3)}/${n} (${Math.round(withImgs.size/n*100)}%)`);

  // Check auction events
  const { data: auctions } = await supabase
    .from('auction_events')
    .select('vehicle_id, winning_bid, high_bid')
    .in('vehicle_id', ids);

  const withAuction = new Set((auctions || []).map(a => a.vehicle_id));
  const withWinningBid = (auctions || []).filter(a => a.winning_bid && a.winning_bid > 0).length;
  const withHighBid = (auctions || []).filter(a => a.high_bid && a.high_bid > 0).length;

  console.log(`\n=== AUCTION DATA ===`);
  console.log(`With auction event: ${withAuction.size}/${n}`);
  console.log(`With winning_bid:   ${withWinningBid}`);
  console.log(`With high_bid:      ${withHighBid}`);

  // Show sample vehicles
  console.log('\n=== SAMPLE VEHICLES ===');
  for (const v of vehicles.slice(0, 5)) {
    const hasImg = withImgs.has(v.id) ? '📷' : '  ';
    console.log(`${hasImg} ${v.year} ${v.make} ${v.model}`);
    console.log(`   VIN: ${v.vin || 'N/A'}`);
    console.log(`   Miles: ${v.mileage || 'N/A'} | Color: ${v.color || 'N/A'} | Trans: ${v.transmission || 'N/A'}`);
  }

  // Overall totals
  console.log('\n=== OVERALL STATS ===');
  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  const { count: batVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true }).like('discovery_url', '%bringatrailer%');
  const { count: withImages } = await supabase.from('vehicle_images').select('vehicle_id', { count: 'exact', head: true });

  console.log(`Total vehicles: ${totalVehicles}`);
  console.log(`BaT vehicles: ${batVehicles}`);
  console.log(`Vehicle images: ${withImages}`);

  // Queue status
  console.log('\n=== QUEUE STATUS ===');
  const { count: pending } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending');
  const { count: completed } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', 'complete');
  const { count: batPending } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending').like('listing_url', '%bringatrailer%');

  console.log(`Pending: ${pending}`);
  console.log(`Completed: ${completed}`);
  console.log(`BaT pending: ${batPending}`);
}

main().catch(console.error);
