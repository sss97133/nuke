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
// Fallback: HEAD^ with a ::warning:: when the API cannot be read or no such run is found in the newest page.
//
// Usage (in the workflow): BASE=$(node scripts/ci/deploy-base.mjs) ; prints one sha on stdout, notes on stderr.

export const APPLY_STEP = /^Apply migrations/;

// runs: newest first (the API order). stepsByRun(id) -> the steps of that run's jobs, or null when unreadable.
// Returns { sha, run, skipped: [{ id, sha, why }] } or { sha: null, why }.
export async function selectBase(runs, stepsByRun, { currentRunId, branch = 'main' } = {}) {
  const skipped = [];
  for (const r of runs) {
    if (String(r.id) === String(currentRunId)) continue;
    if (r.event !== 'push' || r.head_branch !== branch) continue;
    const steps = await stepsByRun(r.id);
    if (steps == null) return { sha: null, why: `steps of run ${r.id} unreadable` };
    const apply = steps.find((s) => APPLY_STEP.test(s.name || ''));
    const started = Boolean(apply && apply.started_at && apply.conclusion !== 'skipped' && apply.status !== 'queued');
    if (started) return { sha: r.head_sha, run: r.id, skipped };
    skipped.push({ id: r.id, sha: r.head_sha, why: `${r.conclusion}, apply step ${apply ? apply.conclusion || apply.status : 'absent'}` });
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

async function main() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId } = process.env;
  const fallback = (why) => {
    console.error(`::warning::deploy-base: ${why}; diffing from HEAD^ (a run replaced while pending may be missed)`);
    process.stdout.write('HEAD^\n');
  };
  if (!token || !repo) return fallback('GITHUB_TOKEN or GITHUB_REPOSITORY missing');
  try {
    const { workflow_runs: runs } = await api(
      `/repos/${repo}/actions/workflows/supabase-deploy.yml/runs?branch=main&event=push&per_page=30`, token);
    const stepsByRun = async (id) => {
      try {
        const { jobs } = await api(`/repos/${repo}/actions/runs/${id}/jobs?per_page=20`, token);
        return jobs.flatMap((j) => j.steps || []);
      } catch { return null; }
    };
    const out = await selectBase(runs, stepsByRun, { currentRunId: runId });
    for (const s of out.skipped || []) console.error(`deploy-base: run ${s.id} (${s.sha.slice(0, 9)}) applied nothing (${s.why}); its files ride this run`);
    if (!out.sha) return fallback(out.why);
    console.error(`deploy-base: run ${out.run} applied through ${out.sha.slice(0, 9)}`);
    process.stdout.write(`${out.sha}\n`);
  } catch (e) {
    return fallback(e.message);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
