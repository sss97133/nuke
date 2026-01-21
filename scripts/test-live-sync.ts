import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function testLiveSync() {
  // The Mercedes-Benz 300E ending soon
  const externalListingId = 'e2e3ca79-1123-4fcd-83c9-4c3b04825633';

  console.log('=== TESTING LIVE SYNC ===\n');
  console.log(`Syncing listing: ${externalListingId}`);

  // Get current state
  const { data: before } = await supabase
    .from('external_listings')
    .select('*')
    .eq('id', externalListingId)
    .single();

  console.log('\n--- BEFORE SYNC ---');
  console.log(`  Current Bid: $${before?.current_bid?.toLocaleString()}`);
  console.log(`  Bid Count: ${before?.bid_count}`);
  console.log(`  Watchers: ${before?.watcher_count}`);
  console.log(`  Status: ${before?.listing_status}`);
  console.log(`  Last Synced: ${before?.last_synced_at}`);

  // Trigger sync
  console.log('\n--- TRIGGERING SYNC ---');
  const start = Date.now();

  const { data, error } = await supabase.functions.invoke('sync-bat-listing', {
    body: { externalListingId }
  });

  const elapsed = Date.now() - start;

  if (error) {
    console.error('Sync failed:', error);
    return;
  }

  console.log(`Sync completed in ${elapsed}ms`);
  console.log('Response:', JSON.stringify(data, null, 2));

  // Get updated state
  const { data: after } = await supabase
    .from('external_listings')
    .select('*')
    .eq('id', externalListingId)
    .single();

  console.log('\n--- AFTER SYNC ---');
  console.log(`  Current Bid: $${after?.current_bid?.toLocaleString()}`);
  console.log(`  Bid Count: ${after?.bid_count}`);
  console.log(`  Watchers: ${after?.watcher_count}`);
  console.log(`  Status: ${after?.listing_status}`);
  console.log(`  Last Synced: ${after?.last_synced_at}`);

  // Show changes
  console.log('\n--- CHANGES ---');
  if (before?.current_bid !== after?.current_bid) {
    console.log(`  Bid: $${before?.current_bid?.toLocaleString()} → $${after?.current_bid?.toLocaleString()}`);
  }
  if (before?.bid_count !== after?.bid_count) {
    console.log(`  Bid Count: ${before?.bid_count} → ${after?.bid_count}`);
  }
  if (before?.watcher_count !== after?.watcher_count) {
    console.log(`  Watchers: ${before?.watcher_count} → ${after?.watcher_count}`);
  }
}

testLiveSync().catch(console.error);
