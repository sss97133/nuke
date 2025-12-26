#!/usr/bin/env node
/**
 * Ingestion Fix Script
 * Attempts to fix common ingestion issues
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

async function fixIngestion() {
  console.log('🔧 FIXING INGESTION ISSUES\n');
  console.log('='.repeat(60));
  console.log('');

  let fixesApplied = 0;

  // Fix 1: Unlock stuck processing items
  console.log('🔓 Fix 1: Unlocking stuck processing items...');
  const { data: stuckItems } = await supabase
    .from('import_queue')
    .select('id')
    .eq('status', 'processing')
    .not('locked_at', 'is', null)
    .limit(100);

  if (stuckItems && stuckItems.length > 0) {
    // Calculate 30 minutes ago
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
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
      console.error('   ❌ Error:', unlockError.message);
    } else {
      console.log(`   ✅ Unlocked ${stuckItems.length} stuck items`);
      fixesApplied++;
    }
  } else {
    console.log('   ✅ No stuck items found');
  }
  console.log('');

  // Fix 2: Manually trigger process-import-queue
  console.log('🚀 Fix 2: Manually triggering process-import-queue...');
  try {
    const { data, error } = await supabase.functions.invoke('process-import-queue', {
      body: {
        batch_size: 20,
        priority_only: false
      }
    });

    if (error) {
      console.error('   ❌ Error:', error.message);
    } else {
      console.log('   ✅ Triggered successfully');
      console.log(`   📊 Result:`, JSON.stringify(data, null, 2));
      fixesApplied++;
    }
  } catch (err) {
    console.error('   ❌ Error:', err.message);
  }
  console.log('');

  // Fix 3: Check and report on queue status
  console.log('📊 Fix 3: Current queue status...');
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
    .eq('status', 'failed');

  console.log(`   Pending: ${pendingCount || 0}`);
  console.log(`   Processing: ${processingCount || 0}`);
  console.log(`   Failed: ${failedCount || 0}`);
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('📋 FIX SUMMARY');
  console.log('='.repeat(60));
  console.log(`Fixes applied: ${fixesApplied}`);
  console.log(`Queue status: ${pendingCount || 0} pending, ${processingCount || 0} processing, ${failedCount || 0} failed`);
  console.log('');

  if (pendingCount > 0) {
    console.log('💡 Next steps:');
    console.log('   1. Check cron job status in Supabase Dashboard → Database → Cron Jobs');
    console.log('   2. Verify service role key is set: SELECT current_setting(\'app.service_role_key\', true);');
    console.log('   3. Check Edge Function logs in Supabase Dashboard → Edge Functions → process-import-queue');
    console.log('   4. Run diagnostics again: node scripts/diagnose-ingestion.js');
  } else {
    console.log('✅ Queue is empty - ingestion is working!');
  }
}

fixIngestion().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

