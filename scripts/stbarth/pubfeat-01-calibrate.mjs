// pubfeat-01-calibrate.mjs — Stage 01: measure matcher quality on the 184
// already-linked features BEFORE anything is written.
//
// Gates (written to calibration-report.json):
//   deterministic precision ≥ 0.98  (of auto-accepts, agree with existing org_id)
//   shortlist recall        ≥ 0.95  (true org appears in the top-8 shortlist)
// Disagreements are printed as evidence cards — they may indicate a wrong
// EXISTING link (the prior pipeline was ~0.95 confidence); they are logged,
// never auto-fixed.
//
// Usage: node scripts/stbarth/pubfeat-01-calibrate.mjs [run-dir]

import {
  buildOrgIndex, deterministicMatch, shortlist,
  latestRunDir, readJson, writeJson,
} from './pubfeat-lib.mjs';

const dir = process.argv[2] ?? latestRunDir();
const calibration = readJson(dir, 'features-calibration.json');
const orgs = readJson(dir, 'organizations-bl.json');
const index = buildOrgIndex(orgs);

let accepts = 0;
let agree = 0;
let shortlistHits = 0;
let shortlistApplicable = 0;
const disagreements = [];
const hardRows = []; // calibration rows the deterministic tier does NOT catch → Opus spot-check corpus

for (const f of calibration) {
  const truth = f.org_id;
  const det = deterministicMatch(f, index);
  const list = shortlist(f, index, 8);

  // Shortlist recall only counts rows whose true org is in the BL slice at all
  if (index.byId.has(truth)) {
    shortlistApplicable++;
    if (list.some((c) => c.id === truth)) shortlistHits++;
  }

  if (det.decision && det.decision !== 'AMBIGUOUS') {
    accepts++;
    if (det.decision === truth) {
      agree++;
    } else {
      const predicted = index.byId.get(det.decision);
      const existing = index.byId.get(truth);
      disagreements.push({
        feature_id: f.id,
        org_name_printed: f.org_name_printed,
        details: f.details,
        method: det.method,
        evidence: det.evidence,
        predicted: predicted
          ? { id: predicted.id, business_name: predicted.business_name, phone: predicted.phone, website: predicted.website }
          : { id: det.decision, note: 'not in BL slice' },
        existing: existing
          ? { id: existing.id, business_name: existing.business_name, phone: existing.phone, website: existing.website }
          : { id: truth, note: 'existing link points outside BL slice' },
      });
    }
  } else {
    hardRows.push({ feature_id: f.id, truth, deterministic: det.decision ?? 'NO_KEYS' });
  }
}

const precision = accepts ? agree / accepts : 0;
const recall = shortlistApplicable ? shortlistHits / shortlistApplicable : 0;
const detCoverage = accepts / calibration.length;

const report = {
  calibration_rows: calibration.length,
  deterministic_accepts: accepts,
  deterministic_agreements: agree,
  deterministic_precision: Number(precision.toFixed(4)),
  deterministic_coverage: Number(detCoverage.toFixed(4)),
  shortlist_applicable: shortlistApplicable,
  shortlist_recall: Number(recall.toFixed(4)),
  truth_outside_bl_slice: calibration.length - shortlistApplicable,
  gates: {
    precision_gate: precision >= 0.98,
    recall_gate: recall >= 0.95,
  },
  gate_passed: precision >= 0.98 && recall >= 0.95,
  disagreements,
  hard_rows_for_opus_spotcheck: hardRows.slice(0, 25),
};

writeJson(dir, 'calibration-report.json', report);

console.log(`calibration rows:        ${report.calibration_rows}`);
console.log(`deterministic accepts:   ${accepts} (coverage ${(detCoverage * 100).toFixed(0)}%)`);
console.log(`deterministic precision: ${(precision * 100).toFixed(1)}%  (gate ≥98: ${report.gates.precision_gate})`);
console.log(`shortlist recall:        ${(recall * 100).toFixed(1)}% of ${shortlistApplicable} applicable  (gate ≥95: ${report.gates.recall_gate})`);
console.log(`truth outside BL slice:  ${report.truth_outside_bl_slice}`);
console.log(`disagreements:           ${disagreements.length}`);
console.log(`GATE_PASSED: ${report.gate_passed}`);
if (disagreements.length) {
  console.log('\n── Disagreement evidence cards ──');
  for (const d of disagreements) {
    console.log(
      `\n[${d.feature_id}] printed="${d.org_name_printed}" via ${d.method} (${d.evidence.join(', ')})\n` +
      `  matcher → ${d.predicted.business_name ?? d.predicted.id}\n` +
      `  existing → ${d.existing.business_name ?? d.existing.id}`
    );
  }
}
