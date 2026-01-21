import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkActiveListings() {
  console.log('=== ACTIVE EXTERNAL LISTINGS ===\n');

  // Find active/live external listings
  const { data: listings, error } = await supabase
    .from('external_listings')
    .select('id, vehicle_id, platform, listing_url, listing_status, current_bid, bid_count, watcher_count, end_date, updated_at')
    .in('listing_status', ['active', 'live'])
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${listings?.length || 0} active listings:\n`);

  for (const l of listings || []) {
    const endTime = l.end_date ? new Date(l.end_date) : null;
    const remaining = endTime ? Math.max(0, endTime.getTime() - Date.now()) / 1000 / 60 : null;

    console.log(`ID: ${l.id}`);
    console.log(`  Vehicle: ${l.vehicle_id}`);
    console.log(`  Platform: ${l.platform}`);
    console.log(`  Status: ${l.listing_status}`);
    console.log(`  Current Bid: $${l.current_bid?.toLocaleString() || 'N/A'}`);
    console.log(`  Bid Count: ${l.bid_count ?? 'N/A'}`);
    console.log(`  Watchers: ${l.watcher_count ?? 'N/A'}`);
    console.log(`  End Date: ${l.end_date || 'N/A'}`);
    console.log(`  Time Remaining: ${remaining !== null ? `${remaining.toFixed(1)} minutes` : 'N/A'}`);
    console.log(`  URL: ${l.listing_url}`);
    console.log('');
  }

  // Also check the GT500CR specifically (from earlier conversation)
  console.log('=== GT500CR STATUS ===\n');
  const { data: gt500 } = await supabase
    .from('external_listings')
    .select('*')
    .ilike('listing_url', '%gt500cr%')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (gt500) {
    console.log('GT500CR External Listing:');
    console.log(`  ID: ${gt500.id}`);
    console.log(`  Status: ${gt500.listing_status}`);
    console.log(`  Current Bid: $${gt500.current_bid?.toLocaleString()}`);
    console.log(`  End Date: ${gt500.end_date}`);
    console.log(`  Last Synced: ${gt500.last_synced_at}`);
    console.log(`  Updated: ${gt500.updated_at}`);
  } else {
    console.log('GT500CR not found in external_listings');
  }
}

checkActiveListings().catch(console.error);
