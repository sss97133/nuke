/**
 * Ralph Direct BaT Processor V2
 *
 * Processes pending BaT items by directly invoking extract-bat-core
 * Uses correct parameter name: 'url' (not 'listing_url')
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const MAX_ITEMS = 50; // Process up to 50 items per run
const DELAY_MS = 1500; // 1.5 seconds between items (be nice to BaT)

async function processItem(item: any): Promise<{ success: boolean; error?: string; vehicleId?: string }> {
  const url = item.listing_url;
  const shortUrl = url.split('/listing/')[1] || url;
  console.log(`  Processing: ${shortUrl}`);

  try {
    // Mark as processing
    await supabase
      .from('import_queue')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'pending');

    // Invoke extract-bat-core with correct parameter name
    const { data, error } = await supabase.functions.invoke('extract-bat-core', {
      body: { url: url }  // Use 'url' not 'listing_url'
    });

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Extraction failed');
    }

    const vehicleId = data?.created_vehicle_ids?.[0] || data?.updated_vehicle_ids?.[0] || null;

    // Mark as complete
    await supabase
      .from('import_queue')
      .update({
        status: 'complete',
        updated_at: new Date().toISOString(),
        raw_data: {
          ...(item.raw_data || {}),
          processed_at: new Date().toISOString(),
          vehicle_id: vehicleId,
          extraction_result: {
            vehicles_extracted: data.vehicles_extracted,
            vehicles_created: data.vehicles_created,
            vehicles_updated: data.vehicles_updated,
          }
        }
      })
      .eq('id', item.id);

    return { success: true, vehicleId };

  } catch (err: any) {
    const errorMsg = err?.message || String(err);

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
  console.log('║       RALPH DIRECT BAT PROCESSOR V2                ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Get pending BaT items (only valid /listing/ URLs)
  const { data: items, count } = await supabase
    .from('import_queue')
    .select('id, listing_url, raw_data', { count: 'exact' })
    .eq('status', 'pending')
    .like('listing_url', '%bringatrailer.com/listing/%')
    .limit(MAX_ITEMS);

  console.log(`📊 Total pending BaT /listing/ items: ${count || 0}`);
  console.log(`📦 Processing batch of ${items?.length || 0} items\n`);

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
      const vId = result.vehicleId ? result.vehicleId.substring(0, 8) : 'n/a';
      console.log(`    ✅ Created/Updated vehicle: ${vId}...`);
    } else {
      failCount++;
      console.log(`    ❌ ${result.error?.substring(0, 50)}`);
    }

    // Progress update every 10 items
    if (processed % 10 === 0) {
      console.log(`\n--- Progress: ${processed}/${items.length} (✅${successCount} ❌${failCount}) ---\n`);
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
  console.log(`   Success rate: ${((successCount / processed) * 100).toFixed(1)}%`);

  // Check remaining
  const { count: remaining } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .like('listing_url', '%bringatrailer.com/listing/%');

  console.log(`   BaT /listing/ items remaining: ${remaining || 0}`);

  // Update vehicle count
  const { count: totalVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });

  const { count: batVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .ilike('discovery_url', '%bringatrailer%');

  console.log(`\n   Total vehicles: ${totalVehicles}`);
  console.log(`   BaT vehicles: ${batVehicles}`);
}

main().catch(console.error);
