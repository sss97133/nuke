// pubfeat-05-apply.mjs — Stage 05: write verified matches to publication_features.
//
// Safety model:
//   - refuses to run unless calibration-report.json has gate_passed: true
//   - every org_id must exist in the exported BL slice; LLM matches must also
//     be members of that feature's candidate shortlist
//   - fresh snapshot of every target row is taken first (rollback input)
//   - guarded PATCH: ...?id=eq.<id>&org_id=is.null  → never clobbers a link
//   - batches of 50 with 250ms pauses (Hard Rules: no unbounded writes)
//   - DRY-RUN by default; pass --apply to execute
//
// Usage: node scripts/stbarth/pubfeat-05-apply.mjs [run-dir] [--apply]

import {
  restClient, sleep, latestRunDir, readJson, writeJson,
} from './pubfeat-lib.mjs';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const dirArg = argv.find((a) => !a.startsWith('--'));
const dir = dirArg ?? latestRunDir();

const calibration = readJson(dir, 'calibration-report.json');
if (!calibration.gate_passed) {
  console.error('REFUSING: calibration gate not passed (calibration-report.json).');
  process.exit(1);
}

const deterministic = readJson(dir, 'matches-deterministic.json');
const verified = readJson(dir, 'matches-verified.json'); // from the Opus fleet
const orgs = readJson(dir, 'organizations-bl.json');
const ambiguous = readJson(dir, 'ambiguous.json');

const orgIds = new Set(orgs.map((o) => o.id));
const orgName = new Map(orgs.map((o) => [o.id, o.business_name]));
const shortlistByFeature = new Map(
  ambiguous.map((e) => [e.feature.id, new Set(e.shortlist.map((c) => c.id))])
);

// Assemble the write set with validation
const writes = [];
const invalid = [];
for (const m of deterministic) {
  if (!orgIds.has(m.org_id)) { invalid.push({ ...m, why: 'org not in BL slice' }); continue; }
  writes.push({ feature_id: m.feature_id, org_id: m.org_id, confidence: m.confidence, method: m.method, evidence: m.evidence });
}
for (const m of verified) {
  if (!orgIds.has(m.decision)) { invalid.push({ ...m, why: 'org not in BL slice' }); continue; }
  const sl = shortlistByFeature.get(m.feature_id);
  if (!sl || !sl.has(m.decision)) { invalid.push({ ...m, why: 'decision outside feature shortlist' }); continue; }
  writes.push({
    feature_id: m.feature_id, org_id: m.decision, confidence: m.confidence,
    method: 'opus', evidence: m.evidence, skeptics: m.skeptics ?? null,
  });
}

// Duplicate-feature guard
const seen = new Set();
for (const w of writes) {
  if (seen.has(w.feature_id)) {
    console.error(`REFUSING: duplicate write for feature ${w.feature_id}`);
    process.exit(1);
  }
  seen.add(w.feature_id);
}

console.log(`write set: ${writes.length} (deterministic ${deterministic.length}, opus-verified ${verified.length}, invalid ${invalid.length})`);
if (invalid.length) console.log('invalid entries:', JSON.stringify(invalid, null, 2));

const db = restClient();

// Fresh snapshot of target rows (also re-checks org_id is still null)
const ids = writes.map((w) => w.feature_id);
const current = [];
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50);
  current.push(
    ...(await db.getAll('publication_features', `id=in.(${chunk.join(',')})&select=id,org_id,confidence,details`))
  );
}
const currentById = new Map(current.map((r) => [r.id, r]));
const conflicted = writes.filter((w) => currentById.get(w.feature_id)?.org_id !== null);
if (conflicted.length) {
  console.log(`WARNING: ${conflicted.length} rows no longer have org_id null — they will be SKIPPED (guard would no-op anyway).`);
}
const applicable = writes.filter((w) => currentById.get(w.feature_id)?.org_id === null);

writeJson(dir, 'snapshot-features.json', {
  run_id: dir.split('/').pop(),
  table: 'publication_features',
  rows: applicable.map((w) => ({
    id: w.feature_id,
    before: currentById.get(w.feature_id),
    after: { org_id: w.org_id, confidence: w.confidence },
  })),
});

if (!apply) {
  console.log('\n── DRY RUN (pass --apply to execute) ──');
  for (const w of applicable) {
    console.log(`${w.feature_id} → ${orgName.get(w.org_id)} [${w.method}] conf=${w.confidence}`);
  }
  console.log(`\nWould update ${applicable.length} rows. Snapshot written.`);
  process.exit(0);
}

const applied = [];
const errors = [];
for (let i = 0; i < applicable.length; i += 50) {
  const batch = applicable.slice(i, i + 50);
  for (const w of batch) {
    const row = currentById.get(w.feature_id);
    const details = {
      ...(row.details || {}),
      org_match: {
        method: w.method,
        confidence: w.confidence,
        evidence: w.evidence,
        ...(w.skeptics ? { skeptics: w.skeptics } : {}),
        run_id: dir.split('/').pop(),
      },
    };
    try {
      const res = await db.patch(
        'publication_features',
        `id=eq.${w.feature_id}&org_id=is.null`,
        { org_id: w.org_id, confidence: w.confidence, details }
      );
      if (res.length === 1) applied.push({ feature_id: w.feature_id, org_id: w.org_id });
      else errors.push({ feature_id: w.feature_id, why: `guard matched ${res.length} rows` });
    } catch (e) {
      errors.push({ feature_id: w.feature_id, why: String(e).slice(0, 300) });
    }
  }
  await sleep(250);
  console.log(`applied ${Math.min(i + 50, applicable.length)}/${applicable.length}...`);
}

writeJson(dir, 'apply-log.json', {
  applied_at: new Date().toISOString(),
  applied_count: applied.length,
  error_count: errors.length,
  applied,
  errors,
  skipped_conflicts: conflicted.map((w) => w.feature_id),
});
console.log(`\nAPPLIED: ${applied.length}  errors: ${errors.length}  skipped: ${conflicted.length}`);
if (errors.length) console.log(JSON.stringify(errors, null, 2));
