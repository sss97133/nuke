import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== EXTERNAL LISTINGS CHECK ===\n');

  // Get active external listings
  const { data: listings, error } = await supabase
    .from('external_listings')
    .select(`
      id,
      platform,
      listing_status,
      current_bid,
      bid_count,
      end_date,
      listing_url,
      vehicle:vehicles (
        id,
        year,
        make,
        model,
        listing_title,
        primary_image_url
      )
    `)
    .eq('listing_status', 'active')
    .order('current_bid', { ascending: false, nullsFirst: false })
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
    byPlatform[l.platform] = (byPlatform[l.platform] || 0) + 1;

    const v = l.vehicle as any;
    const title = v?.listing_title?.substring(0, 50) || `${v?.year} ${v?.make} ${v?.model}`;
    const bid = l.current_bid ? `$${Number(l.current_bid).toLocaleString()}` : 'No bid';
    const endDate = l.end_date ? new Date(l.end_date).toLocaleString() : 'No end date';

    console.log(`[${l.platform}] ${title}`);
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
    .from('external_listings')
    .select('*', { count: 'exact', head: true })
    .eq('listing_status', 'active');

  console.log(`\nTotal active external_listings: ${count}`);
}

main().catch(console.error);
