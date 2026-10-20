#!/usr/bin/env node
// Jobs that failed and then passed on a rerun of the same commit: the flake list for the next loop.
// Reads GitHub Actions through the signed-in gh CLI; writes nothing.
//
//   node scripts/ci/flake-report.mjs                    # last 24 hours, newest 200 runs
//   node scripts/ci/flake-report.mjs --hours 72 --limit 500
//   node scripts/ci/flake-report.mjs --logs             # also read each failed attempt's log for its first error
//   node scripts/ci/flake-report.mjs --json             # machine-readable rows
//
// A rerun-passed job: one run (one head commit), the same job name, a failed attempt followed by a successful one.
// A job re-pushed instead of rerun is invisible here; a rerun that failed again is reported as still-failing.
// Signatures name the failing contract or test with ids, numbers and timings stripped, so repeats group together.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const FAILED = new Set(['failure', 'timed_out']);

export function parseArgs(argv) {
  const opts = { hours: 24, limit: 200, logs: false, json: false, repo: process.env.GITHUB_REPOSITORY || 'sss97133/nuke' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hours') opts.hours = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--logs') opts.logs = true;
    else if (a === '--json') opts.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!(opts.hours > 0) || !(opts.limit > 0)) throw new Error('--hours and --limit must be positive');
  return opts;
}

// attempts: [{ attempt, jobs: [{ id, name, conclusion }] }] for one run, any order.
// Returns one row per job name that failed in some attempt: rerun-passed when a later attempt succeeded.
export function classifyAttempts(attempts) {
  const byName = new Map();
  for (const { attempt, jobs } of [...attempts].sort((a, b) => a.attempt - b.attempt)) {
    for (const job of jobs) {
      if (!byName.has(job.name)) byName.set(job.name, []);
      byName.get(job.name).push({ attempt, id: job.id, conclusion: job.conclusion });
    }
  }
  const rows = [];
  for (const [name, seen] of byName) {
    const firstFail = seen.find(s => FAILED.has(s.conclusion));
    if (!firstFail) continue;
    const laterPass = seen.find(s => s.attempt > firstFail.attempt && s.conclusion === 'success');
    rows.push({ job: name, outcome: laterPass ? 'rerun-passed' : 'still-failing', failedJobId: firstFail.id,
      failedAttempt: firstFail.attempt, passedAttempt: laterPass ? laterPass.attempt : null });
  }
  return rows;
}

export function normalize(line) {
  return line
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{12,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, 'N')
    .replace(/(Got \(N\)): .*/, '$1: <title>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// The first meaningful error in a job log. A database contract names its file and the assertion that raised;
// a vitest run names the test file; anything else falls back to the first ##[error] annotation.
export function failureSignature(log) {
  const lines = log.split('\n').map(l => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[0-9;]*m/g, ''));
  for (let i = 0; i < lines.length; i++) {
    const contract = lines[i].match(/^##\[error\](test_\w+\.sql) failed/);
    if (!contract) continue;
    for (let j = i - 1; j >= 0 && j > i - 400; j--) {
      const raised = lines[j].match(/^psql:(\S+?\.sql):\d+: ERROR:\s+(.*)/);
      if (raised) return normalize(`${contract[1]}: ${raised[1].replace(/^supabase\/sql\//, '')}: ${raised[2]}`);
    }
    return normalize(contract[1]);
  }
  const vitest = lines.find(l => /^\s*FAIL\s+\S+\.(test|spec)\.[jt]sx?\b/.test(l));
  if (vitest) return normalize(vitest.replace(/^\s*FAIL\s+/, 'vitest '));
  const annotation = lines.find(l => l.startsWith('##[error]') && !/Process completed with exit code/.test(l));
  if (annotation) return normalize(annotation.slice('##[error]'.length));
  return 'unknown';
}

export function rank(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.workflow} / ${r.job}\t${r.signature || ''}`;
    if (!groups.has(key)) groups.set(key, { workflow: r.workflow, job: r.job, signature: r.signature || null, count: 0, runs: [] });
    const g = groups.get(key); g.count += 1; g.runs.push(r.runId);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.job.localeCompare(b.job));
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function listRuns(repo, since, limit) {
  const runs = [];
  for (let page = 1; runs.length < limit; page++) {
    const body = JSON.parse(gh(['api', `repos/${repo}/actions/runs?per_page=100&page=${page}&created=>=${since}`]));
    runs.push(...body.workflow_runs);
    if (body.workflow_runs.length < 100) break;
  }
  return runs.slice(0, limit);
}

function attemptJobs(repo, runId, attempt) {
  const body = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`]));
  return body.jobs.map(j => ({ id: j.id, name: j.name, conclusion: j.conclusion }));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - opts.hours * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const runs = listRuns(opts.repo, since, opts.limit);
  const rows = [];
  for (const run of runs.filter(r => r.run_attempt > 1)) {
    const attempts = [];
    for (let n = 1; n <= run.run_attempt; n++) attempts.push({ attempt: n, jobs: attemptJobs(opts.repo, run.id, n) });
    for (const row of classifyAttempts(attempts)) {
      const out = { ...row, workflow: run.name, runId: run.id, branch: run.head_branch, sha: run.head_sha.slice(0, 7), created: run.created_at };
      if (opts.logs) {
        try { out.signature = failureSignature(gh(['api', `repos/${opts.repo}/actions/jobs/${row.failedJobId}/logs`])); }
        catch { out.signature = 'log unavailable'; }
      }
      rows.push(out);
    }
  }
  const flaky = rows.filter(r => r.outcome === 'rerun-passed');
  if (opts.json) { console.log(JSON.stringify({ since, runs: runs.length, rerunRuns: runs.filter(r => r.run_attempt > 1).length, rows, ranked: rank(flaky) }, null, 1)); return; }
  console.log(`flake report · ${opts.repo} · since ${since} · ${runs.length} runs, ${runs.filter(r => r.run_attempt > 1).length} rerun`);
  if (!flaky.length) console.log('no rerun-passed jobs in this window');
  for (const g of rank(flaky)) console.log(`${String(g.count).padStart(3)}  ${g.workflow} / ${g.job}${g.signature ? `\n       ${g.signature}` : ''}\n       runs ${g.runs.join(' ')}`);
  const still = rows.filter(r => r.outcome === 'still-failing');
  if (still.length) console.log(`\n${still.length} rerun job(s) failed again (not flakes, or flaky twice): ${[...new Set(still.map(r => r.job))].join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
