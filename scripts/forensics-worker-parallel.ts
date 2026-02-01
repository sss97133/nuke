#!/usr/bin/env npx tsx
/**
 * Parallel Forensics Workers
 *
 * Spawns multiple forensics workers to process the backfill queue in parallel.
 *
 * Usage:
 *   npx tsx scripts/forensics-worker-parallel.ts              # 3 workers (default)
 *   npx tsx scripts/forensics-worker-parallel.ts --workers=5  # 5 workers
 *   npx tsx scripts/forensics-worker-parallel.ts --dry-run    # Show what would run
 */

import { spawn, ChildProcess } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const args = process.argv.slice(2);
const workerCount = parseInt(args.find(a => a.startsWith('--workers='))?.split('=')[1] || '3');
const dryRun = args.includes('--dry-run');

const workers: ChildProcess[] = [];

async function getQueueStatus() {
  const { data } = await supabase
    .from('broadcast_backfill_queue')
    .select('*')
    .eq('status', 'pending')
    .order('priority', { ascending: false });

  return data || [];
}

function spawnWorker(id: number): ChildProcess {
  console.log(`[Worker ${id}] Starting...`);

  const worker = spawn('npx', ['tsx', 'scripts/broadcast-backfill-worker.ts', '--all'], {
    cwd: '/Users/skylar/nuke',
    env: { ...process.env, WORKER_ID: String(id) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  worker.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line: string) => {
      if (line.includes('Processing:') || line.includes('✅') || line.includes('⚠️')) {
        console.log(`[Worker ${id}] ${line.trim()}`);
      }
    });
  });

  worker.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg.includes('DeprecationWarning') && !msg.includes('dotenvx')) {
      console.error(`[Worker ${id}] ERROR: ${msg}`);
    }
  });

  worker.on('exit', (code) => {
    console.log(`[Worker ${id}] Exited with code ${code}`);
  });

  return worker;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PARALLEL FORENSICS WORKERS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const pending = await getQueueStatus();
  console.log(`Queue: ${pending.length} broadcasts pending`);
  console.log(`Workers: ${workerCount}`);

  if (pending.length === 0) {
    console.log('\nNo pending broadcasts. Nothing to do.');
    return;
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would process:');
    pending.slice(0, 10).forEach((b, i) => {
      console.log(`  ${i + 1}. [${b.auction_house}] ${b.auction_name} ${b.broadcast_date}`);
    });
    if (pending.length > 10) console.log(`  ... and ${pending.length - 10} more`);
    return;
  }

  console.log('\nStarting workers...\n');

  // Spawn workers
  for (let i = 1; i <= workerCount; i++) {
    workers.push(spawnWorker(i));
    // Stagger starts to avoid race conditions on job claiming
    await new Promise(r => setTimeout(r, 2000));
  }

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down workers...');
    workers.forEach(w => w.kill('SIGTERM'));
    process.exit(0);
  });

  // Wait for all workers to complete
  await Promise.all(workers.map(w => new Promise(resolve => w.on('exit', resolve))));

  console.log('\n✅ All workers completed');
}

main().catch(console.error);
