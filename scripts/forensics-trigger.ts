#!/usr/bin/env npx tsx
/**
 * Forensics Trigger - Universal launcher for forensics processing
 *
 * Usage:
 *   npx tsx scripts/forensics-trigger.ts status          # Queue status
 *   npx tsx scripts/forensics-trigger.ts local           # Start 1 local worker
 *   npx tsx scripts/forensics-trigger.ts parallel [n]    # Start n parallel workers (default 3)
 *   npx tsx scripts/forensics-trigger.ts cloud           # Call cloud endpoint for status
 *   npx tsx scripts/forensics-trigger.ts flagged         # Show flagged alerts
 *   npx tsx scripts/forensics-trigger.ts analyze <url>   # Analyze specific video
 */

import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CLOUD_URL = `${process.env.VITE_SUPABASE_URL}/functions/v1/forensics-process-broadcast`;

async function showStatus() {
  const { data: queue } = await supabase
    .from('broadcast_backfill_queue')
    .select('*')
    .order('priority', { ascending: false });

  const { count: forensicsCount } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true })
    .not('forensics_data', 'is', null);

  const { count: flaggedCount } = await supabase
    .from('auction_events')
    .select('*', { count: 'exact', head: true })
    .not('forensics_data', 'is', null)
    .gt('forensics_data->alertScore', 30);

  const pending = queue?.filter(q => q.status === 'pending').length || 0;
  const processing = queue?.filter(q => q.status === 'processing').length || 0;
  const completed = queue?.filter(q => q.status === 'completed').length || 0;
  const totalHours = Math.round((queue || []).reduce((s, i) => s + (i.duration_seconds || 0), 0) / 3600);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FORENSICS STATUS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Queue: ${queue?.length || 0} broadcasts (${totalHours} hours)`);
  console.log(`  Pending: ${pending} | Processing: ${processing} | Completed: ${completed}`);
  console.log(`\nForensics Data:`);
  console.log(`  Vehicles analyzed: ${forensicsCount}`);
  console.log(`  Flagged alerts: ${flaggedCount}`);
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('Trigger commands:');
  console.log('  npx tsx scripts/forensics-trigger.ts local      # 1 worker');
  console.log('  npx tsx scripts/forensics-trigger.ts parallel 5 # 5 workers');
  console.log('  npx tsx scripts/forensics-trigger.ts flagged    # View alerts');
}

async function showFlagged() {
  const { data: flagged } = await supabase
    .from('auction_events')
    .select(`
      id, lot_number, estimate_low, estimate_high, winning_bid,
      forensics_data,
      vehicles(id, year, make, model)
    `)
    .not('forensics_data', 'is', null)
    .gt('forensics_data->alertScore', 30)
    .order('forensics_data->alertScore', { ascending: false })
    .limit(20);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FLAGGED ALERTIES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!flagged?.length) {
    console.log('No flagged alerts found.');
    return;
  }

  for (const f of flagged) {
    const v = f.vehicles as any;
    const fd = f.forensics_data as any;
    console.log(`🚨 ${v?.year} ${v?.make} ${v?.model}`);
    console.log(`   Score: ${fd?.alertScore} | Duration: ${fd?.duration?.toFixed(0)}s | Bids: ${fd?.bidCount}`);
    if (f.estimate_low && f.estimate_high) {
      console.log(`   Estimate: $${(f.estimate_low/1000).toFixed(0)}K-$${(f.estimate_high/1000).toFixed(0)}K`);
    }
    if (f.winning_bid) {
      console.log(`   Final: $${f.winning_bid.toLocaleString()}`);
    }
    if (fd?.alerts?.length) {
      console.log(`   Reasons: ${fd.alerts.join('; ')}`);
    }
    console.log('');
  }
}

function startLocal() {
  console.log('\nStarting local worker...\n');
  const worker = spawn('npx', ['tsx', 'scripts/broadcast-backfill-worker.ts', '--all'], {
    cwd: '/Users/skylar/nuke',
    stdio: 'inherit',
    env: process.env,
  });
  worker.on('exit', (code) => process.exit(code || 0));
}

function startParallel(count: number) {
  console.log(`\nStarting ${count} parallel workers...\n`);
  const worker = spawn('npx', ['tsx', 'scripts/forensics-worker-parallel.ts', `--workers=${count}`], {
    cwd: '/Users/skylar/nuke',
    stdio: 'inherit',
    env: process.env,
  });
  worker.on('exit', (code) => process.exit(code || 0));
}

function analyzeVideo(url: string) {
  console.log(`\nAnalyzing video: ${url}\n`);
  const worker = spawn('npx', ['tsx', 'scripts/auction-forensics-analyzer.ts', url], {
    cwd: '/Users/skylar/nuke',
    stdio: 'inherit',
    env: process.env,
  });
  worker.on('exit', (code) => process.exit(code || 0));
}

async function cloudStatus() {
  try {
    const resp = await fetch(CLOUD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'status' }),
    });
    const data = await resp.json();
    console.log('\nCloud Status:', JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.log('Cloud endpoint not deployed. Deploy with:');
    console.log('  supabase functions deploy forensics-process-broadcast --no-verify-jwt');
  }
}

// Main
const [command, arg] = process.argv.slice(2);

switch (command) {
  case 'status':
    showStatus();
    break;
  case 'local':
    startLocal();
    break;
  case 'parallel':
    startParallel(parseInt(arg) || 3);
    break;
  case 'cloud':
    cloudStatus();
    break;
  case 'flagged':
    showFlagged();
    break;
  case 'analyze':
    if (!arg) {
      console.log('Usage: npx tsx scripts/forensics-trigger.ts analyze <youtube-url>');
      process.exit(1);
    }
    analyzeVideo(arg);
    break;
  default:
    showStatus();
}
