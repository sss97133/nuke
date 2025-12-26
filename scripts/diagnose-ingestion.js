#!/usr/bin/env node
/**
 * Ingestion Diagnostic Script
 * Queries the database to diagnose ingestion failures
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

async function runDiagnostics() {
  console.log('🔍 INGESTION DIAGNOSTICS\n');
  console.log('='.repeat(60));
  console.log('');

  // 1. Import Queue Status
  console.log('📊 1. IMPORT QUEUE STATUS');
  console.log('-'.repeat(60));
  const { data: queueStatus, error: qsError } = await supabase
    .from('import_queue')
    .select('status')
    .then(result => {
      if (result.error) return result;
      // Group by status
      const grouped = (result.data || []).reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {});
      return { data: grouped, error: null };
    });

  if (qsError) {
    console.error('❌ Error:', qsError.message);
  } else {
    console.table(queueStatus);
  }
  console.log('');

  // 2. Pending Items Count
  const { count: pendingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  console.log(`📋 Pending items: ${pendingCount || 0}`);
  console.log('');

  // 3. Failed Items (Recent)
  console.log('⚠️  2. RECENT FAILURES (Last 10)');
  console.log('-'.repeat(60));
  const { data: failedItems, error: fiError } = await supabase
    .from('import_queue')
    .select('listing_url, error_message, attempts, created_at, processed_at')
    .eq('status', 'failed')
    .order('processed_at', { ascending: false })
    .limit(10);

  if (fiError) {
    console.error('❌ Error:', fiError.message);
  } else if (failedItems && failedItems.length > 0) {
    failedItems.forEach((item, idx) => {
      console.log(`\n${idx + 1}. ${item.listing_url}`);
      console.log(`   Error: ${(item.error_message || 'No error message').substring(0, 100)}`);
      console.log(`   Attempts: ${item.attempts || 0}`);
      console.log(`   Created: ${new Date(item.created_at).toLocaleString()}`);
    });
  } else {
    console.log('✅ No recent failures');
  }
  console.log('');

  // 4. Stuck Processing Items
  console.log('🔒 3. STUCK PROCESSING ITEMS');
  console.log('-'.repeat(60));
  const { data: stuckItems, error: siError } = await supabase
    .from('import_queue')
    .select('id, listing_url, locked_at')
    .eq('status', 'processing')
    .not('locked_at', 'is', null)
    .limit(10);
  
  if (siError) {
    console.error('   ❌ Error:', siError.message);
  } else if (stuckItems && stuckItems.length > 0) {
    // Filter items locked more than 30 minutes ago
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const actuallyStuck = stuckItems.filter(item => {
      if (!item.locked_at) return false;
      return new Date(item.locked_at) < thirtyMinutesAgo;
    });
    
    if (actuallyStuck.length > 0) {
      console.log(`⚠️  Found ${actuallyStuck.length} stuck items (locked >30 min)`);
      actuallyStuck.forEach((item, idx) => {
        const lockedAt = item.locked_at ? new Date(item.locked_at) : null;
        const minutesAgo = lockedAt ? Math.floor((Date.now() - lockedAt.getTime()) / 60000) : 'unknown';
        console.log(`   ${idx + 1}. ${item.listing_url} (locked ${minutesAgo} min ago)`);
      });
    } else {
      console.log('✅ No stuck items found (all processing items are recent)');
    }
  } else {
    console.log('✅ No stuck items found');
  }
  console.log('');

  // 5. Recent Vehicle Creations
  console.log('🚗 4. RECENT VEHICLE CREATIONS (Last 24h)');
  console.log('-'.repeat(60));
  const { data: recentVehicles, error: rvError } = await supabase
    .from('vehicles')
    .select('discovery_source')
    .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .then(result => {
      if (result.error) return result;
      const grouped = (result.data || []).reduce((acc, item) => {
        const source = item.discovery_source || 'unknown';
        acc[source] = (acc[source] || 0) + 1;
        return acc;
      }, {});
      return { data: grouped, error: null };
    });

  if (rvError) {
    console.error('❌ Error:', rvError.message);
  } else {
    if (Object.keys(recentVehicles).length === 0) {
      console.log('⚠️  No vehicles created in last 24 hours!');
    } else {
      console.table(recentVehicles);
    }
  }
  console.log('');

  // 6. Source Health
  console.log('🌐 5. SOURCE HEALTH');
  console.log('-'.repeat(60));
  const { data: sources, error: srcError } = await supabase
    .from('scrape_sources')
    .select('domain, source_name, is_active, last_scraped_at, last_successful_scrape, total_listings_found')
    .eq('is_active', true)
    .order('last_scraped_at', { ascending: false, nullsFirst: false })
    .limit(10);

  if (srcError) {
    console.error('❌ Error:', srcError.message);
  } else if (sources && sources.length > 0) {
    sources.forEach((source, idx) => {
      const lastScrape = source.last_scraped_at ? new Date(source.last_scraped_at).toLocaleString() : 'Never';
      const lastSuccess = source.last_successful_scrape ? new Date(source.last_successful_scrape).toLocaleString() : 'Never';
      console.log(`\n${idx + 1}. ${source.domain || source.source_name}`);
      console.log(`   Active: ${source.is_active ? '✅' : '❌'}`);
      console.log(`   Last scraped: ${lastScrape}`);
      console.log(`   Last success: ${lastSuccess}`);
      console.log(`   Total listings: ${source.total_listings_found || 0}`);
    });
  } else {
    console.log('⚠️  No active sources found');
  }
  console.log('');

  // 7. Cron Job Status (via direct SQL if possible)
  console.log('⏰ 6. CRON JOB STATUS');
  console.log('-'.repeat(60));
  console.log('⚠️  Cron job status requires direct database access.');
  console.log('   Run this SQL in Supabase Dashboard → SQL Editor:');
  console.log('');
  console.log('   SELECT jobname, active, schedule, last_run_started_at, last_run_status');
  console.log('   FROM cron.job');
  console.log('   WHERE jobname = \'process-import-queue\';');
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('📋 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Pending items: ${pendingCount || 0}`);
  console.log(`Failed items: ${failedItems?.length || 0}`);
  console.log(`Recent vehicles (24h): ${Object.keys(recentVehicles || {}).reduce((sum, k) => sum + (recentVehicles[k] || 0), 0)}`);
  console.log(`Active sources: ${sources?.length || 0}`);
  console.log('');

  if ((pendingCount || 0) > 0 && (Object.keys(recentVehicles || {}).reduce((sum, k) => sum + (recentVehicles[k] || 0), 0) === 0)) {
    console.log('🚨 ISSUE DETECTED: Items in queue but no vehicles being created!');
    console.log('   Possible causes:');
    console.log('   1. Cron job not running');
    console.log('   2. Service role key not set in database');
    console.log('   3. Edge Function failing');
    console.log('   4. Items stuck in processing state');
    console.log('');
    console.log('   Run the quick fix script: node scripts/fix-ingestion.js');
  }
}

runDiagnostics().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

