#!/usr/bin/env npx tsx
/**
 * Repair Agent - Monitors and auto-fixes extraction issues
 * Runs alongside extractor, triggers repairs on failures
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const CHECK_INTERVAL = 60000; // 1 minute
const FAILURE_THRESHOLD = 50; // Alert if >50 failures in last check
const STUCK_THRESHOLD = 300000; // 5 minutes

interface QueueStats {
  pending: number;
  processing: number;
  complete: number;
  failed: number;
  skipped: number;
}

async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
    });
  } catch {}
}

async function getStats(): Promise<QueueStats> {
  const { data } = await supabase
    .from('import_queue')
    .select('status')
    .limit(500000);

  const counts: QueueStats = { pending: 0, processing: 0, complete: 0, failed: 0, skipped: 0 };
  data?.forEach(r => { counts[r.status as keyof QueueStats] = (counts[r.status as keyof QueueStats] || 0) + 1; });
  return counts;
}

async function getRecentFailures(): Promise<{ error: string; count: number }[]> {
  const { data } = await supabase
    .from('import_queue')
    .select('error_message')
    .eq('status', 'failed')
    .gt('processed_at', new Date(Date.now() - CHECK_INTERVAL * 2).toISOString())
    .limit(1000);

  const counts: Record<string, number> = {};
  data?.forEach(r => {
    const key = (r.error_message || 'unknown').slice(0, 50);
    counts[key] = (counts[key] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([error, count]) => ({ error, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

async function clearStaleLocks(): Promise<number> {
  const { data } = await supabase
    .from('import_queue')
    .update({ status: 'pending', locked_at: null, locked_by: null })
    .eq('status', 'processing')
    .lt('locked_at', new Date(Date.now() - STUCK_THRESHOLD).toISOString())
    .select('id');

  return data?.length || 0;
}

async function autoRepairFailures(): Promise<{ type: string; count: number }[]> {
  const repairs: { type: string; count: number }[] = [];

  // 1. Mark duplicates as complete
  const { data: dups } = await supabase
    .from('import_queue')
    .update({ status: 'complete', error_message: null })
    .eq('status', 'failed')
    .like('error_message', '%duplicate key%')
    .select('id');
  if (dups?.length) repairs.push({ type: 'duplicates→complete', count: dups.length });

  // 2. Reset old extractor failures (but NOT Gooding or bad URLs)
  const { data: oldFails } = await supabase
    .from('import_queue')
    .update({ status: 'pending', attempts: 0, error_message: null })
    .eq('status', 'failed')
    .or('error_message.eq.Extraction failed,error_message.eq.extraction failed')
    .not('listing_url', 'like', '%goodingco%')
    .not('error_message', 'eq', 'listing_url is required')
    .select('id');
  if (oldFails?.length) repairs.push({ type: 'old_extractor→retry', count: oldFails.length });

  // 3. Reset quota failures (OpenAI/Firecrawl)
  const { data: quotaFails } = await supabase
    .from('import_queue')
    .update({ status: 'pending', attempts: 0, error_message: null })
    .eq('status', 'failed')
    .or('error_message.ilike.%OpenAI%429%,error_message.ilike.%Firecrawl%402%')
    .select('id');
  if (quotaFails?.length) repairs.push({ type: 'quota_errors→retry', count: quotaFails.length });

  // 4. Reset timeout failures
  const { data: timeouts } = await supabase
    .from('import_queue')
    .update({ status: 'pending', attempts: 0, error_message: null })
    .eq('status', 'failed')
    .like('error_message', '%Timeout%')
    .select('id');
  if (timeouts?.length) repairs.push({ type: 'timeouts→retry', count: timeouts.length });

  // 5. Reset rate limit failures
  const { data: rateLimits } = await supabase
    .from('import_queue')
    .update({ status: 'pending', attempts: 0, error_message: null })
    .eq('status', 'failed')
    .or('error_message.ilike.%RATE_LIMITED%,error_message.ilike.%REDIRECT%')
    .select('id');
  if (rateLimits?.length) repairs.push({ type: 'rate_limits→retry', count: rateLimits.length });

  return repairs;
}

let lastStats: QueueStats | null = null;
let lastFailCount = 0;

async function runCheck() {
  const now = new Date().toISOString().slice(11, 19);
  const stats = await getStats();

  // Calculate progress
  const progress = lastStats
    ? { completed: stats.complete - lastStats.complete, failed: stats.failed - lastStats.failed }
    : { completed: 0, failed: 0 };

  // Clear stale locks
  const clearedLocks = await clearStaleLocks();

  // Get recent failures
  const recentFailures = await getRecentFailures();
  const totalRecentFails = recentFailures.reduce((sum, f) => sum + f.count, 0);

  // Auto-repair
  const repairs = await autoRepairFailures();
  const totalRepaired = repairs.reduce((sum, r) => sum + r.count, 0);

  // Log status
  console.log(`[${now}] pending=${stats.pending} complete=${stats.complete} failed=${stats.failed} | +${progress.completed} done, +${progress.failed} failed`);

  if (clearedLocks > 0) {
    console.log(`  🔓 Cleared ${clearedLocks} stale locks`);
  }

  if (totalRepaired > 0) {
    console.log(`  🔧 Repaired: ${repairs.map(r => `${r.count} ${r.type}`).join(', ')}`);
  }

  if (recentFailures.length > 0 && totalRecentFails > 10) {
    console.log(`  ⚠️  Recent failures: ${recentFailures.map(f => `${f.count}x "${f.error}"`).join(', ')}`);
  }

  // Alert if high failure rate
  if (totalRecentFails > FAILURE_THRESHOLD && totalRecentFails > lastFailCount * 1.5) {
    const msg = `⚠️ <b>High failure rate</b>\n\n` +
      `Pending: ${stats.pending}\n` +
      `Recent failures: ${totalRecentFails}\n\n` +
      `Top errors:\n${recentFailures.map(f => `• ${f.count}x ${f.error}`).join('\n')}\n\n` +
      `Auto-repaired: ${totalRepaired}`;
    await sendTelegram(msg);
  }

  // Alert if queue stalled (no progress)
  if (lastStats && progress.completed === 0 && progress.failed === 0 && stats.pending > 100) {
    console.log(`  🚨 STALLED - no progress!`);
    await sendTelegram(`🚨 <b>Extraction stalled!</b>\n\nPending: ${stats.pending}\nNo progress in last check.`);
  }

  // Alert when complete
  if (stats.pending === 0 && stats.processing === 0 && lastStats && lastStats.pending > 0) {
    const msg = `✅ <b>Extraction complete!</b>\n\n` +
      `Complete: ${stats.complete}\n` +
      `Failed: ${stats.failed}\n` +
      `Skipped: ${stats.skipped}`;
    await sendTelegram(msg);
    console.log(`\n✅ QUEUE EMPTY - Extraction complete!`);
  }

  lastStats = stats;
  lastFailCount = totalRecentFails;
}

async function main() {
  console.log('🔧 Repair Agent started\n');

  // Initial check
  await runCheck();

  // Run every minute
  setInterval(runCheck, CHECK_INTERVAL);
}

main().catch(console.error);
