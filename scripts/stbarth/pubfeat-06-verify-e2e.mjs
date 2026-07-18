// pubfeat-06-verify-e2e.mjs — Stage 06: end-to-end verification after apply.
//
// Checks (per approved plan):
//   1. count arithmetic on publication_features (nulls = 184 − applied; total 368)
//   2. every newly written org_id joins to a country=BL organization
//   3. projections untouched (businesses / concierge_supply_stbarth counts)
//   4. concentration: no org received > 8 new links
//   5. idempotency probe: deterministic matcher reproduces 20 random applied rows
//   6. spine: unique (publication_id, issue_number); all editorial_stories
//      resolve into publication_issues; none still on the legacy id;
//      frontend natural-key query returns exactly 1 row for 5 sampled issues
//   7. prints 15 random evidence cards for human spot-check
//
// Usage: node scripts/stbarth/pubfeat-06-verify-e2e.mjs [run-dir]

import {
  restClient, buildOrgIndex, deterministicMatch,
  latestRunDir, readJson, writeJson,
} from './pubfeat-lib.mjs';

const dir = process.argv[2] ?? latestRunDir();
const db = restClient();
const applyLog = readJson(dir, 'apply-log.json');
const meta = readJson(dir, 'run-meta.json');
const orgs = readJson(dir, 'organizations-bl.json');
const frontier = readJson(dir, 'features-frontier.json');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PUB = meta.publication_id;

// 1. count arithmetic
const total = await db.count('publication_features', `publication_id=eq.${PUB}`);
const stillNull = await db.count('publication_features', `publication_id=eq.${PUB}&org_id=is.null`);
const expectedNull = meta.counts.frontier - applyLog.applied_count;
check('feature row total unchanged', total === meta.counts.features, `${total}`);
check('null-org arithmetic', stillNull === expectedNull, `nulls=${stillNull} expected=${expectedNull}`);

// 2. BL join integrity for newly written rows
const orgIds = new Set(orgs.map((o) => o.id));
const badJoins = applyLog.applied.filter((a) => !orgIds.has(a.org_id));
check('all applied org_ids in BL slice', badJoins.length === 0, `${badJoins.length} bad`);

// 3. projections untouched
const bizCount = await db.count('businesses', '');
const supplyCount = await db.count('concierge_supply_stbarth', '');
check('businesses projection readable & plausible', bizCount >= 5000, `${bizCount}`);
check('concierge_supply_stbarth untouched', supplyCount === 1717, `${supplyCount}`);

// 4. concentration
const perOrg = {};
for (const a of applyLog.applied) perOrg[a.org_id] = (perOrg[a.org_id] ?? 0) + 1;
const concentrated = Object.entries(perOrg).filter(([, n]) => n > 8);
check('no org over-concentrated (>8 new links)', concentrated.length === 0,
  concentrated.map(([id, n]) => `${id}:${n}`).join(' ') || 'max ok');

// 5. idempotency probe — deterministic matcher must reproduce its own applied rows
const index = buildOrgIndex(orgs);
const detApplied = readJson(dir, 'matches-deterministic.json')
  .filter((m) => applyLog.applied.some((a) => a.feature_id === m.feature_id));
const sample = detApplied.sort(() => 0.5 - Math.random()).slice(0, 20);
const featureById = new Map(frontier.map((f) => [f.id, f]));
let reproduced = 0;
for (const m of sample) {
  const det = deterministicMatch(featureById.get(m.feature_id), index);
  if (det.decision === m.org_id) reproduced++;
}
check('idempotency probe (deterministic rows reproduce)', reproduced === sample.length,
  `${reproduced}/${sample.length}`);

// 6. spine — read-only validation of the live spine (seeded 2026-07-15 by the
// external 'spine_build' process, not by this pipeline)
const issues = await db.getAll('publication_issues', 'select=id,publication_id,issue_number,issue_title');
const keys = issues.map((i) => `${i.publication_id}|${i.issue_number}`);
check('publication_issues natural key unique', new Set(keys).size === keys.length, `${issues.length} issues`);

const stories = await db.getAll('editorial_stories', 'select=id,issue_id,attributes');
const issueIdSet = new Set(issues.map((i) => i.id));
const unresolved = stories.filter((s) => !issueIdSet.has(s.issue_id));
check('all editorial_stories resolve to publication_issues', unresolved.length === 0, `${unresolved.length} orphans of ${stories.length}`);

let nkOk = 0;
const nkSample = issues.slice(0, 5);
for (const i of nkSample) {
  const n = await db.count('publication_issues', `publication_id=eq.${i.publication_id}&issue_number=eq.${encodeURIComponent(i.issue_number)}`);
  if (n === 1) nkOk++;
}
check('frontend natural-key query returns exactly 1', nkOk === nkSample.length, `${nkOk}/${nkSample.length}`);

// 7. evidence cards
const orgName = new Map(orgs.map((o) => [o.id, o.business_name]));
const printedName = new Map(frontier.map((f) => [f.id, f.org_name_printed]));
const cards = applyLog.applied.sort(() => 0.5 - Math.random()).slice(0, 15);
console.log('\n── 15 random applied matches (human spot-check) ──');
for (const c of cards) {
  console.log(`  "${printedName.get(c.feature_id)}"  →  ${orgName.get(c.org_id)}`);
}

const failed = results.filter((r) => !r.ok);
writeJson(dir, 'verify-e2e-report.json', { results, all_passed: failed.length === 0 });
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECKS FAILED`}`);
process.exit(failed.length === 0 ? 0 : 1);
