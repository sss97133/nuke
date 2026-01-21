import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function findCommentVehicles() {
  console.log('=== FINDING WHICH VEHICLES HAVE COMMENTS ===\n');

  // Get all unique vehicle_ids from comments
  const { data: comments } = await supabase
    .from('auction_comments')
    .select('vehicle_id')
    .not('vehicle_id', 'is', null)
    .limit(200000);

  // Count by vehicle_id
  const vehicleCounts: Record<string, number> = {};
  for (const c of comments || []) {
    if (c.vehicle_id) {
      vehicleCounts[c.vehicle_id] = (vehicleCounts[c.vehicle_id] || 0) + 1;
    }
  }

  const sorted = Object.entries(vehicleCounts).sort((a, b) => b[1] - a[1]);

  console.log('Vehicles with most comments:');
  for (const [vehicleId, count] of sorted.slice(0, 20)) {
    // Look up vehicle info
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('listing_title, bat_auction_url, year, make, model')
      .eq('id', vehicleId)
      .single();

    console.log(`\n${count.toLocaleString()} comments: ${vehicle?.listing_title || 'Unknown'}`);
    console.log(`  ID: ${vehicleId}`);
    console.log(`  URL: ${vehicle?.bat_auction_url || 'N/A'}`);
  }

  console.log(`\n\nTotal unique vehicles with comments: ${sorted.length}`);
  console.log(`Total comments: ${(comments || []).length.toLocaleString()}`);

  // Now check auction_events - what vehicles do they link to?
  console.log('\n\n=== AUCTION EVENTS ANALYSIS ===\n');

  const { data: events } = await supabase
    .from('auction_events')
    .select('id, vehicle_id, auction_url, total_comments, total_bids')
    .order('total_comments', { ascending: false })
    .limit(20);

  console.log('Top auction_events by comment count:');
  for (const e of events || []) {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('listing_title')
      .eq('id', e.vehicle_id)
      .single();

    console.log(`\n${e.total_comments} comments / ${e.total_bids} bids`);
    console.log(`  Vehicle: ${vehicle?.listing_title || 'Unknown'}`);
    console.log(`  Event ID: ${e.id}`);
    console.log(`  URL: ${e.auction_url?.slice(0, 70)}...`);
  }

  // Count unique vehicle_ids in auction_events
  const { data: eventVehicleIds } = await supabase
    .from('auction_events')
    .select('vehicle_id');

  const uniqueEventVehicles = new Set(eventVehicleIds?.map(e => e.vehicle_id).filter(Boolean));
  console.log(`\n\nUnique vehicles in auction_events: ${uniqueEventVehicles.size}`);
}

findCommentVehicles().catch(console.error);
