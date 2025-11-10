/**
 * BACKFILL TIMELINE EVENTS FOR IMAGES
 * Creates timeline events for all vehicle_images that have null timeline_event_id
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔄 BACKFILLING TIMELINE EVENTS FOR IMAGES...\n');

async function backfillTimelineEvents() {
  // Get all images without timeline events
  const { data: images, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, user_id, image_url, taken_at, created_at, filename')
    .is('timeline_event_id', null)
    .not('user_id', 'is', null) // Only process images with a user_id
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('❌ Error fetching images:', fetchError);
    return;
  }

  if (!images || images.length === 0) {
    console.log('✅ No images need backfilling!');
    return;
  }

  console.log(`📸 Found ${images.length} images without timeline events\n`);

  let processed = 0;
  let errors = 0;

  for (const image of images) {
    try {
      const eventDate = (image.taken_at || image.created_at).split('T')[0];
      
      // Call database function to create timeline event (bypasses RLS)
      const { data: eventId, error: eventError } = await supabase
        .rpc('backfill_timeline_event_for_image', {
          p_vehicle_id: image.vehicle_id,
          p_user_id: image.user_id,
          p_image_id: image.id,
          p_image_url: image.image_url,
          p_event_date: eventDate,
          p_filename: image.filename
        });

      if (eventError) {
        console.error(`❌ Failed to create event for image ${image.id}:`, eventError.message);
        errors++;
        continue;
      }

      processed++;
      process.stdout.write(`\r✅ Processed: ${processed}/${images.length} | Errors: ${errors}`);

      // Rate limit to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`\n❌ Unexpected error processing image ${image.id}:`, error);
      errors++;
    }
  }

  console.log(`\n\n🎯 FINAL RESULTS:`);
  console.log(`─────────────────────────────────────`);
  console.log(`Total images processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`\n✅ Backfill complete!`);
}

backfillTimelineEvents().catch(console.error);
