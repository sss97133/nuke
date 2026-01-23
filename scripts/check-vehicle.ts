import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VEHICLE_ID = 'cfd289b8-b5f5-4a79-9b0e-a9298b1d442d';

async function check() {
  console.log('=== VEHICLE CHECK ===\n');

  // Get vehicle info
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();

  console.log('Vehicle:', vehicle?.year, vehicle?.make, vehicle?.model);
  console.log('VIN:', vehicle?.vin);

  // Get external listing
  const { data: listing } = await supabase
    .from('external_listings')
    .select('*')
    .eq('vehicle_id', VEHICLE_ID)
    .single();

  if (listing) {
    console.log('\n--- External Listing ---');
    console.log('Platform:', listing.platform);
    console.log('URL:', listing.listing_url);
    console.log('Status:', listing.listing_status);
    console.log('Current bid:', listing.current_bid);
    console.log('Metadata source:', listing.metadata?.source);
    console.log('Comment count in metadata:', listing.metadata?.comment_count);
  }

  // Get comments
  const { data: comments, count: commentCount } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact' })
    .eq('vehicle_id', VEHICLE_ID);

  console.log('\n--- Comments ---');
  console.log('Total comments in DB:', commentCount);
  if (comments && comments.length > 0) {
    console.log('Sample:');
    comments.slice(0, 3).forEach((c: any) => {
      console.log(`  @${c.author_username}: "${c.comment_text?.substring(0, 50)}..."`);
    });
  }

  // Get images
  const { data: images, count: imageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact' })
    .eq('vehicle_id', VEHICLE_ID);

  console.log('\n--- Images ---');
  console.log('Total images in DB:', imageCount);

  if (images && images.length > 0) {
    // Group by source
    const bySource: Record<string, any[]> = {};
    images.forEach((img: any) => {
      const source = img.exif_data?.imported_from || img.source || 'unknown';
      if (!bySource[source]) bySource[source] = [];
      bySource[source].push(img);
    });

    console.log('\nBy source:');
    Object.entries(bySource).forEach(([source, imgs]) => {
      console.log(`  ${source}: ${imgs.length} images`);
      // Show sample URL
      const sample = imgs[0];
      console.log(`    Sample: ${sample.image_url?.substring(0, 80)}...`);
      // Check for pollution indicators
      const polluted = imgs.filter((i: any) =>
        i.image_url?.includes('width=80') ||
        i.image_url?.includes('height=80') ||
        !i.image_url?.includes('media.carsandbids.com')
      );
      if (polluted.length > 0) {
        console.log(`    POLLUTED (80x80 or bad URL): ${polluted.length}`);
      }
    });
  }
}

check().catch(console.error);
