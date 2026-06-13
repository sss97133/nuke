#!/usr/bin/env node
/**
 * automation-advisor.mjs — the standing watchdog for Nuke's background jobs.
 *
 * The checks-and-balances that never existed. For every automation we KEEP,
 * it answers the only two questions that matter, in plain English:
 *   1. is it running (or intentionally paused)?
 *   2. is its data ACTUALLY LANDING — did the real table grow recently?
 * Not "did the process exit 0" — whether the work showed up in the database.
 *
 * Design rules (the traps that bit us, baked in):
 *   - Backoff, never storm: one fast liveness probe first; if the DB is
 *     unreachable it reports "can't verify" ONCE and stops — it never hammers
 *     a down database (that retry-storm is what turned slow into down).
 *   - Distinguish PAUSED from BROKEN: a disabled job that's quiet is fine;
 *     a loaded job with zero fresh data is the silent-failure we hunt.
 *   - Watch for runaway logs (the 1 GB extraction-daemon trap).
 *   - Never crash-loop: always exits 0; degrades gracefully on any error.
 *
 * Silent when healthy. Writes ~/.nuke/advisor-report.txt every run; prints a
 * report; the launchd wrapper only surfaces it when something is wrong.
 *
 * Usage:  dotenvx run -- node scripts/automation-advisor.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { statSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const HOME = os.homedir();

// A query that can never hang the watchdog: resolves to {error} on timeout.
async function timed(builder, ms = 8000) {
  let t;
  const timeout = new Promise((res) => { t = setTimeout(() => res({ error: new Error('timeout'), timedOut: true }), ms); });
  const r = await Promise.race([Promise.resolve(builder).then((x) => x).catch((error) => ({ error })), timeout]);
  clearTimeout(t);
  return r;
}

// Count rows in `table` where `tsCol` is within the last `hours`.
async function recentCount({ table, tsCol, hours, filter }) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  let q = supabase.from(table).select('*', { count: 'exact', head: true }).gt(tsCol, since);
  if (filter) q = filter(q);
  const r = await timed(q);
  if (r.error) return { count: null, err: r.timedOut ? 'timeout' : (r.error.message || 'error') };
  return { count: r.count ?? 0 };
}

// launchd loaded? (a label present in `launchctl list` is loaded/running)
function isLoaded(label) {
  try {
    const out = execSync(`launchctl list 2>/dev/null | grep -F ${label} || true`, { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch { return false; }
}

// Newest log under a dir/path, in MB (for the runaway-log trap). 0 if none.
function logMB(globs) {
  let max = 0;
  for (const p of globs) {
    try { const s = statSync(p.replace('~', HOME)); max = Math.max(max, s.size / 1048576); } catch { /* absent */ }
  }
  return Math.round(max);
}

