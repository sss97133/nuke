// node --test scripts/org-tagging/review-gps-org-links.test.mjs
// ruleFor() must decide a photo as auto_tag_organization_from_gps does; these are the cases of
// supabase/sql/test_gps_org_tag_proposes_pending.sql, at the same coordinates.
import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeLink, ruleFor } from './review-gps-org-links.mjs';

const U = 'u1', U2 = 'u2';
const org = { A: [35.972666, -114.85595], B: [35.972836, -114.855666], C: [35.972719, -114.855269], D: [35.9772094, -114.853624],
  E: [35.99, -114.84], F: [36.1, -115.1], G: [36.1003, -115.1002], H: [36.2, -115.07], I: [36.3, -115.2],
  J: [36.4, -115.3], K: [36.4, -115.29721] };
const points = new Map(Object.entries(org).map(([id, [lat, lon]]) => [id, [{ location_id: id === 'I' ? null : `loc-${id}`, lat, lon }]]));
const member = (organization_id, end_date = null) => ({ organization_id, status: 'active', end_date });
const ctx = {
  memberships: new Map([[U, [member('A'), member('B'), member('C'), member('D'), member('F'), member('H', '2025-12-31'), member('I'),
    member('J'), member('K')]],
    [U2, [member('A')]]]),
  points,
  decided: new Set(['v4|D', 'v5|D', 'v9|D']),
  windows: new Map([['v6|u1', [{ start_date: null, end_date: '2026-02-22' }]]]),
};
const photo = (vehicle_id, user_id, lat, lon, taken_at = '2026-06-01T17:00:00+00:00', extra = {}) =>
  ({ id: `${vehicle_id}-${lat}`, vehicle_id, user_id, lat, lon, taken_at, is_superseded: false, gate: 'pending', ...extra });

test('a site three of his organizations share proposes nothing', () => {
  assert.equal(ruleFor(photo('v1', U, 35.97275, -114.8557), ctx).verdict, 'ambiguous_site');
});
test('the far edge of a shared site is still shared', () => {
  assert.equal(ruleFor(photo('v14', U, 35.97272, -114.85388), ctx).verdict, 'ambiguous_site');
});
test('halfway between two of his organizations 250 m apart is shared', () => {
  assert.equal(ruleFor(photo('v15', U, 36.4, -115.298605), ctx).verdict, 'ambiguous_site');
});
test('a one-organization site proposes that organization at its location', () => {
  const r = ruleFor(photo('v2', U, 35.9773, -114.8537), ctx);
  assert.deepEqual([r.verdict, r.org, r.location_id], ['propose', 'D', 'loc-D']);
  assert.ok(r.metres > 5 && r.metres < 20);
});
test('a member of one of the three at the shared site proposes that one', () => {
  assert.deepEqual(Object.values((({ verdict, org }) => ({ verdict, org }))(ruleFor(photo('v12', U2, 35.97275, -114.8557), ctx))), ['propose', 'A']);
});
test('organizations he does not belong to are never candidates', () => {
  assert.equal(ruleFor(photo('v3', U, 35.9901, -114.8401), ctx).verdict, 'no_candidate');
  assert.equal(ruleFor(photo('v13', U, 36.10015, -115.1001), ctx).org, 'F');
  assert.equal(ruleFor(photo('v3', 'stranger', 35.9773, -114.8537), ctx).verdict, 'no_candidate');
});
test('a decided triple is not proposed again', () => {
  for (const v of ['v4', 'v5', 'v9']) assert.equal(ruleFor(photo(v, U, 35.9773, -114.8537), ctx).verdict, 'decided');
});
test('the recorded holding bounds the photo; an undated photo against it is refused', () => {
  assert.equal(ruleFor(photo('v6', U, 35.9773, -114.8537, '2026-03-01T17:00:00+00:00'), ctx).verdict, 'outside_window');
  assert.equal(ruleFor(photo('v6', U, 35.9773, -114.8537, null), ctx).verdict, 'outside_window');
  assert.equal(ruleFor(photo('v6', U, 35.9773, -114.8537, '2026-01-10T17:00:00+00:00'), ctx).verdict, 'propose');
});
test('an ended membership covers only photos taken by its end', () => {
  assert.equal(ruleFor(photo('v7', U, 36.2001, -115.0701, '2026-01-05T17:00:00+00:00'), ctx).verdict, 'no_candidate');
  assert.equal(ruleFor(photo('v7', U, 36.2001, -115.0701, '2025-12-01T17:00:00+00:00'), ctx).verdict, 'propose');
});
test('an organization with no located point matches on its own coordinates', () => {
  const r = ruleFor(photo('v8', U, 36.3001, -115.2001), ctx);
  assert.deepEqual([r.verdict, r.org, r.location_id], ['propose', 'I', null]);
});
test('incomplete, gate-rejected and superseded photos are skipped', () => {
  assert.equal(ruleFor(photo(null, U, 35.9773, -114.8537), ctx).verdict, 'incomplete');
  assert.equal(ruleFor(photo('v10', null, 35.9773, -114.8537), ctx).verdict, 'incomplete');
  assert.equal(ruleFor(photo('v10', U, 35.9773, -114.8537, undefined, { gate: 'rejected_misattributed' }), ctx).verdict, 'gate_rejected');
  assert.equal(ruleFor(photo('v10', U, 35.9773, -114.8537, undefined, { is_superseded: true }), ctx).verdict, 'superseded');
});

test('judgeLink names one reason per link', () => {
  const link = (vehicle_id, organization_id, extra = {}) =>
    ({ vehicle_id, organization_id, relationship_type: 'work_location', auto_tagged: true, rejection: null, approved: false, ...extra });
  assert.equal(judgeLink(link('v1', 'A'), [photo('v1', U, 35.97275, -114.8557)], ctx).reason, 'ambiguous_site');
  assert.equal(judgeLink(link('v1', 'E'), [photo('v1', U, 35.9901, -114.8401)], ctx).reason, 'non_member_org');
  assert.equal(judgeLink(link('v1', 'D'), [photo('v1', U, 35.97275, -114.8557)], ctx).reason, 'no_photo_within_150m');
  assert.equal(judgeLink(link('v6', 'D'), [photo('v6', U, 35.9773, -114.8537, '2026-03-01T17:00:00+00:00')], ctx).reason, 'outside_window');
  assert.equal(judgeLink(link('v4', 'D', { rejection: { id: 'r' } }), [photo('v4', U, 35.9773, -114.8537)], ctx).action, 'honor_rejection');
  const proposed = judgeLink(link('v2', 'D'), [photo('v2', U, 35.9780, -114.8536), photo('v2', U, 35.9773, -114.8537)], ctx);
  assert.deepEqual([proposed.reason, proposed.action, proposed.photos_would_propose], ['would_propose', 'mark_pending_and_propose', 2]);
  assert.equal(proposed.evidence.image_id, 'v2-35.9773');
});
