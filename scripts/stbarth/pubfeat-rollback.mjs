// pubfeat-rollback.mjs — restore publication_features org links from a run's
// snapshot file.
//
// No-clobber guard: a row is only restored if its CURRENT org_id equals what
// the run wrote (i.e., nothing else has touched it since).
//
// Usage:
//   node scripts/stbarth/pubfeat-rollback.mjs <run-dir> [--apply]
//     (default is dry-run: prints the restore plan)

import fs from 'node:fs';
import path from 'node:path';
import { restClient, sleep, readJson, writeJson } from './pubfeat-lib.mjs';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const dirArg = argv.find((a) => !a.startsWith('--'));
if (!dirArg) {
  console.error('Usage: node pubfeat-rollback.mjs <run-dir> [--apply]');
  process.exit(1);
}
const dir = path.isAbsolute(dirArg) ? dirArg : path.join(import.meta.dirname, 'data', dirArg);
if (!fs.existsSync(path.join(dir, 'snapshot-features.json'))) {
  console.error(`No snapshot-features.json in ${dir}`);
  process.exit(1);
}

const db = restClient();
const snap = readJson(dir, 'snapshot-features.json');
const log = { restored: [], skipped: [], errors: [] };
console.log(`features snapshot: ${snap.rows.length} rows`);

for (let i = 0; i < snap.rows.length; i += 50) {
  for (const r of snap.rows.slice(i, i + 50)) {
    if (!apply) { log.restored.push({ id: r.id, to: r.before.org_id }); continue; }
    try {
      const res = await db.patch(
        'publication_features',
        `id=eq.${r.id}&org_id=eq.${r.after.org_id}`,
        { org_id: r.before.org_id, confidence: r.before.confidence, details: r.before.details }
      );
      (res.length === 1 ? log.restored : log.skipped).push({ id: r.id });
    } catch (e) {
      log.errors.push({ id: r.id, why: String(e).slice(0, 200) });
    }
  }
  if (apply) await sleep(250);
}

writeJson(dir, apply ? 'rollback-log.json' : 'rollback-plan.json', log);
console.log(`\n${apply ? 'ROLLBACK EXECUTED' : 'DRY RUN'}: restore=${log.restored.length} skipped=${log.skipped.length} errors=${log.errors.length}`);
