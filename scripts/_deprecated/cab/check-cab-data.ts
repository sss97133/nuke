import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get vehicle
  const { data: v, error: vErr } = await supabase
    .from('vehicles')
    .select('id')
    .eq('year', 2002)
    .ilike('model', '%is 300%')
    .limit(1)
    .maybeSingle();

  if (!v) {
    console.log('Vehicle not found:', vErr);
    return;
  }

  console.log('Vehicle ID:', v.id);

  // Get external_listing for this vehicle
  const { data: listing, error: lErr } = await supabase
    .from('external_listings')
    .select('id, metadata')
    .eq('vehicle_id', v.id)
    .maybeSingle();

  console.log('\n=== EXTERNAL_LISTING METADATA ===');
  if (!listing) {
    console.log('No listing found:', lErr);
  } else if (listing.metadata) {
    const m = listing.metadata as any;
    console.log('carfax_url:', m.carfax_url);
    console.log('video_url:', m.video_url);
    console.log('seller_username:', m.seller_username);
    console.log('dougs_take:', m.dougs_take?.substring(0, 150) + '...');
    console.log('highlights:', m.highlights?.slice(0, 3));
    console.log('equipment count:', m.equipment?.length);
    console.log('seller_notes:', m.seller_notes?.substring(0, 100));
  }

  // Check image sources for pollution
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('source, image_url')
    .eq('vehicle_id', v.id)
    .order('position', { ascending: true })
    .limit(50);

  console.log('\n=== IMAGE SOURCES ===');
  const sources: Record<string, number> = {};
  images?.forEach(img => {
    sources[img.source || 'null'] = (sources[img.source || 'null'] || 0) + 1;
  });
  Object.entries(sources).forEach(([s, c]) => console.log(s + ':', c));

  // Check unique hashes among first 50 images
  const hashes = new Map<string, number>();
  images?.forEach(img => {
    const match = img.image_url?.match(/\/([a-f0-9]{40})\/photos/);
    if (match) {
      hashes.set(match[1], (hashes.get(match[1]) || 0) + 1);
    }
  });
  console.log('\nUnique auction hashes in first 50 images:', hashes.size);
  hashes.forEach((count, hash) => {
    console.log('  ' + hash.substring(0, 12) + '...:', count, 'images');
  });
}

main();
