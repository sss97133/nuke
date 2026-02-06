#!/usr/bin/env npx tsx
/**
 * Autonomous Supervisor
 * Monitors scrapers, sends hourly Telegram updates, manages extraction pipeline
 */

import { createClient } from '@supabase/supabase-js';
import { spawn, exec } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const HOURLY_UPDATE = 60 * 60 * 1000; // 1 hour
const RUNTIME_HOURS = 8;

interface QueueStats {
  pending: number;
  complete: number;
  failed: number;
  processing: number;
}

async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      }),
    });
  } catch {}
}

async function getQueueStats(): Promise<QueueStats> {
  const { data } = await supabase
    .from('import_queue')
    .select('status')
    .limit(500000);

  const counts: QueueStats = { pending: 0, complete: 0, failed: 0, processing: 0 };
  data?.forEach(r => {
    if (r.status in counts) counts[r.status as keyof QueueStats]++;
  });
  return counts;
}

async function getECRStats(): Promise<{ collections: number; users: number; cars: number }> {
  const { data } = await supabase
    .from('import_queue')
    .select('raw_data')
    .eq('raw_data->>source', 'ecr')
    .limit(10000);

  const counts = { collections: 0, users: 0, cars: 0 };
  data?.forEach(r => {
    const type = r.raw_data?.type;
    if (type === 'collection') counts.collections++;
    else if (type === 'user') counts.users++;
    else if (type === 'car') counts.cars++;
  });
  return counts;
}

function isProcessRunning(name: string): Promise<boolean> {
  return new Promise(resolve => {
    exec(`pgrep -f "${name}"`, (err, stdout) => {
      resolve(!!stdout.trim());
    });
  });
}

function startProcess(script: string, logFile: string): void {
  const proc = spawn('dotenvx', ['run', '--', 'npx', 'tsx', `scripts/${script}`], {
    cwd: '/Users/skylar/nuke',
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const fs = require('fs');
  const log = fs.createWriteStream(`/Users/skylar/nuke/logs/${logFile}`, { flags: 'a' });
  proc.stdout?.pipe(log);
  proc.stderr?.pipe(log);
  proc.unref();

  console.log(`Started ${script} (PID: ${proc.pid})`);
}

let startTime = Date.now();
let lastHourlyUpdate = 0;
let hourNumber = 0;

async function runCheck() {
  const now = new Date().toISOString().slice(11, 19);
  const elapsedHours = (Date.now() - startTime) / (1000 * 60 * 60);

  // Check if runtime exceeded
  if (elapsedHours >= RUNTIME_HOURS) {
    await sendTelegram(`✅ <b>Autonomous Mode Complete</b>\n\n⏱ Ran for ${RUNTIME_HOURS} hours\n\nFinal stats coming...`);
    const stats = await getQueueStats();
    const ecr = await getECRStats();
    await sendTelegram(
      `📊 <b>Final Stats</b>\n\n` +
      `<b>Queue:</b>\n` +
      `• Complete: ${stats.complete.toLocaleString()}\n` +
      `• Pending: ${stats.pending.toLocaleString()}\n` +
      `• Failed: ${stats.failed.toLocaleString()}\n\n` +
      `<b>ECR Data:</b>\n` +
      `• Collections: ${ecr.collections}\n` +
      `• Users: ${ecr.users}\n` +
      `• Cars: ${ecr.cars}`
    );
    process.exit(0);
  }

  // Get current stats
  const stats = await getQueueStats();
  console.log(`[${now}] pending=${stats.pending} complete=${stats.complete} failed=${stats.failed}`);

  // Check processes
  const ecrRunning = await isProcessRunning('ecr-full-scraper');
  const repairRunning = await isProcessRunning('repair-agent');
  const extractorRunning = await isProcessRunning('playwright-universal');

  // Restart repair agent if not running
  if (!repairRunning) {
    console.log('  Starting repair-agent...');
    startProcess('repair-agent.ts', 'repair-agent.log');
  }

  // Restart extractor if not running and we have pending work
  if (!extractorRunning && stats.pending > 100) {
    console.log('  Starting playwright-universal...');
    startProcess('playwright-universal.ts', 'playwright-universal.log');
  }

  // Hourly Telegram update
  if (Date.now() - lastHourlyUpdate >= HOURLY_UPDATE) {
    hourNumber++;
    lastHourlyUpdate = Date.now();

    const ecr = await getECRStats();
    const hoursRemaining = Math.round((RUNTIME_HOURS - elapsedHours) * 10) / 10;

    await sendTelegram(
      `⏰ <b>Hour ${hourNumber} Update</b>\n\n` +
      `<b>Queue:</b>\n` +
      `• Complete: ${stats.complete.toLocaleString()}\n` +
      `• Pending: ${stats.pending.toLocaleString()}\n` +
      `• Processing: ${stats.processing}\n\n` +
      `<b>ECR Progress:</b>\n` +
      `• Collections: ${ecr.collections}\n` +
      `• Users: ${ecr.users}\n` +
      `• Cars: ${ecr.cars}\n\n` +
      `<b>Processes:</b>\n` +
      `• ECR Scraper: ${ecrRunning ? '✅' : '⏹'}\n` +
      `• Repair Agent: ${repairRunning ? '✅' : '🔄 restarted'}\n` +
      `• Extractor: ${extractorRunning ? '✅' : stats.pending > 100 ? '🔄 restarted' : '⏹'}\n\n` +
      `⏳ ${hoursRemaining}h remaining`
    );
  }
}

async function main() {
  console.log('🤖 Autonomous Supervisor started\n');
  console.log(`Runtime: ${RUNTIME_HOURS} hours\n`);

  lastHourlyUpdate = Date.now(); // Don't send immediately (already sent startup msg)

  // Initial check
  await runCheck();

  // Run every CHECK_INTERVAL
  setInterval(runCheck, CHECK_INTERVAL);
}

main().catch(console.error);
