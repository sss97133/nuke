// Actual fold migrations -> actual public profile SQL. Synthetic PG17 only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { ORG_ACTIVITY_SQL } from '../supabase/functions/db-stats/intakeStatus.ts';

assert.match(process.env.PGDATABASE ?? '', /^dm_refinement_org_activity_/);
function sql(query, args = []) {
  const r = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', ...args], { input: query, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
sql('', ['-f', 'supabase/sql/test_organization_listing_activity.sql']);
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reading = n => JSON.parse(sql(`PREPARE profile(uuid) AS SELECT row_to_json(r) FROM (${ORG_ACTIVITY_SQL}) r; EXECUTE profile('${uid(n)}');`));
const a = reading(1);
assert.equal(a.rows[0].total_listings, 6001);
assert.equal(a.rows[0].currencies[0].currency, 'USD');
assert.equal(a.rows[0].currencies[0].total, 6001);
assert.equal(a.rows[0].sell_through_rate, 100);
assert.equal(reading(2).rows[0].sell_through_rate, null);
assert.deepEqual(reading(3).rows, [], 'Private organization cache cannot cross public reader');
assert.deepEqual(reading(99).rows, [], 'Missing organization is not evidence');
sql(`UPDATE public.organization_seller_stats SET evidence_summary=NULL WHERE organization_id='${uid(4)}';`);
assert.deepEqual(reading(4).rows, [], 'Legacy unqualified cache is not admitted');
sql(`UPDATE public.organization_seller_stats SET evidence_summary=evidence_summary || '{"private_contact":"PRIVATE_SENTINEL"}'::jsonb WHERE organization_id='${uid(1)}';`);
assert(!JSON.stringify(reading(1)).includes('PRIVATE_SENTINEL'), 'Reader projects a whitelist, not cache payloads');

// Hold the actual per-org lock in a second session. Reject the same cohort,
// allow an unrelated cohort, and leave the first cache intact.
const locker = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
const finished = new Promise((resolve, reject) => {
  locker.on('error', reject); locker.on('exit', code => code === 0 ? resolve() : reject(new Error(`lock fixture exit ${code}`)));
});
await new Promise((resolve, reject) => {
  locker.on('error', reject);
  locker.stdout.on('data', chunk => { if (chunk.toString().includes('locked')) resolve(); });
  locker.stdin.end(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('organization_listing_activity:${uid(1)}',0)); SELECT 'locked'; SELECT pg_sleep(3); ROLLBACK;`);
});
const held = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
  input: `SELECT public.compute_organization_listing_activity('${uid(1)}');`, encoding: 'utf8' });
assert.notEqual(held.status, 0);
assert.match(held.stderr, /organization_fold_busy/);
assert.equal(JSON.parse(sql(`SELECT public.compute_organization_listing_activity('${uid(2)}');`)).total_listings, 11);
assert.equal(reading(1).rows[0].total_listings, 6001);
await finished;
console.log('Organization fold, concurrency and public profile reader contracts passed.');
