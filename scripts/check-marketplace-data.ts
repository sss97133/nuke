import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== VEHICLE EVENTS CHECK ===\n');

  // Get active vehicle events
  const { data: listings, error } = await supabase
    .from('vehicle_events')
    .select(`
      id,
      source_platform,
      event_status,
      current_price,
      bid_count,
      ended_at,
      source_url,
      vehicle:vehicles (
        id,
        year,
        make,
        model,
        listing_title,
        primary_image_url
      )
    `)
    .eq('event_status', 'active')
    .order('current_price', { ascending: false, nullsFirst: false })
    .limit(20);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  const listingCount = listings ? listings.length : 0;
  console.log(`Found ${listingCount} active listings:\n`);

  // Group by platform
  const byPlatform: Record<string, number> = {};

  for (const l of listings || []) {
    byPlatform[l.source_platform] = (byPlatform[l.source_platform] || 0) + 1;

    const v = l.vehicle as any;
    const title = v?.listing_title?.substring(0, 50) || `${v?.year} ${v?.make} ${v?.model}`;
    const bid = l.current_price ? `$${Number(l.current_price).toLocaleString()}` : 'No bid';
    const endDate = l.ended_at ? new Date(l.ended_at).toLocaleString() : 'No end date';

    console.log(`[${l.source_platform}] ${title}`);
    console.log(`  Bid: ${bid} | Bids: ${l.bid_count || 0} | Ends: ${endDate}`);
    console.log(`  Vehicle ID: ${v?.id || 'none'}`);
    console.log(`  Has Image: ${v?.primary_image_url ? 'Yes' : 'No'}`);
    console.log('');
  }

  console.log('\n=== BY PLATFORM ===');
  for (const [p, count] of Object.entries(byPlatform).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p}: ${count}`);
  }

  // Check total active
  const { count } = await supabase
    .from('vehicle_events')
    .select('*', { count: 'exact', head: true })
    .eq('event_status', 'active');

  console.log(`\nTotal active vehicle_events: ${count}`);
}

main().catch(console.error);
