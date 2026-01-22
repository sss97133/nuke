/**
 * Ralph Direct BaT Processor
 *
 * Processes pending BaT items by directly invoking extract-bat-core
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BATCH_SIZE = 3;
const MAX_ITEMS = 100; // Process up to 100 items per run
const DELAY_MS = 1000;

async function processItem(item: any): Promise<{ success: boolean; error?: string; vehicleId?: string }> {
  const url = item.listing_url;
  console.log(`  Processing: ${url.split('/').slice(-2).join('/')}`);

  try {
    // Mark as processing
    await supabase
      .from('import_queue')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'pending');

    // Invoke extract-bat-core
    const { data, error } = await supabase.functions.invoke('extract-bat-core', {
      body: { listing_url: url }
    });

    if (error) {
      throw new Error(error.message);
    }

    // Mark as complete
    await supabase
      .from('import_queue')
      .update({
        status: 'complete',
        updated_at: new Date().toISOString(),
        raw_data: {
          ...(item.raw_data || {}),
          processed_at: new Date().toISOString(),
          vehicle_id: data?.vehicle_id || null,
          extraction_result: data
        }
      })
      .eq('id', item.id);

    return { success: true, vehicleId: data?.vehicle_id };

  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.log(`    ❌ Error: ${errorMsg}`);

    // Mark as failed
    await supabase
      .from('import_queue')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString(),
        raw_data: {
          ...(item.raw_data || {}),
          failed_at: new Date().toISOString(),
          last_error: errorMsg
        }
      })
      .eq('id', item.id);

    return { success: false, error: errorMsg };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       RALPH DIRECT BAT PROCESSOR                   ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Get pending BaT items
  const { data: items, count } = await supabase
    .from('import_queue')
    .select('id, listing_url, raw_data', { count: 'exact' })
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer.com%')
    .limit(MAX_ITEMS);

  console.log(`📊 Found ${count || 0} pending BaT items`);
  console.log(`📦 Will process up to ${items?.length || 0} items\n`);

  if (!items || items.length === 0) {
    console.log('✅ No BaT items to process!');
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let processed = 0;

  for (const item of items) {
    const result = await processItem(item);
    processed++;

    if (result.success) {
      successCount++;
      console.log(`    ✅ Success ${result.vehicleId ? `(vehicle: ${result.vehicleId.substring(0, 8)}...)` : ''}`);
    } else {
      failCount++;
    }

    // Progress update
    if (processed % 10 === 0) {
      console.log(`\n--- Progress: ${processed}/${items.length} (${successCount} success, ${failCount} failed) ---\n`);
    }

    // Delay between items
    if (processed < items.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  // Final summary
  console.log('\n════════════════════════════════════════════════════════');
  console.log('                    FINAL SUMMARY');
  console.log('════════════════════════════════════════════════════════');
  console.log(`   Processed: ${processed}`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Failed: ${failCount}`);

  // Check remaining
  const { count: remaining } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer.com%');

  console.log(`   BaT items remaining: ${remaining || 0}`);
}

main().catch(console.error);
