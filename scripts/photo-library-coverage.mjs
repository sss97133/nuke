#!/usr/bin/env node
/**
 * Photo library coverage report: the completion metric for photo sorting.
 *
 * Reads capture_library_coverage_v1 (service role) and prints, per capture month:
 * the library census count L (or "unknown" until a census exists), the Nuke-side ledger states, inventory
 * drain states, unowned-but-linked rows, and coverage. "unsorted = 0" alone is not completion. Done means
 * every month has a fresh full census, pending = 0, in_nuke_unsorted = 0 and unowned_linked = 0.
 *
 * Usage:
 *   dotenvx run -- node scripts/photo-library-coverage.mjs [--user <uuid>] [--from 2017-01-01] [--to YYYY-MM-DD] [--json]
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). Never printed.
 */
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL_ = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and a service key are required'); process.exit(2); }
const body = {
  p_uid: arg('--user', process.env.NUKE_USER_ID || '0b9f107a-d124-49de-9ded-94698f63c1c4'),
  p_tz: arg('--tz', 'America/Los_Angeles'),
  p_from: arg('--from', '2017-01-01'),
  p_to: arg('--to', null),
};

const res = await fetch(`${URL_}/rest/v1/rpc/capture_library_coverage_v1`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(300_000),
});
if (!res.ok) { console.error(`coverage RPC failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const rows = await res.json();
if (args.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const sum = (rs, k) => rs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
const fmt = (v) => (v === null || v === undefined ? '?' : String(v));
const census = rows[0]?.library_count_status ?? 'unknown_no_census';
console.log(`Photo library coverage: capture months in ${body.p_tz}`);
if (census === 'unknown_no_census') {
  console.log('LIBRARY COUNT UNKNOWN: no census has been reported yet (phone app #3033 + census, or the Mac Photos census script).');
  console.log('The Nuke-side numbers below only cover photos that reached Nuke. They are not a share of the library.');
} else {
  console.log(`Library census: ${census}, ${rows[0].census_origins} origin(s), oldest ${rows[0].census_oldest_finished_at} (${rows[0].census_age_hours} h old)`);
}
const cols = ['month', 'library_count', 'nuke_rows', 'sorted', 'held_for_review', 'in_nuke_unsorted', 'kept_as_evidence',
  'counted_elsewhere', 'pending', 'gave_up', 'unowned_linked_rows', 'coverage_pct'];
const head = ['month', 'L', 'nuke', 'sorted', 'held', 'unsorted', 'kept_ev', 'elsewhere', 'pending', 'gave_up', 'unowned', 'cov%'];
console.log(head.map((h) => h.padStart(9)).join(''));
for (const r of rows) console.log(cols.map((c) => fmt(r[c]).padStart(9)).join(''));

const byYear = new Map();
for (const r of rows) { const y = r.month.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(r); }
console.log('\nBy year:');
for (const [y, rs] of byYear) {
  console.log(`  ${y}: nuke ${sum(rs, 'nuke_rows')}, sorted ${sum(rs, 'sorted')}, held ${sum(rs, 'held_for_review')}, ` +
    `unsorted ${sum(rs, 'in_nuke_unsorted')}, unowned ${sum(rs, 'unowned_linked_rows')}` +
    (rs.every((r) => r.library_count === null) ? ', library ?' : `, library ${sum(rs, 'library_count')}`));
}
const thin = rows.filter((r) => r.month !== 'undated' && Number(r.nuke_rows) <= 10).map((r) => `${r.month}(${r.nuke_rows})`);
console.log(`\nMonths with 10 or fewer photos in Nuke: ${thin.join(' ') || 'none'}`);
const backlog = sum(rows, 'in_nuke_unsorted') + sum(rows, 'pending') + sum(rows, 'gave_up') + sum(rows, 'unowned_linked_rows');
console.log(`Backlog (unsorted + pending + gave_up + unowned linked): ${backlog}; held for review: ${sum(rows, 'held_for_review')}`);
const done = census !== 'unknown_no_census' && !String(census).startsWith('limited') && backlog === 0 &&
  rows.every((r) => Number(r.census_age_hours ?? 1e9) < 24);
console.log(`Done by the coverage definition: ${done ? 'YES' : 'NO'}`);
