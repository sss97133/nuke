import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VEHICLE_ID = '81a73e63-2f73-4c1c-b4e9-00dde3857045';

async function check() {
  console.log('Checking vehicle:', VEHICLE_ID, '\n');

  // Get listing
  const { data: listing } = await supabase
    .from('external_listings')
    .select('*')
    .eq('vehicle_id', VEHICLE_ID)
    .single();

  if (listing) {
    console.log('URL:', listing.listing_url);
    console.log('Metadata source:', listing.metadata?.source);
    console.log('Metadata image_count:', listing.metadata?.image_count);
    console.log('Metadata comment_count:', listing.metadata?.comment_count);
  }

  // Get all images
  const { data: images, count: imageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact' })
    .eq('vehicle_id', VEHICLE_ID);

  console.log('\nImages in DB:', imageCount);
  if (images && images.length > 0) {
    console.log('Sources:', [...new Set(images.map((i: any) => i.source))]);
    console.log('Sample URLs:');
    images.slice(0, 3).forEach((img: any) => {
      console.log('  ', img.image_url?.substring(0, 70) + '...');
    });
  }

  // Get comments
  const { count: commentCount } = await supabase
    .from('auction_comments')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', VEHICLE_ID);

  console.log('\nComments in DB:', commentCount);

  // Try inserting a test image to see if it works
  console.log('\n--- TEST IMAGE INSERT ---');
  const testImage = {
    vehicle_id: VEHICLE_ID,
    image_url: 'https://media.carsandbids.com/test-' + Date.now() + '.jpg',
    source: 'external_import',
    source_url: 'https://test.com',
    is_external: true,
    is_approved: true,
    approval_status: 'auto_approved',
    redaction_level: 'none',
    position: 999,
    display_order: 999,
    exif_data: { test: true },
  };

  const { data: inserted, error } = await supabase
    .from('vehicle_images')
    .insert(testImage)
    .select('id');

  if (error) {
    console.log('Insert ERROR:', error.message);
    console.log('Code:', error.code);
    console.log('Details:', error.details);
  } else {
    console.log('Insert SUCCESS, ID:', inserted?.[0]?.id);
    // Clean up
    await supabase.from('vehicle_images').delete().eq('id', inserted?.[0]?.id);
    console.log('Cleaned up test image');
  }
}

check().catch(console.error);
