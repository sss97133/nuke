/**
 * Check if we have any stored HTML snapshots for C&B listings
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== CHECKING C&B DATA ===\n');

  // 1. Check vehicles with C&B discovery_url
  const { data: cabVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, color, transmission, engine_size, discovery_url, origin_metadata')
    .ilike('discovery_url', '%carsandbids%')
    .limit(10);

  console.log(`📋 C&B Vehicles: ${cabVehicles?.length || 0}`);

  for (const v of cabVehicles || []) {
    console.log(`\n  ${v.year} ${v.make} ${v.model}`);
    console.log(`    VIN: ${v.vin || 'NULL'}`);
    console.log(`    Mileage: ${v.mileage || 'NULL'}`);
    console.log(`    Color: ${v.color || 'NULL'}`);
    console.log(`    Transmission: ${v.transmission || 'NULL'}`);
    console.log(`    URL: ${v.discovery_url}`);

    // Check if we have listing_page_snapshots
    const { data: snapshot } = await supabase
      .from('listing_page_snapshots')
      .select('id, fetched_at, html_length')
      .eq('url', v.discovery_url)
      .limit(1)
      .maybeSingle();

    if (snapshot) {
      console.log(`    ✅ Snapshot: ${snapshot.html_length} bytes @ ${snapshot.fetched_at}`);
    } else {
      console.log(`    ❌ No snapshot`);
    }

    // Check if we have images
    const { count: imgCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);
    console.log(`    Images: ${imgCount || 0}`);

    // Check if origin_metadata has anything
    if (v.origin_metadata) {
      const metaKeys = Object.keys(v.origin_metadata);
      console.log(`    Origin metadata: ${metaKeys.slice(0, 5).join(', ')}`);
    }
  }

  // 2. Check import_queue for C&B
  const { count: cabQueue } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .ilike('listing_url', '%carsandbids%')
    .eq('status', 'pending');

  console.log(`\n📋 C&B in import_queue (pending): ${cabQueue || 0}`);

  // 3. Check external_listings
  const { count: cabListings } = await supabase
    .from('external_listings')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'cars_and_bids');

  console.log(`📋 C&B external_listings: ${cabListings || 0}`);

  // 4. Check listing_page_snapshots
  const { count: cabSnapshots } = await supabase
    .from('listing_page_snapshots')
    .select('*', { count: 'exact', head: true })
    .ilike('url', '%carsandbids%');

  console.log(`📋 C&B snapshots: ${cabSnapshots || 0}`);

  // 5. Read a snapshot and check its structure
  const { data: sampleSnapshot } = await supabase
    .from('listing_page_snapshots')
    .select('id, url, html_content')
    .ilike('url', '%carsandbids%')
    .limit(1)
    .maybeSingle();

  if (sampleSnapshot?.html_content) {
    console.log(`\n=== SAMPLE SNAPSHOT ANALYSIS ===`);
    console.log(`URL: ${sampleSnapshot.url}`);
    console.log(`HTML length: ${sampleSnapshot.html_content.length}`);

    const html = sampleSnapshot.html_content;
    const hasNextData = html.includes('__NEXT_DATA__');
    console.log(`Has __NEXT_DATA__: ${hasNextData}`);

    if (hasNextData) {
      const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const auction = nextData?.props?.pageProps?.auction;
          if (auction) {
            console.log(`✅ Found auction in __NEXT_DATA__`);
            console.log(`  title: ${auction.title}`);
            console.log(`  mileage: ${auction.mileage}`);
            console.log(`  vin: ${auction.vin}`);
            console.log(`  images: ${auction.images?.length || 0}`);
            console.log(`  comments: ${auction.comments?.length || 0}`);
            console.log(`  bids: ${auction.bids?.length || 0}`);
            console.log(`  AUCTION KEYS: ${Object.keys(auction).join(', ')}`);
          } else {
            console.log(`❌ No auction in __NEXT_DATA__`);
            console.log(`pageProps keys: ${Object.keys(nextData?.props?.pageProps || {}).join(', ')}`);
          }
        } catch (e: any) {
          console.log(`❌ Failed to parse __NEXT_DATA__: ${e.message}`);
        }
      }
    }
  }
}

main();
