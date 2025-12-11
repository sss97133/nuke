/**
 * Process Pending Organization Images
 * Processes organization images that are pending AI analysis
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function processPendingImages(batchSize = 10) {
  console.log(`\n🔍 Fetching ${batchSize} pending images...`);

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
    return;
  }

  if (!images || images.length === 0) {
    console.log('✅ No more pending images!');
    return;
  }

  console.log(`📸 Processing ${images.length} images...\n`);

  let successCount = 0;
  let errorCount = 0;

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

      console.log(`  ✅ Analysis complete`);
      successCount++;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      
      // Mark as failed
      await supabase
        .from('vehicle_images')
        .update({
          ai_processing_status: 'failed',
          ai_processing_error: error.message
        })
        .eq('id', image.id);
      
      errorCount++;
    }
  }

  console.log(`\n✅ Processed: ${successCount} | ❌ Failed: ${errorCount}`);
  
  if (images.length === batchSize) {
    console.log('\n🔄 More images to process. Run again to continue...');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const batchSize = parseInt(process.argv[2]) || 10;
  processPendingImages(batchSize).catch(console.error);
}

export { processPendingImages };

