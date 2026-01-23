import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function show() {
  // Get a recently extracted vehicle with lots of comments
  const { data: listing } = await supabase
    .from('external_listings')
    .select('*, vehicle_id')
    .eq('platform', 'cars_and_bids')
    .eq('metadata->>source', 'cab_backfill_v4')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (!listing) {
    console.log('No v4 extraction found');
    return;
  }

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  FULL EXTRACTION VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('URL:', listing.listing_url);
  console.log('Vehicle ID:', listing.vehicle_id);
  console.log('Status:', listing.listing_status);
  console.log('Current Bid:', listing.current_bid);
  console.log('\n--- METADATA ---');

  const m = listing.metadata;
  console.log('Source:', m.source);
  console.log('Page Title:', m.page_title);
  console.log('Seller:', m.seller_username);
  console.log('Winner:', m.winner_username || 'N/A');
  console.log('Location:', m.location);
  console.log('Video URL:', m.video_url || 'NONE');
  console.log('Carfax URL:', m.carfax_url ? 'YES' : 'NO');
  console.log('Auction Result:', JSON.stringify(m.auction_result));

  console.log('\n--- CONTENT ---');
  console.log('Equipment:', m.equipment?.length || 0, 'items');
  console.log('Known Flaws:', m.known_flaws?.length || 0, 'items');
  console.log('Service History:', m.service_history?.length || 0, 'items');
  console.log('Dougs Take:', m.dougs_take ? m.dougs_take.substring(0, 100) + '...' : 'NONE');

  // Get comments
  const { data: comments, count: commentCount } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact' })
    .eq('vehicle_id', listing.vehicle_id)
    .order('sequence_number', { ascending: true });

  console.log('\n--- COMMENTS ---');
  console.log('Total in DB:', commentCount);
  console.log('Metadata says:', m.comment_count);

  if (comments && comments.length > 0) {
    console.log('\nFirst 5 comments:');
    comments.slice(0, 5).forEach((c: any, i: number) => {
      const tags = [
        c.is_seller ? '[SELLER]' : '',
        c.comment_type === 'bid' ? '[BID]' : '',
        c.comment_type === 'sold' ? '[SYSTEM]' : '',
      ].filter(Boolean).join(' ');
      console.log(`  ${i + 1}. @${c.author_username} ${tags}`);
      console.log(`     "${c.comment_text?.substring(0, 60)}..."`);
    });
  }

  // Get images
  const { data: images, count: imageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact' })
    .eq('vehicle_id', listing.vehicle_id);

  console.log('\n--- IMAGES ---');
  console.log('Total in DB:', imageCount);
  console.log('Metadata says:', m.image_count);

  if (images && images.length > 0) {
    // Group by category
    const byCategory: Record<string, number> = {};
    images.forEach((img: any) => {
      const cat = img.exif_data?.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    console.log('By category:', byCategory);

    console.log('\nFirst 3 image URLs:');
    images.slice(0, 3).forEach((img: any, i: number) => {
      console.log(`  ${i + 1}. ${img.image_url?.substring(0, 80)}...`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Comments: ${commentCount}/${m.comment_count} ${commentCount === m.comment_count ? 'MATCH' : 'MISMATCH'}`);
  console.log(`Images: ${imageCount}/${m.image_count} ${imageCount === m.image_count ? 'MATCH' : 'MISMATCH'}`);
  console.log(`Video: ${m.video_url ? 'SAVED' : 'NONE'}`);
  console.log(`Seller: ${m.seller_username ? 'CAPTURED' : 'MISSING'}`);
  console.log(`Winner: ${m.winner_username ? 'CAPTURED' : 'N/A'}`);
}

show().catch(console.error);
