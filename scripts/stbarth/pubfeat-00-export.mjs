// pubfeat-00-export.mjs — Stage 00: export the working corpus.
// Pulls publication_features (Guest Book 2024) split into frontier (org_id null)
// and calibration (org_id set), plus the BL organizations slice. Writes JSON
// artifacts to a fresh run dir and prints per-key field coverage.
//
// Usage: set -a; source ~/.nuke_env; set +a; node scripts/stbarth/pubfeat-00-export.mjs

import { restClient, featureKeys, orgKeys, runDir, writeJson } from './pubfeat-lib.mjs';

const GUESTBOOK_PUBLICATION_ID = 'c033ba62-8208-4476-9a58-d5df0f30a23d';

const db = restClient();
const dir = runDir();

const features = await db.getAll(
  'publication_features',
  `publication_id=eq.${GUESTBOOK_PUBLICATION_ID}&select=*&order=id`
);
const frontier = features.filter((f) => f.org_id === null);
const calibration = features.filter((f) => f.org_id !== null);

const orgs = await db.getAll(
  'organizations',
  'country=eq.BL&select=id,business_name,name,legal_name,entity_type,business_type,email,phone,website,address,city,country,discovered_via,metadata&order=id'
);

console.log(`features total=${features.length} frontier=${frontier.length} calibration=${calibration.length}`);
console.log(`BL organizations=${orgs.length}`);

// Field-coverage report (drives expectations for deterministic capture)
const cov = (rows, fn) => {
  const n = rows.filter(fn).length;
  return `${n} (${((100 * n) / rows.length).toFixed(0)}%)`;
};
const coverage = {
  frontier: {
    phone: cov(frontier, (f) => featureKeys(f).phones.size > 0),
    instagram: cov(frontier, (f) => !!featureKeys(f).instagram),
    domain: cov(frontier, (f) => featureKeys(f).domains.size > 0),
    name: cov(frontier, (f) => featureKeys(f).names.length > 0),
  },
  calibration: {
    phone: cov(calibration, (f) => featureKeys(f).phones.size > 0),
    instagram: cov(calibration, (f) => !!featureKeys(f).instagram),
    domain: cov(calibration, (f) => featureKeys(f).domains.size > 0),
    name: cov(calibration, (f) => featureKeys(f).names.length > 0),
  },
  organizations: {
    phone: cov(orgs, (o) => orgKeys(o).phones.size > 0),
    instagram: cov(orgs, (o) => !!orgKeys(o).instagram),
    domain: cov(orgs, (o) => orgKeys(o).domains.size > 0),
  },
};
console.log(JSON.stringify(coverage, null, 2));

writeJson(dir, 'features-frontier.json', frontier);
writeJson(dir, 'features-calibration.json', calibration);
writeJson(dir, 'organizations-bl.json', orgs);
writeJson(dir, 'coverage.json', coverage);
writeJson(dir, 'run-meta.json', {
  run_id: dir.split('/').pop(),
  exported_at: new Date().toISOString(),
  publication_id: GUESTBOOK_PUBLICATION_ID,
  counts: { features: features.length, frontier: frontier.length, calibration: calibration.length, orgs: orgs.length },
});

console.log(`\nArtifacts → ${dir}`);
