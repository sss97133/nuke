/**
 * Process All Pending Images
 * Processes all images with ai_processing_status = 'pending'
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function processPendingImages(batchSize = 10, maxBatches = 10) {
  console.log(`\n🚀 Processing pending images...`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Max batches: ${maxBatches}\n`);

  let totalProcessed = 0;
  let totalFailed = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Batch ${batch + 1}/${maxBatches}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Get pending images
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id, image_url, ai_processing_status')
      .eq('ai_processing_status', 'pending')
      .not('vehicle_id', 'is', null)
      .not('image_url', 'is', null)
      .limit(batchSize);

    if (error) {
      console.error('❌ Error fetching images:', error);
      break;
    }

    if (!images || images.length === 0) {
      console.log('✅ No more pending images!');
      break;
    }

    console.log(`📸 Processing ${images.length} images...\n`);

    for (const image of images) {
      try {
        // Mark as processing
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'processing',
            ai_processing_started_at: new Date().toISOString()
          })
          .eq('id', image.id);

        console.log(`Processing: ${image.id.substring(0, 8)}...`);

        // Call tier 1 analysis
        const { data, error: funcError } = await supabase.functions.invoke('analyze-image-tier1', {
          body: {
            image_url: image.image_url,
            vehicle_id: image.vehicle_id,
            image_id: image.id
          }
        });

        if (funcError || !data?.success) {
          throw new Error(funcError?.message || 'Function returned error');
        }

        // Mark as complete
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'complete',
            ai_processing_completed_at: new Date().toISOString()
          })
          .eq('id', image.id);

        console.log(`  ✅ Complete`);
        totalProcessed++;

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'failed',
            ai_processing_error: error.message
          })
          .eq('id', image.id);
        
        totalFailed++;
      }
    }

    // Check if done
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('ai_processing_status', 'pending')
      .not('vehicle_id', 'is', null);

    if (count === 0) {
      console.log('\n✅ All images processed!');
      break;
    }

    // Wait between batches
    if (batch < maxBatches - 1) {
      console.log('\n⏳ Waiting 2 seconds before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final stats
  const { count: pending } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('ai_processing_status', 'pending');

  const { count: complete } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .in('ai_processing_status', ['complete', 'completed']);

  const { count: failed } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('ai_processing_status', 'failed');

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 Final Stats:`);
  console.log(`   ✅ Complete: ${complete}`);
  console.log(`   ⏳ Pending: ${pending}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📊 This run: ${totalProcessed} processed, ${totalFailed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const batchSize = parseInt(process.argv[2]) || 10;
  const maxBatches = parseInt(process.argv[3]) || 10;
  processPendingImages(batchSize, maxBatches).catch(console.error);
}

export { processPendingImages };

