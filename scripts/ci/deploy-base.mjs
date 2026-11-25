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
// No fallback: when no base can be established (API unreadable, no such run in the newest MAX_PAGES pages of 100) or
// the base is not an ancestor of this run's commit (GitHub compare: ahead or identical), the step fails loudly; a silent
// HEAD^ is how #3918's migration was dropped. A base run whose apply step did not succeed is named with a ::warning::.
// Escape (a pre-apply outage longer than the pages scanned leaves no run that applied, and every later run fails
// before applying too): the repo variable DEPLOY_BASE_SHA, read only when no run qualifies, and still held to the
// ancestor test. The operator dispatches the missing migrations by name, sets it to the commit production is
// applied through, re-runs, and clears it; while it is set and unused each run warns.
//
// Usage (in the workflow): BASE=$(node scripts/ci/deploy-base.mjs) ; prints one sha on stdout, notes on stderr, exit 1
// when no safe base exists.

export const APPLY_STEP = /^Apply migrations/;
export const NO_APPLIED_RUN = 'no earlier push run reached its apply step';

// runs: newest first (the API order). stepsByRun(id) -> the steps of that run's jobs, or null when unreadable.
// Returns { sha, run, skipped: [{ id, sha, why }] } or { sha: null, why }.
export async function selectBase(runs, stepsByRun, { currentRunId, currentCreatedAt, branch = 'main' } = {}) {
  const skipped = [];
  for (const r of runs) {
    if (String(r.id) === String(currentRunId)) continue;
    // created before this run; a run created in the same second is earlier only by its smaller id
    if (currentCreatedAt && (r.created_at > currentCreatedAt
        || (r.created_at === currentCreatedAt && !(Number(r.id) < Number(currentRunId))))) continue;
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
  return { sha: null, why: NO_APPLIED_RUN, skipped };
}

// GitHub compare base...head: 'ahead' or 'identical' means base is an ancestor of head (or head itself).
export function isAncestorStatus(status) { return status === 'ahead' || status === 'identical'; }

export const MAX_PAGES = 3;

// api(path) -> parsed JSON (throws on HTTP errors). env: GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA, DEPLOY_BASE_SHA.
// Returns { sha, notes: [], warnings: [] } or { error, notes: [] }.
export async function resolveBase(api, env, { maxPages = MAX_PAGES } = {}) {
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId, GITHUB_SHA: head } = env;
  const escape = (env.DEPLOY_BASE_SHA || '').trim();
  const notes = []; const warnings = [];
  if (!repo || !runId || !head) return { error: 'GITHUB_REPOSITORY, GITHUB_RUN_ID or GITHUB_SHA missing', notes };
  const ancestor = async (sha) => {
    const { status } = await api(`/repos/${repo}/compare/${sha}...${head}`);
    return isAncestorStatus(status) ? null : status;
  };
  let out = { sha: null, why: NO_APPLIED_RUN };
  try {
    const current = await api(`/repos/${repo}/actions/runs/${runId}`);
    const stepsByRun = async (id) => {
      try {
        const { jobs } = await api(`/repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=50`);
        return jobs.flatMap((j) => j.steps || []);
      } catch { return null; }
    };
    for (let page = 1; page <= maxPages && !out.sha; page++) {
      const { workflow_runs: runs } = await api(
        `/repos/${repo}/actions/workflows/supabase-deploy.yml/runs?branch=main&event=push&per_page=100&page=${page}`);
      out = await selectBase(runs || [], stepsByRun, { currentRunId: runId, currentCreatedAt: current.created_at });
      for (const s of out.skipped || []) notes.push(`run ${s.id} (${s.sha.slice(0, 9)}) applied nothing (${s.why}); its files ride this run`);
      if (out.why && out.why.includes('unreadable')) break;
      if (!runs || runs.length < 100) break;
    }
  } catch (e) {
    return { error: e.message, notes };
  }
  if (!out.sha) {
    // the escape answers only 'no run applied'; an unreadable run (a transient 5xx) fails, never falls to a stale sha
    if (out.why !== NO_APPLIED_RUN) return { error: out.why, notes };
    if (!escape) {
      return { error: `${out.why} in the newest ${maxPages * 100} push runs. Nothing is applied. Dispatch the missing migrations by name, then set the repo variable DEPLOY_BASE_SHA to the commit production is applied through, re-run, and clear it`, notes };
    }
    if (!/^[0-9a-f]{40}$/.test(escape)) return { error: `DEPLOY_BASE_SHA is not a full commit sha`, notes };
    let bad;
    try { bad = await ancestor(escape); } catch (e) { return { error: `compare: ${e.message}`, notes }; }
    if (bad) return { error: `DEPLOY_BASE_SHA ${escape.slice(0, 9)} is not an ancestor of ${head.slice(0, 9)} (compare: ${bad})`, notes };
    warnings.push(`no run qualified (${out.why}); diffing from the repo variable DEPLOY_BASE_SHA ${escape.slice(0, 9)}. Clear it once a run applies`);
    return { sha: escape, notes, warnings };
  }
  let bad;
  try { bad = await ancestor(out.sha); } catch (e) { return { error: `compare: ${e.message}`, notes }; }
  if (bad) return { error: `base ${out.sha.slice(0, 9)} (run ${out.run}) is not an ancestor of ${head.slice(0, 9)} (compare: ${bad})`, notes };
  if (out.applied !== 'success') warnings.push(`base run ${out.run} reached its apply step but ended ${out.applied}; its own files are not re-applied (re-dispatch them by name)`);
  if (escape) warnings.push(`the repo variable DEPLOY_BASE_SHA is set but unused (run ${out.run} applied); clear it`);
  notes.push(`run ${out.run} applied through ${out.sha.slice(0, 9)}`);
  return { sha: out.sha, notes, warnings };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const call = async (path) => {
    if (!token) throw new Error('GITHUB_TOKEN missing');
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };
  const r = await resolveBase(call, process.env);
  for (const n of r.notes) console.error(`deploy-base: ${n}`);
  for (const w of r.warnings || []) console.error(`::warning::deploy-base: ${w}`);
  if (r.error) {
    console.error(`::error::deploy-base: ${r.error}.`);
    process.exit(1);
  }
  process.stdout.write(`${r.sha}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
