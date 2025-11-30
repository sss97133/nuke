import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const BATCH_SIZE = 50; // Process 50 images per batch
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches

async function processAllImages() {
  console.log('🚨 CRITICAL: Processing ALL images in database\n');

  // Get total count
  const { count: total } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .is('ai_scan_metadata->appraiser->primary_label', null);

  console.log(`📊 Total images needing analysis: ${total || 0}\n`);

  if (!total || total === 0) {
    console.log('✅ All images already analyzed!');
    return;
  }

  let totalAnalyzed = 0;
  let totalFailed = 0;
  let offset = 0;
  const allFailedIds = [];

  console.log(`Starting batch processing (${BATCH_SIZE} images per batch)...\n`);

  while (true) {
    try {
      console.log(`\n📦 Batch ${Math.floor(offset / BATCH_SIZE) + 1} (offset: ${offset})`);

      const { data, error } = await supabase.functions.invoke('batch-analyze-all-images', {
        body: {
          batch_size: BATCH_SIZE,
          offset: offset,
          limit: BATCH_SIZE
        }
      });

      if (error) {
        console.error(`❌ Batch error: ${error.message}`);
        break;
      }

      if (!data || !data.success) {
        console.error(`❌ Batch failed: ${data?.error || 'Unknown error'}`);
        break;
      }

      totalAnalyzed += data.analyzed || 0;
      totalFailed += data.failed || 0;
      if (data.failed_ids) {
        allFailedIds.push(...data.failed_ids);
      }

      const remaining = data.total_remaining || 0;
      const progress = total - remaining;
      const percent = Math.round((progress / total) * 100);

      console.log(`  ✅ Analyzed: ${data.analyzed}`);
      console.log(`  ❌ Failed: ${data.failed}`);
      console.log(`  📊 Progress: ${progress}/${total} (${percent}%)`);
      console.log(`  ⏳ Remaining: ${remaining}`);

      if (remaining === 0 || data.total_in_batch === 0) {
        console.log('\n✅ All images processed!');
        break;
      }

      offset = data.next_offset || offset + BATCH_SIZE;

      // Delay between batches to avoid overwhelming the API
      if (remaining > 0) {
        console.log(`  ⏸️  Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }

    } catch (error) {
      console.error(`❌ Error in batch processing: ${error.message}`);
      console.log(`\n⏸️  Pausing before retry...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 FINAL RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`✅ Total analyzed: ${totalAnalyzed}`);
  console.log(`❌ Total failed: ${totalFailed}`);
  console.log(`📊 Success rate: ${Math.round((totalAnalyzed / (totalAnalyzed + totalFailed)) * 100)}%`);

  if (allFailedIds.length > 0) {
    console.log(`\n⚠️  ${allFailedIds.length} images failed analysis`);
    console.log(`   Failed IDs: ${allFailedIds.slice(0, 10).join(', ')}${allFailedIds.length > 10 ? '...' : ''}`);
  }

  // Final verification
  const { count: finalRemaining } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .is('ai_scan_metadata->appraiser->primary_label', null);

  if (finalRemaining > 0) {
    console.log(`\n⚠️  WARNING: ${finalRemaining} images still need analysis`);
  } else {
    console.log(`\n✅ VERIFIED: ALL images have been analyzed!`);
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

processAllImages().catch(console.error);

