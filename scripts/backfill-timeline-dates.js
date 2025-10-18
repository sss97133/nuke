#!/usr/bin/env node
/**
 * Backfill Timeline Events with Correct EXIF Dates
 * 
 * Fixes timeline events to use actual photo dates from EXIF instead of upload dates
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Backfill Timeline Events - EXIF Date Correction\n');
  
  // Step 1: Dry run - show what will be updated
  console.log('📋 Step 1: Dry Run - Preview Changes\n');
  
  const { data: previewData, error: previewError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT 
        te.id AS timeline_event_id,
        te.event_type,
        te.event_date AS current_event_date,
        vi.taken_at AS correct_date_from_exif,
        vi.taken_at::date AS new_event_date,
        te.metadata->>'image_url' AS image_url,
        vi.vehicle_id
      FROM timeline_events te
      JOIN vehicle_images vi ON te.metadata->>'image_url' = vi.image_url
      WHERE 
        te.event_type IN ('image_upload', 'photo_added', 'document_added')
        AND vi.taken_at IS NOT NULL
        AND te.event_date::date != vi.taken_at::date
      ORDER BY vi.vehicle_id, vi.taken_at
      LIMIT 20
    `
  });

  // Fetch timeline events
  const { data: timelineEvents, error: timelineError } = await supabase
    .from('timeline_events')
    .select('id, event_type, event_date, metadata, vehicle_id')
    .in('event_type', ['image_upload', 'photo_added', 'document_added'])
    .not('metadata->image_url', 'is', null);

  if (timelineError) {
    console.error('❌ Error fetching timeline events:', timelineError);
    process.exit(1);
  }

  // Fetch vehicle images
  const { data: vehicleImages, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, taken_at, vehicle_id')
    .not('taken_at', 'is', null);

  if (imagesError) {
    console.error('❌ Error fetching vehicle images:', imagesError);
    process.exit(1);
  }

  // Build lookup map
  const imageMap = new Map();
  (vehicleImages || []).forEach(img => {
    imageMap.set(img.image_url, img);
  });

  // Find items that need updating
  const itemsToUpdate = (timelineEvents || []).filter(event => {
    const imageUrl = event.metadata?.image_url;
    if (!imageUrl) return false;
    
    const matchingImage = imageMap.get(imageUrl);
    if (!matchingImage || !matchingImage.taken_at) return false;
    
    const takenDate = new Date(matchingImage.taken_at).toISOString().split('T')[0];
    const currentDate = new Date(event.event_date).toISOString().split('T')[0];
    
    return takenDate !== currentDate;
  }).map(event => ({
    ...event,
    matchingImage: imageMap.get(event.metadata.image_url)
  }));

  if (itemsToUpdate.length === 0) {
    console.log('✅ No timeline events need updating - all dates are correct!');
    process.exit(0);
  }

  console.log(`Found ${itemsToUpdate.length} events that need date correction (showing first 10):\n`);
  itemsToUpdate.slice(0, 10).forEach(item => {
    const currentDate = new Date(item.event_date).toISOString().split('T')[0];
    const correctDate = new Date(item.matchingImage.taken_at).toISOString().split('T')[0];
    console.log(`  Event ${item.id.substring(0, 8)}...`);
    console.log(`    Type: ${item.event_type}`);
    console.log(`    Current: ${currentDate}`);
    console.log(`    Correct: ${correctDate}`);
    console.log(`    Vehicle: ${item.matchingImage.vehicle_id.substring(0, 8)}...`);
    console.log('');
  });

  // Step 2: Execute update
  console.log('\n🔄 Step 2: Executing Update\n');
  
  let totalUpdated = 0;
  const batchSize = 50;

  console.log(`Updating ${itemsToUpdate.length} timeline events...\n`);

  // Update in batches
  for (let i = 0; i < itemsToUpdate.length; i += batchSize) {
    const batch = itemsToUpdate.slice(i, i + batchSize);
    
    for (const item of batch) {
      const takenAt = item.matchingImage.taken_at;
      const takenDate = new Date(takenAt).toISOString().split('T')[0];
      
      const updatedMetadata = {
        ...item.metadata,
        when: {
          ...(item.metadata?.when || {}),
          photo_taken: takenAt
        }
      };

      const { error: updateError } = await supabase
        .from('timeline_events')
        .update({
          event_date: takenDate,
          metadata: updatedMetadata
        })
        .eq('id', item.id);

      if (updateError) {
        console.error(`❌ Error updating event ${item.id}:`, updateError);
      } else {
        totalUpdated++;
      }
    }
    
    const progress = Math.min(i + batchSize, itemsToUpdate.length);
    console.log(`  Updated ${progress} / ${itemsToUpdate.length}`);
  }

  console.log(`\n✅ Successfully updated ${totalUpdated} timeline events\n`);

  // Step 3: Verification
  console.log('✓ Step 3: Verification\n');
  
  // Re-fetch to verify
  const { data: verifyEvents, error: verifyError } = await supabase
    .from('timeline_events')
    .select('id, event_type, event_date, metadata')
    .in('event_type', ['image_upload', 'photo_added', 'document_added'])
    .not('metadata->image_url', 'is', null)
    .limit(10);

  if (verifyEvents) {
    console.log('Sample of events after update:');
    verifyEvents.slice(0, 5).forEach(item => {
      const eventDate = new Date(item.event_date).toISOString().split('T')[0];
      const imageUrl = item.metadata?.image_url;
      const matchingImage = imageMap.get(imageUrl);
      const takenDate = matchingImage?.taken_at 
        ? new Date(matchingImage.taken_at).toISOString().split('T')[0]
        : 'N/A';
      const match = eventDate === takenDate ? '✓' : '✗';
      console.log(`  ${match} Event ${item.id.substring(0, 8)}... - Date: ${eventDate} (EXIF: ${takenDate})`);
    });
  }

  console.log('\n🎉 Backfill complete!\n');
  console.log('Next steps:');
  console.log('  1. Test uploading a new image with old EXIF date');
  console.log('  2. Verify timeline shows event on correct date');
  console.log('  3. Check user contribution graph');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

