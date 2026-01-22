/**
 * Skip non-vehicle BaT items (go-karts, wheels, signs, memorabilia, etc.)
 * These items don't have years in the URL and aren't actual vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Patterns that indicate non-vehicle items
const NON_VEHICLE_PATTERNS = [
  'go-kart',
  'wheels-',
  'sign-',
  'signs-',
  'luggage-',
  'sculpture-',
  'pedal-car',
  'pinball',
  'gas-pump',
  'neon-',
  'memorabilia',
  'watch-',
  'jacket-',
  'poster-',
  'helmet-',
  'racing-suit',
  'artwork',
  'collectible',
  '/auctions/',  // BaT auction index pages, not listings
];

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       RALPH NON-VEHICLE SKIPPER                    ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Get all pending BaT items
  const { data: items } = await supabase
    .from('import_queue')
    .select('id, listing_url')
    .eq('status', 'pending')
    .ilike('listing_url', '%bringatrailer%');

  if (!items || items.length === 0) {
    console.log('No pending BaT items found');
    return;
  }

  console.log(`Found ${items.length} pending BaT items\n`);

  // Find items to skip
  const toSkip: { id: string; url: string; reason: string }[] = [];

  for (const item of items) {
    const url = item.listing_url?.toLowerCase() || '';

    // Check for non-vehicle patterns
    for (const pattern of NON_VEHICLE_PATTERNS) {
      if (url.includes(pattern)) {
        toSkip.push({ id: item.id, url: item.listing_url, reason: pattern });
        break;
      }
    }

    // Also skip URLs without year pattern (/listing/YYYY-)
    if (!toSkip.find(s => s.id === item.id)) {
      const hasYear = /\/listing\/\d{4}-/.test(url);
      if (!hasYear && url.includes('/listing/')) {
        toSkip.push({ id: item.id, url: item.listing_url, reason: 'no-year-pattern' });
      }
    }
  }

  console.log(`Items to skip: ${toSkip.length}\n`);

  // Show sample
  console.log('Sample items being skipped:');
  for (const item of toSkip.slice(0, 15)) {
    const shortUrl = item.url.split('/listing/')[1] || item.url;
    console.log(`  [${item.reason}] ${shortUrl}`);
  }

  if (toSkip.length === 0) {
    console.log('\nNo items to skip!');
    return;
  }

  // Skip them
  console.log('\nSkipping items...');
  const ids = toSkip.map(t => t.id);

  // Process in batches
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { error } = await supabase
      .from('import_queue')
      .update({
        status: 'skipped',
        updated_at: new Date().toISOString(),
        raw_data: { skipped_reason: 'non-vehicle-item', skipped_by: 'ralph' }
      })
      .in('id', batch);

    if (error) {
      console.error('Error skipping batch:', error.message);
    } else {
      console.log(`  Skipped batch ${Math.floor(i/BATCH) + 1} (${batch.length} items)`);
    }
  }

  console.log(`\n✅ Skipped ${toSkip.length} non-vehicle items`);

  // Final count
  const { count: remaining } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .like('listing_url', '%bringatrailer.com/listing/%');

  console.log(`\nRemaining valid BaT /listing/ items: ${remaining}`);
}

main().catch(console.error);
