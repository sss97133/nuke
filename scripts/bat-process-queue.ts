#!/usr/bin/env npx tsx
/**
 * BaT Queue Processor
 *
 * Continuously processes pending BaT URLs from the import_queue.
 * Uses extract-bat-core edge function.
 *
 * Usage: dotenvx run -f .env.local -- npx tsx scripts/bat-process-queue.ts [batch_size] [max_batches]
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function extractUrl(url: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-bat-core`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    const result = await response.json();
    return { success: result.success === true, error: result.error };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 10;
  const maxBatches = parseInt(process.argv[3]) || Infinity;

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BaT QUEUE PROCESSOR');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Batch size: ${batchSize}`);
  console.log(`Max batches: ${maxBatches === Infinity ? 'unlimited' : maxBatches}\n`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let batchCount = 0;

  while (batchCount < maxBatches) {
    // Get a batch of pending URLs
    const { data: batch, error: fetchError } = await supabase
      .from('import_queue')
      .select('id, listing_url')
      .eq('status', 'pending')
      .ilike('listing_url', '%bringatrailer%')
      .limit(batchSize);

    if (fetchError) {
      console.error('Error fetching queue:', fetchError.message);
      break;
    }

    if (!batch || batch.length === 0) {
      console.log('\nNo more pending URLs in queue.');
      break;
    }

    batchCount++;
    console.log(`\n─── Batch ${batchCount} (${batch.length} URLs) ───`);

    // Process batch concurrently (but not too fast)
    const results = await Promise.all(
      batch.map(async (item) => {
        const result = await extractUrl(item.listing_url);
        return { ...item, ...result };
      })
    );

    // Update queue status for processed items
    for (const item of results) {
      totalProcessed++;

      if (item.success) {
        totalSuccess++;
        await supabase
          .from('import_queue')
          .update({ status: 'complete', processed_at: new Date().toISOString() })
          .eq('id', item.id);
        console.log(`  ✓ ${item.listing_url.split('/listing/')[1]?.split('/')[0] || item.listing_url}`);
      } else {
        totalFailed++;
        await supabase
          .from('import_queue')
          .update({ status: 'failed', error_message: item.error, processed_at: new Date().toISOString() })
          .eq('id', item.id);
        console.log(`  ✗ ${item.listing_url.split('/listing/')[1]?.split('/')[0] || 'unknown'}: ${item.error?.slice(0, 60)}`);
      }
    }

    // Status update
    const { count: remaining } = await supabase
      .from('import_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .ilike('listing_url', '%bringatrailer%');

    console.log(`\n  Progress: ${totalSuccess} succeeded, ${totalFailed} failed, ${remaining} remaining`);

    // Brief pause between batches
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  PROCESSING COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Succeeded: ${totalSuccess}`);
  console.log(`  Failed: ${totalFailed}`);
  console.log(`  Success rate: ${((totalSuccess / totalProcessed) * 100).toFixed(1)}%`);
}

main().catch(console.error);
