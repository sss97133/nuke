import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  C&B BACKFILL STATUS');
  console.log('═══════════════════════════════════════════════════════════════');

  // Count C&B vehicles
  const { count: cabVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .ilike('listing_url', '%carsandbids%');

  // Count with descriptions (backfilled)
  const { count: withDesc } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .ilike('listing_url', '%carsandbids%')
    .not('description', 'is', null);

  // Count C&B images
  const { count: cabImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .ilike('image_url', '%carsandbids%');

  // Count comments
  const { count: cabComments } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'cars_and_bids');

  console.log('\nCOUNTS:');
  console.log('  C&B Vehicles:', cabVehicles || 0);
  console.log('  With Descriptions:', withDesc || 0);
  console.log('  C&B Images:', cabImages || 0);
  console.log('  C&B Comments:', cabComments || 0);

  // Get a recent example
  const { data: recent } = await supabase
    .from('vehicles')
    .select('id, year, make, model, description, bat_seller, sold_price, auction_outcome, location')
    .not('description', 'is', null)
    .ilike('listing_url', '%carsandbids%')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    console.log('\nRECENT EXAMPLE:');
    console.log('  Vehicle:', recent.year, recent.make, recent.model);
    console.log('  Description:', recent.description?.substring(0, 80) + '...');
    console.log('  Seller:', recent.bat_seller);
    console.log('  Sold Price:', recent.sold_price ? '$' + recent.sold_price.toLocaleString() : 'N/A');
    console.log('  Outcome:', recent.auction_outcome);
    console.log('  Location:', recent.location);

    // Check images
    const { data: imgs } = await supabase
      .from('vehicle_images')
      .select('image_url')
      .eq('vehicle_id', recent.id)
      .limit(100);

    const hashes = new Set();
    imgs?.forEach(i => {
      const m = i.image_url?.match(/\/([a-f0-9]{40})\/photos/);
      if (m) hashes.add(m[1]);
    });

    console.log('  Images:', imgs?.length || 0, '(unique hashes:', hashes.size + ')');

    // Check comments
    const { count: cmtCount } = await supabase
      .from('auction_comments')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', recent.id);

    console.log('  Comments:', cmtCount);
  }

  // Check external_listings metadata
  if (recent) {
    const { data: listing } = await supabase
      .from('external_listings')
      .select('metadata')
      .eq('vehicle_id', recent.id)
      .maybeSingle();

    if (listing?.metadata) {
      const m = listing.metadata as any;
      console.log('\nMETADATA (in external_listings):');
      console.log('  Carfax:', m.carfax_url ? 'Yes' : 'No');
      console.log('  Video:', m.video_url ? 'Yes' : 'No');
      console.log('  Doug\'s Take:', m.dougs_take ? 'Yes (' + m.dougs_take.length + ' chars)' : 'No');
      console.log('  Highlights:', m.highlights?.length || 0, 'items');
      console.log('  Equipment:', m.equipment?.length || 0, 'items');
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
}

main();
