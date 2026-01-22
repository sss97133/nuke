/**
 * Analyze C&B vehicles that DO have data - how did they get it?
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== Analyzing C&B Success Cases ===\n');

  // Find C&B vehicles that DO have images
  const { data: vehiclesWithImages } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, discovery_url, discovery_source, origin_metadata, profile_origin, created_at')
    .ilike('discovery_url', '%carsandbids%')
    .limit(20);

  // For each, check if it has images
  for (const v of vehiclesWithImages || []) {
    const { count: imgCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', v.id);

    if ((imgCount || 0) > 0) {
      console.log(`\n✅ ${v.year} ${v.make} ${v.model} - ${imgCount} images`);
      console.log(`   VIN: ${v.vin || 'NULL'} | Mileage: ${v.mileage || 'NULL'}`);
      console.log(`   discovery_source: ${v.discovery_source}`);
      console.log(`   profile_origin: ${v.profile_origin}`);
      console.log(`   created_at: ${v.created_at}`);

      // Check image sources
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('image_url, source')
        .eq('vehicle_id', v.id)
        .limit(3);

      if (images && images.length > 0) {
        console.log('   Sample images:');
        for (const img of images) {
          console.log(`     - source: ${img.source} | ${img.image_url?.substring(0, 60)}...`);
        }
      }

      // Check origin_metadata for clues
      const meta = v.origin_metadata as any;
      if (meta) {
        console.log(`   origin_metadata keys: ${Object.keys(meta).join(', ')}`);
        if (meta.image_urls && meta.image_urls.length > 0) {
          console.log(`   image_urls in metadata: ${meta.image_urls.length}`);
        }
      }
    }
  }

  // Also check if there are any snapshots for C&B
  const { count: snapshotCount } = await supabase
    .from('listing_page_snapshots')
    .select('*', { count: 'exact', head: true })
    .ilike('url', '%carsandbids%');

  console.log(`\n\n📸 Total C&B snapshots: ${snapshotCount || 0}`);
}

main();
