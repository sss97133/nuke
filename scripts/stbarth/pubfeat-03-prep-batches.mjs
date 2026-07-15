// pubfeat-03-prep-batches.mjs — Stage 03 prep: split ambiguous.json into
// batch files of 10 for the LLM matcher fleet, and build the Opus
// spot-calibration corpus (hard calibration rows, truth withheld from the
// batch files; truth map emitted separately for the orchestrator's gate).
//
// Usage: node scripts/stbarth/pubfeat-03-prep-batches.mjs [run-dir]

import {
  buildOrgIndex, shortlist, latestRunDir, readJson, writeJson,
} from './pubfeat-lib.mjs';

const dir = process.argv[2] ?? latestRunDir();
const ambiguous = readJson(dir, 'ambiguous.json');
const calibration = readJson(dir, 'features-calibration.json');
const report = readJson(dir, 'calibration-report.json');
const orgs = readJson(dir, 'organizations-bl.json');
const index = buildOrgIndex(orgs);

const BATCH = 10;
let nBatches = 0;
for (let i = 0; i < ambiguous.length; i += BATCH) {
  nBatches++;
  writeJson(dir, `ambiguous-batch-${String(nBatches).padStart(2, '0')}.json`,
    ambiguous.slice(i, i + BATCH));
}

// Spot-calibration corpus: calibration rows the deterministic tier missed.
const hardIds = new Set(report.hard_rows_for_opus_spotcheck.map((r) => r.feature_id));
const spot = calibration
  .filter((f) => hardIds.has(f.id))
  .slice(0, 20)
  .map((f) => ({
    feature: {
      id: f.id,
      org_name_printed: f.org_name_printed,
      category: f.category,
      feature_kind: f.feature_kind,
      page: f.page,
      printed_page: f.printed_page,
      details: f.details,
    },
    shortlist: shortlist(f, index, 8),
  }));

const spotBatches = [];
for (let i = 0; i < spot.length; i += BATCH) {
  const name = `spot-batch-${String(spotBatches.length + 1).padStart(2, '0')}.json`;
  writeJson(dir, name, spot.slice(i, i + BATCH));
  spotBatches.push(name);
}

const truthMap = Object.fromEntries(
  calibration.filter((f) => hardIds.has(f.id)).slice(0, 20).map((f) => [f.id, f.org_id])
);
writeJson(dir, 'spot-truth.json', truthMap);

console.log(JSON.stringify({
  run_dir: dir,
  ambiguous_batches: nBatches,
  ambiguous_rows: ambiguous.length,
  spot_batches: spotBatches.length,
  spot_rows: spot.length,
}, null, 2));
