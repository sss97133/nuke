import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedVersions, collisions, openPrs, main } from './migration-versions-vs-open-prs.mjs';

const mig = (v, name = 'x', changeType = 'ADDED') => ({ path: `supabase/migrations/${v}_${name}.sql`, changeType });

test('addedVersions: added and renamed-in migrations only, not tests, reverts or modified files', () => {
  const v = addedVersions([
    mig('20261126001000', 'a'),
    mig('20261126013700', 'b', 'RENAMED'),
    mig('20261125200000', 'c', 'MODIFIED'),
    mig('20261125100000', 'd', 'DELETED'),
    { path: 'supabase/sql/revert_20261126002000_e.sql', changeType: 'ADDED' },
    { path: 'supabase/migrations/sub/20261126003000_f.sql', changeType: 'ADDED' },
    { path: 'supabase/migrations/20261126_short.sql', changeType: 'ADDED' },
  ]);
  assert.deepEqual([...v.keys()].sort(), ['20261126001000', '20261126013700']);
});

test('collisions: the later PR fails, the earlier one only warns', () => {
  const prs = [
    { number: 3957, files: [mig('20261126001000', 'relink')] },
    { number: 3962, files: [mig('20261126001000', 'watch')] },
    { number: 3970, files: [mig('20261126014900', 'kind')] },
  ];
  const later = collisions(3962, prs);
  assert.equal(later.errors.length, 1);
  assert.equal(later.errors[0].other, 3957);
  assert.equal(later.warnings.length, 0);
  const earlier = collisions(3957, prs);
  assert.equal(earlier.errors.length, 0);
  assert.equal(earlier.warnings.length, 1);
  assert.equal(earlier.warnings[0].other, 3962);
  assert.deepEqual(collisions(3970, prs).errors, []);
});

test('collisions: a PR that only modifies a migration claims nothing', () => {
  const prs = [
    { number: 3935, files: [mig('20261125200000', 'scan', 'MODIFIED')] },
    { number: 3999, files: [mig('20261125200000', 'other')] },
  ];
  assert.deepEqual(collisions(3999, prs).errors, []);
});

test('collisions: a stacked PR carrying its parent migration file (same path) is not a collision', () => {
  const prs = [
    { number: 3947, files: [mig('20261125230000', 'custody')] },
    { number: 3980, files: [mig('20261125230000', 'custody'), mig('20261126003000', 'follow')] },
  ];
  assert.deepEqual(collisions(3980, prs).errors, []);
  assert.deepEqual(collisions(3947, prs).warnings, []);
});

test('openPrs: pages pull requests and a PR with more than 100 files', async () => {
  const calls = [];
  const gql = async (q, v) => {
    calls.push(v);
    if (v.number) {
      return { repository: { pullRequest: { files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [mig('20261126009900', 'late')] } } } };
    }
    if (!v.after) {
      return { repository: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [
        { number: 1, files: { pageInfo: { hasNextPage: true, endCursor: 'f1' }, nodes: [mig('20261126000100')] } },
      ] } } };
    }
    return { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
      { number: 2, files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [mig('20261126009900')] } },
    ] } } };
  };
  const prs = await openPrs(gql, 'o', 'n');
  assert.equal(prs.length, 2);
  assert.equal(prs[0].files.length, 2);
  assert.equal(calls.length, 3);
  assert.equal(collisions(2, prs).errors[0].other, 1);
});

test('main: exit 1 on a collision with an earlier PR, on an API error, and without PR; 0 otherwise', async () => {
  const quiet = { log() {}, error() {} };
  const page = (nodes) => async () => ({ repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
  const pr = (number, files) => ({ number, files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: files } });
  const env = { PR: '20', GITHUB_REPOSITORY: 'o/n' };
  assert.equal(await main(env, page([pr(10, [mig('20261126001000', 'a')]), pr(20, [mig('20261126001000', 'b')])]), quiet), 1);
  assert.equal(await main(env, page([pr(10, [mig('20261126001000')]), pr(20, [mig('20261126001500')])]), quiet), 0);
  assert.equal(await main({ ...env, PR: '10' }, page([pr(10, [mig('20261126001000', 'a')]), pr(20, [mig('20261126001000', 'b')])]), quiet), 0);
  assert.equal(await main(env, async () => { throw new Error('GraphQL HTTP 502'); }, quiet), 1);
  assert.equal(await main({ GITHUB_REPOSITORY: 'o/n' }, page([]), quiet), 1);
});
