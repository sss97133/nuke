#!/usr/bin/env node
// Fails a pull request that adds a migration whose version (the digits before the first underscore) another open pull
// request already adds. migration-versions-vs-main.sh catches a collision with main only; two open PRs that each pass
// it collide once both merge, and lanes kept picking the same round minute (2026-11-25: #3962 took #3957's
// 20261126001000, #3959 and #3960 both held 20261125221500).
//
// Who fails: the PR being checked, on any collision. The check runs on a push, so the PR checked is the one that
// pushed the version last, and it renumbers; the other PR's earlier run stays green. A collision with a lower-numbered
// PR and one with a higher-numbered PR both fail (a warning let a PR push into a version a later-numbered green PR
// already held, and both stay green until one re-runs). If both re-run while they collide, both are red until one
// renumbers: a collision never merges green. The same file path in two PRs (a stacked branch) is not a collision.
// One GraphQL query per 50 open PRs (files read with them; a PR with more than 100 files pages its own files), so the
// REST quota the deploy reads share is not touched.
//
//   GH_TOKEN=... PR=<number> GITHUB_REPOSITORY=owner/name node scripts/ci/migration-versions-vs-open-prs.mjs
// Exit 0: no collision. Exit 1: collision (::error:: lines) or the API could not be read.

// Any digit run: main holds 313 eight-digit versions (20241203_...) beside the fourteen-digit ones.
export const MIGRATION_RE = /^supabase\/migrations\/(\d+)_[^/]+\.sql$/;

/** Versions a PR adds: files added (or renamed into place) directly under supabase/migrations/. */
export function addedVersions(files) {
  const out = new Map();
  for (const f of files) {
    if (!['ADDED', 'RENAMED', 'COPIED'].includes(f.changeType)) continue;
    const m = MIGRATION_RE.exec(f.path);
    if (m) out.set(m[1], f.path);
  }
  return out;
}

/** Collisions for PR `self` among `prs` ([{number, title, files:[{path, changeType}]}]). */
export function collisions(self, prs) {
  const me = prs.find((p) => p.number === self);
  if (!me) return { errors: [], mine: new Map() };
  const mine = addedVersions(me.files);
  const errors = [];
  for (const p of prs) {
    if (p.number === self) continue;
    const theirs = addedVersions(p.files);
    for (const [v, path] of mine) {
      // The same file in both is a stacked branch carrying its parent's migration, not a second claim.
      if (!theirs.has(v) || theirs.get(v) === path) continue;
      errors.push({ version: v, mine: path, other: p.number, theirs: theirs.get(v), later: p.number > self });
    }
  }
  return { errors, mine };
}

const PRS_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { number files(first: 100) { pageInfo { hasNextPage endCursor } nodes { path changeType } } }
    }
  }
}`;
const FILES_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path changeType } } }
  }
}`;

/** Every open PR with all its files. `gql(query, variables)` returns the response's data. */
export async function openPrs(gql, owner, name, { maxPages = 10 } = {}) {
  const prs = [];
  let after = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await gql(PRS_QUERY, { owner, name, after });
    const conn = data.repository.pullRequests;
    for (const n of conn.nodes) {
      const files = [...n.files.nodes];
      let fAfter = n.files.pageInfo.hasNextPage ? n.files.pageInfo.endCursor : null;
      while (fAfter) {
        const fd = await gql(FILES_QUERY, { owner, name, number: n.number, after: fAfter });
        const fc = fd.repository.pullRequest.files;
        files.push(...fc.nodes);
        fAfter = fc.pageInfo.hasNextPage ? fc.pageInfo.endCursor : null;
      }
      prs.push({ number: n.number, files });
    }
    if (!conn.pageInfo.hasNextPage) return prs;
    after = conn.pageInfo.endCursor;
  }
  throw new Error(`more than ${maxPages * 50} open pull requests; raise maxPages`);
}

function githubGql(token) {
  return async (query, variables) => {
    const r = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'migration-version-check' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}`);
    const j = await r.json();
    if (j.errors?.length) throw new Error(`GraphQL: ${j.errors.map((e) => e.message).join('; ')}`);
    return j.data;
  };
}

export async function main(env = process.env, gql = null, log = console) {
  const self = Number(env.PR);
  const [owner, name] = String(env.GITHUB_REPOSITORY || '').split('/');
  if (!Number.isInteger(self) || self <= 0 || !owner || !name) {
    log.error('::error::PR and GITHUB_REPOSITORY are required');
    return 1;
  }
  let prs;
  try {
    prs = await openPrs(gql || githubGql(env.GH_TOKEN), owner, name);
  } catch (e) {
    log.error(`::error::could not read open pull requests: ${e.message}`);
    return 1;
  }
  const { errors, mine } = collisions(self, prs);
  for (const e of errors) {
    log.error(`::error::${e.mine} shares version ${e.version} with open PR #${e.other} (${e.theirs}); renumber this migration (pick an odd minute; check the board and open PRs first)`);
  }
  if (errors.length) return 1;
  log.log(`migration versions unique against ${prs.length - 1} other open PRs (${mine.size} added here)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