// The KEEP registry: each job + how to prove its data landed. Thresholds are
// first-draft (tune once the DB is back and the table shapes are confirmed);
// any wrong column degrades to "couldn't verify", never a crash.
const JOBS = [
  { label: 'com.nuke.byok-image-analysis', plain: 'AI photo analysis (the burns)',
    land: { table: 'vehicle_observations', tsCol: 'ingested_at', hours: 24 * 7,
            filter: (q) => q.eq('structured_data->>analysis_kind', 'image_deep_byok') },
    proof: 'analyzed images → vehicle_observations',
    logs: ['~/nuke/logs/daily-receipt.log', '~/.nuke/byok.log'] },
  { label: 'com.nuke.fb-sweep-g1', plain: 'Facebook new-vehicle scraper (batch 1)',
    land: { table: 'vehicles', tsCol: 'created_at', hours: 36 }, proof: 'new vehicles', logs: ['~/nuke/logs/fb-sweep-g1.log'] },
  { label: 'com.nuke.fb-sweep-g2', plain: 'Facebook new-vehicle scraper (batch 2)',
    land: { table: 'vehicles', tsCol: 'created_at', hours: 36 }, proof: 'new vehicles', logs: ['~/nuke/logs/fb-sweep-g2.log'] },
  { label: 'com.nuke.fb-sweep-g3', plain: 'Facebook new-vehicle scraper (batch 3)',
    land: { table: 'vehicles', tsCol: 'created_at', hours: 36 }, proof: 'new vehicles', logs: ['~/nuke/logs/fb-sweep-g3.log'] },
  { label: 'com.nuke.fb-sweep-g4', plain: 'Facebook new-vehicle scraper (batch 4)',
    land: { table: 'vehicles', tsCol: 'created_at', hours: 36 }, proof: 'new vehicles', logs: ['~/nuke/logs/fb-sweep-g4.log'] },
  { label: 'com.nuke.fb-enrich', plain: 'fills in listing descriptions',
    land: { table: 'marketplace_listings', tsCol: 'updated_at', hours: 36 }, proof: 'enriched listings', logs: ['~/nuke/logs/fb-enrich.log'] },
  { label: 'com.nuke.poll-feeds', plain: 'Craigslist / Hagerty feed poller',
    land: { table: 'listing_feeds', tsCol: 'last_polled_at', hours: 12 }, proof: 'polled feeds', logs: ['~/nuke/logs/poll-feeds.log'] },
  { label: 'com.nuke.bat-bid-backfill', plain: 'auction bid / comment backfill',
    land: { table: 'vehicle_observations', tsCol: 'ingested_at', hours: 48,
            filter: (q) => q.eq('source_slug', 'bring_a_trailer') }, proof: 'auction detail', logs: ['~/nuke/logs/bat-bid-backfill.log'] },
];

const LOG_RUNAWAY_MB = 100;

async function main() {
  const lines = [];
  const issues = [];
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
  lines.push(`NUKE AUTOMATION ADVISOR — ${ts}`);

  // Liveness probe FIRST. If the DB is down we back off — report once, no storm.
  const probe = await timed(supabase.from('vehicles').select('id', { head: true, count: 'exact' }).limit(1), 8000);
  if (probe.error) {
    lines.push('');
    lines.push('⚠  DATABASE UNREACHABLE — cannot verify any job right now.');
    lines.push('   (Not hammering it. Re-run after service is restored.)');
    issues.push('database unreachable');
    return finish(lines, issues);
  }
  lines.push('✓  database reachable');
  lines.push('');

  for (const j of JOBS) {
    const loaded = isLoaded(j.label);
    const { count, err } = await recentCount(j.land);
    const mb = logMB(j.logs);
    const name = j.plain;

    let status;
    if (err) {
      status = `?  ${name} — couldn't verify (${err}); ${j.proof}`;
    } else if (!loaded) {
      status = `⏸  ${name} — paused; ${count} ${j.proof} landed in last ${j.land.hours}h`;
    } else if (count > 0) {
      status = `✓  ${name} — healthy; ${count} ${j.proof} in last ${j.land.hours}h`;
    } else {
      status = `✗  ${name} — RUNNING BUT NOTHING LANDED in ${j.land.hours}h (silent failure)`;
      issues.push(`${j.label}: running, 0 ${j.proof}`);
    }
    if (mb >= LOG_RUNAWAY_MB) {
      status += `\n   ⚠ runaway log: ${mb} MB`;
      issues.push(`${j.label}: ${mb} MB log`);
    }
    lines.push(status);
  }
  return finish(lines, issues);
}

function finish(lines, issues) {
  lines.push('');
  lines.push(issues.length ? `▲ ${issues.length} issue(s) need attention.` : '✓ all clear — nothing to do.');
  const report = lines.join('\n') + '\n';
  process.stdout.write(report);
  try { mkdirSync(`${HOME}/.nuke`, { recursive: true }); writeFileSync(`${HOME}/.nuke/advisor-report.txt`, report); }
  catch { /* report still printed even if the file write fails */ }
  // Exit 2 when there are issues so the launchd wrapper can choose to surface
  // a notification; never throw — a watchdog must not crash-loop.
  process.exit(issues.length ? 2 : 0);
}

main().catch((e) => {
  process.stdout.write(`advisor error (non-fatal): ${e?.message || e}\n`);
  process.exit(0);
});
