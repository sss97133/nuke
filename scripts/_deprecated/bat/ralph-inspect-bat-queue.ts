/**
 * Inspect BaT queue items to understand URL patterns
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== INSPECTING BAT QUEUE ===\n');

  // Get sample of pending BaT items
  const { data: items } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer%')
    .limit(20);

  console.log('Sample pending BaT URLs:');
  for (const item of items || []) {
    console.log(`  ${item.listing_url}`);
  }

  // Count by URL patterns
  const { data: allItems } = await supabase
    .from('import_queue')
    .select('listing_url')
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer%')
    .limit(1000);

  const patterns: Record<string, number> = {
    '/listing/': 0,
    '/auctions/': 0,
    '/sold/': 0,
    'other': 0,
  };

  for (const item of allItems || []) {
    const url = item.listing_url || '';
    if (url.includes('/listing/')) patterns['/listing/']++;
    else if (url.includes('/auctions/')) patterns['/auctions/']++;
    else if (url.includes('/sold/')) patterns['/sold/']++;
    else patterns['other']++;
  }

  console.log('\nURL pattern distribution:');
  for (const [pattern, count] of Object.entries(patterns)) {
    console.log(`  ${pattern}: ${count}`);
  }

  // Check valid listing URLs
  const { count: validListings } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .like('listing_url', '%bringatrailer.com/listing/%');

  console.log(`\nURLs matching /listing/ pattern: ${validListings}`);
}

main().catch(console.error);
