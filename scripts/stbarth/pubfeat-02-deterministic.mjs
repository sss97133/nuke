// pubfeat-02-deterministic.mjs — Stage 02: deterministic key joins on the
// frontier (org_id null). Auto-accepts only unique, uncontradicted key hits;
// everything else goes to ambiguous.json with a top-8 candidate shortlist for
// the LLM matching tier.
//
// Usage: node scripts/stbarth/pubfeat-02-deterministic.mjs [run-dir]

import {
  buildOrgIndex, deterministicMatch, shortlist,
  latestRunDir, readJson, writeJson,
} from './pubfeat-lib.mjs';

const dir = process.argv[2] ?? latestRunDir();
const frontier = readJson(dir, 'features-frontier.json');
const orgs = readJson(dir, 'organizations-bl.json');
const index = buildOrgIndex(orgs);

const matched = [];
const ambiguous = [];
const methodCounts = {};

for (const f of frontier) {
  const det = deterministicMatch(f, index);
  if (det.decision && det.decision !== 'AMBIGUOUS') {
    const org = index.byId.get(det.decision);
    matched.push({
      feature_id: f.id,
      org_id: det.decision,
      org_business_name: org?.business_name ?? null,
      method: det.method,
      evidence: det.evidence,
      confidence: 0.97,
      org_name_printed: f.org_name_printed,
    });
    methodCounts[det.method] = (methodCounts[det.method] ?? 0) + 1;
  } else {
    ambiguous.push({
      feature: {
        id: f.id,
        org_name_printed: f.org_name_printed,
        category: f.category,
        feature_kind: f.feature_kind,
        page: f.page,
        printed_page: f.printed_page,
        details: f.details,
      },
      deterministic_state: det.decision ?? 'NO_KEYS',
      key_evidence: det.evidence,
      shortlist: shortlist(f, index, 8),
    });
  }
}

writeJson(dir, 'matches-deterministic.json', matched);
writeJson(dir, 'ambiguous.json', ambiguous);

console.log(`frontier rows:        ${frontier.length}`);
console.log(`deterministic match:  ${matched.length} (${JSON.stringify(methodCounts)})`);
console.log(`→ LLM tier:           ${ambiguous.length}`);
console.log(`Artifacts → ${dir}/matches-deterministic.json, ambiguous.json`);
