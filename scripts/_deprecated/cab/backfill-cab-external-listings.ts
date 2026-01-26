/**
 * Backfill external_listings for ALL Cars & Bids vehicles
 * This populates the table the frontend reads from
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CAB_ORG_ID = '822cae29-f80e-4859-9c48-a1485a543152';

async function main() {
  console.log('=== BACKFILL C&B EXTERNAL LISTINGS ===\n');

  // Get all C&B vehicles with their auction_events data
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, discovery_url, color, engine_type, transmission, drivetrain, body_style, location, mileage')
    .like('discovery_url', '%carsandbids%');

  if (error || !vehicles) {
    console.error('Error fetching vehicles:', error?.message);
    return;
  }

  console.log(`Found ${vehicles.length} C&B vehicles\n`);

  // Get auction_events data
  const { data: auctionEvents } = await supabase
    .from('auction_events')
    .select('vehicle_id, winning_bid, total_bids, comments_count, outcome')
    .eq('source', 'cars_and_bids');

  const auctionMap = new Map();
  for (const ae of auctionEvents || []) {
    auctionMap.set(ae.vehicle_id, ae);
  }

  // Check existing external_listings
  const { data: existingListings } = await supabase
    .from('external_listings')
    .select('vehicle_id')
    .eq('platform', 'cars_and_bids');

  const existingSet = new Set((existingListings || []).map(l => l.vehicle_id));
  console.log(`Found ${existingSet.size} existing external_listings\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const v of vehicles) {
    if (!v.discovery_url) {
      skipped++;
      continue;
    }

    // Extract listing ID from URL
    const listingIdMatch = v.discovery_url.match(/\/auctions\/([^/]+)/);
    const listingId = listingIdMatch?.[1] || null;

    if (!listingId) {
      skipped++;
      continue;
    }

    const auctionEvent = auctionMap.get(v.id);

    // Determine listing status
    let listingStatus = 'ended';
    if (auctionEvent?.outcome === 'sold') listingStatus = 'sold';
    else if (auctionEvent?.outcome === 'live') listingStatus = 'active';

    const externalListingData: any = {
      vehicle_id: v.id,
      organization_id: CAB_ORG_ID,
      platform: 'cars_and_bids',
      listing_url: v.discovery_url,
      listing_id: listingId,
      listing_status: listingStatus,
      current_bid: auctionEvent?.winning_bid || null,
      bid_count: auctionEvent?.total_bids || null,
      final_price: listingStatus === 'sold' ? auctionEvent?.winning_bid : null,
      metadata: {
        source: 'backfill_from_auction_events',
        location: v.location,
        color: v.color,
        engine: v.engine_type,
        transmission: v.transmission,
        drivetrain: v.drivetrain,
        body_style: v.body_style,
        comment_count: auctionEvent?.comments_count || null,
      },
      updated_at: new Date().toISOString(),
    };

    if (existingSet.has(v.id)) {
      // Update existing
      const { error: updateError } = await supabase
        .from('external_listings')
        .update(externalListingData)
        .eq('vehicle_id', v.id)
        .eq('platform', 'cars_and_bids');

      if (updateError) {
        console.log(`  Error updating ${v.id}: ${updateError.message}`);
      } else {
        updated++;
      }
    } else {
      // Insert new
      externalListingData.created_at = new Date().toISOString();
      const { error: insertError } = await supabase
        .from('external_listings')
        .insert(externalListingData);

      if (insertError) {
        console.log(`  Error inserting ${v.id}: ${insertError.message}`);
      } else {
        created++;
      }
    }
  }

  console.log('\n=== RESULTS ===');
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);

  // Verification
  const { count } = await supabase
    .from('external_listings')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'cars_and_bids');

  console.log(`\n  Total C&B external_listings: ${count}`);
}

main().catch(console.error);
