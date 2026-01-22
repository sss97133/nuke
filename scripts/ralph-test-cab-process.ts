import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Reset one failed C&B item to pending for testing
  const { data: item, error: selectError } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .like('listing_url', '%carsandbids.com%')
    .eq('status', 'failed')
    .limit(1)
    .single();

  if (!item) {
    console.log('No failed C&B items');
    return;
  }

  console.log('Resetting to pending:', item.listing_url);

  const { error: updateError } = await supabase
    .from('import_queue')
    .update({ status: 'pending', error_message: null, attempts: 0 })
    .eq('id', item.id);

  if (updateError) {
    console.error('Update error:', updateError);
    return;
  }

  console.log('Item reset. Now testing process-import-queue...');

  // Invoke process-import-queue with just this item
  const { data, error } = await supabase.functions.invoke('process-import-queue', {
    body: { batch_size: 1, queue_ids: [item.id] }
  });

  console.log('Result:', JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);

  // Check the queue item status
  const { data: updated } = await supabase
    .from('import_queue')
    .select('status, error_message')
    .eq('id', item.id)
    .single();

  console.log('\nQueue status after:', updated?.status);
  console.log('Error:', updated?.error_message || 'none');
}

main().catch(console.error);
