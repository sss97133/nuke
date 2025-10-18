#!/usr/bin/env node

/**
 * Backfill Timeline Events for Existing Images
 * 
 * Creates timeline events for all vehicle_images that don't have corresponding
 * timeline events, using EXIF dates when available.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function backfillTimelineEvents(vehicleId = null, dryRun = true) {
  console.log(`\n🔄 Backfilling timeline events for images...`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will create events)'}\n`);

  try {
    // Get all images
    let query = supabase
      .from('vehicle_images')
      .select('id, vehicle_id, user_id, image_url, filename, taken_at, created_at, exif_data, file_size');
    
    if (vehicleId) {
      query = query.eq('vehicle_id', vehicleId);
      console.log(`Filtering to vehicle: ${vehicleId}`);
    }

    const { data: images, error: imageError } = await query;

    if (imageError) {
      console.error('❌ Error fetching images:', imageError);
      return;
    }

    console.log(`Found ${images.length} images total`);

    // Get existing timeline events of type photo_added
    let eventQuery = supabase
      .from('timeline_events')
      .select('vehicle_id, event_date, metadata');
    
    if (vehicleId) {
      eventQuery = eventQuery.eq('vehicle_id', vehicleId);
    }

    const { data: existingEvents, error: eventError } = await eventQuery
      .in('event_type', ['photo_added', 'batch_image_upload', 'image_upload']);

    if (eventError) {
      console.error('❌ Error fetching existing events:', eventError);
      return;
    }

    console.log(`Found ${existingEvents.length} existing photo timeline events\n`);

    // Build a set of image URLs that already have timeline events
    const eventsWithImages = new Set();
    existingEvents.forEach(event => {
      if (event.metadata?.uploadedUrls) {
        event.metadata.uploadedUrls.forEach(url => eventsWithImages.add(url));
      }
      if (event.metadata?.what?.image_url) {
        eventsWithImages.add(event.metadata.what.image_url);
      }
    });

    // Find images without timeline events
    const imagesToBackfill = images.filter(img => !eventsWithImages.has(img.image_url));

    console.log(`Images needing timeline events: ${imagesToBackfill.length}\n`);

    if (imagesToBackfill.length === 0) {
      console.log('✅ No backfill needed - all images have timeline events!');
      return;
    }

    // Group images by date for batch creation
    const imagesByDate = {};
    
    imagesToBackfill.forEach(img => {
      // Use EXIF date if available, otherwise use upload date
      const photoDate = img.taken_at || img.created_at;
      const dateOnly = new Date(photoDate).toISOString().split('T')[0];
      
      if (!imagesByDate[dateOnly]) {
        imagesByDate[dateOnly] = [];
      }
      
      imagesByDate[dateOnly].push(img);
    });

    console.log(`Will create ${Object.keys(imagesByDate).length} timeline events (grouped by date)\n`);

    // Preview the events to be created
    Object.entries(imagesByDate).forEach(([date, imgs]) => {
      console.log(`  ${date}: ${imgs.length} image${imgs.length > 1 ? 's' : ''}`);
    });

    if (dryRun) {
      console.log('\n⚠️  DRY RUN - No changes made');
      console.log('Run with --live flag to actually create timeline events');
      return;
    }

    // Create timeline events
    console.log('\n📝 Creating timeline events...\n');
    
    const eventsToCreate = [];
    
    for (const [date, imgs] of Object.entries(imagesByDate)) {
      const count = imgs.length;
      const firstImage = imgs[0];
      
      const eventData = {
        vehicle_id: firstImage.vehicle_id,
        user_id: firstImage.user_id,
        event_type: 'photo_added',
        source: 'backfill_script',
        event_date: date,
        title: count === 1 ? 'Photo Added' : `${count} Photos Added`,
        description: count === 1 
          ? `Image uploaded: ${firstImage.filename || 'unknown'}` 
          : `Batch upload of ${count} images`,
        metadata: {
          source: 'backfill_script',
          count: count,
          uploadedUrls: imgs.map(img => img.image_url),
          filenames: imgs.map(img => img.filename || 'unknown'),
          backfill_date: new Date().toISOString(),
          who: {
            user_id: firstImage.user_id
          },
          what: {
            action: 'image_upload',
            source: 'backfill_script',
            count: count
          },
          when: {
            photo_taken: date,
            backfilled_at: new Date().toISOString()
          }
        }
      };
      
      eventsToCreate.push(eventData);
    }

    // Insert in batches of 100
    const batchSize = 100;
    let created = 0;
    
    for (let i = 0; i < eventsToCreate.length; i += batchSize) {
      const batch = eventsToCreate.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('timeline_events')
        .insert(batch);
      
      if (error) {
        console.error(`❌ Error creating batch ${Math.floor(i / batchSize) + 1}:`, error);
      } else {
        created += batch.length;
        console.log(`✅ Created ${batch.length} events (${created}/${eventsToCreate.length})`);
      }
    }

    console.log(`\n✅ Backfill complete! Created ${created} timeline events`);
    console.log(`\nRefresh the vehicle page to see the updated timeline.`);

  } catch (error) {
    console.error('❌ Backfill failed:', error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--live');
const vehicleId = args.find(arg => arg.startsWith('--vehicle='))?.split('=')[1] || null;

// Run backfill
backfillTimelineEvents(vehicleId, dryRun)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

