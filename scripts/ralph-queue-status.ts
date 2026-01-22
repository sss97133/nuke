/**
 * Quick queue status check
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== QUEUE STATUS ===\n');

  // Status counts
  const statuses = ['pending', 'processing', 'complete', 'completed', 'failed', 'skipped'];
  for (const status of statuses) {
    const { count } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', status);
    if (count && count > 0) {
      console.log(`${status.padEnd(12)}: ${(count || 0).toLocaleString()}`);
    }
  }

  // BaT breakdown
  console.log('\n=== BaT ITEMS ===');
  for (const status of statuses) {
    const { count } = await supabase
      .from('import_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
      .ilike('listing_url', '%bringatrailer%');
    if (count && count > 0) {
      console.log(`BaT ${status.padEnd(10)}: ${(count || 0).toLocaleString()}`);
    }
  }

  // Check recent completions
  console.log('\n=== RECENT COMPLETIONS (last 5) ===');
  const { data: recent } = await supabase
    .from('import_queue')
    .select('id, listing_url, status, updated_at')
    .or('status.eq.complete,status.eq.completed')
    .order('updated_at', { ascending: false })
    .limit(5);

  for (const item of recent || []) {
    const url = item.listing_url?.split('/').slice(-2).join('/') || item.listing_url;
    console.log(`  ${item.status} - ${url}`);
  }

  // Check total vehicles
  console.log('\n=== VEHICLES ===');
  const { count: totalVehicles } = await supabase.from('vehicles').select('*', { count: 'exact', head: true });
  console.log(`Total vehicles: ${(totalVehicles || 0).toLocaleString()}`);

  const { count: batVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .ilike('discovery_url', '%bringatrailer%');
  console.log(`BaT vehicles: ${(batVehicles || 0).toLocaleString()}`);
}

main().catch(console.error);
