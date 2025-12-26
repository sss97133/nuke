#!/usr/bin/env node
/**
 * Ensure Ingestion is Running
 * Checks and fixes common issues preventing queue processing
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

async function ensureIngestionRunning() {
  console.log('🔍 ENSURING INGESTION IS RUNNING\n');
  console.log('='.repeat(60));
  console.log('');

  let issuesFound = 0;
  let fixesApplied = 0;

  // 1. Check queue status
  console.log('📊 1. Checking queue status...');
  const { count: pendingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const { count: processingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing');

  const { count: failedCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .lt('attempts', 3); // Only count retryable failures

  console.log(`   Pending: ${pendingCount || 0}`);
  const processingMsg = processingCount > 50 ? ' ⚠️  (High - may indicate stuck items)' : '';
  console.log(`   Processing: ${processingCount || 0}${processingMsg}`);
  console.log(`   Failed (retryable): ${failedCount || 0}`);
  console.log('');

  // 2. Unlock stuck processing items
  if (processingCount > 0) {
    console.log('🔓 2. Checking for stuck processing items...');
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const { data: stuckItems } = await supabase
      .from('import_queue')
      .select('id')
      .eq('status', 'processing')
      .not('locked_at', 'is', null)
      .lt('locked_at', thirtyMinutesAgo)
      .limit(100);

    if (stuckItems && stuckItems.length > 0) {
      console.log(`   ⚠️  Found ${stuckItems.length} stuck items`);
      issuesFound++;
      
      const { error: unlockError } = await supabase
        .from('import_queue')
        .update({
          status: 'pending',
          locked_at: null,
          locked_by: null,
          next_attempt_at: new Date().toISOString()
        })
        .eq('status', 'processing')
        .lt('locked_at', thirtyMinutesAgo);

      if (unlockError) {
        console.error(`   ❌ Error unlocking: ${unlockError.message}`);
      } else {
        console.log(`   ✅ Unlocked ${stuckItems.length} stuck items`);
        fixesApplied++;
      }
    } else {
      console.log('   ✅ No stuck items found');
    }
    console.log('');
  }

  // 3. Check if we need to trigger processing
  const totalNeedsProcessing = (pendingCount || 0) + (failedCount || 0);
  
  if (totalNeedsProcessing > 0) {
    console.log('🚀 3. Triggering queue processing...');
    try {
      const { data, error } = await supabase.functions.invoke('process-import-queue', {
        body: {
          batch_size: Math.min(40, totalNeedsProcessing),
          priority_only: false,
          fast_mode: true,
          skip_image_upload: false
        }
      });

      if (error) {
        console.error(`   ❌ Error: ${error.message}`);
        issuesFound++;
      } else {
        console.log('   ✅ Triggered successfully');
        if (data) {
          console.log(`   📊 Processed: ${data.processed || 0}`);
          console.log(`   ✅ Succeeded: ${data.succeeded || 0}`);
          console.log(`   ❌ Failed: ${data.failed || 0}`);
        }
        fixesApplied++;
      }
    } catch (err) {
      console.error(`   ❌ Exception: ${err.message}`);
      issuesFound++;
    }
    console.log('');
  } else {
    console.log('✅ 3. No items need processing');
    console.log('');
  }

  // 4. Check recent vehicle creation rate
  console.log('📈 4. Checking recent activity...');
  const { count: recentVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  console.log(`   Vehicles created (24h): ${recentVehicles || 0}`);
  
  if ((recentVehicles || 0) > 0) {
    console.log('   ✅ Ingestion is active!');
  } else if (totalNeedsProcessing > 0) {
    console.log('   ⚠️  No recent vehicles but items in queue - may need attention');
    issuesFound++;
  } else {
    console.log('   ℹ️  No items to process (this is normal if queue is empty)');
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Issues found: ${issuesFound}`);
  console.log(`Fixes applied: ${fixesApplied}`);
  console.log(`Queue status: ${pendingCount || 0} pending, ${processingCount || 0} processing, ${failedCount || 0} failed (retryable)`);
  console.log(`Recent activity: ${recentVehicles || 0} vehicles created in 24h`);
  console.log('');

  if (issuesFound === 0 && (recentVehicles || 0) > 0) {
    console.log('✅ Everything looks good! Ingestion is running smoothly.');
  } else if (issuesFound > 0) {
    console.log('⚠️  Some issues were found. Check the output above for details.');
    console.log('');
    console.log('💡 Next steps:');
    console.log('   1. Check cron job status in Supabase Dashboard → Database → Cron Jobs');
    console.log('   2. Verify service role key is set in database settings');
    console.log('   3. Check Edge Function logs for errors');
  } else {
    console.log('ℹ️  System is healthy but no items to process at the moment.');
  }
}

ensureIngestionRunning().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

