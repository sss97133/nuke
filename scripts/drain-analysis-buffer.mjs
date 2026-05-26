#!/usr/bin/env node
/**
 * Drain Analysis Buffer — flush local-buffered PATCHes to Supabase.
 *
 * Companion to deep-image-analysis.mjs. When Skylar's WiFi is hostile to
 * Supabase, the analysis script appends every PATCH to a local JSONL at
 * ~/nuke-analysis-buffer/pending.jsonl. This script reads that buffer,
 * replays the patches to Supabase, and rewrites the buffer with only the
 * still-unsynced rows.
 *
 * Run when you're on a network that can actually reach Supabase.
 *
 * Usage:
 *   dotenvx run -- node scripts/drain-analysis-buffer.mjs
 *   dotenvx run -- node scripts/drain-analysis-buffer.mjs --dry-run
 *   dotenvx run -- node scripts/drain-analysis-buffer.mjs --concurrency 4
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const concurrency = parseInt(args[args.indexOf('--concurrency') + 1]) || 4;

const BUFFER_DIR = path.join(os.homedir(), 'nuke-analysis-buffer');
const BUFFER_FILE = path.join(BUFFER_DIR, 'pending.jsonl');

// ─── Read buffer ─────────────────────────────────────────────────────────────

async function readBuffer() {
  try {
    const raw = await fs.readFile(BUFFER_FILE, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    return lines.map((l) => {
      try { return JSON.parse(l); }
      catch { return null; }
    }).filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Last-write-wins: if the same (table, id) appears multiple times, keep the
// latest by ts (the file is append-only so order is also chronological).
function dedupLatest(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = `${r.table}|${r.id}`;
    map.set(k, r);
  }
  return Array.from(map.values());
}

// ─── PATCH to Supabase ───────────────────────────────────────────────────────

async function patchOne(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${row.table}?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row.data),
  });
  if (!res.ok) {
    throw new Error(`status ${res.status} ${await res.text()}`);
  }
}

// ─── Concurrency-limited drain ───────────────────────────────────────────────

async function processInParallel(items, fn, maxConcurrent) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        await fn(items[i]);
        results[i] = { ok: true };
      } catch (e) {
        results[i] = { ok: false, error: e.message };
      }
    }
  };
  const workers = Array.from({ length: Math.min(maxConcurrent, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  NUKE ANALYSIS BUFFER DRAIN`);
  console.log(`  ═══════════════════════════════════════`);
  console.log(`  Buffer:      ${BUFFER_FILE}`);
  console.log(`  Concurrency: ${concurrency}${dryRun ? ' (DRY RUN)' : ''}\n`);

  const rows = await readBuffer();
  if (rows.length === 0) {
    console.log('  Nothing to drain.');
    return;
  }
  const latest = dedupLatest(rows);
  console.log(`  Buffered:    ${rows.length} rows (${latest.length} latest-per-id)\n`);

  if (dryRun) {
    const byTable = new Map();
    for (const r of latest) byTable.set(r.table, (byTable.get(r.table) || 0) + 1);
    for (const [t, n] of byTable) console.log(`    ${t}: ${n}`);
    return;
  }

  // Pre-flight: does Supabase respond at all?
  try {
    const probe = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { 'apikey': SUPABASE_KEY },
    });
    if (!probe.ok) throw new Error(`probe status ${probe.status}`);
  } catch (e) {
    console.error(`  Supabase unreachable from this network: ${e.message}`);
    console.error(`  Try a different network (phone tether) or fix WiFi blocking.`);
    process.exit(2);
  }

  let done = 0;
  const total = latest.length;
  const startTs = Date.now();
  const printProgress = () => {
    const elapsed = (Date.now() - startTs) / 1000;
    const rate = done / Math.max(elapsed, 0.1);
    const eta = (total - done) / Math.max(rate, 0.1);
    process.stdout.write(`\r  [${done}/${total}] ${(100 * done / total).toFixed(1)}% | ${eta.toFixed(0)}s left`);
  };

  const results = await processInParallel(latest, async (row) => {
    await patchOne(row);
    done++;
    if (done % 25 === 0 || done === total) printProgress();
  }, concurrency);
  printProgress();
  console.log('');

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  // Rewrite buffer with ONLY the still-failed rows (using their original
  // payloads so a future drain attempt still has the right data).
  const failedKeys = new Set(
    results.map((r, i) => (r.ok ? null : `${latest[i].table}|${latest[i].id}`)).filter(Boolean),
  );
  const remaining = rows.filter((r) => failedKeys.has(`${r.table}|${r.id}`));

  if (remaining.length === 0) {
    await fs.unlink(BUFFER_FILE).catch(() => {});
  } else {
    const tmpFile = BUFFER_FILE + '.tmp';
    await fs.writeFile(tmpFile, remaining.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    await fs.rename(tmpFile, BUFFER_FILE);
  }

  console.log(`\n  ═══════════════════════════════════════`);
  console.log(`  Synced:   ${succeeded}/${total}`);
  console.log(`  Failed:   ${failed} (left in buffer for next run)`);
  console.log(`  Buffer:   ${remaining.length} rows remaining\n`);

  if (failed > 0) {
    console.log(`  First few errors:`);
    results.forEach((r, i) => {
      if (!r.ok && i < 5) console.log(`    ${latest[i].id}: ${r.error}`);
    });
  }
}

main().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
