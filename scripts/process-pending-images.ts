/**
 * Batch Process Pending Images
 * 
 * Processes images that are pending AI analysis by calling the intelligent-work-detector function
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  Deno.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

interface ImageRecord {
  id: string;
  vehicle_id: string;
  image_url: string;
  ai_processing_status: string;
}

async function processBatch(batchSize: number = 10): Promise<void> {
  console.log(`\n🔍 Fetching batch of ${batchSize} pending images...`);

  // Get pending images
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, ai_processing_status')
    .eq('ai_processing_status', 'pending')
    .not('vehicle_id', 'is', null)
    .not('image_url', 'is', null)
    .limit(batchSize);

  if (error) {
    console.error('Error fetching images:', error);
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

      // Call edge function
      const { data, error: funcError } = await supabase.functions.invoke('intelligent-work-detector', {
        body: {
          image_id: image.id,
          vehicle_id: image.vehicle_id,
          image_url: image.image_url
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

      console.log(`  ✅ ${data.extraction?.work_type || 'work'} detected (${Math.round((data.extraction?.confidence || 0) * 100)}% confidence)`);
      successCount++;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      console.error(`  ❌ Error: ${error.message}`);
      
      // Mark as failed
      await supabase
        .from('vehicle_images')
        .update({
          ai_processing_status: 'failed'
        })
        .eq('id', image.id);

      errorCount++;
    }
  }

  console.log(`\n📊 Batch complete: ${successCount} success, ${errorCount} errors`);
}

async function main() {
  const batchSize = parseInt(Deno.args[0]) || 10;
  const maxBatches = parseInt(Deno.args[1]) || 5;

  console.log(`🚀 Starting batch processing`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Max batches: ${maxBatches}`);
  console.log(`   Total images per run: ${batchSize * maxBatches}\n`);

  for (let i = 0; i < maxBatches; i++) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Batch ${i + 1}/${maxBatches}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    await processBatch(batchSize);

    // Check if we're done
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
    if (i < maxBatches - 1) {
      console.log('\n⏳ Waiting 2 seconds before next batch...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Final stats
  const { count: pending } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('ai_processing_status', 'pending')
    .not('vehicle_id', 'is', null);

  const { count: complete } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('ai_processing_status', 'complete');

  const { count: failed } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('ai_processing_status', 'failed');

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 Final Stats:`);
  console.log(`   ✅ Complete: ${complete}`);
  console.log(`   ⏳ Pending: ${pending}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

if (import.meta.main) {
  main().catch(console.error);
}

