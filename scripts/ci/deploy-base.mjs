#!/usr/bin/env node
// The commit a push-triggered supabase-deploy run diffs from (migrations added, functions changed).
//
// Why: GitHub keeps one PENDING run per concurrency group; a newer push replaces the pending run even with
// cancel-in-progress false. Diffing HEAD^..HEAD then drops the replaced commit's migrations and functions for good:
// 2026-11-25 10:08Z run 45592124859 (#3918, 3c6fe5af2) was cancelled while pending by #3914's push and its four
// SELECT policies never reached production.
//
// Rule: the base is the head sha of the newest other push run on main whose "Apply migrations" step started (any
// conclusion: success, failure, or cancelled while applying). Runs are not filtered on status=completed: the run before
// this one finished seconds ago and the API may still list it in progress; skipping it would re-apply its files.
// A run that never reached that step (replaced while pending, or failed before it) applied nothing, so its commit's
// files ride the next run. A run that failed while
// applying keeps today's behaviour: its own files are not re-applied (re-dispatch them by name).
// Re-runs: a run keeps its id and created_at when re-run, so only runs created before this one are candidates (a re-run
// of an old commit diffs from the run before it, not from newer runs), and a run's steps are read across all its
// attempts (jobs?filter=all): a run whose first attempt applied and whose re-run is still queued has applied.
// No fallback: when no base can be established (API unreadable, no such run in the newest page) or the base is not an
// ancestor of this run's commit (GitHub compare: ahead or identical), the step fails loudly; a silent HEAD^ is how
// #3918's migration was dropped. A base run whose apply step did not succeed is named with a ::warning::.
//
// Usage (in the workflow): BASE=$(node scripts/ci/deploy-base.mjs) ; prints one sha on stdout, notes on stderr, exit 1
// when no safe base exists.

export const APPLY_STEP = /^Apply migrations/;

// runs: newest first (the API order). stepsByRun(id) -> the steps of that run's jobs, or null when unreadable.
// Returns { sha, run, skipped: [{ id, sha, why }] } or { sha: null, why }.
export async function selectBase(runs, stepsByRun, { currentRunId, currentCreatedAt, branch = 'main' } = {}) {
  const skipped = [];
  for (const r of runs) {
    if (String(r.id) === String(currentRunId)) continue;
    if (currentCreatedAt && !(r.created_at < currentCreatedAt)) continue;
    if (r.event !== 'push' || r.head_branch !== branch) continue;
    const steps = await stepsByRun(r.id);
    if (steps == null) return { sha: null, why: `steps of run ${r.id} unreadable` };
    const applies = steps.filter((s) => APPLY_STEP.test(s.name || ''));
    const started = applies.some((s) => s.started_at && s.conclusion !== 'skipped' && s.status !== 'queued');
    if (started) {
      const ok = applies.some((s) => s.conclusion === 'success');
      return { sha: r.head_sha, run: r.id, applied: ok ? 'success' : applies.map((s) => s.conclusion || s.status).join('/'), skipped };
    }
    const seen = applies.map((s) => s.conclusion || s.status).join('/') || 'absent';
    skipped.push({ id: r.id, sha: r.head_sha, why: `${r.conclusion}, apply step ${seen}` });
  }
  return { sha: null, why: 'no earlier push run reached its apply step in the newest page', skipped };
}

async function api(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// GitHub compare base...head: 'ahead' or 'identical' means base is an ancestor of head (or head itself).
export function isAncestorStatus(status) { return status === 'ahead' || status === 'identical'; }

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId, GITHUB_SHA: head } = process.env;
  const fail = (why) => {
    console.error(`::error::deploy-base: ${why}. No safe diff base, so nothing is applied; re-dispatch the migrations by name.`);
    process.exit(1);
  };
  if (!token || !repo || !runId || !head) return fail('GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID or GITHUB_SHA missing');
  let out;
  try {
    const { workflow_runs: runs } = await api(
      `/repos/${repo}/actions/workflows/supabase-deploy.yml/runs?branch=main&event=push&per_page=30`, token);
    const stepsByRun = async (id) => {
      try {
        const { jobs } = await api(`/repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=50`, token);
        return jobs.flatMap((j) => j.steps || []);
      } catch { return null; }
    };
    const current = await api(`/repos/${repo}/actions/runs/${runId}`, token);
    out = await selectBase(runs, stepsByRun, { currentRunId: runId, currentCreatedAt: current.created_at });
  } catch (e) {
    return fail(e.message);
  }
  for (const s of out.skipped || []) console.error(`deploy-base: run ${s.id} (${s.sha.slice(0, 9)}) applied nothing (${s.why}); its files ride this run`);
  if (!out.sha) return fail(out.why);
  let status;
  try { ({ status } = await api(`/repos/${repo}/compare/${out.sha}...${head}`, token)); } catch (e) { return fail(`compare: ${e.message}`); }
  if (!isAncestorStatus(status)) return fail(`base ${out.sha.slice(0, 9)} (run ${out.run}) is not an ancestor of ${head.slice(0, 9)} (compare: ${status})`);
  if (out.applied !== 'success') console.error(`::warning::deploy-base: base run ${out.run} reached its apply step but ended ${out.applied}; its own files are not re-applied (re-dispatch them by name)`);
  console.error(`deploy-base: run ${out.run} applied through ${out.sha.slice(0, 9)}`);
  process.stdout.write(`${out.sha}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
