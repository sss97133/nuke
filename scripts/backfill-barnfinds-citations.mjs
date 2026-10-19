// Backfill Barn Finds citations from the pages already kept (listing_page_snapshots, platform barnfinds): no fetch, no credits.
// Calls extract-barn-finds-listing {action: "cite_snapshots"} in batches walking snapshots by fetched_at; each batch records
// every post's cited listings on its event and folds the post's vehicle into the listing's vehicle where the listing is held
// (vehicle_merge_proposals + merge_into_primary). Resumable: pass --after <fetched_at> from the log's last line.
//
//   cd ~/nuke && dotenvx run -q -- node scripts/backfill-barnfinds-citations.mjs [--after ISO] [--limit 40] [--max-batches N]
//     [--dry-run] [--log path] [--sleep-ms 2000]
//
// Hold the db-heavy lock while it runs.
import { appendFileSync, writeFileSync } from 'node:fs';

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
const url = `${process.env.SUPABASE_URL}/functions/v1/extract-barn-finds-listing`;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (run under dotenvx)'); process.exit(2); }

const limit = Number(arg('--limit', 40));
const maxBatches = Number(arg('--max-batches', 100000));
const sleepMs = Number(arg('--sleep-ms', 2000));
const log = arg('--log');
const dryRun = flag('--dry-run');
let after = arg('--after');

const total = {};
const add = (k, v) => {
  if (typeof v === 'number') total[k] = (total[k] ?? 0) + v;
  else if (v && typeof v === 'object' && !Array.isArray(v)) { total[k] ??= {}; for (const [kk, vv] of Object.entries(v)) total[k][kk] = (total[k][kk] ?? 0) + vv; }
};
const say = (line) => { console.log(line); if (log) appendFileSync(log, `${line}\n`); };

for (let b = 0; b < maxBatches; b++) {
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cite_snapshots', after, limit, dry_run: dryRun }), signal: AbortSignal.timeout(150_000) });
      res = await r.json();
      if (res.success) break;
      throw new Error(res.error ?? `HTTP ${r.status}`);
    } catch (e) {
      if (attempt >= 3) { say(`stop: batch after=${after} failed 3 times: ${e.message}`); process.exit(1); }
      await new Promise((ok) => setTimeout(ok, 10_000 * attempt));
    }
  }
  for (const [k, v] of Object.entries(res)) if (!['success', 'next_after', 'done', 'errors'].includes(k)) add(k, v);
  if (res.errors?.length) add('error_count', res.errors.length);
  say(JSON.stringify({ batch: b, after, next_after: res.next_after, snapshots: res.snapshots, posts: res.posts, bind: res.bind, merged: res.merged, errors: res.errors?.slice(0, 3) }));
  after = res.next_after;
  if (res.done || !after) break;
  await new Promise((ok) => setTimeout(ok, sleepMs));
}
say(`total ${JSON.stringify(total)}`);
if (arg('--summary')) writeFileSync(arg('--summary'), JSON.stringify({ finished_at: new Date().toISOString(), last_after: after, dry_run: dryRun, total }, null, 1));
