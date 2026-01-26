/**
 * Ralph BaT Queue Processor
 *
 * Triggers processing of pending BaT items in batches
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BATCH_SIZE = 3; // As per Ralph constraints
const MAX_BATCHES = 50; // Process up to 150 items per run
const DELAY_MS = 2000; // 2 seconds between batches

async function processBatch(batchNum: number): Promise<{ success: number; failed: number; items: any[] }> {
  console.log(`\n📦 Processing batch ${batchNum}...`);

  // Get pending BaT items
  const { data: items, error: fetchError } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer.com%')
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error('❌ Fetch error:', fetchError.message);
    return { success: 0, failed: 0, items: [] };
  }

  if (!items || items.length === 0) {
    console.log('📭 No more BaT items to process');
    return { success: 0, failed: 0, items: [] };
  }

  console.log(`   Found ${items.length} items to process`);

  // Invoke the edge function
  const { data: result, error: invokeError } = await supabase.functions.invoke('process-import-queue-simple', {
    body: {
      batch_size: BATCH_SIZE,
      priority_only: false
    }
  });

  if (invokeError) {
    console.error('❌ Invoke error:', invokeError.message);
    return { success: 0, failed: BATCH_SIZE, items };
  }

  const successCount = result?.successful || 0;
  const failedCount = (result?.processed || 0) - successCount;

  console.log(`   ✅ Success: ${successCount}, ❌ Failed: ${failedCount}`);

  if (result?.items) {
    for (const item of result.items) {
      const status = item.success ? '✅' : '❌';
      const url = item.url?.split('/').slice(-2).join('/') || item.url;
      console.log(`   ${status} ${url} ${item.error ? `- ${item.error}` : ''}`);
    }
  }

  return { success: successCount, failed: failedCount, items: result?.items || [] };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║         RALPH BAT QUEUE PROCESSOR                  ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`\n⚙️  Batch size: ${BATCH_SIZE}, Max batches: ${MAX_BATCHES}`);

  // Check initial queue state
  const { count: batPending } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer.com%');

  console.log(`\n📊 BaT items pending: ${batPending || 0}`);

  if (!batPending || batPending === 0) {
    console.log('\n✅ No BaT items to process!');
    return;
  }

  let totalSuccess = 0;
  let totalFailed = 0;
  let batchNum = 0;
  let emptyBatches = 0;

  while (batchNum < MAX_BATCHES && emptyBatches < 2) {
    batchNum++;
    const result = await processBatch(batchNum);

    totalSuccess += result.success;
    totalFailed += result.failed;

    if (result.items.length === 0) {
      emptyBatches++;
    } else {
      emptyBatches = 0;
    }

    // Delay between batches
    if (batchNum < MAX_BATCHES && emptyBatches < 2) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  // Final status
  console.log('\n════════════════════════════════════════════════════════');
  console.log('                    FINAL SUMMARY');
  console.log('════════════════════════════════════════════════════════');
  console.log(`   Batches processed: ${batchNum}`);
  console.log(`   Total successful: ${totalSuccess}`);
  console.log(`   Total failed: ${totalFailed}`);

  // Check remaining
  const { count: remaining } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer.com%');

  console.log(`   BaT items remaining: ${remaining || 0}`);
}

main().catch(console.error);
