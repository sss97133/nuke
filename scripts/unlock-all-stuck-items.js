#!/usr/bin/env node
/**
 * Unlock All Stuck Items
 * Resets all items stuck in processing state back to pending
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function unlockAllStuck() {
  console.log('🔓 UNLOCKING ALL STUCK ITEMS\n');
  console.log('='.repeat(60));
  console.log('');

  // Get count of stuck items
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  const { count: stuckCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing')
    .or(`locked_at.is.null,locked_at.lt.${thirtyMinutesAgo}`);

  console.log(`Found ${stuckCount || 0} items in processing state`);
  console.log('');

  if ((stuckCount || 0) === 0) {
    console.log('✅ No stuck items found!');
    return;
  }

  // Unlock all processing items (they'll be retried)
  console.log('Unlocking all processing items...');
  const { error: unlockError, count: unlockedCount } = await supabase
    .from('import_queue')
    .update({
      status: 'pending',
      locked_at: null,
      locked_by: null,
      next_attempt_at: new Date().toISOString()
    })
    .eq('status', 'processing')
    .select('*', { count: 'exact', head: true });

  if (unlockError) {
    console.error(`❌ Error: ${unlockError.message}`);
    process.exit(1);
  }

  console.log(`✅ Unlocked ${stuckCount || 0} items`);
  console.log('');
  console.log('These items will be retried on the next cron run.');
  console.log('You can also manually trigger processing with:');
  console.log('  node scripts/ensure-ingestion-running.js');
}

unlockAllStuck().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

