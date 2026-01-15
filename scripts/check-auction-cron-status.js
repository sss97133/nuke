#!/usr/bin/env node
/**
 * Check auction scheduler cron job status and recent runs
 * 
 * Usage:
 *   node scripts/check-auction-cron-status.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function formatTime(isoString) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);

  if (diffMins < 1) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ${diffSecs}s ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
  return date.toLocaleString();
}

function getStatusIcon(status) {
  switch (status) {
    case 'succeeded': return '✅';
    case 'failed': return '❌';
    case 'running': return '🔄';
    default: return '⚠️';
  }
}

async function checkCronJobs() {
  console.log('⏰ Auction Cron Job Status Check');
  console.log('='.repeat(70));
  console.log('');

  try {
    // Check auction-scheduler job
    const { data: jobs, error: jobsError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          j.jobid,
          j.jobname,
          j.active,
          j.schedule,
          j.command
        FROM cron.job j
        WHERE j.jobname = 'auction-scheduler'
        LIMIT 1;
      `
    });

    if (jobsError) {
      // Try alternative query without exec_sql
      const { data: jobDetails, error: altError } = await supabase
        .from('cron.job')
        .select('*')
        .eq('jobname', 'auction-scheduler')
        .single();

      if (altError) {
        console.error('❌ Could not query cron.job table. You may need to run this SQL directly:');
        console.error('\n' + getCronStatusSQL());
        return;
      }

      displayJobStatus(jobDetails);
    } else {
      if (jobs && jobs.length > 0) {
        displayJobStatus(jobs[0]);
      } else {
        console.log('⚠️  auction-scheduler job not found');
        console.log('\nTo create it, run the migration:');
        console.log('  20260113195900_native_auction_scheduler_and_readiness.sql');
      }
    }

    // Get recent run details
    console.log('\n' + '='.repeat(70));
    console.log('📊 Recent Run History (Last 10)');
    console.log('='.repeat(70));

    const { data: runs, error: runsError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          jrd.jobid,
          jrd.runid,
          jrd.job_pid,
          jrd.database,
          jrd.username,
          jrd.command,
          jrd.status,
          jrd.return_message,
          jrd.start_time,
          jrd.end_time,
          CASE 
            WHEN jrd.end_time IS NOT NULL AND jrd.start_time IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (jrd.end_time - jrd.start_time))
            ELSE NULL
          END as duration_seconds
        FROM cron.job_run_details jrd
        WHERE jrd.jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auction-scheduler' LIMIT 1)
        ORDER BY jrd.start_time DESC
        LIMIT 10;
      `
    });

    if (runsError) {
      console.log('\n⚠️  Could not fetch run details. Run this SQL directly:');
      console.log('\n' + getRecentRunsSQL());
    } else if (runs && runs.length > 0) {
      console.log('');
      runs.forEach((run, idx) => {
        const duration = run.duration_seconds 
          ? `${Math.round(run.duration_seconds * 100) / 100}s`
          : 'N/A';
        console.log(`${idx + 1}. ${getStatusIcon(run.status)} ${run.status?.toUpperCase() || 'UNKNOWN'}`);
        console.log(`   Started: ${formatTime(run.start_time)}`);
        console.log(`   Duration: ${duration}`);
        if (run.return_message) {
          const msg = run.return_message.length > 100 
            ? run.return_message.substring(0, 100) + '...'
            : run.return_message;
          console.log(`   Message: ${msg}`);
        }
        console.log('');
      });
    } else {
      console.log('\n⚠️  No run history found. Job may not have run yet.');
    }

    // Check active auctions
    console.log('='.repeat(70));
    console.log('🎯 Active Auction Status');
    console.log('='.repeat(70));

    const { data: activeAuctions, error: auctionsError } = await supabase
      .from('vehicle_listings')
      .select('id, sale_type, status, auction_end_time, current_high_bid_cents, bid_count')
      .in('sale_type', ['auction', 'live_auction'])
      .eq('status', 'active')
      .order('auction_end_time', { ascending: true })
      .limit(10);

    if (auctionsError) {
      console.error('❌ Error fetching active auctions:', auctionsError.message);
    } else if (activeAuctions && activeAuctions.length > 0) {
      console.log(`\nFound ${activeAuctions.length} active auction(s):\n`);
      activeAuctions.forEach((auction, idx) => {
        const endTime = auction.auction_end_time 
          ? new Date(auction.auction_end_time).toLocaleString()
          : 'No end time';
        const timeRemaining = auction.auction_end_time
          ? Math.max(0, Math.floor((new Date(auction.auction_end_time) - new Date()) / 1000))
          : null;
        const timeStr = timeRemaining !== null 
          ? `${Math.floor(timeRemaining / 60)}m ${timeRemaining % 60}s`
          : 'N/A';
        
        console.log(`${idx + 1}. ${auction.sale_type} (${auction.status})`);
        console.log(`   ID: ${auction.id}`);
        console.log(`   End time: ${endTime}`);
        console.log(`   Time remaining: ${timeStr}`);
        console.log(`   Current bid: $${(auction.current_high_bid_cents || 0) / 100}`);
        console.log(`   Bid count: ${auction.bid_count || 0}`);
        console.log('');
      });
    } else {
      console.log('\n✅ No active auctions found.');
    }

    // Check timer extensions
    console.log('='.repeat(70));
    console.log('🔄 Recent Timer Extensions (Last 10)');
    console.log('='.repeat(70));

    const { data: extensions, error: extError } = await supabase
      .from('auction_timer_extensions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (extError) {
      if (extError.code === '42P01') {
        console.log('\n⚠️  auction_timer_extensions table does not exist yet.');
        console.log('   Run migration: 20260115000000_auction_timer_extension_audit.sql');
      } else {
        console.error('❌ Error:', extError.message);
      }
    } else if (extensions && extensions.length > 0) {
      console.log('');
      extensions.forEach((ext, idx) => {
        console.log(`${idx + 1}. ${formatTime(ext.created_at)}`);
        console.log(`   Type: ${ext.extension_type}`);
        console.log(`   Extension: +${ext.extension_seconds}s`);
        console.log(`   Listing: ${ext.listing_id.substring(0, 8)}...`);
        console.log('');
      });
    } else {
      console.log('\n✅ No timer extensions logged yet.');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

function displayJobStatus(job) {
  console.log('Job Configuration:');
  console.log(`  Name: ${job.jobname || 'N/A'}`);
  console.log(`  Active: ${job.active ? '✅ Yes' : '❌ No'}`);
  console.log(`  Schedule: ${job.schedule || 'N/A'}`);
  console.log(`  Job ID: ${job.jobid || 'N/A'}`);
  if (job.command) {
    const cmdPreview = job.command.length > 100 
      ? job.command.substring(0, 100) + '...'
      : job.command;
    console.log(`  Command: ${cmdPreview}`);
  }
}

function getCronStatusSQL() {
  return `
SELECT 
  j.jobid,
  j.jobname,
  j.active,
  j.schedule,
  jrd.start_time as last_run,
  jrd.status as last_status,
  jrd.return_message as last_message
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT start_time, status, return_message
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
WHERE j.jobname = 'auction-scheduler';
  `.trim();
}

function getRecentRunsSQL() {
  return `
SELECT 
  jrd.start_time,
  jrd.end_time,
  jrd.status,
  jrd.return_message,
  EXTRACT(EPOCH FROM (jrd.end_time - jrd.start_time)) as duration_seconds
FROM cron.job_run_details jrd
WHERE jrd.jobid = (SELECT jobid FROM cron.job WHERE jobname = 'auction-scheduler' LIMIT 1)
ORDER BY jrd.start_time DESC
LIMIT 10;
  `.trim();
}

checkCronJobs();
