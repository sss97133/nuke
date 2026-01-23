import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function verify() {
  // Get 5 recently extracted vehicles
  const { data: listings } = await supabase
    .from('external_listings')
    .select('listing_url, vehicle_id, metadata')
    .eq('platform', 'cars_and_bids')
    .eq('metadata->>source', 'cab_backfill_v4')
    .order('updated_at', { ascending: false })
    .limit(5);

  if (!listings) {
    console.log('No v4 extractions found');
    return;
  }

  console.log('═══ VERIFICATION OF 5 RECENT EXTRACTIONS ═══\n');

  for (const listing of listings) {
    const m = listing.metadata;

    // Get actual counts from DB
    const { count: commentCount } = await supabase
      .from('auction_comments')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', listing.vehicle_id);

    const { count: imageCount } = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', listing.vehicle_id);

    const commentsOk = commentCount === m.comment_count;
    const imagesOk = imageCount === m.image_count;

    console.log(`${listing.listing_url.split('/').pop()}`);
    console.log(`  Comments: ${commentCount}/${m.comment_count} ${commentsOk ? 'OK' : 'MISMATCH'}`);
    console.log(`  Images: ${imageCount}/${m.image_count} ${imagesOk ? 'OK' : 'MISMATCH'}`);
    console.log(`  Video: ${m.video_url ? 'YES' : 'NO'}`);
    console.log(`  Seller: ${m.seller_username || 'MISSING'}`);
    console.log(`  Winner: ${m.winner_username || '-'}`);
    console.log('');
  }
}

verify().catch(console.error);
