/**
 * Check what's in the pending queue
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== PENDING QUEUE ANALYSIS ===\n');

  // Get pending items
  const { data: pending } = await supabase
    .from('import_queue')
    .select('listing_url, listing_title, created_at')
    .eq('status', 'pending')
    .limit(1500);

  // Categorize by source
  const sources: Record<string, number> = {};
  for (const item of pending || []) {
    const url = item.listing_url || '';
    let source = 'other';
    if (url.includes('bringatrailer.com')) source = 'bat';
    else if (url.includes('carsandbids.com')) source = 'cab';
    else if (url.includes('craigslist')) source = 'craigslist';
    else if (url.includes('mecum.com')) source = 'mecum';
    else if (url.includes('classic.com')) source = 'classic';
    else if (url.includes('ksl.com')) source = 'ksl';

    sources[source] = (sources[source] || 0) + 1;
  }

  console.log('Pending items by source:');
  Object.entries(sources)
    .sort((a, b) => b[1] - a[1])
    .forEach(([src, cnt]) => console.log(`  ${src.padEnd(12)}: ${cnt}`));

  console.log(`\nTotal pending: ${pending?.length || 0}`);

  // Show sample BaT items
  const batItems = (pending || []).filter(p => p.listing_url?.includes('bringatrailer.com'));
  if (batItems.length > 0) {
    console.log('\nSample BaT items:');
    batItems.slice(0, 5).forEach(item => {
      console.log(`  ${item.listing_url?.substring(0, 70)}...`);
    });
  }

  // Show sample other items
  const otherItems = (pending || []).filter(p => !p.listing_url?.includes('bringatrailer.com') && !p.listing_url?.includes('ksl.com'));
  if (otherItems.length > 0) {
    console.log('\nSample other items:');
    otherItems.slice(0, 5).forEach(item => {
      console.log(`  ${item.listing_url?.substring(0, 70)}...`);
    });
  }
}

main().catch(console.error);
