import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function verify() {
  const { data } = await supabase
    .from('external_listings')
    .select('listing_url, metadata')
    .eq('platform', 'cars_and_bids')
    .eq('metadata->>source', 'cab_backfill_v4')
    .limit(3);

  if (!data || data.length === 0) {
    console.log('No v4 extractions found');
    return;
  }

  console.log('=== V4 EXTRACTION VERIFICATION ===\n');

  for (const listing of data) {
    console.log('URL:', listing.listing_url);
    console.log('---');
    const m = listing.metadata;
    console.log('Seller:', m.seller_username || 'NOT FOUND');
    console.log('Winner:', m.winner_username || 'N/A');
    console.log('Location:', m.location || 'NOT FOUND');
    console.log('Video:', m.video_url ? 'YES' : 'NO');
    console.log('Carfax:', m.carfax_url ? 'YES' : 'NO');
    console.log('Comments:', m.comment_count);
    console.log('Images:', m.image_count);
    console.log('Equipment:', m.equipment?.length || 0, 'items');
    console.log('Flaws:', m.known_flaws?.length || 0, 'items');
    console.log('Auction Result:', JSON.stringify(m.auction_result));
    console.log('\n');
  }
}
verify();
