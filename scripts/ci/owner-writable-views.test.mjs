// Contract for scripts/ci/owner-writable-views.mjs: the README line, the allowed view, and what fails the daily run.
//   node --test scripts/ci/owner-writable-views.test.mjs   (run by scripts/ci/verify.sh)
// Rows are shaped like the live query's: view, owner, writes. geometry_columns' row is the one measured on 2026-10-14;
// the other two are the shapes 20261014124500 closed (every write by default) and a column grant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED,
  OWNER_WRITABLE_VIEWS_SQL,
  ownerWritableViews,
  ownerWritableViewsLine,
  ownerWritableViewsReport,
} from './owner-writable-views.mjs';

const ALL = 'anon:INSERT,anon:UPDATE,anon:DELETE,anon:TRUNCATE,authenticated:INSERT,authenticated:UPDATE,authenticated:DELETE,authenticated:TRUNCATE';
const GC = { view: 'geometry_columns', owner: 'supabase_admin', writes: ALL };
const VD = { view: 'vehicle_display_names', owner: 'postgres', writes: ALL };
const CG = { view: 'v_column_grant', owner: 'postgres', writes: 'authenticated:UPDATE' };

test('only the allowed view matching prints a zero and names what is allowed', () => {
  const line = ownerWritableViewsLine([GC]);
  assert.match(line, /^Owner-run views in `public` that anon or authenticated can write through, past row-level security: 0\. /);
  assert.match(line, /Allowed: `geometry_columns` \(PostGIS view owned by supabase_admin; its insert, update and delete rules are DO INSTEAD NOTHING\)\.$/);
  assert.equal(ownerWritableViewsLine([]), line, 'no rows at all reads the same');
});

test('every other view is counted and named with each role and its writes', () => {
  const line = ownerWritableViewsLine([GC, VD, CG]);
  assert.match(line, /past row-level security: 2: /);
  assert.match(line, /`vehicle_display_names` \(anon INSERT, UPDATE, DELETE, TRUNCATE; authenticated INSERT, UPDATE, DELETE, TRUNCATE\)/);
  assert.match(line, /`v_column_grant` \(authenticated UPDATE\)/);
  assert.doesNotMatch(line.split('Allowed:')[0], /geometry_columns/, 'the allowed view is not in the count or the list');
});

test('the allowed view never fails the run; any other view does, every day it stays', () => {
  assert.deepEqual(ownerWritableViews([GC, VD]), [VD]);
  assert.equal(ownerWritableViewsReport([]), null);
  assert.equal(ownerWritableViewsReport([GC]), null);
  const report = ownerWritableViewsReport([GC, CG]);
  assert.match(report, /^OWNER-RUN VIEW WRITABLE BY VISITORS: v_column_grant \(authenticated UPDATE\)\. /);
  assert.match(report, /20261014124500_owner_view_writes_revoked\.sql/);
  assert.match(report, /security_invoker = true/);
  assert.doesNotMatch(report, /geometry_columns/);
  assert.equal(ownerWritableViewsReport([CG]), report, 'no memory of the previous block: it fails again tomorrow');
});

test('a name is allowed only when it is listed itself, not through the prototype', () => {
  assert.equal(ownerWritableViews([{ view: 'toString', owner: 'postgres', writes: 'anon:DELETE' }]).length, 1);
  assert.deepEqual(Object.keys(ALLOWED), ['geometry_columns']);
});

test('the query reads public views by owner, invoker, updatability and the two API roles', () => {
  assert.match(OWNER_WRITABLE_VIEWS_SQL, /c\.relnamespace = 'public'::regnamespace and c\.relkind = 'v'/);
  assert.match(OWNER_WRITABLE_VIEWS_SQL, /o\.rolbypassrls/);
  assert.match(OWNER_WRITABLE_VIEWS_SQL, /option_name = 'security_invoker'/);
  assert.match(OWNER_WRITABLE_VIEWS_SQL, /pg_relation_is_updatable\(c\.oid, false\) & 28\) > 0/);
  assert.match(OWNER_WRITABLE_VIEWS_SQL, /has_any_column_privilege\(r\.role, c\.oid, 'UPDATE'\)/);
  assert.match(OWNER_WRITABLE_VIEWS_SQL, /has_table_privilege\(r\.role, c\.oid, 'TRUNCATE'\)/);
  assert.doesNotMatch(OWNER_WRITABLE_VIEWS_SQL, /;/, 'the caller wraps it in a read-only transaction');
});
